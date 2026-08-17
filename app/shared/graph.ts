import type { GameContent, DocType } from './types.ts';

/**
 * Граф игры для служебного просмотра (`/adm`).
 *
 * Здесь только арифметика: что во что ведёт, на каком слое лежит и как пройти
 * из одного узла в другой. Рисование — дело компонента, и оно должно уметь
 * поменяться, не трогая ничего из этого.
 *
 * Условия (`if`) при обходе **не проверяются**: это карта того, что автор
 * написал, а не того, что увидит игрок с конкретными флагами. Путь, который
 * тут показан, может требовать флага — зато видно, что связь вообще есть.
 */

/** Места: сцена и комната. Предмет отвечает, но игрока не двигает. */
const PLACES: DocType[] = ['scene', 'room'];

export interface MapBox {
  docId: string;
  id: string;
  label: string;
  type: DocType;
  /** Сколько узлов внутри: заметка на два узла и на двадцать — разные вещи. */
  nodes: number;
  /** Предметы, до которых дотягивается заметка: они висят на месте, а не в графе. */
  items: string[];
  /**
   * Слой — расстояние в переходах от входа в эпизод. `-1` значит «из входа
   * не дойти»: закрытая заметка, черновик или отвалившаяся ветка.
   */
  layer: number;
  /** Закрыта в `episode.yaml` — в игре её не показывают, в графе она есть. */
  closed: boolean;
}

export interface MapEdge {
  from: string;
  to: string;
  /** Сколько переходов ведёт туда: толщина связи, а не число линий. */
  count: number;
  /** Ведёт назад или вбок — в тот же слой или в более ранний. */
  back: boolean;
}

export interface StoryMap {
  boxes: MapBox[];
  edges: MapEdge[];
  /** Заметки по слоям, в порядке отрисовки; последний — недостижимое. */
  columns: MapBox[][];
}

function docOf(addr: string): string {
  const hash = addr.indexOf('#');
  return hash === -1 ? addr : addr.slice(0, hash);
}

/** Куда ведёт узел: цели опций и безусловный `goto`, без пустых. */
function targetsOf(content: GameContent, addr: string): { target: string; label: string }[] {
  const node = content.nodes[addr];
  if (!node) return [];
  const out = node.options.flatMap((o) => (o.target ? [{ target: o.target, label: o.label }] : []));
  if (node.attrs.goto) out.push({ target: node.attrs.goto, label: '' });
  return out;
}

/**
 * Карта эпизода на уровне заметок: сцены и комнаты — коробки, переходы между
 * ними — связи. Предметы коробками не становятся: их десятки, они висят на
 * своём месте и графа не образуют, — поэтому они перечислены внутри коробки.
 */
export function storyMap(content: GameContent, episodeId: string): StoryMap {
  const episode = content.episodes.find((e) => e.id === episodeId);
  if (!episode) return { boxes: [], edges: [], columns: [] };

  const prefix = `episodes/${episodeId}/`;
  const places = Object.values(content.docs).filter(
    (d) => d.docId.startsWith(prefix) && PLACES.includes(d.type),
  );
  const isPlace = new Set(places.map((d) => d.docId));

  // Связи между заметками и предметы, до которых заметка дотягивается.
  const edges = new Map<string, MapEdge>();
  const items = new Map<string, Set<string>>();

  for (const doc of places) {
    const own = new Set<string>();
    for (const node of doc.nodes) {
      for (const { target } of targetsOf(content, node.addr)) {
        const to = docOf(target);
        if (to === doc.docId) continue;
        if (isPlace.has(to)) {
          const key = `${doc.docId}→${to}`;
          const found = edges.get(key);
          if (found) found.count += 1;
          else edges.set(key, { from: doc.docId, to, count: 1, back: false });
        } else if (content.docs[to]?.type === 'item') {
          own.add(content.docs[to]!.label);
        }
      }
    }
    items.set(doc.docId, own);
  }

  // Слой — расстояние от входа. Обход в ширину: первый раз добрались, значит
  // это и есть кратчайшее число переходов.
  const layer = new Map<string, number>();
  const entry = docOf(episode.entry);
  if (isPlace.has(entry)) layer.set(entry, 0);

  for (let queue = [entry], depth = 0; queue.length > 0; depth++) {
    const next: string[] = [];
    for (const from of queue) {
      for (const edge of edges.values()) {
        if (edge.from !== from || layer.has(edge.to)) continue;
        layer.set(edge.to, depth + 1);
        next.push(edge.to);
      }
    }
    queue = next;
  }

  const boxes: MapBox[] = places.map((doc) => ({
    docId: doc.docId,
    id: doc.id,
    label: doc.label,
    type: doc.type,
    nodes: doc.nodes.length,
    items: [...(items.get(doc.docId) ?? [])],
    layer: layer.get(doc.docId) ?? -1,
    closed: episode.closed.includes(doc.docId),
  }));

  // Связь «назад» — в тот же слой или в более ранний: возврат в комнату,
  // круг по хабу. Рисуется иначе, потому что читается иначе.
  for (const edge of edges.values()) {
    const a = layer.get(edge.from);
    const b = layer.get(edge.to);
    edge.back = a != null && b != null && b <= a;
  }

  const depth = Math.max(0, ...boxes.map((b) => b.layer));
  const columns: MapBox[][] = [];
  for (let i = 0; i <= depth; i++) columns.push(boxes.filter((b) => b.layer === i));
  const lost = boxes.filter((b) => b.layer === -1);
  if (lost.length > 0) columns.push(lost);

  return { boxes, edges: [...edges.values()], columns };
}

