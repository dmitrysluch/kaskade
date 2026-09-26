import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT, docIdOf, walkMarkdown } from './paths.ts';
import { ContentError, anchor, parseMarkdown, type RawDoc } from './markdown.ts';
import { ANY_STAGE, parseRoomRef, virtDocId } from '../../shared/rooms.ts';
import { mergeRoom, type MergedRoom, type RoomPart } from './rooms.ts';
import { planStages, type Out, type PlanDoc, type StagePlan } from './stages.ts';
import { docGenerators, expandNode, type ExpandContext, type TargetInfo } from './options.ts';
import { parseRenderer, readYaml, str, strArray, strMap } from './yaml.ts';
import { loadCharacters } from './portrait.ts';
import type {
  Doc,
  DocumentDef,
  EpisodeDef,
  GameContent,
  Node,
  ReferenceDef,
  RendererDef,
  StageDef,
  TransitionDef,
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
  /** `undefined` — список не объявлен; `[]` — объявлен пустым, и это решение автора. */
  exits: string[] | undefined;
  items: string[] | undefined;
  /** Постоянный адрес помещения; `null` — заметка помещением не является. */
  persistent: string | null;
  /** Срез версии помещения; `null` — общая часть. */
  stage: string | null;
  /** Именованная входная нода помещения. */
  entry: string | null;
  /** Закрыто ли помещение в этом срезе; `null` — автор не решал. */
  available: boolean | null;
}

/**
 * Поиск заметки по-обсидиановски: относительный путь, точный путь, поиск по
 * имени файла во всём vault. Вынесено отдельно, потому что этим пользуются
 * двое — резолвер ссылок и планировщик срезов.
 */
function fileIndex(parsed: Map<string, Parsed>): Map<string, string[]> {
  const byBasename = new Map<string, string[]>();
  for (const docId of parsed.keys()) {
    const name = docId.split('/').pop()!;
    byBasename.set(name, [...(byBasename.get(name) ?? []), docId]);
  }
  return byBasename;
}

function findDoc(
  parsed: Map<string, Parsed>,
  byBasename: Map<string, string[]>,
  baseDocId: string,
  filePart: string,
): { docId: string | null; ambiguous: string[] } {
  const relative = normalize(`${dirOf(baseDocId)}/${filePart}`);
  const candidates = byBasename.get(filePart.split('/').pop()!) ?? [];

  if (parsed.has(relative)) return { docId: relative, ambiguous: [] };
  if (parsed.has(normalize(filePart))) return { docId: normalize(filePart), ambiguous: [] };
  if (candidates.length === 1) return { docId: candidates[0]!, ambiguous: [] };
  return { docId: null, ambiguous: candidates };
}

/**
 * Разрешение ссылок.
 *
 * Первая ветка — виртуальный адрес помещения: `rooms-virt/` узнаётся **до**
 * файлового поиска, как требует ТЗ. Ссылка без среза получает срез базы,
 * а у сцены среза нет — там остаётся звёздочка, и срез подставит оболочка.
 *
 * Ссылка, которая привела в файл-источник помещения, — ошибка миграции:
 * она обошла бы слияние общей части с версией.
 */
