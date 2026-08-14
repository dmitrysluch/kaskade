import { Fragment } from 'react';
import { clip, MARGIN, width as segWidth, wrap, type Seg } from './text.ts';

/**
 * Экран как сетка знаков.
 *
 * Псевдографика — настоящие символы в потоке текста, а не рамки CSS: терминал
 * должен быть терминалом, и на скриншоте это должно быть видно. Отсюда же и всё
 * остальное устройство: каждая строка ровно той ширины, которую ей отвели, ничего
 * не переносится браузером и ничего не скроллится само.
 *
 * Рамка обводит объект, линейка делит поток (07-оболочка-тз, «Поля и линейка»):
 * коробка осталась только у оверлеев дела и справочника, у главного экрана её нет.
 */

/**
 * Список команд: по одной на строку, высота постоянная. Больше вариантов — окно
 * едет за выбором, но ввод, детали и служебная полоса не двигаются.
 *
 * Восемь — компромисс: комната пролога со всеми действиями показывается целиком,
 * а потоку остаётся половина экрана.
 */
export const LIST_ROWS = 8;

/**
 * Детали выбранной команды — сразу под строкой ввода: точная реплика Марго
 * и предупреждение о невозврате. Они относятся к тому, что игрок сейчас скажет,
 * поэтому и стоят при вводе, а не при списке вариантов.
 *
 * Высота постоянная — иначе появление предпросмотра двигало бы всё под ним.
 */
export const DETAIL_ROWS = 2;

/** Служебная полоса: закреплена под деталями и от ввода не зависит. */
export const SYSTEM_ROWS = 1;

/**
 * Пустые строки под подсказками. Нижнее поле — такое же свойство текста, как
 * левое: строка подсказок, прижатая к кромке окна, читается как обрезанная.
 */
export const BOTTOM_ROWS = 2;

/**
 * Линейки, ввод с деталями, список и полоса. Рамки у экрана нет.
 *
 * Линеек две: первая отделяет поток от ввода, вторая — то, что игрок говорит,
 * от того, что ему предлагают. Между ними живёт одно: набранное и его следствие.
 */
export const LOWER_ROWS = 3 + DETAIL_ROWS + LIST_ROWS + SYSTEM_ROWS + BOTTOM_ROWS;

/** Статус и пустая строка под ним. */
export const STATUS_ROWS = 2;

/**
 * Линейка на экране одна — между потоком и вводом. Выше неё мир, ниже ты.
 * Символ берётся из `renderers.<имя>.rule` и является характером машины
 * наравне с палитрой и шрифтом.
 */
export const RULES: Record<string, string> = {
  light: '─',
  heavy: '━',
  double: '═',
  dashed: '╌',
  none: ' ',
};

export function ruleGlyph(name: string): string {
  const found = RULES[name];
  if (found == null) throw new Error(`нет линейки "${name}"; есть: ${Object.keys(RULES).join(', ')}`);
  return found;
}

export interface FrameGlyphs {
  h: string;
  v: string;
  tl: string;
  tr: string;
  bl: string;
  br: string;
  /** Тройники: сверху, снизу, слева, справа. */
  t: string;
  b: string;
  l: string;
  r: string;
}

/**
 * Наборы рамок — только для оверлеев: коробка честно значит «это отдельная вещь».
 * Выбирается в `game.yaml` (`renderers.<имя>.frame`).
 */
export const FRAMES: Record<string, FrameGlyphs> = {
  light: { h: '─', v: '│', tl: '┌', tr: '┐', bl: '└', br: '┘', t: '┬', b: '┴', l: '├', r: '┤' },
  heavy: { h: '━', v: '┃', tl: '┏', tr: '┓', bl: '┗', br: '┛', t: '┳', b: '┻', l: '┣', r: '┫' },
  double: { h: '═', v: '║', tl: '╔', tr: '╗', bl: '╚', br: '╝', t: '╦', b: '╩', l: '╠', r: '╣' },
};

export function frameGlyphs(name: string): FrameGlyphs {
  const found = FRAMES[name];
  if (!found) throw new Error(`нет рамки "${name}"; есть: ${Object.keys(FRAMES).join(', ')}`);
  return found;
}

function Cell({ segs, w }: { segs: Seg[]; w: number }) {
  const cut = clip(segs, w);
  const pad = w - segWidth(cut);
  return (
    <>
      {cut.map((seg, i) => (
        <span
          key={i}
          className={seg.cls}
          style={
            seg.color != null || seg.bg != null
              ? { ...(seg.color != null && { color: seg.color }), ...(seg.bg != null && { background: seg.bg }) }
              : undefined
          }
        >
          {seg.text}
        </span>
      ))}
      {pad > 0 ? ' '.repeat(pad) : ''}
    </>
  );
}

