import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enter, optionAvailable } from '../app/client/engine/state.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { SaveState } from '../app/shared/types.ts';

/**
 * Опция и маршрут (07-оболочка-тз): метка есть — опция, метки нет — маршрут.
 * Опции ждут ввода, маршруты не ждут никогда, и порядок между ними — не деталь
 * реализации: ошибка здесь молчаливая, игра просто уходит не туда.
 */

const S = 'episodes/p/scenes/s';

function save(patch: Partial<SaveState> = {}): SaveState {
  return {
    saveVersion: 1,
    words: {},
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
    episodeState: { episode: 'p', at: `${S}#`, used: [] },
    ...patch,
  };
}

function game(nodes: ReturnType<typeof node>[]) {
  return content({
    episodes: [episode('p', { entry: `${S}#` })],
    docs: { [S]: doc(S, { nodes }) },
  });
}

test('маршрут уводит сам, опция ждёт ввода', () => {
  const g = game([
    node(`${S}#`, { text: 'первый', options: [option({ label: '', target: `${S}#второй` })] }),
    node(`${S}#второй`, { text: 'второй', options: [option({ label: 'дальше', target: `${S}#третий` })] }),
    node(`${S}#третий`, { text: 'третий' }),
  ]);

  const r = enter(g, save(), `${S}#`);
  // Прокатились через маршрут и встали там, где ждут ввода.
  assert.deepEqual(r.entries.map((e) => e.text), ['первый', 'второй']);
  assert.equal(r.save.episodeState.at, `${S}#второй`);
});

test('маршруты проверяются сверху вниз: скрыта цель — проваливаемся на следующий', () => {
  const g = game([
    node(`${S}#`, {
      text: 'старт',
      options: [option({ label: '', target: `${S}#беломор` }), option({ label: '', target: `${S}#прощание` })],
    }),
    node(`${S}#беломор`, { text: 'беломор', attrs: attrs({ if: 'p.moscow' }) }),
    node(`${S}#прощание`, { text: 'прощание' }),
  ]);

  assert.equal(enter(g, save(), `${S}#`).save.episodeState.at, `${S}#прощание`);

  const been = save({ flags: { 'p.moscow': { value: true, at: null } } });
  assert.equal(enter(g, been, `${S}#`).save.episodeState.at, `${S}#беломор`);
});

test('условие живёт на самом переходе, когда оно про маршрут, а не про цель', () => {
  // Одна опция, у которой от флага меняется формулировка: цель у обеих общая.
  const g = game([
    node(`${S}#`, {
      text: 'протокол',
      options: [
        option({ label: 'я сказала иначе', target: `${S}#записал-я`, attrs: attrs({ if: 'p.confirmed' }) }),
        option({ label: 'я этого не говорила', target: `${S}#записал-я`, attrs: attrs({ if: '!p.confirmed' }) }),
      ],
    }),
    node(`${S}#записал-я`, { text: 'записал я' }),
  ]);

  const shown = (s: SaveState) =>
    g.nodes[`${S}#`]!.options.filter((o) => optionAvailable(g, s, o)).map((o) => o.label);

  assert.deepEqual(shown(save()), ['я этого не говорила']);
  assert.deepEqual(shown(save({ flags: { 'p.confirmed': { value: true, at: null } } })), ['я сказала иначе']);
});

test('выжила хоть одна опция — маршрут не срабатывает', () => {
  const g = game([
    node(`${S}#`, {
      text: 'узел',
      options: [
        option({ label: 'сказать', target: `${S}#ответ`, attrs: attrs({ if: 'p.знает' }) }),
        option({ label: '', target: `${S}#мимо` }),
      ],
    }),
    node(`${S}#ответ`, { text: 'ответ' }),
    node(`${S}#мимо`, { text: 'мимо' }),
  ]);

  // Флага нет — опция отпала, работает маршрут-запаска.
  assert.equal(enter(g, save(), `${S}#`).save.episodeState.at, `${S}#мимо`);

  // Флаг есть — опция выжила, и узел обязан дождаться ввода.
  const знает = save({ flags: { 'p.знает': { value: true, at: null } } });
  assert.equal(enter(g, знает, `${S}#`).save.episodeState.at, `${S}#`);
});

test('опции комнаты не мешают развилке-вступлению', () => {
  // `осмотреть доску` стоит в комнате всегда. Считай её оболочка выбором узла,
  // войти в комнату в верном состоянии было бы неоткуда.
  const R = 'episodes/p/rooms/r';
  const g = content({
    episodes: [episode('p', { entry: `${R}#` })],
    docs: {
      [R]: doc(R, {
        type: 'room',
        nodes: [
          node(`${R}#`, {
            options: [
              option({ label: 'осмотреть доску', target: `${R}#доска`, verb: 'осмотреть', object: 'board' }),
              option({ label: '', target: `${R}#после` }),
            ],
          }),
          node(`${R}#доска`, { text: 'доска' }),
          node(`${R}#после`, { text: 'всё вышли' }),
        ],
      }),
    },
  });

  assert.equal(enter(g, save({ episodeState: { episode: 'p', at: `${R}#`, used: [] } }), `${R}#`).save.episodeState.at, `${R}#после`);
});
