/**
 * Раскладка слоёв в пиксели — общая для карты эпизода и для графа заметки.
 *
 * Обе картинки устроены одинаково: слои сверху вниз, внутри слоя коробки в ряд,
 * связи — кривые между ними. Разные у них только размер коробки и то, что
 * в ней написано, поэтому геометрия живёт здесь и знает про слои, а не про то,
 * заметка это или узел.
 */

export interface BoxSize {
  w: number;
  h: number;
  gapX: number;
  gapY: number;
}

export type Placed<T> = T & { x: number; y: number };

/**
 * Слои в пиксели. Широкий слой переносится в несколько рядов: у хаба два
 * десятка тем на одном уровне, и в строку они дают пять тысяч пикселей
 * вширь — картинку, которую нельзя охватить глазом. Ряды одного слоя идут
 * подряд и читаются как один.
 */
export function place<T>(
  columns: T[][],
  box: BoxSize,
  perRow = Infinity,
): { boxes: Placed<T>[]; width: number; height: number } {
  const rows: T[][] = columns.flatMap((column) => {
    if (column.length <= perRow) return [column];
    const chunks: T[][] = [];
    for (let i = 0; i < column.length; i += perRow) chunks.push(column.slice(i, i + perRow));
    return chunks;
  });

  const width = Math.max(1, ...rows.map((r) => r.length)) * (box.w + box.gapX) - box.gapX;
  const boxes: Placed<T>[] = [];

  rows.forEach((row, y) => {
    // Ряд центрируем: цепочка тогда читается как позвоночник, а ветка видна
    // тем, что от него отходит.
    const span = row.length * (box.w + box.gapX) - box.gapX;
    const left = (width - span) / 2;
    row.forEach((item, i) => {
      boxes.push({ ...item, x: left + i * (box.w + box.gapX), y: y * (box.h + box.gapY) });
    });
  });

  return { boxes, width, height: Math.max(box.h, rows.length * (box.h + box.gapY) - box.gapY) };
}

/** Куда ведёт связь на картинке: вниз по прямой или назад, дугой сбоку. */
export function edgePath(
  a: { x: number; y: number },
  b: { x: number; y: number },
  back: boolean,
  box: BoxSize,
): string {
  const ax = a.x + box.w / 2;
  const bx = b.x + box.w / 2;

  if (!back) {
    const ay = a.y + box.h;
    const by = b.y;
    const mid = (ay + by) / 2;
    return `M ${ax} ${ay} C ${ax} ${mid}, ${bx} ${mid}, ${bx} ${by}`;
  }

  // Возврат обводим справа: иначе он ложится на прямую связь и читается как она.
  const ay = a.y + box.h / 2;
  const by = b.y + box.h / 2;
  const side = Math.max(a.x, b.x) + box.w + 26;
  return `M ${a.x + box.w} ${ay} C ${side} ${ay}, ${side} ${by}, ${b.x + box.w} ${by}`;
}