function Row({
  cells,
  glyphs,
  endRail,
}: {
  cells: { segs: Seg[]; w: number }[];
  glyphs: FrameGlyphs;
  endRail?: string;
}) {
  const end = endRail ?? glyphs.v;
  return (
    <div>
      {cells.map((cell, i) => (
        <Fragment key={i}>
          <span className="rail">{glyphs.v}</span>
          <Cell segs={cell.segs} w={cell.w} />
        </Fragment>
      ))}
      <span className={end === glyphs.v ? 'rail' : 'more'}>{end}</span>
    </div>
  );
}

function Border({
  widths,
  glyphs,
  left,
  mid,
  right,
  title,
}: {
  widths: number[];
  glyphs: FrameGlyphs;
  left: string;
  mid: string;
  right: string;
  title?: string;
}) {
  let line = left + widths.map((w) => glyphs.h.repeat(w)).join(mid) + right;
  if (title) {
    const label = ` ${title} `;
    line = line.slice(0, 2) + label + line.slice(2 + label.length);
  }
  return <div className="rail">{line}</div>;
}

export interface GameScreenProps {
  cols: number;
  /** Строк, отданных потоку. */
  streamRows: number;
  status: Seg[];
  stream: Seg[][];
  input: Seg[];
  /** Вертикальный список того, что можно ввести прямо сейчас. */
  list: Seg[][];
  /** Реплика выбранной команды и предупреждение `advance`. */
  details: Seg[][];
  /** Закреплённая полоса служебных действий. */
  system: Seg[];
  /** Есть ли неотрисованный текст выше и ниже окна: знак на правом конце линейки. */
  more: { up: boolean; down: boolean };
  /** Символ линейки из конфига рендерера. */
  rule: string;
}

/** Строка без рамки: поля уже внутри сегментов, здесь только обрезка по сетке. */
function Line({ segs, cols, cls }: { segs: Seg[]; cols: number; cls?: string }) {
  return (
    <div className={cls}>
      <Cell segs={segs} w={cols} />
    </div>
  );
}

/**
 * Главный экран. Коробки по периметру нет: она превратила бы игру в TUI-приложение,
 * а это терминальная сессия (07-оболочка-тз, «Экран»). Три полосы — статус, поток,
 * ввод — и одна линейка между миром и игроком.
 */
export function GameScreen({
  cols,
  streamRows,
  status,
  stream,
  input,
  list,
  details,
  system,
  more,
  rule,
}: GameScreenProps) {
  // Линейка идёт во всю сетку, сквозь поля: подрезанная по ширине текста, она
  // читалась бы как разрыв внутри документа, а нужна как деление поверхности.
  // На правом конце — знак того, что осталось за краем; отдельной полосы нет.
  // Знак один, а направлений два. Пока игрок внизу, важно «выше есть история»;
  // как только он ушёл вверх — важнее «ниже есть свежий текст», туда и возвращаться.
  const mark = (more.down && '▼') || (more.up && '▲') || null;
  const ruleLine: Seg[] = mark
    ? [
        { text: rule.repeat(Math.max(0, cols - 1)), cls: 'rule' },
        { text: mark, cls: 'more' },
      ]
    : [{ text: rule.repeat(cols), cls: 'rule' }];

  return (
    <>
      {/* Пустой статус — не пустая полоса: у Алерса в 2034-м его нет вовсе,
          и подложка оставила бы после себя дырку. */}
      <Line segs={status} cols={cols} {...(status.length > 0 ? { cls: 'status' } : {})} />
      <Line segs={[]} cols={cols} />
      {Array.from({ length: streamRows }, (_, i) => (
        <Line key={i} segs={stream[i] ?? []} cols={cols} />
      ))}
      <Line segs={ruleLine} cols={cols} />
      <Line segs={input} cols={cols} />
      {details.map((line, i) => (
        <Line key={i} segs={line} cols={cols} />
      ))}
      <Line segs={[{ text: rule.repeat(cols), cls: 'rule' }]} cols={cols} />
      {list.map((line, i) => (
        <Line key={i} segs={line} cols={cols} />
      ))}
      <Line segs={system} cols={cols} />
      {Array.from({ length: BOTTOM_ROWS }, (_, i) => (
        <Line key={i} segs={[]} cols={cols} />
      ))}
    </>
  );
}

/** Шире этого титр не растёт: запись, которую кладут перед тобой, — небольшая вещь. */
const CARD_MAX = 48;

/** Коробка титра как строки текста: её рисует и экран, и сплэш под лицом. */
export function cardBox(text: string, glyphs: FrameGlyphs | null, max = CARD_MAX): string[] {
  const body = text.split('\n').flatMap((line) => (line.trim() === '' ? [''] : wrap(line, max)));
  const w = Math.max(1, ...body.map((l) => l.length));
  const centred = (line: string) => {
    const pad = w - line.length;
    const left = Math.floor(pad / 2);
    return `${' '.repeat(left)}${line}${' '.repeat(pad - left)}`;
  };

  // По пробелу с каждой стороны: рамка не должна липнуть к букве.
  const rows = body.map((line) => (glyphs ? `${glyphs.v} ${centred(line)} ${glyphs.v}` : centred(line)));
  if (!glyphs) return rows;
  const rail = glyphs.h.repeat(w + 2);
  return [`${glyphs.tl}${rail}${glyphs.tr}`, ...rows, `${glyphs.bl}${rail}${glyphs.br}`];
}

