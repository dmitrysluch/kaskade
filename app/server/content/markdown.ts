import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import yaml from 'js-yaml';
import { emptyAttrs, type Attrs, type DocType } from '../../shared/types.ts';

/**
 * Разбор заметки в узлы, атрибуты, переходы и генераторы опций.
 *
 * Формат один на все типы файлов (07-оболочка-тз, «Формат контента») и выбран так,
 * чтобы заметка оставалась заметкой: в Obsidian ссылки кликабельны, граф диалога
 * строится сам, блок `options` читается как обычный код. Всё, что здесь разбирается,
 * автор должен уметь написать руками, не сверяясь с кодом.
 *
 * Ссылки тут остаются сырыми строками: чтобы `[[rooms/коридор]]` превратить в адрес,
 * нужно видеть весь vault, а это уже работа load.ts.
 */

export class ContentError extends Error {
  constructor(
    public file: string,
    message: string,
    public line?: number,
  ) {
    const where = line == null ? basename(file) : `${basename(file)}:${line}`;
    super(`${where}: ${message}`);
    this.name = 'ContentError';
  }
}

export interface RawTransition {
  label: string | null;
  ref: string;
  line: number;
  /**
   * Атрибуты самого перехода — вложенный список под ним. Условие здесь относится
   * к этому маршруту, а не к содержанию цели: «отсюда туда сейчас нельзя».
   */
  attrs: Attrs;
}

export interface RawGenerator {
  /** Может быть фразой: `спросить о`. Глаголом считается первое слово. */
  phrase: string;
  source: string | string[];
  line: number;
}

export interface RawNode {
  id: string;
  line: number;
  attrs: Attrs;
  text: string;
  transitions: RawTransition[];
  generators: RawGenerator[];
}

export interface RawDoc {
  path: string;
  fm: Record<string, unknown>;
  type: DocType;
  nodes: RawNode[];
}

const DOC_TYPES: DocType[] = ['scene', 'room', 'item', 'word', 'doc', 'person'];

const ATTR_KEYS = new Set([
  'if',
  'set',
  'unset',
  'give',
  'take',
  'cost',
  'once',
  'goto',
  'tag',
  'label',
  // Состояние комнаты — это узел: у него свои предметы и свои выходы.
  // Постоянное живёт во frontmatter, временное здесь; списки складываются.
  'items',
  'exits',
  // Сроки: `- dates: {blueCard: 31.12.2026}`. Объявлены в episode.yaml, узел двигает.
  'dates',
  // Помета на переходе: команда закрывает текущие возможности («Опция»).
  'advance',
  // Номер страницы предмета: секция становится состоянием, а не глаголом.
  'page',
]);

/** Ключи, которые можно писать несколько раз: `- set: a` двумя строками. */
const MULTI_KEYS = new Set(['set', 'unset', 'give', 'take', 'tag', 'items', 'exits']);

/**
 * Якорь узла нормализуется так же, как в Obsidian: `[[#Первый ряд]]` и `## первый-ряд`
 * должны сойтись, иначе автор чинит ссылки вместо того, чтобы писать текст.
 */
export function anchor(raw: string): string {
  return raw.trim().replace(/\s+/g, '-').toLowerCase();
}

function asArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseAttrs(file: string, lines: { text: string; line: number }[]): Attrs {
  const attrs = emptyAttrs();
  if (lines.length === 0) return attrs;

  // Собираем обратно в yaml-последовательность вместо ручного разбора: так `[a, b]`,
  // кавычки и числа работают ровно так, как автор ожидает от frontmatter.
  let parsed: unknown;
  try {
    parsed = yaml.load(lines.map((l) => l.text).join('\n'));
  } catch (e) {
    throw new ContentError(file, `не разбирается список атрибутов: ${(e as Error).message}`, lines[0]!.line);
  }
  if (!Array.isArray(parsed)) {
    throw new ContentError(file, 'атрибуты должны быть списком', lines[0]!.line);
  }

  parsed.forEach((item, i) => {
    const line = lines[i]?.line;
    const entries: [string, unknown][] =
      item != null && typeof item === 'object'
        ? Object.entries(item as Record<string, unknown>)
        : [[String(item).trim(), true]];

    for (const [rawKey, value] of entries) {
      const key = rawKey.trim();
      if (!ATTR_KEYS.has(key)) {
        throw new ContentError(
          file,
          `неизвестный атрибут "${key}"; допустимы: ${[...ATTR_KEYS].join(', ')}`,
          line,
        );
      }
      if (key === 'dates') {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
          throw new ContentError(file, 'dates пишется парами «имя: дата»: `- dates: {blueCard: 31.12.2026}`', line);
        }
        for (const [name, at] of Object.entries(value as Record<string, unknown>)) {
          attrs.dates[name.trim()] = String(at).trim();
        }
      } else if (MULTI_KEYS.has(key)) {
        const target = attrs[key as 'set' | 'unset' | 'give' | 'take' | 'tag'];
        target.push(...asArray(value));
      } else if (key === 'once') {
        attrs.once = value !== false;
      } else if (key === 'advance') {
        attrs.advance = value !== false;
      } else if (key === 'cost' || key === 'page') {
        const n = Number(value);
        if (!Number.isFinite(n)) throw new ContentError(file, `${key} должен быть числом, а не "${value}"`, line);
        if (key === 'cost') attrs.cost = n;
        else attrs.page = n;
      } else {
        const s = String(value).trim();
        if (key === 'if') attrs.if = s;
        else if (key === 'goto') attrs.goto = s;
        else if (key === 'label') attrs.label = s;
      }
    }
  });

  return attrs;
}

/** `→ сесть сзади [[#сзади]]` — метка необязательна. */
function parseTransition(file: string, raw: string, line: number): RawTransition {
  const body = raw.replace(/^→\s*/, '').trim();
  const m = /\[\[([^\]]+)\]\]/.exec(body);
  if (!m) throw new ContentError(file, `переход без ссылки: "${raw.trim()}"`, line);
  const label = body.slice(0, m.index).trim();
  return { label: label || null, ref: m[1]!.trim(), line, attrs: emptyAttrs() };
}

function parseGenerators(file: string, block: string, line: number): RawGenerator[] {
  let parsed: unknown;
  try {
    parsed = yaml.load(block);
  } catch (e) {
    throw new ContentError(file, `не разбирается блок options: ${(e as Error).message}`, line);
  }
  if (parsed == null) return [];
  if (typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ContentError(file, 'блок options должен быть парами «глагол: источник»', line);
  }
  return Object.entries(parsed as Record<string, unknown>).map(([phrase, source]) => ({
    phrase: phrase.trim(),
    source: Array.isArray(source) ? asArray(source) : String(source ?? '').trim(),
    line,
  }));
}

