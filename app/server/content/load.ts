import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT, docIdOf, walkMarkdown } from './paths.ts';
import { ContentError, anchor, parseMarkdown, type RawDoc } from './markdown.ts';
import { docGenerators, expandNode, type ExpandContext, type TargetInfo } from './options.ts';
import { parseRenderer, readYaml, str, strArray, strMap } from './yaml.ts';
import { loadCharacters } from './portrait.ts';
import type {
  Doc,
  DocumentDef,
  EpisodeDef,
  GameContent,
  Node,
  RendererDef,
  WordDef,
} from '../../shared/types.ts';

/**
 * Сборка всего контента в один объект, который уезжает клиенту как JSON.
 *
 * Здесь же резолвятся ссылки: чтобы `[[rooms/коридор]]` превратить в адрес, надо
 * видеть весь vault сразу, поэтому парсер этим не занимается.
 */

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function dirOf(docId: string): string {
  return docId.split('/').slice(0, -1).join('/');
}

function episodeOf(docId: string): string | null {
  const m = /^episodes\/([^/]+)\//.exec(docId);
  return m ? m[1]! : null;
}

interface Parsed {
  raw: RawDoc;
  docId: string;
  /** Внутриигровая дата сцены; если не задана — берётся из эпизода. */
  date: string | null;
  info: TargetInfo;
  exits: string[];
  items: string[];
}

function buildResolver(parsed: Map<string, Parsed>): ExpandContext {
  // Obsidian ищет заметку по имени файла в любом месте vault — автор пишет
  // `[[коридор]]`, а не путь. Повторяем это, но на неоднозначности ругаемся.
  const byBasename = new Map<string, string[]>();
  for (const docId of parsed.keys()) {
    const name = docId.split('/').pop()!;
    byBasename.set(name, [...(byBasename.get(name) ?? []), docId]);
  }

  return {
    get: (docId) => parsed.get(docId)?.info,
    resolve(fromDocId, ref, line) {
      const from = parsed.get(fromDocId)!;
      const clean = ref.split('|')[0]!.trim();
      const hash = clean.indexOf('#');
      const filePart = (hash === -1 ? clean : clean.slice(0, hash)).trim();
      const nodePart = hash === -1 ? '' : clean.slice(hash + 1).trim();
      const nodeId = anchor(nodePart);

      let docId: string | null = null;
      if (filePart === '') {
        docId = fromDocId;
      } else {
        const relative = normalize(`${dirOf(fromDocId)}/${filePart}`);
        const candidates = byBasename.get(filePart.split('/').pop()!) ?? [];
        if (parsed.has(relative)) docId = relative;
        else if (parsed.has(normalize(filePart))) docId = normalize(filePart);
        else if (candidates.length === 1) docId = candidates[0]!;
        else if (candidates.length > 1) {
          throw new ContentError(
            from.raw.path,
            `ссылка [[${ref}]] неоднозначна: подходят ${candidates.join(', ')}`,
            line,
          );
        }
      }

      if (docId == null) throw new ContentError(from.raw.path, `битая ссылка [[${ref}]]`, line);

      const target = parsed.get(docId)!;
      if (!target.info.nodeIds.has(nodeId)) {
        throw new ContentError(from.raw.path, `в "${docId}" нет узла "${nodeId || '(вступление)'}"`, line);
      }
      return { docId, nodeId };
    },
  };
}

/**
 * Сроки эпизода. Пишутся коротко, когда нужна только дата, и полно, когда нужна
 * своя подпись в статусе:
 *
 *   dates:
 *     blueCard: {label: BLUE CARD, at: 31.12.2026}
 *     hearing: 03.03.2027
 */
function parseDates(file: string, id: string, raw: unknown): EpisodeDef['dates'] {
  if (raw == null) return {};
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new ContentError(file, `эпизод "${id}": dates — это пары «имя: дата» или «имя: {label, at}»`);
  }

  const out: EpisodeDef['dates'] = {};
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const full = value != null && typeof value === 'object' && !Array.isArray(value);
    const spec = full ? (value as Record<string, unknown>) : { at: value };
    out[name.trim()] = {
      label: String(spec.label ?? name).trim(),
      at: spec.at == null ? null : String(spec.at).trim(),
      // Срок, который прошёл, показывается словом, а не отрицательным числом.
      // Слово настраивается: карта истекла, а срок — истёк.
      expired: String(spec.expired ?? 'истекла').trim(),
    };
  }
  return out;
}

function parseEpisodes(gameFile: string, game: Record<string, unknown>): EpisodeDef[] {
  const list = Array.isArray(game.episodes) ? game.episodes : [];
  return list.map((rawEntry) => {
    const entry = (rawEntry ?? {}) as Record<string, unknown>;
    const id = str(gameFile, entry.id, 'episodes[].id');
    const dir = join(CONTENT, 'episodes', id);
    const cfgFile = join(dir, 'episode.yaml');

    // game.yaml — витрина, episode.yaml — правда: при расхождении выигрывает эпизод.
    const cfg = existsSync(cfgFile) ? readYaml(cfgFile) : {};
    const merged = { ...entry, ...cfg };
    const file = existsSync(cfgFile) ? cfgFile : gameFile;

    const entryRef = str(file, merged.entry, `эпизод "${id}": entry`);
    return {
      id,
      title: String(merged.title ?? id),
      renderer: str(file, merged.renderer, `эпизод "${id}": renderer`),
      entry: `${normalize(`episodes/${id}/${entryRef}`)}#`,
      verbs: strArray(merged.verbs),
      itemVerbs: strArray(merged.itemVerbs),
      characters: strArray(merged.characters),
      paletteOverride: strMap(merged.palette),
      ambience: merged.ambience == null ? null : String(merged.ambience),
      dates: parseDates(file, id, merged.dates),
      tutorial: {
        at: merged.tutorial == null ? null : `${normalize(`episodes/${id}/${String((merged.tutorial as Record<string, unknown>).at ?? '')}`)}#`,
        hint: String((merged.tutorial as Record<string, unknown> | undefined)?.hint ?? ''),
      },
      closed: strArray(merged.closed).map((ref) => normalize(`episodes/${id}/${ref}`)),
    };
  });
}