/** Один возможный ход из узла: куда, какой командой и необратим ли он. */
export interface Move {
  target: string;
  /** `null` — маршрут: переход без метки, который игрок не выбирает. */
  label: string | null;
  advance: boolean;
}

/**
 * Что можно сделать из узла. Нужно всюду, где путь собирают руками: граф
 * подсвечивает этим следующий шаг, карточка узла — перечисляет выходы.
 */
export function movesFrom(content: GameContent, addr: string): Move[] {
  const node = content.nodes[addr];
  if (!node) return [];

  const out: Move[] = node.options.flatMap((o) =>
    o.target ? [{ target: o.target, label: o.label === '' ? null : o.label, advance: o.attrs.advance }] : [],
  );
  if (node.attrs.goto) out.push({ target: node.attrs.goto, label: null, advance: false });
  return out;
}

export interface PathStep {
  addr: string;
  /** Шага в графе нет: путь собран руками и с тех пор заметку правили. */
  broken?: boolean;
  /**
   * Чем сюда пришли: метка команды, `null` у первого шага и у маршрута —
   * перехода без метки, который игрок не выбирает.
   */
  via: string | null;
  /** Шаг закрывает текущие возможности: `advance` у той самой опции. */
  advance: boolean;
}

/**
 * Кратчайший путь между узлами: обход в ширину по целям опций и `goto`.
 *
 * Кратчайший, а не «какой-нибудь»: читать надо связь, а не первую попавшуюся
 * прогулку по графу. Условия не проверяются — см. заглавный комментарий.
 */
export function shortestPath(content: GameContent, from: string, to: string): PathStep[] | null {
  if (!content.nodes[from] || !content.nodes[to]) return null;
  if (from === to) return [{ addr: from, via: null, advance: false }];

  const came = new Map<string, { prev: string; via: string; advance: boolean }>();
  const seen = new Set([from]);
  let queue = [from];

  while (queue.length > 0) {
    const next: string[] = [];
    for (const addr of queue) {
      for (const { target, label } of targetsOf(content, addr)) {
        if (seen.has(target)) continue;
        seen.add(target);
        const option = content.nodes[addr]?.options.find((o) => o.target === target);
        came.set(target, { prev: addr, via: label, advance: option?.attrs.advance ?? false });
        if (target === to) {
          // Разматываем назад: путь собран из того, чем в каждый узел пришли.
          const steps: PathStep[] = [];
          for (let at = to; ; ) {
            const step = came.get(at);
            if (!step) break;
            steps.unshift({ addr: at, via: step.via === '' ? null : step.via, advance: step.advance });
            at = step.prev;
          }
          return [{ addr: from, via: null, advance: false }, ...steps];
        }
        next.push(target);
      }
    }
    queue = next;
  }

  return null;
}

/* ────────────────────────────── граф одной заметки ────────────────────────── */

export interface SceneNode {
  addr: string;
  id: string;
  /**
   * Метки, которыми в узел приходят изнутри заметки. `null` — маршрут: переход
   * без метки, который игрок не выбирает. В диалоге это главное, что надо
   * видеть: узел «прокладка» интересен тем, что в него ведёт «выдавит прокладку».
   */
  via: (string | null)[];
  /** Слой — расстояние от входов заметки; `-1` — внутри заметки не достижим. */
  layer: number;
  /** В узел входят снаружи заметки: это вход в сцену, а не её середина. */
  entrance: boolean;
  /** Хоть один входящий переход помечен `advance`. */
  advance: boolean;
  /** Механика узла — то, ради чего в него часто и заглядывают. */
  set: string[];
  give: string[];
  once: boolean;
  /** Первая непустая строка: по ней узел узнают, не открывая. */
  first: string;
}

