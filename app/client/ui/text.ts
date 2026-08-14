/**
 * Работа с текстом как со знакоместами.
 *
 * Перенос, обрезку и подсветку делаем сами, а не отдаём браузеру: экран — сетка
 * из знаков, рамки нарисованы символами, и каждая строка обязана быть ровно той
 * ширины, которую ей отвели. Стоит отдать перенос CSS — и рамка разъедется.
 */

export interface Seg {
  text: string;
  // `| undefined` явно: с exactOptionalPropertyTypes «нет класса» и «класс undefined» —
  // разные вещи, а сегменты собираются из спредов, где undefined появляется само.
  cls?: string | undefined;
  color?: string | undefined;
  /** Цвет фона клетки: нужен полублокам портрета, где клетка — два пикселя. */
  bg?: string | undefined;
}

/**
 * Поля — свойство текста, и только текста (07-оболочка-тз, «Поля и линейка»).
 *
 * Поле узкое и одинаковое на всех экранах: текст начинается от левого края, а не
 * стоит колонкой посреди пустоты — в терминале поле набирается пробелами, и их
 * там два-четыре, а не двадцать. Линейка и сплэш поля игнорируют и идут во всю
 * сетку.
 *
 * Промпт висит в поле: `>` стоит левее текстового поля, набираемое встаёт ровно
 * под повествование. Левый край остаётся непрерывной линией, а приглашение из неё
 * торчит.
 */
export const MARGIN = { prompt: 2, text: 4, right: 4 };

/** Левое поле — пробелы до текстовой колонки. */
export function pad(): string {
  return ' '.repeat(MARGIN.text);
}

/**
 * Висящий знак в поле: `>` у ввода, `›` у выбранной команды. Набираемое и сами
 * команды встают ровно под повествование, а знак торчит из левого края.
 */
export function hanging(glyph = '>'): string {
  return `${' '.repeat(MARGIN.prompt)}${glyph}${' '.repeat(MARGIN.text - MARGIN.prompt - 1)}`;
}

/**
 * Разметка означает механику, а не важность (07-оболочка-тз, «Разметка»).
 *
 * Подсвечивать «важное» нельзя — игра начнёт читать за игрока. Подсвечивается
 * ровно то, что **можно набрать в строке ввода**: слова из дела (их оболочка
 * знает сама, никакой разметки в заметках) и коды в обратных кавычках.
 *
 * Отсюда бесплатно: длинная карточка предмета становится сканируемой, видно,
 * что про слово можно спросить, и виден прогресс — в старом тексте после лекции
 * подсвечено больше, чем было.
 */
export interface Span {
  text: string;
  cls: string;
}

const WORD_CHAR = /[\p{L}\p{N}_-]/u;

/** Совпадение целым словом: `дело` внутри `делопроизводства` подсвечивать нельзя. */
function whole(line: string, at: number, len: number): boolean {
  const before = line[at - 1];
  const after = line[at + len];
  return !(before && WORD_CHAR.test(before)) && !(after && WORD_CHAR.test(after));
}

export function mark(line: string, base: string | undefined, spans: Span[]): Seg[] {
  const lower = line.toLowerCase();
  const hits: { at: number; len: number; cls: string }[] = [];

  for (const span of spans) {
    const needle = span.text.toLowerCase();
    if (needle === '') continue;
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, at + 1)) {
      if (whole(line, at, needle.length)) hits.push({ at, len: needle.length, cls: span.cls });
    }
  }

  // Длинное совпадение бьёт короткое, дальше — по порядку: пересечения не рисуем.
  hits.sort((a, b) => a.at - b.at || b.len - a.len);
  const out: Seg[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.at < cursor) continue;
    if (hit.at > cursor) out.push({ text: line.slice(cursor, hit.at), cls: base });
    out.push({ text: line.slice(hit.at, hit.at + hit.len), cls: hit.cls });
    cursor = hit.at + hit.len;
  }
  if (cursor < line.length || out.length === 0) out.push({ text: line.slice(cursor), cls: base });
  return out;
}

