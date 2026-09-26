import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRoom, type RoomPart } from '../app/server/content/rooms.ts';
import type { RawDoc, RawNode } from '../app/server/content/markdown.ts';

/**
 * Сборка виртуальных комнат ([[13-навигация-и-комнаты-тз]], «Объединение»).
 *
 * Таблица слияния проверяется построчно: каждая строка отвечает на вопрос
 * «что значит, что автор этого не написал», и ошибка здесь не падает, а тихо
 * меняет обстановку — возвращает ушедшего человека или теряет выход.
 */

function rawNode(id: string, patch: Partial<RawNode> = {}): RawNode {
  return { id, line: 1, attrs: { ...emptyAttrs() }, text: '', transitions: [], generators: [], ...patch } as RawNode;
}

function emptyAttrs() {
  return {
    if: null, set: [], unset: [], give: [], take: [], cost: null, once: false, goto: null,
    tag: [], label: null, items: [], exits: [], dates: {}, page: null, timeLabel: null,
    wait: null, advance: false,
  };
}

function part(docId: string, patch: Partial<RoomPart> = {}): RoomPart {
  const raw: RawDoc = { path: `/content/${docId}.md`, fm: {}, type: 'room', nodes: [rawNode('')] };
  return {
    docId,
    raw,
    persistent: 'tu.dorm-room',
    stage: null,
    label: null,
    target: null,
    targets: {},
    entry: null,
    available: null,
    exits: undefined,
    items: undefined,
    ...patch,
  };
}

const merge = (common: RoomPart | null, version: RoomPart | null) =>
  mergeRoom('prolog', 'tu.dorm-room', '04', common, version);

test('адрес собранной комнаты не зависит от имён файлов', () => {
  const room = merge(part('rooms/common-room'), part('rooms/04-room', { stage: '04' }));
  assert.equal(room.docId, 'episodes/prolog/rooms-virt/tu.dorm-room:04');
});

test('подпись, форма, вход и доступность: версия заменяет, отсутствие наследует', () => {
  const common = part('rooms/common-room', { label: 'комната', target: 'в комнату', entry: 'один' });
  const version = part('rooms/04-room', { stage: '04', label: 'комната одной Марго' });

  const room = merge(common, version);
  assert.equal(room.label, 'комната одной Марго');
  assert.equal(room.target, 'в комнату', 'форму версия не объявила — наследуется');
  assert.equal(room.entry, 'один');
  assert.equal(room.available, true, 'по умолчанию помещение открыто');

  // `available: false` закрывает помещение в этом срезе.
  assert.equal(merge(common, part('rooms/04-room', { stage: '04', available: false })).available, false);
  // И наследуется из общей части, если версия молчит.
  assert.equal(merge(part('c', { available: false }), part('v', { stage: '04' })).available, false);
});

test('targets объединяются по глаголам, а не заменяются целиком', () => {
  const room = merge(
    part('c', { targets: { осмотреть: 'комнату', подойти: 'к столу' } }),
    part('v', { stage: '04', targets: { подойти: 'к окну' } }),
  );

  assert.deepEqual(room.targets, { осмотреть: 'комнату', подойти: 'к окну' });
});

test('предметы складываются без повторов: постоянное остаётся постоянным', () => {
  const room = merge(
    part('c', { items: ['00-window', '00-speaker'] }),
    part('v', { stage: '04', items: ['04-letter', '00-window'] }),
  );

  assert.deepEqual(room.items, ['00-window', '00-speaker', '04-letter']);
});

test('выходы версия заменяет целиком, и пустой список значит «выходов нет»', () => {
  const common = part('c', { exits: ['rooms-virt/tu.dorm-corridor'] });

  // Версия молчит — берутся общие.
  assert.deepEqual(merge(common, part('v', { stage: '04' })).exits, ['rooms-virt/tu.dorm-corridor']);

  // Версия объявила свои — общие не дописываются.
  assert.deepEqual(
    merge(common, part('v', { stage: '04', exits: ['rooms-virt/tu.yard'] })).exits,
    ['rooms-virt/tu.yard'],
  );

  // Пустой список — это решение автора, а не отсутствие решения.
  assert.deepEqual(merge(common, part('v', { stage: '04', exits: [] })).exits, []);
});

