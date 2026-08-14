import { emptyAttrs, type Attrs, type Doc, type GameContent, type Node, type Option } from '../app/shared/types.ts';

/** Сборка синтетического контента: правила валидатора удобнее проверять на трёх узлах. */

export function attrs(patch: Partial<Attrs> = {}): Attrs {
  return { ...emptyAttrs(), ...patch };
}

export function option(patch: Partial<Option> = {}): Option {
  return {
    label: '',
    kind: 'story',
    target: null,
    attrs: attrs(),
    verb: null,
    object: null,
    moves: false,
    ...patch,
  };
}

export function node(addr: string, patch: Partial<Node> = {}): Node {
  return {
    id: addr.slice(addr.indexOf('#') + 1),
    addr,
    date: null,
    line: 1,
    attrs: attrs(),
    text: '',
    options: [],
    pending: [],
    generators: [],
    ...patch,
  };
}

export function doc(docId: string, patch: Partial<Doc> = {}): Doc {
  const id = docId.split('/').pop()!;
  return {
    id,
    docId,
    path: `/content/${docId}.md`,
    type: 'scene',
    label: id,
    date: null,
    fm: {},
    nodes: [],
    exits: [],
    items: [],
    inHand: [],
    pages: [],
    optionBlocks: [],
    ...patch,
  };
}

export function content(patch: Partial<GameContent> = {}): GameContent {
  const base: GameContent = {
    title: 'тест',
    saveVersion: 1,
    episodes: [],
    renderers: {},
    characters: {},
    words: {},
    documents: {},
    reference: {},
    nodes: {},
    docs: {},
    ...patch,
  };
  // Узлы приходят в двух видах — списком в документе и картой по адресу; держим их
  // согласованными, чтобы тест не проверял случайно только половину.
  if (!patch.nodes) {
    base.nodes = Object.fromEntries(
      Object.values(base.docs).flatMap((d) => d.nodes.map((n) => [n.addr, n] as const)),
    );
  }
  return base;
}

export function episode(id: string, patch: Partial<GameContent['episodes'][number]> = {}) {
  return {
    id,
    title: id,
    renderer: 'academic',
    entry: `episodes/${id}/scenes/start#`,
    verbs: [],
    itemVerbs: [],
    characters: [],
    paletteOverride: {},
    ambience: null,
    dates: {},
    tutorial: { at: null, hint: '' },
    closed: [],
    ...patch,
  };
}