function buildResolver(
  parsed: Map<string, Parsed>,
  rooms: Map<string, { info: TargetInfo; nodeIds: Set<string> }>,
): ExpandContext {
  const byBasename = fileIndex(parsed);

  return {
    get: (docId) => parsed.get(docId)?.info ?? rooms.get(docId)?.info,
    resolve(base, ref, line) {
      const clean = ref.split('|')[0]!.trim();

      const virt = parseRoomRef(clean);
      if (virt) {
        const episode = episodeOf(base.baseDocId) ?? '';
        const stage = virt.stage ?? base.stage ?? ANY_STAGE;
        const docId = virtDocId(episode, virt.persistent, stage);
        const nodeId = anchor(virt.node ?? '');

        // Со звёздочкой проверять нечего: представления ещё нет, срез подставит
        // оболочка. За такие ссылки отвечает валидатор — он знает, в каких
        // срезах играется заметка.
        if (stage !== ANY_STAGE) {
          const room = rooms.get(docId);
          if (!room) {
            throw new ContentError(base.path, `нет помещения ${virt.persistent} в срезе ${stage}`, line);
          }
          if (!room.nodeIds.has(nodeId)) {
            throw new ContentError(
              base.path,
              `в помещении ${virt.persistent}:${stage} нет узла "${nodeId || '(вход)'}"`,
              line,
            );
          }
        }
        return { docId, nodeId };
      }

      const hash = clean.indexOf('#');
      const filePart = (hash === -1 ? clean : clean.slice(0, hash)).trim();
      const nodePart = hash === -1 ? '' : clean.slice(hash + 1).trim();
      const nodeId = anchor(nodePart);

      // `[[#якорь]]` — своя заметка. Для комнаты это собранное представление,
      // а не файл: якорь общей части обязан находиться в версии.
      if (filePart === '') {
        const self = rooms.get(base.selfDocId);
        const nodeIds = self ? self.nodeIds : parsed.get(base.selfDocId)!.info.nodeIds;
        if (!nodeIds.has(nodeId)) {
          throw new ContentError(base.path, `в "${base.selfDocId}" нет узла "${nodeId || '(вступление)'}"`, line);
        }
        return { docId: base.selfDocId, nodeId };
      }

      const { docId, ambiguous } = findDoc(parsed, byBasename, base.baseDocId, filePart);
      if (ambiguous.length > 1) {
        throw new ContentError(base.path, `ссылка [[${ref}]] неоднозначна: подходят ${ambiguous.join(', ')}`, line);
      }
      if (docId == null) throw new ContentError(base.path, `битая ссылка [[${ref}]]`, line);

      const target = parsed.get(docId)!;
      if (target.persistent != null) {
        throw new ContentError(
          base.path,
          `прямая ссылка [[${ref}]] на файл помещения: игровой переход пишется логическим адресом ` +
            `[[rooms-virt/${target.persistent}${nodeId === '' ? '' : `#${nodeId}`}]]`,
          line,
        );
      }
      if (!target.info.nodeIds.has(nodeId)) {
        throw new ContentError(base.path, `в "${docId}" нет узла "${nodeId || '(вступление)'}"`, line);
      }
      return { docId, nodeId };
    },
  };
}


/** Адрес цели по сырой ссылке — без проверки: проверит резолвер и валидатор. */
function addrOf(
  parsed: Map<string, Parsed>,
  byBasename: Map<string, string[]>,
  from: Parsed,
  stage: string,
  ref: string,
): string {
  const clean = ref.split('|')[0]!.trim();
  const virt = parseRoomRef(clean);
  if (virt) {
    const docId = virtDocId(episodeOf(from.docId) ?? '', virt.persistent, virt.stage ?? stage);
    return `${docId}#${anchor(virt.node ?? '')}`;
  }

  const hash = clean.indexOf('#');
  const filePart = (hash === -1 ? clean : clean.slice(0, hash)).trim();
  const nodeId = anchor(hash === -1 ? '' : clean.slice(hash + 1));
  if (filePart === '') return `${from.docId}#${nodeId}`;

  const { docId } = findDoc(parsed, byBasename, from.docId, filePart);
  return docId == null ? '' : `${docId}#${nodeId}`;
}

/**
 * Карточки перехода. Читаются до сборки комнат: срезы мира задают именно они,
 * а от среза зависит, какие представления собирать.
 *
 * Поля берутся как есть — чего не хватает и что не разбирается, покажет
 * валидатор целым списком и с адресами.
 */
function collectTransitions(parsed: Map<string, Parsed>, byBasename: Map<string, string[]>): TransitionDef[] {
  const out: TransitionDef[] = [];
  for (const p of parsed.values()) {
    if (p.raw.type !== 'transition') continue;
    const stage = p.raw.fm.stage == null ? '' : String(p.raw.fm.stage).trim();
    const routes = p.raw.nodes.flatMap((n) => n.transitions).filter((t) => (t.label ?? '') === '');

    out.push({
      id: p.docId.split('/').pop()!,
      docId: p.docId,
      stage,
      date: p.date ?? '',
      location: p.raw.fm.location == null ? '' : String(p.raw.fm.location).trim(),
      timeLabel: p.raw.fm.timeLabel == null ? null : String(p.raw.fm.timeLabel).trim(),
      // Цель одна: две или ни одной — забота валидатора, здесь берём первую.
      target: routes.length === 1 ? addrOf(parsed, byBasename, p, stage, routes[0]!.ref) : '',
    });
  }
  return out;
}

