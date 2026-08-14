import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, ContentError } from '../app/server/content/markdown.ts';
import { expandNode, type ExpandContext, type TargetInfo } from '../app/server/content/options.ts';

/**
 * Раскрытие генераторов — то место, где «удобно автору» превращается в «одинаково
 * для игрока». Стенд подменяет vault: важен не резолв ссылок, а какие опции выходят.
 */

const TARGETS: Record<string, TargetInfo> = {
  'rooms/коридор': { docId: 'rooms/коридор', type: 'room', label: 'коридор', nodeIds: new Set(['']), inHand: [] },
  'items/телефон': {
    docId: 'items/телефон',
    type: 'item',
    label: 'телефон',
    nodeIds: new Set(['', 'осмотреть', 'взять', 'позвонить']),
    inHand: ['позвонить'],
  },
  'items/доска': {
    docId: 'items/доска',
    type: 'item',
    label: 'доска',
    nodeIds: new Set(['', 'осмотреть']),
    inHand: [],
  },
};

const ctx: ExpandContext = {
  get: (docId) => TARGETS[docId],
  resolve(_from, ref, line) {
    const [file, node = ''] = ref.split('#');
    const docId = Object.keys(TARGETS).find((id) => id === file || id.endsWith(`/${file}`));
    if (!docId) throw new ContentError('room.md', `битая ссылка [[${ref}]]`, line);
    return { docId, nodeId: node };
  },
};

function room(body: string) {
  return parseMarkdown('room.md', `---\nid: пультовая\ntype: room\n---\n${body}`);
}

test('комната без блока options ведёт себя очевидным образом', () => {
  const doc = room('\nОписание.\n');
  const { options } = expandNode(ctx, doc, 'rooms/пультовая', doc.nodes[0]!, ['коридор'], ['доска']);

  assert.deepEqual(
    options.map((o) => o.label),
    ['идти коридор', 'осмотреть доска'],
  );
});

test('комната — место: `идти` ведёт в неё целиком и сдвигает игрока', () => {
  const doc = room('\nОписание.\n');
  const { options } = expandNode(ctx, doc, 'rooms/пультовая', doc.nodes[0]!, ['коридор'], []);
  const идти = options[0]!;

  assert.equal(идти.target, 'rooms/коридор#');
  assert.equal(идти.moves, true);
});

test('предмет отвечает только на то, что умеет, и не двигает игрока', () => {
  const doc = room('\n```options\nосмотреть: items\nвзять: items\n```\n');
  const { options } = expandNode(ctx, doc, 'rooms/пультовая', doc.nodes[0]!, [], ['доска', 'телефон']);

  // У доски есть только `осмотреть` — `взять доска` не появляется.
  assert.deepEqual(
    options.map((o) => o.label),
    ['осмотреть доска', 'осмотреть телефон', 'взять телефон'],
  );
  assert.equal(options.every((o) => !o.moves), true);
});

test('глагол из inHand комната не отдаёт: сначала возьми', () => {
  const doc = room('\n```options\nосмотреть: items\nпозвонить: items\n```\n');
  const { options } = expandNode(ctx, doc, 'rooms/пультовая', doc.nodes[0]!, [], ['телефон']);

  assert.deepEqual(
    options.map((o) => o.label),
    ['осмотреть телефон'],
  );
});

test('вещи на руках ездят с игроком — генератор inventory заводится сам', () => {
  const doc = room('\nОписание.\n');
  const { pending } = expandNode(ctx, doc, 'rooms/пультовая', doc.nodes[0]!, ['коридор'], []);
  assert.deepEqual(pending, [{ verb: '*', from: 'inventory' }]);
});

test('неизвестный источник — ошибка с именем файла', () => {
  const doc = room('\n```options\nосмотреть: карманы\n```\n');
  assert.throws(
    () => expandNode(ctx, doc, 'rooms/пультовая', doc.nodes[0]!, [], []),
    (e: unknown) => e instanceof ContentError && /неизвестный источник/.test((e as Error).message),
  );
});

test('источник пуст — генератор молча не отдаёт ничего', () => {
  const doc = room('\n```options\nосмотреть: items\n```\n');
  const { options } = expandNode(ctx, doc, 'rooms/пультовая', doc.nodes[0]!, [], []);
  assert.deepEqual(options, []);
});
