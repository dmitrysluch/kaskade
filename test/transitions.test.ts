import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmTransition, dateAt, enter, stageOf } from '../app/client/engine/state.ts';
import { transitionCard } from '../app/client/ui/lines.ts';
import { migrate } from '../app/client/engine/save.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { GameContent, SaveState, TransitionDef } from '../app/shared/types.ts';

/**
 * Карточки перехода ([[14-переходы-и-даты-тз]]).
 *
 * Проверяем не вёрстку, а контракт: карточка — это позиция игрока, дата приходит
 * из подтверждённого перехода, и до подтверждения цель не отыграна. Ошибка здесь
 * выглядит как чужой день в статусе или как выданный дважды предмет.
 */

const ROOM = 'episodes/p/rooms/r';
const CARD = 'episodes/p/transitions/01-monday';

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
    minigames: {},
    logs: {},
    taught: true,
    hinted: true,
    started: true,
    wait: null,
    pressure: null,
    resume: [],
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
  location: 'TU BERLIN · АУДИТОРИЯ H 1012',
  timeLabel: 'два дня спустя',
  target: `${ROOM}#утро`,
};

/** Мир: комната с двумя узлами и карточка, ведущая во второй. */
function game(def: TransitionDef = MONDAY, extra: Partial<GameContent> = {}): GameContent {
  return content({
    episodes: [episode('p', { entry: `${ROOM}#` })],
    transitions: { [def.id]: def },
    stages: { p: [{ stage: def.stage, date: def.date, transitions: [def.id] }] },
    docs: {
      [ROOM]: doc(ROOM, {
        type: 'room',
        label: 'аудитория',
        nodes: [
          node(`${ROOM}#`, { text: 'Общага.', options: [option({ label: 'лечь спать', target: `${CARD}#` })] }),
          node(`${ROOM}#утро`, { text: 'Аудитория.', attrs: attrs({ give: ['лист'] }) }),
        ],
      }),
      [CARD]: doc(CARD, {
        type: 'transition',
        nodes: [node(`${CARD}#`, { options: [option({ label: '', target: def.target })] })],
      }),
    },
    ...extra,
  });
}

test('карточка показывает подпись, дату и место — и только их', () => {
  assert.equal(transitionCard(MONDAY), 'два дня спустя\n14.10.2024\nTU BERLIN · АУДИТОРИЯ H 1012');

  // Подпись необязательна: по умолчанию карточка показывает день и место.
  assert.equal(transitionCard({ ...MONDAY, timeLabel: null }), '14.10.2024\nTU BERLIN · АУДИТОРИЯ H 1012');
});

test('игрок останавливается на карточке, и цель не отыграна', () => {
  const g = game();
  const r = enter(g, save(), `${CARD}#`);

  // Позиция — сама карточка: отдельного поля «незавершённый переход» не нужно.
  assert.equal(r.save.episodeState.at, `${CARD}#`);
  // В поток ничего не попало, предмет цели не выдан, контекст не тронут.
  assert.deepEqual(r.entries, []);
  assert.deepEqual(r.save.inventory, []);
  assert.equal(r.save.activeStage, null);
  assert.equal(r.save.currentDate, null);
  assert.equal(r.save.lastTransitionId, null);
});

test('подтверждение ставит контекст и играет цель одной операцией', () => {
  const g = game();
  const onCard = enter(g, save(), `${CARD}#`).save;
  const done = confirmTransition(g, onCard, CARD);

  assert.equal(done.save.activeStage, '01');
  assert.equal(done.save.currentDate, '14.10.2024');
  assert.equal(done.save.lastTransitionId, '01-monday');
  // Эпизодом владеет переход: он же становится активным ([[14-переходы-и-даты-тз]]).
  assert.equal(done.save.episodeState.episode, 'p');
  assert.equal(done.save.episodeState.at, `${ROOM}#утро`);
  // Цель отыграна ровно один раз: её текст в потоке, её `give` в инвентаре.
  assert.ok(done.entries.some((e) => e.text.includes('Аудитория')));
  assert.deepEqual(done.save.inventory, ['лист']);
});