export function loadContent(): GameContent {
  const gameFile = join(CONTENT, 'game.yaml');
  const game = readYaml(gameFile);

  const parsed = new Map<string, Parsed>();
  for (const file of walkMarkdown()) {
    const raw = parseMarkdown(file, readFileSync(file, 'utf8'));
    const docId = docIdOf(file);
    const name = docId.split('/').pop()!;
    const id = String(raw.fm.id ?? name).trim();
    if (id !== name) {
      throw new ContentError(file, `id "${id}" не совпадает с именем файла "${name}" — id обязан быть стабильным`, 1);
    }
    parsed.set(docId, {
      raw,
      docId,
      date: raw.fm.date == null ? null : String(raw.fm.date).trim(),
      exits: strArray(raw.fm.exits),
      items: strArray(raw.fm.items),
      info: {
        docId,
        type: raw.type,
        label: String(raw.fm.label ?? id),
        nodeIds: new Set(raw.nodes.map((n) => n.id)),
        inHand: strArray(raw.fm.inHand),
        // Порядок страниц считаем один раз здесь: и генератор опций, и клиент,
        // и валидатор обязаны видеть один и тот же порядок.
        pages: raw.nodes
          .filter((n) => n.id !== '' && n.attrs.page != null)
          .sort((a, b) => a.attrs.page! - b.attrs.page!)
          .map((n) => n.id),
      },
    });
  }

  const ctx = buildResolver(parsed);
  const episodes = parseEpisodes(gameFile, game);

  const docs: Record<string, Doc> = {};
  const nodes: Record<string, Node> = {};
  const words: Record<string, WordDef> = {};
  const documents: Record<string, DocumentDef> = {};

  for (const p of parsed.values()) {
    // Блок `options` — свойство комнаты и объявляется один раз; а вот предметы
    // и выходы у каждого состояния свои, поэтому раскрытие идёт по узлу.
    // Только объявленная дата: подставить сюда эпизодную нельзя, иначе комната,
    // у которой своей даты нет, откатывала бы текущую дату к началу эпизода.
    const date = p.date;

    const built: Node[] = p.raw.nodes.map((node) => {
      const exits = [...p.exits, ...node.attrs.exits];
      const items = [...p.items, ...node.attrs.items];
      const { options, pending, generators } = expandNode(
        ctx,
        p.raw,
        p.docId,
        node,
        exits,
        items,
        docGenerators(p.raw, exits, items),
      );
      return {
        id: node.id,
        addr: `${p.docId}#${node.id}`,
        date,
        line: node.line,
        attrs: node.attrs,
        text: node.text,
        options,
        pending,
        generators,
      };
    });

    for (const node of built) nodes[node.addr] = node;

    // id совпадает с именем файла — это проверено выше и обязано быть стабильным ([[06-выпуск]]).
    const id = p.docId.split('/').pop()!;

    docs[p.docId] = {
      id,
      docId: p.docId,
      path: p.raw.path,
      type: p.raw.type,
      label: p.info.label,
      date,
      fm: p.raw.fm,
      nodes: built,
      pages: p.info.pages,
      exits: p.exits,
      items: p.items,
      inHand: p.info.inHand,
      optionBlocks: p.raw.nodes.filter((n) => n.generators.length > 0).map((n) => n.generators[0]!.line),
    };

    const intro = built[0]?.text ?? '';

    if (p.raw.type === 'word') {
      words[id] = {
        id,
        label: p.info.label,
        category: String(p.raw.fm.category ?? 'прочее'),
        text: intro,
      };
    }
    if (p.raw.type === 'doc') {
      documents[id] = {
        id,
        label: p.info.label,
        grif: p.raw.fm['гриф'] == null ? null : String(p.raw.fm['гриф']),
        date: p.raw.fm['дата'] == null ? null : String(p.raw.fm['дата']),
        text: intro,
      };
    }
  }

  const renderers: Record<string, RendererDef> = {};
  for (const [id, raw] of Object.entries(strObject(game.renderers))) {
    renderers[id] = parseRenderer(gameFile, id, raw);
  }

  const characters = loadCharacters(join(CONTENT, 'characters'), episodes.map((e) => e.id));

  // Справочник статичен и доступен с первой минуты, поэтому это просто плоский
  // список, а не заметки: одна строка на термин, никакой механики.
  const referenceFile = join(CONTENT, 'reference.yaml');
  const reference = existsSync(referenceFile) ? strMap(readYaml(referenceFile)) : {};

  return {
    title: String(game.title ?? 'Без названия'),
    saveVersion: Number(game.saveVersion ?? 1),
    episodes,
    renderers,
    characters,
    words,
    documents,
    reference,
    nodes,
    docs,
  };
}

function strObject(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
