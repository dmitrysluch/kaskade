import { useMemo } from 'react';
import { sceneGraph, type SceneNode } from '../../shared/graph.ts';
import { edgePath, place, type BoxSize } from './layout.ts';
import type { GameContent } from '../../shared/types.ts';

/**
 * Граф узлов одной заметки (`/adm`, коробка на карте раскрывается им).
 *
 * Та же геометрия, что у карты эпизода, — слои сверху вниз, — но коробка это
 * узел, и в ней написано главное: **чем в него приходят**. В диалоге узел
 * узнают не по имени секции, а по команде, которая к нему ведёт: «прокладка»
 * ничего не говорит, «← выдавит прокладку» говорит всё.
 *
 * Метки поэтому живут в коробке, а не на связи. Подписанные стрелки в сцене
 * на три десятка узлов превращаются в кашу, а тут каждая метка стоит там же,
 * где её последствие.
 *
 * По этому же графу путь и собирают: узлы пути пронумерованы, его связи
 * подсвечены, а куда можно шагнуть дальше — обведено. Граф игры не дерево,
 * и парой «откуда/куда» нужная ветка не задаётся.
 */

const BOX: BoxSize = { w: 196, h: 46, gapX: 22, gapY: 38 };

/**
 * Сколько узлов ставим в ряд. У хаба два десятка тем на одном слое: в строку
 * они дают картинку в пять тысяч пикселей, которую нельзя охватить глазом.
 */
const PER_ROW = 6;

/** Механика узла одной строкой: то, ради чего в него чаще всего и заглядывают. */
function marks(node: SceneNode): string {
  const out: string[] = [];
  if (node.advance) out.push('▶');
  if (node.set.length > 0) out.push('⚑');
  if (node.give.length > 0) out.push('+');
  if (node.once) out.push('1×');
  return out.join(' ');
}

function incoming(node: SceneNode): string {
  if (node.via.length === 0) return node.entrance ? 'входят снаружи' : 'входа нет';
  const first = node.via[0] === null ? 'маршрут' : `← ${node.via[0]!}`;
  return node.via.length > 1 ? `${first}  +${node.via.length - 1}` : first;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : text;
}

export function SceneMap({
  content,
  docId,
  selected,
  onSelect,
  walk,
  candidates,
  onFollow,
}: {
  content: GameContent;
  docId: string;
  selected: string | null;
  onSelect: (addr: string) => void;
  /** Собранный руками путь: его узлы пронумерованы, его связи подсвечены. */
  walk: string[];
  /** Куда можно шагнуть из последнего узла пути: подсказка, а не запрет. */
  candidates: Set<string>;
  /** Шаг наружу заметки: продолжает путь и открывает соседнюю заметку. */
  onFollow: (addr: string) => void;
}) {
  const graph = useMemo(() => sceneGraph(content, docId), [content, docId]);
  const { boxes, width, height } = useMemo(() => place(graph.columns, BOX, PER_ROW), [graph]);
  const at = useMemo(() => new Map(boxes.map((b) => [b.addr, b])), [boxes]);

  // Номер шага, а не «состоит в пути»: один узел путь может пройти дважды,
  // и показать надо первый номер — по нему его в списке и ищут.
  const step = useMemo(() => {
    const out = new Map<string, number>();
    walk.forEach((addr, i) => {
      if (!out.has(addr)) out.set(addr, i + 1);
    });
    return out;
  }, [walk]);

  // Связи пути: пара подряд идущих узлов. Проверяем именно пары, иначе петля
  // подсветила бы половину графа.
  const walked = useMemo(
    () => new Set(walk.slice(1).map((addr, i) => `${walk[i]}→${addr}`)),
    [walk],
  );
  const last = walk.at(-1) ?? null;

  if (graph.nodes.length === 0) return null;

  return (
    <>
      {/* Сцена на три десятка узлов шире окна: даём ей прокрутиться, а не жать
          картинку до нечитаемого — читают тут именно подписи. */}
      <div className="adm-scroll">
        <svg className="adm-map" width={width} height={height}>
          {graph.edges.map((edge, i) => {
            const a = at.get(edge.from);
            const b = at.get(edge.to);
            if (!a || !b) return null;
            return (
              <path
                key={`${edge.from}→${edge.to}-${i}`}
                className={[
                  'adm-edge',
                  edge.back ? 'adm-edge-back' : '',
                  walked.has(`${edge.from}→${edge.to}`) ? 'adm-edge-walk' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                d={edgePath(a, b, edge.back, BOX)}
              />
            );
          })}

          {boxes.map((node) => (
            <g
              key={node.addr}
              className={[
                'adm-box adm-node',
                node.entrance ? 'adm-entrance' : '',
                node.layer === -1 ? 'adm-lost' : '',
                step.has(node.addr) ? 'adm-walk' : '',
                node.addr === last ? 'adm-walk-last' : '',
                candidates.has(node.addr) ? 'adm-next' : '',
                selected === node.addr ? 'adm-open' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSelect(node.addr)}
            >
              <title>{node.first}</title>
              <rect x={node.x} y={node.y} width={BOX.w} height={BOX.h} rx={3} />
              <text x={node.x + 10} y={node.y + 19}>
                {step.has(node.addr) && <tspan className="adm-step-no">{step.get(node.addr)} </tspan>}
                {clip(node.id || '(вступление)', 22)}
              </text>
              <text className="adm-tag" x={node.x + BOX.w - 10} y={node.y + 19}>
                {marks(node)}
              </text>
              <text className="adm-sub" x={node.x + 10} y={node.y + 36}>
                {clip(incoming(node), 26)}
              </text>
            </g>
          ))}
        </svg>
      </div>

      {graph.exits.length > 0 && (
        <p className="adm-exits">
          <span className="adm-sub">наружу: </span>
          {graph.exits.map((exit, i) => {
            // Выход из последнего узла пути — это следующий шаг: по нему путь
            // переходит в соседнюю заметку, и её граф открывается сам.
            const step = exit.from === last;
            const text = `${exit.label ?? 'маршрут'} → ${exit.to.split('/').slice(-1)[0]}`;
            return step ? (
              <button
                key={`${exit.from}-${exit.to}-${i}`}
                className="adm-exit adm-next"
                type="button"
                onClick={() => onFollow(exit.to)}
              >
                {text}
              </button>
            ) : (
              <span key={`${exit.from}-${exit.to}-${i}`} className="adm-exit">
                {text}
              </span>
            );
          })}
        </p>
      )}
    </>
  );
}