test('нода с тем же id заменяется целиком и остаётся на своём месте', () => {
  const common = part('c', {
    raw: {
      path: '/content/c.md',
      fm: {},
      type: 'room',
      nodes: [rawNode('', { text: 'Общага.' }), rawNode('один', { text: 'Тоби лежит поперёк кровати.' }), rawNode('окно')],
    },
  });
  const version = part('v', {
    stage: '04',
    raw: { path: '/content/v.md', fm: {}, type: 'room', nodes: [rawNode('один', { text: 'Тоби нет. На столе письмо.' })] },
  });

  const room = merge(common, version);
  assert.deepEqual(room.nodes.map((n) => n.raw.id), ['', 'один', 'окно']);

  const один = room.nodes.find((n) => n.raw.id === 'один')!;
  assert.equal(один.raw.text, 'Тоби нет. На столе письмо.');
  assert.equal(один.part, 'version');
  // Старый текст не склеивается и не остаётся рядом.
  assert.equal(room.nodes.filter((n) => n.raw.id === 'один').length, 1);
  // А нетронутые ноды знают, что они из общей части: это видно в `/adm`.
  assert.equal(room.nodes.find((n) => n.raw.id === 'окно')!.part, 'common');
});

test('новая нода версии дописывается в конец, в порядке источника', () => {
  const common = part('c', {
    raw: { path: '/content/c.md', fm: {}, type: 'room', nodes: [rawNode(''), rawNode('один')] },
  });
  const version = part('v', {
    stage: '04',
    raw: { path: '/content/v.md', fm: {}, type: 'room', nodes: [rawNode('письмо'), rawNode('папка')] },
  });

  assert.deepEqual(merge(common, version).nodes.map((n) => n.raw.id), ['', 'один', 'письмо', 'папка']);
});

test('безымянное вступление версия тоже заменяет целиком', () => {
  const common = part('c', {
    raw: { path: '/content/c.md', fm: {}, type: 'room', nodes: [rawNode('', { text: 'Общага. Тоби дома.' })] },
  });
  const version = part('v', {
    stage: '04',
    raw: { path: '/content/v.md', fm: {}, type: 'room', nodes: [rawNode('', { text: 'Общага. Ты одна.' })] },
  });

  const room = merge(common, version);
  assert.equal(room.nodes.length, 1);
  assert.equal(room.nodes[0]!.raw.text, 'Общага. Ты одна.');
});

test('помещение из одного среза пишется одним файлом, без пустой общей части', () => {
  const only = part('rooms/01-hall', { persistent: 'tu.h1012', stage: '01', label: 'аудитория' });
  const room = mergeRoom('prolog', 'tu.h1012', '01', null, only);

  assert.equal(room.label, 'аудитория');
  assert.equal(room.nodes.length, 1);
  assert.equal(room.nodes[0]!.part, 'version');
});

test('блок options версии заменяет общий, а не дописывается к нему', () => {
  const common = part('c', {
    raw: {
      path: '/content/c.md',
      fm: {},
      type: 'room',
      nodes: [rawNode('', { generators: [{ phrase: 'идти', source: 'exits', line: 5 }] })],
    },
  });
  const version = part('v', {
    stage: '04',
    raw: {
      path: '/content/v.md',
      fm: {},
      type: 'room',
      nodes: [rawNode('', { generators: [{ phrase: 'осмотреть', source: 'items', line: 9 }] })],
    },
  });

  // Версия объявила блок — общий не участвует.
  assert.deepEqual(merge(common, version).generators.map((g) => g.phrase), ['осмотреть']);

  /*
   * Версия молчит — работает общий, **даже если версия перепишет вступление**.
   * Блок — свойство файла, а висит он на узле; считай его по собранным узлам,
   * и переписанное вступление унесло бы с собой все выходы комнаты.
   */
  const silent = part('v', {
    stage: '04',
    raw: { path: '/content/v.md', fm: {}, type: 'room', nodes: [rawNode('', { text: 'Ты одна.' })] },
  });
  assert.deepEqual(merge(common, silent).generators.map((g) => g.phrase), ['идти']);

  // Оба файла видны валидатору по отдельности: два блока в одном файле — ошибка,
  // а общий плюс версии — норма.
  assert.deepEqual(merge(common, version).optionBlocks.map((b) => b.line), [5, 9]);
});