test('дата статуса и штамп флага приходят из перехода, а не из заметки', () => {
  // Цель сама ставит флаг: так видно, чем он штампуется.
  const g = game(MONDAY);
  const withSet = {
    ...g,
    nodes: {
      ...g.nodes,
      [`${ROOM}#утро`]: { ...g.nodes[`${ROOM}#утро`]!, attrs: attrs({ set: ['день'] }) },
    },
  };

  const done = confirmTransition(withSet, enter(withSet, save(), `${CARD}#`).save, CARD);

  assert.equal(dateAt(withSet, done.save), '14.10.2024');
  assert.equal(stageOf(done.save), '01');
  assert.equal(done.save.flags['день']?.at, '14.10.2024');
});

test('ошибка цели не меняет сейв: лучше остаться на карточке, чем нигде', () => {
  const broken = game({ ...MONDAY, target: `${ROOM}#которого-нет` });
  const onCard = enter(broken, save(), `${CARD}#`).save;
  const done = confirmTransition(broken, onCard, CARD);

  assert.deepEqual(done.save, onCard);
  assert.deepEqual(done.entries, []);
});

test('перезагрузка на карточке показывает карточку, а не цель', () => {
  // Сейв хранит адрес карточки, и этого достаточно: продолжение видит тип
  // заметки и рисует кадр, а эффекты цели по-прежнему не выполнены.
  const g = game();
  const onCard = enter(g, save(), `${CARD}#`).save;

  assert.equal(g.docs[onCard.episodeState.at.slice(0, onCard.episodeState.at.indexOf('#'))]!.type, 'transition');
  assert.deepEqual(onCard.inventory, []);
  assert.equal(onCard.currentDate, null);
});

test('карточка появляется и при прежних срезе и дате', () => {
  // Переезд в квартиру тем же вечером — тоже переход: автор вправе обозначить
  // его карточкой, и она не «оптимизируется» из-за совпадения даты.
  const EVENING = 'episodes/p/transitions/03-evening';
  const evening: TransitionDef = { ...MONDAY, id: '03-evening', docId: EVENING };

  const world = content({
    episodes: [episode('p', { entry: `${ROOM}#` })],
    transitions: { [MONDAY.id]: MONDAY, [evening.id]: evening },
    stages: { p: [{ stage: '01', date: MONDAY.date, transitions: [MONDAY.id, evening.id] }] },
    docs: {
      [ROOM]: doc(ROOM, {
        type: 'room',
        nodes: [node(`${ROOM}#`, { text: 'Общага.' }), node(`${ROOM}#утро`, { text: 'Аудитория.' })],
      }),
      [CARD]: doc(CARD, {
        type: 'transition',
        nodes: [node(`${CARD}#`, { options: [option({ label: '', target: `${ROOM}#утро` })] })],
      }),
      [EVENING]: doc(EVENING, {
        type: 'transition',
        nodes: [node(`${EVENING}#`, { options: [option({ label: '', target: `${ROOM}#утро` })] })],
      }),
    },
  });

  const after = confirmTransition(world, enter(world, save(), `${CARD}#`).save, CARD).save;
  assert.equal(after.currentDate, MONDAY.date);

  const again = enter(world, after, `${EVENING}#`);
  // Игрок снова стоит на карточке, хотя срез и дата те же.
  assert.equal(again.save.episodeState.at, `${EVENING}#`);
  assert.deepEqual(again.entries, []);
});

test('сейв прежней версии не поднимается наугад', () => {
  // Девятая версия берёт день из перехода; у восьмой этого поля нет, и вывести
  // его не из чего — значит несовместимость, а не молчаливый сброс.
  assert.equal(migrate({ ...save(), saveVersion: 8 }, 9), null);
  assert.equal(migrate({ ...save(), saveVersion: 9 }, 9)?.saveVersion, 9);
});
