import { useEffect, useMemo } from 'react';
import { Line } from './Screen.tsx';
import { useAdvance, ADVANCE_HINT } from './advance.ts';
import { crossPoint, isSolved, layoutText, type Analysis, type Cell, type Word } from '../../shared/untangle.ts';
import type { Seg } from './text.ts';
import type { MinigameDef } from '../../shared/types.ts';

/**
 * Мини-игра «Распутать мысль» ([[07a-мини-игра]], «Рендерер»).
 *
 * Единственное место в игре, нарисованное не знаками сетки: линии обязаны
 * двигаться между дискретными положениями непрерывно, а их пересечения —
 * считаться геометрически. Поэтому поле — SVG, а документы — обычный HTML;
 * палитра, шрифт и фон при этом берутся у активного рендерера эпизода, и
 * второго визуального языка не появляется.
 *
 * Мышью здесь не играют вовсе: ни одного обработчика клика, наведения или
 * перетаскивания. Текст документов при этом выделяется и копируется — как
 * в любом терминале.
 */

/** Четыре цвета палитры: больше четырёх нитей у точки контент не допускает. */
const COLORS = ['var(--accent)', 'var(--margo)', 'var(--code)', 'var(--quote)'];

const HINT = '0–9 точка · WASD/стрелки двигать · Esc снять выбор';

export interface UntangleProps {
  def: MinigameDef;
  points: Record<number, Cell>;
  analysis: Analysis;
  selected: number | null;
  cols: number;
  status: Seg[];
  touch: boolean;
  /** Выбрать точку или снять выбор (`null`). */
  onSelect: (point: number | null) => void;
  /** Шаг на клетку: решает движок, отклонённый ход сюда не возвращается. */
  onMove: (dx: number, dy: number) => void;
  /** `Esc` без выбранной точки — обычное меню оболочки. */
  onMenu: () => void;
  /** `Enter` после победы. */
  onDone: () => void;
}

const MOVES: Record<string, [number, number]> = {
  KeyW: [0, -1],
  KeyA: [-1, 0],
  KeyS: [0, 1],
  KeyD: [1, 0],
  ArrowUp: [0, -1],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowRight: [1, 0],
};