/** Исходящие ссылки заметки — то, по чему планировщик срезов обходит игру. */
function planDocs(parsed: Map<string, Parsed>, byBasename: Map<string, string[]>): Map<string, PlanDoc> {
  const out = new Map<string, PlanDoc>();

  for (const p of parsed.values()) {
    const refs: string[] = [
      ...(p.exits ?? []),
      ...(p.items ?? []),
      ...p.raw.nodes.flatMap((n) => [
        ...n.transitions.map((t) => t.ref),
        ...(n.attrs.goto == null ? [] : [n.attrs.goto]),
        ...n.attrs.exits,
        ...n.attrs.items,
        ...n.generators.flatMap((g) => (Array.isArray(g.source) ? g.source : [])),
      ]),
    ];

    const links: Out[] = [];
    for (const ref of refs) {
      const clean = ref.split('|')[0]!.trim();
      const virt = parseRoomRef(clean);
      if (virt) {
        links.push({ kind: 'room', ref: virt });
        continue;
      }
      const hash = clean.indexOf('#');
      const filePart = (hash === -1 ? clean : clean.slice(0, hash)).trim();
      if (filePart === '') continue;
      const { docId } = findDoc(parsed, byBasename, p.docId, filePart);
      if (docId != null) links.push({ kind: 'doc', docId });
    }

    out.set(p.docId, {
      docId: p.docId,
      path: p.raw.path,
      persistent: p.persistent,
      stage: p.stage,
      out: links,
    });
  }

  return out;
}

