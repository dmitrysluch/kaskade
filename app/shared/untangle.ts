/**
 * Мини-игра «Распутать мысль» — чистая часть ([[07a-мини-игра]]).
 *
 * Здесь нет ни React, ни истории ходов: геометрия, детерминированное
 * соответствие нитей текстовым позициям и перестановка слов. Это сделано
 * ровно ради одного требования ТЗ — **одинаковая геометрия обязана всегда
 * давать одинаковый текст**. Если применять обмены к уже показанным словам
 * по событиям «пересечение появилось / исчезло», результат начинает зависеть
 * от пути, и распутанное поле остаётся перемешанным.
 *
 * Поэтому текущий текст всегда считается заново из авторского оригинала и
 * текущего набора пересечений, а сервер и клиент считают его одним кодом.
 */

/** Точек ровно десять, нитей ровно двенадцать — это часть формата, а не настройка. */
export const POINTS = 10;
export const THREADS = 12;

/** Клетка сетки: `[0, 0]` — левый верхний угол, `x` вправо, `y` вниз. */
export type Cell = [number, number];

export interface Thread {
  id: number;
  points: [number, number];
}

export interface Grid {
  columns: number;
  rows: number;
}

/**
 * Перемещаемая единица — видимое слово. Разметка живёт на самом слове: при
 * разрыве акцента на два слова каждое получает свой, иначе переставленная
 * половина осталась бы без него.
 */
export interface Word {
  text: string;
  /** Inline-code — одна единица даже с пробелами внутри. */
  code?: boolean;
  /** Ссылка на справочник: `[[ref-ines|ИНЕС]]` — тоже одна единица. */
  link?: string;
  em?: boolean;
  strong?: boolean;
}

export interface MinigameDoc {
  /** Подпись документа — заголовок `###`. Не перемешивается. */
  label: string;
  paragraphs: Word[][];
}

/** Полоса текста после перестановки: слово в позиции `i` и нить этой позиции. */
export interface Band {
  words: Word[];
  threads: number[];
}

/* ------------------------------------------------------------------ геометрия */

function cross(o: Cell, a: Cell, b: Cell): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

function same(a: Cell, b: Cell): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

/** Лежит ли `p` на отрезке `ab` — включая концы. Только для коллинеарных. */
function within(p: Cell, a: Cell, b: Cell): boolean {
  return (
    Math.min(a[0], b[0]) <= p[0] && p[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= p[1] && p[1] <= Math.max(a[1], b[1])
  );
}

/** Точка строго внутри отрезка: концы не считаются — там нормальное соединение. */
export function onSegment(p: Cell, a: Cell, b: Cell): boolean {
  if (same(p, a) || same(p, b)) return false;
  return cross(a, b, p) === 0 && within(p, a, b);
}

/**
 * Собственное пересечение внутренних частей двух отрезков.
 *
 * Касание концом и общий конец двух нитей пересечением не считаются: общий
 * конец — это нормальное соединение, а точка, легшая на чужую нить, ловится
 * отдельной проверкой и остаётся некорректной геометрией, а не пересечением.
 */
export function crosses(a1: Cell, a2: Cell, b1: Cell, b2: Cell): boolean {
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Общий участок двух коллинеарных отрезков — наложение, а не пересечение. */
export function overlaps(a1: Cell, a2: Cell, b1: Cell, b2: Cell): boolean {
  if (cross(a1, a2, b1) !== 0 || cross(a1, a2, b2) !== 0) return false;
  // Коллинеарны. Общий участок длиннее точки — это наложение.
  const ends = [
    within(b1, a1, a2) ? b1 : null,
    within(b2, a1, a2) ? b2 : null,
    within(a1, b1, b2) ? a1 : null,
    within(a2, b1, b2) ? a2 : null,
  ].filter((p): p is Cell => p != null);
  return ends.some((p) => ends.some((q) => !same(p, q)));
}

/**
 * Где именно две нити пересеклись — чтобы поставить `×`. Дробные координаты
 * здесь только для рисования: решение считается целыми числами.
 */
export function crossPoint(a1: Cell, a2: Cell, b1: Cell, b2: Cell): [number, number] | null {
  const d = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0]);
  if (d === 0) return null;
  const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / d;
  return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])];
}

