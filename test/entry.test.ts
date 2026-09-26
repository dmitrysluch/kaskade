import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enter, resolveTarget, roomEntry } from '../app/client/engine/state.ts';
import { roomStateKey, virtAddr, virtDocId } from '../app/shared/rooms.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Вход в помещение и его состояние ([[13-навигация-и-комнаты-тз]], «Вход,
 * состояние и опции»).
 *
 * Ошибка здесь не падает: она возвращает ушедшего человека или не даёт сработать
 * реакции на принесённую книгу — то есть находится на третьем прохождении, если
 * находится вообще. Поэтому правило проверяется на обеих формах комнаты пролога
 * поимённо.
 */

const DORM = virtDocId('p', 'tu.dorm-room', '00');
const HALL = virtDocId('p', 'tu.h1012', '01');

function save(patch: Partial<SaveState> = {}): SaveState {
  return {
    saveVersion: 9,
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
    activeStage: '00',
    currentDate: '12.10.2024',
    lastTransitionId: '00-start',
    roomStates: {},
    episodeState: { episode: 'p', at: `${DORM}#`, used: [] },
    ...patch,
  };
}

/**
 * Общага: вступление с текстом и людьми, второе состояние — без них.
 * Аудитория: вступление-диспетчер, который каждый раз решает заново.
 */
function game(): GameContent {
  return content({
    episodes: [episode('p', { entry: `${DORM}#` })],
    docs: {
      [DORM]: doc(DORM, {
        type: 'room',
        label: 'комната',
        nodes: [
          node(`${DORM}#`, { text: 'Общага. Тоби лежит поперёк кровати.' }),
          node(`${DORM}#один`, { text: 'Общага. Ты одна.' }),
          node(`${DORM}#коробка`, { text: 'Ты берёшь коробку.', attrs: attrs({ once: true, give: ['коробка'] }) }),
        ],
      }),
      [HALL]: doc(HALL, {
        type: 'room',
        label: 'аудитория',
        entry: 'до',
        nodes: [
          // Диспетчер: текста нет, метки нет, только условные маршруты.
          node(`${HALL}#`, {
            options: [
              option({ label: '', target: `${HALL}#учебник`, attrs: attrs({ if: 'has:книга' }) }),
              option({ label: '', target: `${HALL}#пусто` }),
            ],
          }),
          node(`${HALL}#до`, { text: 'Алерс у доски.' }),
          node(`${HALL}#учебник`, { text: 'Он замечает книгу.' }),
          node(`${HALL}#пусто`, { text: 'Аудитория пустая.' }),
        ],
      }),
    },
  });
}

test('первый вход: вступление с текстом играется как есть', () => {
  const g = game();
  assert.equal(roomEntry(g, save(), DORM), `${DORM}#`);
});

test('сохранённая нода выигрывает у вступления: ушедший не возвращается', () => {
  const g = game();
  // Игрок дошёл до состояния «одна» — проход на нём остановился, и это запомнилось.
  const stayed = enter(g, save(), `${DORM}#один`).save;
  assert.equal(stayed.roomStates[roomStateKey('p', '00', 'tu.dorm-room')], 'один');

  // Возврат в помещение без якоря приводит туда же, а не в вступление с Тоби.
  assert.equal(roomEntry(g, stayed, DORM), `${DORM}#один`);
});

test('вступление-диспетчер выигрывает у сохранённой ноды: он решает заново', () => {
  const g = game();
  // Первый заход без книги: диспетчер отправил в пустую аудиторию, и это
  // состояние запомнилось.
  const first = enter(g, save({ episodeState: { episode: 'p', at: `${HALL}#`, used: [] } }), `${HALL}#`);
  assert.equal(first.save.episodeState.at, `${HALL}#пусто`);
  assert.equal(first.save.roomStates[roomStateKey('p', '01', 'tu.h1012')], 'пусто');

  // Книга появилась вне комнаты. Возврат обязан снова пройти через диспетчер,
  // иначе реакция на неё не сработает никогда.
  const withBook = { ...first.save, inventory: ['книга'] };
  assert.equal(roomEntry(g, withBook, HALL), `${HALL}#`);
  assert.equal(enter(g, withBook, `${HALL}#`).save.episodeState.at, `${HALL}#учебник`);
});

test('`entry:` работает, когда вступления нет и сохранённого состояния тоже', () => {
  const g = game();
  const noIntro = {
    ...g,
    docs: { ...g.docs, [HALL]: { ...g.docs[HALL]!, nodes: g.docs[HALL]!.nodes.filter((n) => n.id !== '') } },
  };
  assert.equal(roomEntry(noIntro, save({ activeStage: '01' }), HALL), `${HALL}#до`);
});

test('проходной узел состоянием не становится: коробка не появляется вновь', () => {
  const g = game();
  // `#коробка` помечена `once` — вручение не место, куда возвращаются.
  const given = enter(g, save(), `${DORM}#коробка`).save;
  assert.equal(given.roomStates[roomStateKey('p', '00', 'tu.dorm-room')], undefined);
  assert.deepEqual(given.inventory, ['коробка']);
  assert.equal(roomEntry(g, given, DORM), `${DORM}#`);
});

test('явный якорь не подменяется входом', () => {
  const g = game();
  const stayed = enter(g, save(), `${DORM}#один`).save;
  // Сохранено «один», но ссылка назвала вступление — значит вступление.
  assert.equal(resolveTarget(g, stayed, `${DORM}#`), `${DORM}#один`, 'без якоря — вход помещения');
  assert.equal(enter(g, stayed, `${DORM}#коробка`).save.episodeState.at, `${DORM}#коробка`);
});

test('состояние принадлежит срезу: новый срез начинается со своего', () => {
  const g = game();
  const stayed = enter(g, save(), `${DORM}#один`).save;

  // Тот же persistent в другом срезе — другое состояние и другой ключ.
  assert.equal(stayed.roomStates[roomStateKey('p', '04', 'tu.dorm-room')], undefined);
  assert.equal(
    roomEntry(g, { ...stayed, activeStage: '04' }, virtDocId('p', 'tu.dorm-room', '04')),
    null,
    'в четвёртом срезе комната не собрана — входа нет',
  );
});

test('звёздочка в цели разворачивается активным срезом', () => {
  const g = game();
  const starred = virtAddr('p', 'tu.dorm-room', '*', 'один');
  assert.equal(resolveTarget(g, save(), starred), `${DORM}#один`);

  // Без контекста разворачивать нечем: цели нет, и команда не показывается.
  assert.equal(resolveTarget(g, save({ activeStage: null }), starred), null);
});