/** Собранные помещения по плану срезов: общая часть плюс версия. */
function assembleRooms(
  parsed: Map<string, Parsed>,
  plan: StagePlan,
): Map<string, { room: MergedRoom; info: TargetInfo }> {
  const byPersistent = new Map<string, { common: Parsed | null; versions: Map<string, Parsed> }>();
  for (const p of parsed.values()) {
    if (p.persistent == null) continue;
    const key = `${episodeOf(p.docId) ?? ''}|${p.persistent}`;
    const room = byPersistent.get(key) ?? { common: null, versions: new Map() };
    if (p.stage == null) {
      if (room.common) {
        throw new ContentError(p.raw.path, `у помещения ${p.persistent} две общие части: ${room.common.docId} и ${p.docId}`, 1);
      }
      room.common = p;
    } else {
      const twin = room.versions.get(p.stage);
      if (twin) {
        throw new ContentError(p.raw.path, `у ${p.persistent} две версии среза ${p.stage}: ${twin.docId} и ${p.docId}`, 1);
      }
      room.versions.set(p.stage, p);
    }
    byPersistent.set(key, room);
  }

  const part = (p: Parsed): RoomPart => ({
    docId: p.docId,
    raw: p.raw,
    persistent: p.persistent!,
    stage: p.stage,
    label: p.raw.fm.label == null ? null : String(p.raw.fm.label),
    target: p.raw.fm.target == null ? null : String(p.raw.fm.target).trim(),
    targets: p.info.targets,
    entry: p.entry,
    available: p.available,
    exits: p.exits,
    items: p.items,
  });

  const out = new Map<string, { room: MergedRoom; info: TargetInfo }>();
  for (const slice of plan.slices.values()) {
    const source = byPersistent.get(`${slice.episode}|${slice.persistent}`);
    if (!source) continue;

    const room = mergeRoom(
      slice.episode,
      slice.persistent,
      slice.stage,
      source.common ? part(source.common) : null,
      source.versions.has(slice.stage) ? part(source.versions.get(slice.stage)!) : null,
    );

    const label = room.label ?? slice.persistent;
    out.set(room.docId, {
      room,
      info: {
        docId: room.docId,
        type: 'room',
        label,
        target: room.target ?? label,
        targets: room.targets,
        nodeIds: new Set(room.nodes.map((n) => n.raw.id)),
        inHand: [],
        pages: [],
      },
    });
  }

  return out;
}

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

    /*
     * game.yaml — витрина: порядок эпизодов и общие рендереры (07-оболочка-тз,
     * «game.yaml»). Настройки самого эпизода живут в его `episode.yaml` и только
     * там, поэтому правила приоритета не нужно: у каждого поля один владелец.
     *
     * Раньше приоритет был («при расхождении выигрывает эпизод»), и это худший
     * из вариантов: значение видно в двух местах, а работает одно, — правка
     * в витрине молча не делает ничего.
     */
    const extra = Object.keys(entry).filter((k) => k !== 'id');
    if (extra.length > 0) {
      throw new ContentError(
        gameFile,
        `эпизод "${id}": ${extra.join(', ')} — не дело game.yaml; эти поля живут в episodes/${id}/episode.yaml`,
        1,
      );
    }

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
      speakers: strMap(merged.speakers),
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
      // Объявлен ли список вообще — значимо: `exits: []` у версии значит
      // «выходов нет», а отсутствие списка — «берём общие».
      exits: raw.fm.exits == null ? undefined : strArray(raw.fm.exits),
      items: raw.fm.items == null ? undefined : strArray(raw.fm.items),
      persistent: raw.fm.persistent == null ? null : String(raw.fm.persistent).trim(),
      stage: raw.fm.stage == null ? null : String(raw.fm.stage).trim(),
      entry: raw.fm.entry == null ? null : anchor(String(raw.fm.entry)),
      available: raw.fm.available == null ? null : raw.fm.available !== false,
      info: {
        docId,
        type: raw.type,
        label: String(raw.fm.label ?? id),
        // Форма после глагола: пишется в заметке готовой. Не написана — берём
        // название: у слов вроде `учебник` падеж и так совпадает.
        target: raw.fm.target == null ? String(raw.fm.label ?? id) : String(raw.fm.target).trim(),
        targets: strMap(raw.fm.targets),
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

  const episodes = parseEpisodes(gameFile, game);

  /*
   * Переходы, срезы и сборка помещений — до раскрытия опций: генераторы должны
   * видеть уже собранное представление, иначе `идти в …` возьмёт выходы одного
   * файла вместо слитых.
   */
  const byBasename = fileIndex(parsed);
  const transitionDefs = collectTransitions(parsed, byBasename);
  const plan = planStages(planDocs(parsed, byBasename), transitionDefs, episodes);
  const rooms = assembleRooms(parsed, plan);
  const ctx = buildResolver(parsed, new Map([...rooms].map(([docId, r]) => [docId, { info: r.info, nodeIds: r.info.nodeIds }])));

  const docs: Record<string, Doc> = {};
  const nodes: Record<string, Node> = {};
  const words: Record<string, WordDef> = {};
  /*
   * Справочник статичен, доступен с первой минуты и общий на всю игру
   * (07-оболочка-тз, «Справочник»). Раньше это был плоский yaml «термин: строка»;
   * заметки пришли вместе с разметкой в тексте — упоминание `[[ref-ines|шкала]]`
   * должно во что-то разрешаться, а у строки в словаре нет ни id, ни категории.
   */
  const reference: Record<string, ReferenceDef> = {};
  const documents: Record<string, DocumentDef> = {};

  for (const p of parsed.values()) {
    /*
     * Файл-источник помещения в карты не попадает вовсе ([[13-навигация-и-комнаты-тз]]):
     * его узлы — не игровые адреса, а материал для сборки. Оставь их здесь —
     * и правило о тупиках честно наругается на каждый, а всё, что судит по узлу,
     * найдёт одно и то же дважды.
     */
    if (p.persistent != null) continue;

    // Блок `options` — свойство комнаты и объявляется один раз; а вот предметы
    // и выходы у каждого состояния свои, поэтому раскрытие идёт по узлу.
    // Только объявленная дата: подставить сюда эпизодную нельзя, иначе комната,
    // у которой своей даты нет, откатывала бы текущую дату к началу эпизода.
    const date = p.date;

    const built: Node[] = p.raw.nodes.map((node) => {
      const exits = [...(p.exits ?? []), ...node.attrs.exits];
      const items = [...(p.items ?? []), ...node.attrs.items];
      const { options, pending, generators } = expandNode(
        ctx,
        { path: p.raw.path, baseDocId: p.docId, selfDocId: p.docId, stage: null },
        node,
        exits,
        items,
        docGenerators(p.raw, exits, items),
      );
      return {
        id: node.id,
        addr: `${p.docId}#${node.id}`,
        file: p.raw.path,
        part: 'own',
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
      target: p.info.target,
      targets: p.info.targets,
      date,
      fm: p.raw.fm,
      nodes: built,
      pages: p.info.pages,
      exits: p.exits ?? [],
      items: p.items ?? [],
      inHand: p.info.inHand,
      entry: p.entry,
      available: p.available ?? true,
      optionBlocks: p.raw.nodes
        .filter((n) => n.generators.length > 0)
        .map((n) => ({ file: p.raw.path, line: n.generators[0]!.line })),
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
    if (p.raw.type === 'reference') {
      reference[id] = {
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

  /*
   * Собранные помещения ([[13-навигация-и-комнаты-тз]]). Раскрываются тем же
   * `expandNode`, что сцены и предметы, — но база ссылок у каждого узла своя:
   * относительный путь считается от файла, где узел написан, а `[[#якорь]]`
   * указывает на собранное представление.
   */
  for (const { room } of rooms.values()) {
    const built: Node[] = room.nodes.map((node) => {
      const exits = [...room.exits, ...node.raw.attrs.exits];
      const items = [...room.items, ...node.raw.attrs.items];
      const { options, pending, generators } = expandNode(
        ctx,
        { path: node.file, baseDocId: node.baseDocId, selfDocId: room.docId, stage: room.stage },
        node.raw,
        exits,
        items,
        room.generators.length > 0 ? room.generators : docGenerators({ type: 'room', nodes: [] }, exits, items),
      );

      return {
        id: node.raw.id,
        addr: `${room.docId}#${node.raw.id}`,
        file: node.file,
        part: node.part,
        date: null,
        line: node.raw.line,
        attrs: node.raw.attrs,
        text: node.raw.text,
        options,
        pending,
        generators,
      };
    });

    for (const node of built) nodes[node.addr] = node;

    docs[room.docId] = {
      id: room.persistent,
      docId: room.docId,
      // Путь — файла версии, если она есть: там автор правит этот срез.
      path: room.nodes.find((n) => n.part === 'version')?.file ?? room.nodes[0]?.file ?? room.docId,
      type: 'room',
      label: room.label ?? room.persistent,
      target: room.target ?? room.label ?? room.persistent,
      targets: room.targets,
      date: null,
      fm: { persistent: room.persistent, stage: room.stage, available: room.available },
      nodes: built,
      pages: [],
      exits: room.exits,
      items: room.items,
      inHand: [],
      entry: room.entry,
      available: room.available,
      optionBlocks: room.optionBlocks,
    };
  }

  // Реестр переходов собран до сборки комнат: срезы мира задают именно они.
  const transitions: Record<string, TransitionDef> = Object.fromEntries(
    transitionDefs.map((def) => [def.id, def]),
  );

  /*
   * Срезы мира. Набор задают сами переходы: срез существует тогда, когда в него
   * есть чем войти. Дата у среза одна — расхождение ловит валидатор, здесь
   * берётся первая по порядку файлов.
   */
  const stages: Record<string, StageDef[]> = {};
  for (const def of Object.values(transitions)) {
    const episode = episodeOf(def.docId);
    if (episode == null || def.stage === '') continue;
    const list = (stages[episode] ??= []);
    const found = list.find((s) => s.stage === def.stage);
    if (found) found.transitions.push(def.id);
    else list.push({ stage: def.stage, date: def.date, transitions: [def.id] });
  }

  const renderers: Record<string, RendererDef> = {};
  for (const [id, raw] of Object.entries(strObject(game.renderers))) {
    renderers[id] = parseRenderer(gameFile, id, raw);
  }

  const characters = loadCharacters(join(CONTENT, 'characters'), episodes.map((e) => e.id));

  return {
    title: String(game.title ?? 'Без названия'),
    saveVersion: Number(game.saveVersion ?? 1),
    episodes,
    renderers,
    characters,
    words,
    documents,
    reference,
    transitions,
    stages,
    nodes,
    docs,
  };
}

function strObject(v: unknown): Record<string, unknown> {
  return v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
