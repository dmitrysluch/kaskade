import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES } from '../app/server/validate/index.ts';
import { content, doc, episode, node } from './helpers.ts';

/**
 * Генератор, на который никто не отвечает, не выдаёт ни одной опции — и раньше
 * поэтому проходил незамеченным. Проверяем, что валидатор смотрит на объявление,
 * а не только на результат.
 */

function run(ruleId: string, game: Parameters<(typeof RULES)[number]['run']>[0]) {
  return RULES.find((r) => r.id === ruleId)!.run(game);
}

test('глагол генератора ловится, даже если ни один предмет на него не отвечает', () => {
  const room = node('episodes/p/rooms/лаборатория#', {
    generators: [{ verb: 'понюхать', phrase: 'понюхать', source: 'items' }],
    options: [],
  });
  const game = content({
    episodes: [episode('p', { verbs: ['идти', 'осмотреть'] })],
    docs: {
      'episodes/p/rooms/лаборатория': doc('episodes/p/rooms/лаборатория', {
        type: 'room',
        nodes: [room],
        items: ['коробка'],
      }),
    },
  });

  const found = run('verbs', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /"понюхать" не объявлен/);
});

test('один и тот же глагол не даёт двух жалоб', () => {
  const room = node('episodes/p/rooms/r#', {
    generators: [{ verb: 'понюхать', phrase: 'понюхать', source: 'items' }],
    options: [
      {
        label: 'понюхать коробка',
        kind: 'environment',
        target: null,
        attrs: node('x#').attrs,
        verb: 'понюхать',
        object: 'коробка',
        moves: false,
      },
    ],
  });
  const game = content({
    episodes: [episode('p')],
    docs: { 'episodes/p/rooms/r': doc('episodes/p/rooms/r', { type: 'room', nodes: [room], items: ['коробка'] }) },
  });

  assert.equal(run('verbs', game).length, 1);
});

test('генератор с пустым источником ловится', () => {
  const room = node('episodes/p/rooms/r#', {
    generators: [{ verb: 'осмотреть', phrase: 'осмотреть', source: 'items' }],
  });
  const game = content({
    episodes: [episode('p', { verbs: ['осмотреть'] })],
    docs: { 'episodes/p/rooms/r': doc('episodes/p/rooms/r', { type: 'room', nodes: [room], exits: ['x'] }) },
  });

  const found = run('generators', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /пустой источник/);
});