export function parseMarkdown(file: string, raw: string): RawDoc {
  const content = raw.replace(/\r\n/g, '\n');
  const fmMatch = /^---\n([\s\S]*?)\n---\n?/.exec(content);
  if (!fmMatch) throw new ContentError(file, 'нет frontmatter (блока между строками ---)', 1);

  let fm: Record<string, unknown>;
  try {
    fm = (yaml.load(fmMatch[1]!) ?? {}) as Record<string, unknown>;
  } catch (e) {
    throw new ContentError(file, `не разбирается frontmatter: ${(e as Error).message}`, 1);
  }

  const type = String(fm.type ?? '').trim() as DocType;
  if (!DOC_TYPES.includes(type)) {
    throw new ContentError(file, `неизвестный type "${fm.type ?? ''}"; допустимы: ${DOC_TYPES.join(', ')}`, 1);
  }

  const fmLines = fmMatch[0].split('\n').length - 1;
  const lines = content.slice(fmMatch[0].length).split('\n');

  // Вступление — текст до первого `##`. Для комнаты это её описание, для предмета —
  // карточка в «предметах», для слова и документа — вообще всё содержимое.
  const nodes: RawNode[] = [];
  let current: RawNode = { id: '', line: fmLines + 1, attrs: emptyAttrs(), text: '', transitions: [], generators: [] };
  let textLines: string[] = [];
  let attrLines: { text: string; line: number }[] = [];
  let sawBody = false;
  // Переход, под которым сейчас может стоять его вложенный список атрибутов.
  let openTransition: { t: RawTransition; lines: { text: string; line: number }[] } | null = null;
  let fence: string | null = null;
  let fenceLang = '';
  let fenceLines: string[] = [];
  let fenceStart = 0;

  const closeTransition = () => {
    if (openTransition && openTransition.lines.length > 0) {
      openTransition.t.attrs = parseAttrs(file, openTransition.lines);
    }
    openTransition = null;
  };

  const flush = () => {
    closeTransition();
    current.attrs = parseAttrs(file, attrLines);
    current.text = textLines.join('\n').trim();
    // Пустое вступление — это не узел, а пустая строка между frontmatter и первым
    // `##`. Заводить его значит подарить валидатору узел без входа и без выхода.
    const empty =
      current.id === '' &&
      current.text === '' &&
      current.transitions.length === 0 &&
      current.generators.length === 0 &&
      attrLines.length === 0;
    if (!empty) nodes.push(current);
    textLines = [];
    attrLines = [];
    sawBody = false;
  };

  lines.forEach((text, i) => {
    const line = fmLines + i + 1;

    if (fence !== null) {
      if (text.trim().startsWith(fence)) {
        if (fenceLang === 'options') {
          current.generators.push(...parseGenerators(file, fenceLines.join('\n'), fenceStart));
        } else {
          textLines.push(`${fence}${fenceLang}`, ...fenceLines, text);
        }
        fence = null;
        fenceLines = [];
      } else {
        fenceLines.push(text);
      }
      return;
    }

    // Вложенный список под переходом — его атрибуты: `if` здесь про маршрут,
    // а не про цель. Отступ обязателен, иначе это обычный список в тексте.
    if (openTransition && /^\s+-\s+\S/.test(text)) {
      openTransition.lines.push({ text: text.trim(), line });
      return;
    }
    if (openTransition && /^-\s+(\S+)\s*:/.test(text) && ATTR_KEYS.has(/^-\s+(\S+)\s*:/.exec(text)![1]!)) {
      throw new ContentError(file, 'атрибуты перехода пишутся с отступом под ним', line);
    }
    if (text.trim() !== '') closeTransition();

    const fenceOpen = /^\s*(`{3,}|~{3,})\s*(\S*)\s*$/.exec(text);
    if (fenceOpen) {
      fence = fenceOpen[1]!;
      fenceLang = fenceOpen[2] ?? '';
      fenceStart = line;
      sawBody = true;
      return;
    }

    const heading = /^##\s+(.+?)\s*$/.exec(text);
    if (heading) {
      flush();
      current = {
        id: anchor(heading[1]!),
        line,
        attrs: emptyAttrs(),
        text: '',
        transitions: [],
        generators: [],
      };
      return;
    }

    if (text.trimStart().startsWith('→')) {
      const t = parseTransition(file, text, line);
      current.transitions.push(t);
      openTransition = { t, lines: [] };
      sawBody = true;
      return;
    }

    // Атрибуты — только список, стоящий сразу под заголовком: дальше по тексту
    // дефис уже значит обычный маркированный список, а не служебную строку.
    if (!sawBody && /^\s*-\s+\S/.test(text)) {
      attrLines.push({ text: text.trim(), line });
      return;
    }

    if (text.trim() !== '') sawBody = true;
    textLines.push(text);
  });

  if (fence !== null) throw new ContentError(file, 'блок кода не закрыт', fenceStart);
  flush();

  const seen = new Set<string>();
  for (const node of nodes) {
    if (seen.has(node.id)) throw new ContentError(file, `узел "${node.id}" объявлен дважды`, node.line);
    seen.add(node.id);
  }

  return { path: file, fm, type, nodes };
}

export function readMarkdown(file: string): RawDoc {
  return parseMarkdown(file, readFileSync(file, 'utf8'));
}
