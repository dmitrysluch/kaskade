import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonPrefix, exact, matches } from '../app/client/engine/completion.ts';
import { buildCatalog } from '../app/client/engine/catalog.ts';
import { evalCondition } from '../app/client/engine/state.ts';
import { attrs, content, doc, episode, node } from './helpers.ts';
import type { CatalogOption } from '../app/client/engine/catalog.ts';
import type { SaveState } from '../app/shared/types.ts';

function opt(label: string, locked = false): CatalogOption {
  return { label, kind: 'story', target: null, attrs: attrs(), verb: null, object: null, moves: false, locked, system: null };
}

const CATALOG = [
  opt('спросить о партия BAYN-OPV-63991'),
  opt('спросить о партия (общее)'),
  opt('спросить о 4380-B'),
  opt('сесть сзади'),
  opt('идти коридор'),
];

test('совпадение ищется по началу любого слова, а не всей строки', () => {
  // Пример из ТЗ: «спросить о парт▁» находит партию, хотя опция начинается иначе.
  const found = matches(CATALOG, 'спросить о парт').map((o) => o.label);
  assert.deepEqual(found, ['спросить о партия BAYN-OPV-63991', 'спросить о партия (общее)']);
});

test('слова ищутся в любом порядке', () => {
  assert.deepEqual(
    matches(CATALOG, 'коридор идти').map((o) => o.label),
    ['идти коридор'],
  );
});

test('пустой ввод показывает весь каталог', () => {
  assert.equal(matches(CATALOG, '   ').length, CATALOG.length);
});

test('Tab дописывает общую приставку', () => {
  const found = matches(CATALOG, 'спросить о парт');
  assert.equal(commonPrefix(found), 'спросить о партия ');
});

test('коммитится только точное имя опции', () => {
  assert.equal(exact(CATALOG, 'СЕСТЬ  Сзади')?.label, 'сесть сзади');
  assert.equal(exact(CATALOG, 'сесть'), null);
});

test('серое слово видно в каталоге и помечено как незакоммитимое', () => {
  const scene = node('episodes/p/scenes/s#', { pending: [{ verb: 'спросить о', from: 'words' }] });
  const game = content({
    episodes: [episode('p', { verbs: ['спросить'] })],
    words: {
      alers: { id: 'alers', label: 'АЛЕРС, В.', category: 'люди', text: '' },
      kaskade: { id: 'kaskade', label: 'KASKADE', category: 'обозначения', text: '' },
    },
    docs: { 'episodes/p/scenes/s': doc('episodes/p/scenes/s', { nodes: [scene] }) },
  });

  const save: SaveState = {
    saveVersion: 1,
    words: { alers: 'white', kaskade: 'grey' },
    flags: {},
    inventory: [],
    splashes: [],
    chapter: 'p',
    dates: {},
    itemStates: {},
    taught: true,
    hinted: true,
    started: true,
    wait: null,
    episodeState: { episode: 'p', at: 'episodes/p/scenes/s#', used: [] },
  };

  const catalog = buildCatalog(game, save);
  const grey = catalog.find((o) => o.object === 'kaskade')!;
  const white = catalog.find((o) => o.object === 'alers')!;

  assert.equal(grey.label, 'спросить о KASKADE');
  assert.equal(grey.locked, true);
  assert.equal(white.locked, false);
});

test('условия читаются так, как их пишет автор', () => {
  const save: SaveState = {
    saveVersion: 1,
    words: { alers: 'white' },
    flags: { 'prolog.signed': { value: true, at: '11.09.2026' } },
    inventory: ['телефон'],
    splashes: [],
    chapter: 'p',
    dates: {},
    itemStates: {},
    taught: true,
    hinted: true,
    started: true,
    wait: null,
    episodeState: { episode: 'p', at: 'x#', used: [] },
  };

  assert.equal(evalCondition(null, save), true);
  assert.equal(evalCondition('prolog.signed', save), true);
  assert.equal(evalCondition('!prolog.signed', save), false);
  assert.equal(evalCondition('has:телефон', save), true);
  assert.equal(evalCondition('has:бланк', save), false);
  assert.equal(evalCondition('word:alers, has:телефон', save), true);
  assert.equal(evalCondition('word:kaskade', save), false);
});