export function UntangleScreen({
  def,
  points,
  analysis,
  selected,
  cols,
  status,
  touch,
  onSelect,
  onMove,
  onMenu,
  onDone,
}: UntangleProps) {
  const solved = isSolved(analysis);
  // Победа ждёт **нового** нажатия: тем же Enter игрок мог войти в поле.
  useAdvance(solved ? onDone : null);

  /*
   * Клавиатура принадлежит полю, пока оно на экране: цифра выбирает точку,
   * а не открывает меню оболочки. `WASD` проверяются по `code`, поэтому
   * работают и на русской раскладке; удержание даёт обычный `repeat`, и
   * каждый повтор остаётся отдельным шагом на одну клетку.
   */
  useEffect(() => {
    if (solved || touch) return;
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
      if (digit) {
        event.preventDefault();
        const id = Number(digit[1]);
        if (points[id] == null) return;
        onSelect(selected === id ? null : id);
        return;
      }
      const move = MOVES[event.code];
      if (move) {
        event.preventDefault();
        if (selected != null) onMove(move[0], move[1]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (selected == null) onMenu();
        else onSelect(null);
      }
    }

    // Ушёл фокус — снимаем выбор: иначе после возвращения стрелка браузерной
    // навигации поедет по точке, которой игрок уже не видит выбранной.
    const blur = () => onSelect(null);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', blur);
    };
  }, [points, selected, solved, touch, onSelect, onMove, onMenu]);

  const incident = useMemo(
    () =>
      selected == null ? []
      : def.threads.filter((t) => t.points.includes(selected)).map((t) => t.id).sort((a, b) => a - b),
    [def.threads, selected],
  );
  const colorOf = (thread: number): string | null => {
    const at = incident.indexOf(thread);
    return at === -1 ? null : COLORS[at % COLORS.length]!;
  };

  const text = useMemo(
    () => layoutText(def.id, def.seed, def.documents, analysis.crossings),
    [def.id, def.seed, def.documents, analysis.crossings],
  );

  const marks = analysis.crossings.flatMap(([a, b]) => {
    const t = def.threads.find((x) => x.id === a);
    const u = def.threads.find((x) => x.id === b);
    if (!t || !u) return [];
    const at = crossPoint(
      center(points[t.points[0]]!),
      center(points[t.points[1]]!),
      center(points[u.points[0]]!),
      center(points[u.points[1]]!),
    );
    return at == null ? [] : [{ key: `${a}-${b}`, at }];
  });

  // Пересечений нет, а раскладка всё ещё не планарная: точка села на чужую
  // нить или нити легли друг на друга. Невидимой стенки тут быть не должно —
  // только подпись и цвет предупреждения.
  const tangled = analysis.onThread.length > 0 || analysis.overlaps.length > 0;

  return (
    <>
      <Line segs={status} cols={cols} {...(status.length > 0 ? { cls: 'status' } : {})} />
      <div className="mini">
        <div className="mini-left">
          <div className="mini-head">
            <span className="dim">
              {Object.keys(points).length} точек · {def.threads.length} нитей
            </span>
            <span className={solved ? 'mini-solved' : tangled ? 'mini-warn' : 'dim'}>
              {solved ? 'распутано' : tangled ? 'разведите точки' : `пересечений: ${analysis.crossings.length}`}
            </span>
          </div>

          <svg className="mini-field" viewBox={`0 0 ${def.grid.columns} ${def.grid.rows}`} preserveAspectRatio="xMidYMid meet">
            <defs>
              <pattern id="mini-dots" width="1" height="1" patternUnits="userSpaceOnUse">
                <circle cx="0.5" cy="0.5" r="0.04" fill="var(--dim)" opacity="0.35" />
              </pattern>
            </defs>
            <rect x="0" y="0" width={def.grid.columns} height={def.grid.rows} fill="url(#mini-dots)" />

            {def.threads.map((t) => {
              const a = points[t.points[0]];
              const b = points[t.points[1]];
              if (!a || !b) return null;
              const color = colorOf(t.id);
              const [p, q] = [center(a), center(b)];
              return (
                <line
                  key={t.id}
                  x1={p[0]}
                  y1={p[1]}
                  x2={q[0]}
                  y2={q[1]}
                  stroke={color ?? 'var(--fg)'}
                  strokeWidth={color ? 0.09 : 0.06}
                  opacity={selected == null || color ? 1 : 0.3}
                />
              );
            })}

            {marks.map(({ key, at }) => (
              <text key={key} x={at[0]} y={at[1] + 0.12} className="mini-cross" textAnchor="middle" fontSize="0.42">
                ×
              </text>
            ))}

            {Object.entries(points).map(([id, cell]) => {
              const [x, y] = center(cell);
              const mine = selected === Number(id);
              return (
                <g key={id}>
                  <circle cx={x} cy={y} r={0.42} fill="var(--bg)" stroke={mine ? 'var(--accent)' : 'var(--fg)'} strokeWidth={mine ? 0.1 : 0.06} />
                  <text x={x} y={y + 0.18} textAnchor="middle" fontSize="0.5" fill={mine ? 'var(--accent)' : 'var(--fg)'}>
                    {id}
                  </text>
                </g>
              );
            })}
          </svg>

          <div className="mini-foot dim">
            {selected == null ?
              touch ? 'полю нужна клавиатура' : HINT
            : `точка ${selected} · нити ${incident.map(pad2).join(' ')}`}
          </div>
        </div>

        <div className="mini-right">
          {text.map((document, d) => (
            <section className="mini-doc" key={d}>
              <h2 className="mini-label dim">{document.label.toUpperCase()}</h2>
              {document.paragraphs.map((paragraph, p) => (
                <p key={p}>
                  {paragraph.flatMap((band, b) =>
                    band.words.map((word, i) => (
                      <Position key={`${b}-${i}`} word={word} color={colorOf(band.threads[i]!)} thread={band.threads[i]!} />
                    )),
                  )}
                </p>
              ))}
            </section>
          ))}
          {solved ? <p className="mini-enter dim">{touch ? 'Enter' : ADVANCE_HINT}</p> : null}
        </div>
      </div>
    </>
  );
}

/** Точки стоят в центрах клеток — туда же приходят и концы нитей. */
function center(cell: Cell): [number, number] {
  return [cell[0] + 0.5, cell[1] + 0.5];
}

function pad2(id: number): string {
  return String(id).padStart(2, '0');
}

/**
 * Позиция в полосе. Подсветка принадлежит **позиции**, а не слову: при
 * перестановке содержимое меняется, связь позиции с нитью — нет. Номер нити
 * обязателен рядом с цветом: цвет не остаётся единственным каналом связи.
 */
function Position({ word, color, thread }: { word: Word; color: string | null; thread: number }) {
  const body =
    word.code ? <code>{word.text}</code>
    : word.link ? <span className="word">{word.text}</span>
    : word.text;
  const marked = word.strong ? <strong>{body}</strong> : word.em ? <em>{body}</em> : body;

  return (
    <span className="mini-pos" {...(color ? { style: { color } } : {})}>
      {color ? <sup className="mini-tag">{pad2(thread)}</sup> : null}
      {marked}{' '}
    </span>
  );
}