export interface Analysis {
  /** Пары нитей по возрастанию `(a, b)`: порядок несущий — по нему идут обмены. */
  crossings: [number, number][];
  overlaps: [number, number][];
  /** Точка легла на чужую нить: распутывать так можно, победить — нет. */
  onThread: { point: number; thread: number }[];
  /** Две точки в одной клетке. Такой ход движок не принимает вовсе. */
  collisions: [number, number][];
}

export function analyze(points: Record<number, Cell>, threads: Thread[]): Analysis {
  const sorted = [...threads].sort((a, b) => a.id - b.id);
  const at = (p: number): Cell | undefined => points[p];
  const out: Analysis = { crossings: [], overlaps: [], onThread: [], collisions: [] };

  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const t = sorted[i]!;
      const u = sorted[j]!;
      const [a1, a2] = [at(t.points[0]), at(t.points[1])];
      const [b1, b2] = [at(u.points[0]), at(u.points[1])];
      if (!a1 || !a2 || !b1 || !b2) continue;
      const pair: [number, number] = t.id < u.id ? [t.id, u.id] : [u.id, t.id];
      if (crosses(a1, a2, b1, b2)) out.crossings.push(pair);
      else if (overlaps(a1, a2, b1, b2)) out.overlaps.push(pair);
    }
  }

  const ids = Object.keys(points).map(Number).sort((a, b) => a - b);
  for (const p of ids) {
    const cell = at(p)!;
    for (const t of sorted) {
      if (t.points.includes(p)) continue;
      const [a, b] = [at(t.points[0]), at(t.points[1])];
      if (a && b && onSegment(cell, a, b)) out.onThread.push({ point: p, thread: t.id });
    }
  }

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (same(at(ids[i]!)!, at(ids[j]!)!)) out.collisions.push([ids[i]!, ids[j]!]);
    }
  }

  out.crossings.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  return out;
}

/**
 * Поле распутано. Пересечений нет — ещё не всё: точка на чужой нити и
 * наложение нитей читаются как «решено», а планарной раскладкой не являются.
 */
export function isSolved(a: Analysis): boolean {
  return a.crossings.length === 0 && a.overlaps.length === 0 && a.onThread.length === 0 && a.collisions.length === 0;
}

/* ------------------------------------------------- соответствие текста нитям */

/** FNV-1a, 32 бита. Арифметика как в JS: `uint32` и умножение через `Math.imul`. */
export function fnv1a(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: короткий детерминированный генератор на одно семя. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0;
    t = (t ^ (t + Math.imul(t ^ (t >>> 7), t | 61))) >>> 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Какая нить отвечает за какую позицию полосы.
 *
 * Соответствие детерминировано — от id мини-игры, семени и индексов документа,
 * абзаца и полосы. Поэтому его не нужно хранить в сейве и нельзя случайно
 * «пересобрать»: одна и та же бумага всегда перемешана одинаково.
 */
export function bandMapping(
  id: string,
  seed: number,
  document: number,
  paragraph: number,
  band: number,
  size: number,
): number[] {
  const random = mulberry32(fnv1a(`${id}\0${seed}\0${document}\0${paragraph}\0${band}`));
  const ids = Array.from({ length: THREADS }, (_, i) => i);
  // Fisher–Yates от последнего элемента к первому.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  return ids.slice(0, size);
}

/** Абзац делится на полосы по `THREADS` слов; последняя может быть короче. */
export function bands<T>(words: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < words.length; i += THREADS) out.push(words.slice(i, i + THREADS));
  return out;
}

/**
 * Полоса в текущем состоянии поля: по возрастанию пар переставляем позиции
 * пересекшихся нитей. Нить, которой в этой полосе нет (короткая последняя),
 * свою пару не меняет.
 */