export interface SceneEdge {
  from: string;
  to: string;
  back: boolean;
}

/** Переход наружу заметки: куда сцена выпускает. */
export interface SceneExit {
  from: string;
  to: string;
  label: string | null;
}

export interface SceneGraph {
  nodes: SceneNode[];
  edges: SceneEdge[];
  exits: SceneExit[];
  columns: SceneNode[][];
}

function firstLine(text: string): string {
  return text.split('\n').find((l) => l.trim() !== '')?.trim() ?? '';
}

/**
 * Граф узлов одной заметки (07-оболочка-тз, «Dev-loop»).
 *
 * Слои считаются не от одного узла, а от всех входов: в сцену входят снаружи,
 * и `#после` в аудитории — такой же вход, как вступление, просто приходят в него
 * из лекции. Иначе половина заметки оказалась бы «недостижимой», и картинка
 * врала бы про самую обычную комнату с двумя состояниями.
 */
export function sceneGraph(content: GameContent, docId: string): SceneGraph {
  const doc = content.docs[docId];
  if (!doc) return { nodes: [], edges: [], exits: [], columns: [] };

  const inside = new Set(doc.nodes.map((n) => n.addr));
  const via = new Map<string, (string | null)[]>();
  const advance = new Set<string>();
  const edges: SceneEdge[] = [];
  const exits: SceneExit[] = [];

  for (const node of doc.nodes) {
    for (const { target, label } of targetsOf(content, node.addr)) {
      if (!inside.has(target)) {
        exits.push({ from: node.addr, to: target, label: label === '' ? null : label });
        continue;
      }
      edges.push({ from: node.addr, to: target, back: false });
      via.set(target, [...(via.get(target) ?? []), label === '' ? null : label]);
      const option = node.options.find((o) => o.target === target);
      if (option?.attrs.advance) advance.add(target);
    }
  }

  // Входы: вступление и всё, во что заходят снаружи заметки.
  const entrance = new Set<string>();
  if (inside.has(`${docId}#`)) entrance.add(`${docId}#`);
  for (const node of Object.values(content.nodes)) {
    if (inside.has(node.addr)) continue;
    for (const { target } of targetsOf(content, node.addr)) {
      if (inside.has(target)) entrance.add(target);
    }
  }

  const layer = new Map<string, number>();
  for (const addr of entrance) layer.set(addr, 0);
  for (let queue = [...entrance], depth = 0; queue.length > 0; depth++) {
    const next: string[] = [];
    for (const from of queue) {
      for (const edge of edges) {
        if (edge.from !== from || layer.has(edge.to)) continue;
        layer.set(edge.to, depth + 1);
        next.push(edge.to);
      }
    }
    queue = next;
  }

  for (const edge of edges) {
    const a = layer.get(edge.from);
    const b = layer.get(edge.to);
    edge.back = a != null && b != null && b <= a;
  }

  const nodes: SceneNode[] = doc.nodes.map((node) => ({
    addr: node.addr,
    id: node.id,
    via: via.get(node.addr) ?? [],
    layer: layer.get(node.addr) ?? -1,
    entrance: entrance.has(node.addr),
    advance: advance.has(node.addr),
    set: node.attrs.set,
    give: node.attrs.give,
    once: node.attrs.once,
    first: firstLine(node.text),
  }));

  const depth = Math.max(0, ...nodes.map((n) => n.layer));
  const columns: SceneNode[][] = [];
  for (let i = 0; i <= depth; i++) columns.push(nodes.filter((n) => n.layer === i));
  const lost = nodes.filter((n) => n.layer === -1);
  if (lost.length > 0) columns.push(lost);

  return { nodes, edges, exits, columns };
}

/**
 * Путь, собранный руками (`/adm`, конструктор пути).
 *
 * Граф игры — не дерево: из узла в узел ведут несколько разных веток, и парой
 * «откуда/куда» путь не задаётся однозначно. Кратчайший показывает, что связь
 * есть; прочитать нужную ветку можно, только назвав её узлы подряд.
 *
 * Шаг, которого в графе нет, не выбрасывается: он приезжает без метки и с
 * пометой `broken`. Так видно, что заметку правили и путь развалился, — молча
 * подменять его кратчайшим значило бы соврать.
 */
export function walkSteps(content: GameContent, walk: string[]): PathStep[] {
  return walk.map((addr, i) => {
    if (i === 0) return { addr, via: null, advance: false };
    const move = movesFrom(content, walk[i - 1]!).find((m) => m.target === addr);
    return { addr, via: move?.label ?? null, advance: move?.advance ?? false, ...(move ? {} : { broken: true }) };
  });
}