/**
 * Титульная карточка (07-оболочка-тз, «Поля и линейка»).
 *
 * Титр — тоже объект: в этой игре он не подпись к кадру, а предъявленная запись,
 * и рамка это и говорит. Поэтому коробка по размеру содержимого и по центру пустого
 * экрана, а не текст на чёрном: голый текст остаётся за катсценой, которая бывает
 * один раз за игру, — иначе финал повторял бы то, что игрок видел уже восемь раз.
 *
 * Без рамки (`glyphs: null`) рисуются экраны псевдо-BIOS: они не объект, а машина,
 * которая говорит от себя.
 */
export function CardScreen({
  cols,
  rows,
  text,
  glyphs,
  hint,
}: {
  cols: number;
  rows: number;
  text: string;
  glyphs: FrameGlyphs | null;
  /** Подпись в правом нижнем поле: единственное, что тут можно сделать. */
  hint?: string;
}) {
  const box = cardBox(text, glyphs, Math.max(1, Math.min(cols - 8, CARD_MAX)));
  const width = Math.max(...box.map((l) => l.length));
  const left = ' '.repeat(Math.max(0, Math.floor((cols - width) / 2)));

  // Рамка красится, текст нет: цвет рамки — свойство машины, а запись читают.
  const lines: Seg[][] = box.map((line, i) =>
    glyphs && (i === 0 || i === box.length - 1)
      ? [{ text: left }, { text: line, cls: 'rail' }]
      : glyphs
        ? [
            { text: left },
            { text: line.slice(0, 1), cls: 'rail' },
            { text: line.slice(1, -1) },
            { text: line.slice(-1), cls: 'rail' },
          ]
        : [{ text: left }, { text: line }],
  );

  const above = Math.max(0, Math.floor((rows - lines.length) / 2));
  // Подсказка стоит в правом нижнем поле — там же, где статус в терминале.
  const foot: Seg[] =
    hint == null ? [] : [{ text: ' '.repeat(Math.max(0, cols - MARGIN.right - hint.length)) }, { text: hint, cls: 'dim' }];

  return (
    <>
      {Array.from({ length: rows }, (_, i) => (
        <Line key={i} segs={(i === rows - 2 ? foot : lines[i - above]) ?? []} cols={cols} />
      ))}
    </>
  );
}

export function OverlayScreen({
  cols,
  rows,
  title,
  lines,
  scroll,
  glyphs,
}: {
  cols: number;
  rows: number;
  title: string;
  lines: Seg[][];
  scroll: number;
  glyphs: FrameGlyphs;
}) {
  const inner = cols - 2;
  const body = rows - 4;
  // Оверлей, наоборот, читается сверху: это список, а не разговор.
  const from = Math.max(0, Math.min(scroll, Math.max(0, lines.length - body)));
  const visible = lines.slice(from, from + body);

  return (
    <>
      <Border widths={[inner]} glyphs={glyphs} left={glyphs.tl} mid={glyphs.h} right={glyphs.tr} title={title} />
      {Array.from({ length: body }, (_, i) => (
        <Row
          key={i}
          cells={[{ segs: [{ text: ' ' }, ...(visible[i] ?? [])], w: inner }]}
          glyphs={glyphs}
          endRail={
            (i === 0 && from > 0 && '▲') || (i === body - 1 && from + body < lines.length && '▼') || glyphs.v
          }
        />
      ))}
      <Border widths={[inner]} glyphs={glyphs} left={glyphs.l} mid={glyphs.h} right={glyphs.r} />
      <Row cells={[{ segs: [{ text: ' Esc — закрыть', cls: 'dim' }], w: inner }]} glyphs={glyphs} />
      <Border widths={[inner]} glyphs={glyphs} left={glyphs.bl} mid={glyphs.h} right={glyphs.br} />
    </>
  );
}

export function ErrorScreen({ cols, rows, errors }: { cols: number; rows: number; errors: string[] }) {
  const inner = cols - 2;
  const lines = errors.flatMap((e) => e.split('\n'));
  // Рамку берём светлую и не из конфига: контент не собрался, и конфиг в этот
  // момент — ровно то, чему верить нельзя.
  const glyphs = FRAMES.light!;

  return (
    <>
      <Border
        widths={[inner]}
        glyphs={glyphs}
        left={glyphs.tl}
        mid={glyphs.h}
        right={glyphs.tr}
        title="КОНТЕНТ НЕ СОБРАН"
      />
      {Array.from({ length: rows - 2 }, (_, i) => (
        <Row
          key={i}
          cells={[{ segs: [{ text: ' ' }, { text: lines[i] ?? '', cls: 'error' }], w: inner }]}
          glyphs={glyphs}
        />
      ))}
      <Border widths={[inner]} glyphs={glyphs} left={glyphs.bl} mid={glyphs.h} right={glyphs.br} />
    </>
  );
}