export function permuteBand(words: Word[], mapping: number[], crossings: [number, number][]): Word[] {
  const out = [...words];
  for (const [a, b] of crossings) {
    const i = mapping.indexOf(a);
    const j = mapping.indexOf(b);
    if (i === -1 || j === -1) continue;
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Документы в текущем состоянии поля — то, что рисует клиент. */
export function layoutText(
  id: string,
  seed: number,
  docs: MinigameDoc[],
  crossings: [number, number][],
): { label: string; paragraphs: Band[][] }[] {
  return docs.map((doc, d) => ({
    label: doc.label,
    paragraphs: doc.paragraphs.map((words, p) =>
      bands(words).map((band, b) => {
        const mapping = bandMapping(id, seed, d, p, b, band.length);
        return { words: permuteBand(band, mapping, crossings), threads: mapping };
      }),
    ),
  }));
}

/**
 * Сколько позиций полной полосы сдвинула стартовая геометрия. Нужно валидатору:
 * поле, в котором переставлены два слова из двенадцати, не читается как шум,
 * и распутывать его незачем.
 */
export function shifted(id: string, seed: number, docs: MinigameDoc[], crossings: [number, number][]): number {
  let most = 0;
  layoutText(id, seed, docs, crossings).forEach((doc, d) => {
    doc.paragraphs.forEach((paragraph, p) => {
      paragraph.forEach((band, b) => {
        if (band.words.length < THREADS) return;
        const original = bands(docs[d]!.paragraphs[p]!)[b]!;
        const moved = band.words.filter((w, i) => w !== original[i]).length;
        most = Math.max(most, moved);
      });
    });
  });
  return most;
}

/* --------------------------------------------------------------- разбор текста */

const FORBIDDEN: { test: RegExp; what: string }[] = [
  { test: /^\s*(?:[-*+]\s|\d+[.)]\s)/, what: 'список' },
  { test: /^\s*\|/, what: 'таблица' },
  { test: /^\s*>/, what: 'цитата' },
  { test: /!\[/, what: 'изображение' },
  { test: /<[a-z/][^>]*>/i, what: 'HTML' },
  { test: /^\s*#{4,}\s/, what: 'заголовок глубже ###' },
  { test: /→/, what: 'игровой маршрут' },
  { test: /^\s*(?:`{3,}|~{3,})/, what: 'блок кода' },
];

/**
 * Документы мини-игры — текст до первого `##`. Каждый `###` начинает документ:
 * его заголовок служит подписью и не перемешивается.
 *
 * Разбираем здесь, а не в рендерере: валидатору нужно то же самое деление,
 * а клиенту — уже готовые слова.
 */
export function parseDocuments(body: string): { docs: MinigameDoc[]; problems: string[] } {
  const docs: MinigameDoc[] = [];
  const problems: string[] = [];
  let label: string | null = null;
  let chunk: string[] = [];

  const flush = () => {
    if (label == null) return;
    const paragraphs = chunk
      .join('\n')
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p !== '')
      .map((p) => words(p.replace(/\s*\n\s*/g, ' ')));
    docs.push({ label, paragraphs });
    chunk = [];
  };

  for (const line of body.split('\n')) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush();
      label = heading[1]!.trim();
      continue;
    }
    if (line.trim() !== '') {
      for (const { test, what } of FORBIDDEN) {
        if (test.test(line)) problems.push(`${what} в тексте мини-игры: «${line.trim()}»`);
      }
      // Текст вне документа — автор забыл заголовок, и подписи у полосы нет.
      if (label == null) problems.push(`текст до первого «###»: «${line.trim()}»`);
    }
    chunk.push(line);
  }
  flush();

  return { docs, problems };
}

/**
 * Деление абзаца на видимые слова (ТЗ, «Перемещаемая единица — видимое слово»).
 *
 * Атомарны inline-code и wiki-ссылка: у них внутри бывает пробел, а переставлять
 * половину ссылки нельзя. Акцент — состояние, которое наследует каждое слово
 * внутри него.
 */
export function words(text: string): Word[] {
  const out: Word[] = [];
  let buffer = '';
  let em = false;
  let strong = false;

  const mark = (): Pick<Word, 'em' | 'strong'> => ({ ...(em ? { em } : {}), ...(strong ? { strong } : {}) });
  const flush = () => {
    if (buffer !== '') out.push({ text: buffer, ...mark() });
    buffer = '';
  };

  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);

    // Неразрывный пробел единицу не делит — он часть слова.
    const space = /^[^\S ]+/.exec(rest);
    if (space) {
      flush();
      i += space[0].length;
      continue;
    }

    const code = /^`([^`]+)`/.exec(rest);
    if (code) {
      flush();
      out.push({ text: code[1]!, code: true, ...mark() });
      i += code[0].length;
      continue;
    }

    const link = /^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(rest);
    if (link) {
      flush();
      out.push({ text: (link[2] ?? link[1]!).trim(), link: link[1]!.trim(), ...mark() });
      i += link[0].length;
      continue;
    }

    if (rest.startsWith('**')) {
      flush();
      strong = !strong;
      i += 2;
      continue;
    }
    if (rest.startsWith('*') || rest.startsWith('_')) {
      flush();
      em = !em;
      i += 1;
      continue;
    }

    buffer += rest[0]!;
    i += 1;
  }

  flush();
  return out;
}