/** Коды и обозначения: `H 1012`, `Mark I`. Кавычки снимаются до переноса. */
export function codes(text: string): { text: string; spans: Span[] } {
  const spans: Span[] = [];
  const plain = text.replace(/`([^`]+)`/g, (_, body: string) => {
    spans.push({ text: body, cls: 'code' });
    return body;
  });
  return { text: plain, spans };
}

export function width(segs: Seg[]): number {
  return segs.reduce((n, s) => n + s.text.length, 0);
}

/** Обрезает строку по ширине колонки: лишнее не переносится, а отваливается. */
export function clip(segs: Seg[], max: number): Seg[] {
  const out: Seg[] = [];
  let left = max;
  for (const seg of segs) {
    if (left <= 0) break;
    out.push(seg.text.length <= left ? seg : { ...seg, text: seg.text.slice(0, left) });
    left -= seg.text.length;
  }
  return out;
}

/** Жадный перенос по словам. Пустые строки сохраняются: абзацы — часть текста. */
export function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  if (max < 1) return out;

  for (const paragraph of text.split('\n')) {
    if (paragraph.trim() === '') {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      if (line === '') line = word;
      else if (line.length + 1 + word.length <= max) line += ` ${word}`;
      else {
        out.push(line);
        line = word;
      }
      // Слово длиннее колонки рвём: иначе оно вылезет за рамку.
      while (line.length > max) {
        out.push(line.slice(0, max));
        line = line.slice(max);
      }
    }
    out.push(line);
  }
  return out;
}

/**
 * Хвост строки заменяется многоточием. Режем по границе слова и следим, чтобы
 * сам знак поместился в колонку: он часть строки, а не довесок к ней.
 *
 * Нужно ровно там, где обрезать можно, а пересказывать нельзя, — в предпросмотре
 * реплики (07-оболочка-тз, «Команда короче реплики»).
 */
export function ellipsis(line: string, max: number): string {
  if (max < 1) return '';
  // Точка или запятая вплотную к многоточию читается как сор: слов это
  // не меняет, а `в проекте.…` выглядит опечаткой.
  const tail = (s: string) => `${s.replace(/[\s.,;:—–-]+$/, '') || s.trimEnd()}…`;
  if (line.length < max) return tail(line);

  const head = line.slice(0, max - 1);
  // Одно длинное слово рвём: пустой строки в области деталей быть не должно.
  const cut = head.replace(/\s+\S*$/, '');
  return tail(cut === '' ? head : cut);
}

/**
 * Подсветка набранного. Совпадение ищется по началу слова — так же, как в
 * автокомплите, — поэтому игрок видит ровно те буквы, которые уже ввёл.
 */
export function highlight(label: string, input: string): Seg[] {
  const typed = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (typed.length === 0) return [{ text: label }];

  const out: Seg[] = [];
  for (const part of label.split(/(\s+)/)) {
    if (part === '') continue;
    if (/^\s+$/.test(part)) {
      out.push({ text: part });
      continue;
    }
    const lower = part.toLowerCase();
    const hit = typed.filter((t) => lower.startsWith(t)).sort((a, b) => b.length - a.length)[0];
    if (hit) {
      out.push({ text: part.slice(0, hit.length), cls: 'hit' });
      if (part.length > hit.length) out.push({ text: part.slice(hit.length) });
    } else {
      out.push({ text: part });
    }
  }
  return out;
}

/** Слева одно, справа другое, между ними ровно столько пробелов, сколько нужно. */
export function spread(left: Seg[], right: Seg[], max: number): Seg[] {
  const gap = max - width(left) - width(right);
  if (gap < 1) return clip([...left, { text: ' ' }, ...right], max);
  return [...left, { text: ' '.repeat(gap) }, ...right];
}
