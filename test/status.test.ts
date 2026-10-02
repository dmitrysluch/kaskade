import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmTransition, enter, placeLabel } from '../app/client/engine/state.ts';
import { statusLine, statusText } from '../app/client/ui/lines.ts';
import { content, doc, episode, node, option } from './helpers.ts';
import type { GameContent, SaveState, TransitionDef } from '../app/shared/types.ts';

/**
 * Полоса статуса (07-оболочка-тз, «Экран»): слева — где Марго находится,
 * справа — дата и сроки. Место отвечает на «где я», а не «что открыто»,
 * поэтому разговор и книга его не меняют, а карточка перехода — обнуляет.
 */

const ROOM = 'episodes/p/rooms/dorm';
const TALK = 'episodes/p/scenes/talk';
const CARD = 'episodes/p/transitions/01-monday';

const text = (segs: { text: string }[]) => segs.map((s) => s.text).join('');

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
    minigames: {},
    logs: {},
    taught: true,
    hinted: true,
    started: true,
    wait: null,
    activeStage: null,
    currentDate: null,
    lastTransitionId: null,
    activeRoom: null,
    openItem: null,
    roomStates: {},
    episodeState: { episode: 'p', at: `${ROOM}#`, used: [] },
    ...patch,
  };
}

const MONDAY: TransitionDef = {
  id: '01-monday',
  docId: CARD,
  episode: 'p',
  stage: '01',
  date: '14.10.2024',
  location: 'TU BERLIN',
  timeLabel: null,
  target: `${TALK}#`,
};

/** Общага, разговор в ней и карточка перехода, ведущая в разговор. */
function game(): GameContent {
  return content({
    episodes: [episode('p', { entry: `${ROOM}#` })],
    transitions: { [MONDAY.id]: MONDAY },
    stages: { p: [{ stage: '01', date: MONDAY.date, transitions: [MONDAY.id] }] },
    docs: {
      [ROOM]: doc(ROOM, { type: 'room', label: 'комната Марго и Тоби', nodes: [node(`${ROOM}#`, { text: 'Общага.' })] }),
      [TALK]: doc(TALK, { type: 'scene', label: 'разговор', nodes: [node(`${TALK}#`, { text: 'Тоби поднимает голову.' })] }),
      [CARD]: doc(CARD, {
        type: 'transition',
        nodes: [node(`${CARD}#`, { options: [option({ label: '', target: `${TALK}#` })] })],
      }),
    },
  });
}

test('место в статусе ставит вход в комнату, а разговор его не меняет', () => {
  const g = game();
  const inRoom = enter(g, save(), `${ROOM}#`).save;
  assert.equal(placeLabel(g, inRoom), 'комната Марго и Тоби');

  // Сцена — не место: у неё нет `persistent`, и «где я» обязано пережить разговор.
  const talking = enter(g, inRoom, `${TALK}#`).save;
  assert.equal(talking.activeRoom, inRoom.activeRoom);
  assert.equal(placeLabel(g, talking), 'комната Марго и Тоби');
});

test('до первой комнаты место пусто, а подтверждённый переход его сбрасывает', () => {
  const g = game();
  assert.equal(placeLabel(g, save()), '');

  const inRoom = enter(g, save(), `${ROOM}#`).save;
  const done = confirmTransition(g, { ...inRoom, episodeState: { ...inRoom.episodeState, at: `${CARD}#` } }, CARD).save;

  // Переход привёл в сцену: нового места нет, и статус честно молчит, вместо
  // того чтобы показывать общагу, из которой игрок уже уехал.
  assert.equal(done.activeRoom, null);
  assert.equal(placeLabel(g, done), '');
});

test('место слева, дата справа, и строка остаётся сеткой', () => {
  const date = statusText('12.05.2026', []);
  const segs = statusLine('комната Марго и Тоби', date, 72);

  assert.match(text(segs), /^ {4}комната Марго и Тоби {2,}12\.05\.2026$/);
  assert.equal(text(segs).length, 72 - 4, 'правое поле остаётся пустым');
});

test('подрезается место, а не дата: обрезанное число врёт', () => {
  const date = '12.05.2026 · BLUE CARD 233 дня';
  const narrow = text(statusLine('комната Марго и Тоби', date, 48));

  assert.ok(narrow.endsWith(date), narrow);
  assert.match(narrow, /комната…/);

  // Места не осталось вовсе — подпись исчезает целиком: «ко…» не говорит ничего.
  assert.equal(text(statusLine('комната Марго и Тоби', date, 40)), ' '.repeat(40 - date.length - 4) + date);
});

test('пустой статус остаётся пустым: полоса без подложки', () => {
  assert.deepEqual(statusLine('', '', 72), []);
  // Место есть, даты ещё нет — полоса всё равно нужна.
  assert.equal(text(statusLine('общага', '', 72)).trimEnd(), '    общага');
});
