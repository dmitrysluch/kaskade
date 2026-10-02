import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendLog, enter, streamOf } from '../app/client/engine/state.ts';
import { migrate } from '../app/client/engine/save.ts';
import { mergeRoom } from '../app/server/content/rooms.ts';
import { RULES } from '../app/server/validate/index.ts';
import { logKey, REENTRY } from '../app/shared/logs.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Лог контекста и повторный вход (07-оболочка-тз, «Лог контекста и повторный
 * вход»).
 *
 * Проверяем таблицу ТЗ целиком — четыре случая входа, — и то, из чего она
 * получается: что буфер активного контекста есть всегда, что без `log: true`
 * он при уходе выбрасывается, а ключ остаётся и делает следующий вход
 * повторным.
 */

const ROOM = 'episodes/p/rooms-virt/tu.dorm-room:00';
const HALL = 'episodes/p/rooms-virt/tu.h1012:00';
const TALK = 'episodes/p/scenes/talk';
const BOOK = 'episodes/p/items/book';

function save(patch: Partial<SaveState> = {}): SaveState {
  return {
    saveVersion: 12,
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
    activeStage: '00',
    currentDate: '12.10.2024',
    lastTransitionId: null,
    activeRoom: null,
    openItem: null,
    roomStates: {},
    episodeState: { episode: 'p', at: `${ROOM}#`, used: [] },
    ...patch,
  };
}

/**
 * Общага с `log: true` и `## reentry`, аудитория без того и другого, разговор
 * с одним `reentry` и предмет, который места не меняет.
 */
function game(patch: { log?: boolean; reentry?: boolean } = {}): GameContent {
  const { log = true, reentry = true } = patch;
  return content({
    episodes: [episode('p', { entry: `${ROOM}#` })],
    docs: {
      [ROOM]: doc(ROOM, {
        type: 'room',
        label: 'комната',
        log,
        fm: { persistent: 'tu.dorm-room', stage: '00' },
        nodes: [
          node(`${ROOM}#`, {
            text: 'Комната на троих.',
            options: [
              option({ label: 'говорить с тоби', target: `${TALK}#`, moves: true }),
              option({ label: 'идти в аудиторию', target: `${HALL}#`, moves: true }),
              option({ label: 'осмотреть учебник', target: `${BOOK}#осмотреть`, verb: 'осмотреть', object: BOOK }),
            ],
          }),
          ...(reentry ? [node(`${ROOM}#${REENTRY}`, { text: 'Тоби оборачивается к тебе.' })] : []),
        ],
      }),
      [HALL]: doc(HALL, {
        type: 'room',
        label: 'аудитория',
        fm: { persistent: 'tu.h1012', stage: '00' },
        nodes: [
          node(`${HALL}#`, {
            text: 'Аудитория на сорок мест.',
            options: [option({ label: 'идти в комнату', target: `${ROOM}#`, moves: true })],
          }),
        ],
      }),
      [TALK]: doc(TALK, {
        type: 'scene',
        nodes: [
          node(`${TALK}#`, {
            text: 'Тоби лежит поперёк кровати.',
            options: [option({ label: 'завершить разговор', target: `${ROOM}#`, moves: true })],
          }),
          node(`${TALK}#${REENTRY}`, { text: 'Тоби снова поднимает голову.' }),
        ],
      }),
      [BOOK]: doc(BOOK, {
        type: 'item',
        label: 'учебник',
        nodes: [node(`${BOOK}#осмотреть`, { text: 'Учебник по контейнменту.' })],
      }),
    },
  });
}

const texts = (g: GameContent, s: SaveState) => streamOf(g, s).map((e) => e.text);

test('ключ контекста: комната по срезу и помещению, сцена по id', () => {
  const g = game();
  assert.equal(logKey(g, save()), 'p|00|tu.dorm-room');
  assert.equal(logKey(g, save({ episodeState: { episode: 'p', at: `${TALK}#`, used: [] } })), 'p|00|talk');
  // У предмета своего потока нет: он только снимает верхний слой.
  assert.equal(logKey(g, save({ episodeState: { episode: 'p', at: `${BOOK}#осмотреть`, used: [] } })), null);
});

test('буфер активного контекста есть всегда: перезагрузка возвращает тот же экран', () => {
  const g = game({ log: false, reentry: false });
  const first = enter(g, save(), `${ROOM}#`).save;

  assert.deepEqual(texts(g, first), ['Комната на троих.']);
  // Перезагрузка — это тот же сейв, прочитанный заново: поток в нём.
  const reloaded = JSON.parse(JSON.stringify(first)) as SaveState;
  assert.deepEqual(texts(g, reloaded), ['Комната на троих.']);
});

test('`log: true` восстанавливает прежний поток, а `reentry` дописывает реакцию', () => {
  const g = game();
  let s = enter(g, save(), `${ROOM}#`).save;
  s = appendLog(g, s, [{ kind: 'echo', text: 'осмотреть учебник' }]);
  s = enter(g, s, `${BOOK}#осмотреть`, false).save;

  // Предмет места не меняет: всё это легло в тот же лог комнаты.
  assert.deepEqual(texts(g, s), ['Комната на троих.', 'осмотреть учебник', 'Учебник по контейнменту.']);

  // Ушли в аудиторию — у неё свой поток, пустой.
  const away = enter(g, appendLog(g, s, [{ kind: 'echo', text: 'идти в аудиторию' }]), `${HALL}#`).save;
  assert.deepEqual(texts(g, away), ['Аудитория на сорок мест.']);
  // Лог комнаты сохранён вместе с эхом ухода.
  assert.deepEqual(away.logs['p|00|tu.dorm-room']!.at(-1)!.text, 'идти в аудиторию');

  // Вернулись: прежний поток на месте, реакция дописана, место снова себя описало.
  const back = enter(g, away, `${ROOM}#`).save;
  assert.deepEqual(texts(g, back), [
    'Комната на троих.',
    'осмотреть учебник',
    'Учебник по контейнменту.',
    'идти в аудиторию',
    'Тоби оборачивается к тебе.',
    'Комната на троих.',
  ]);
});

test('без `log: true` буфер при уходе выбрасывается, но ключ остаётся', () => {
  const g = game({ log: false });
  const away = enter(g, enter(g, save(), `${ROOM}#`).save, `${HALL}#`).save;

  assert.deepEqual(away.logs['p|00|tu.dorm-room'], [], 'буфер нелогируемой комнаты удалён');
  assert.ok('p|00|tu.dorm-room' in away.logs, 'ключ остался пометкой «здесь уже были»');

  // Поэтому второй вход — повторный: поток чистый, но реакция звучит.
  assert.deepEqual(texts(g, enter(g, away, `${ROOM}#`).save), ['Тоби оборачивается к тебе.', 'Комната на троих.']);
});

test('первый вход реакции не показывает, а второй — показывает', () => {
  const g = game({ log: false });
  const first = enter(g, save(), `${TALK}#`);
  assert.deepEqual(texts(g, first.save), ['Тоби лежит поперёк кровати.']);

  const back = enter(g, enter(g, first.save, `${ROOM}#`).save, `${TALK}#`);
  assert.deepEqual(texts(g, back.save), ['Тоби снова поднимает голову.', 'Тоби лежит поперёк кровати.']);
  // Реакция — часть того, что показал этот вход, и возвращается вызвавшему.
  assert.equal(back.entries[0]?.text, 'Тоби снова поднимает голову.');
});

test('ни `log`, ни `reentry` — чистый поток и никакой реакции', () => {
  const g = game({ log: false, reentry: false });
  const away = enter(g, enter(g, save(), `${ROOM}#`).save, `${HALL}#`).save;
  assert.deepEqual(texts(g, enter(g, away, `${ROOM}#`).save), ['Комната на троих.']);
});

test('повторный вход — это другое место, а не предмет и не оверлей', () => {
  const g = game();
  const inRoom = enter(g, save(), `${ROOM}#`).save;
  // Открыли предмет и «закрыли» его: позиция не менялась, реакции нет.
  const read = enter(g, inRoom, `${BOOK}#осмотреть`, false).save;
  assert.equal(texts(g, read).includes('Тоби оборачивается к тебе.'), false);
});

test('лог не исполняет эффектов: он история предъявления', () => {
  const g = game();
  const gift = content({
    ...g,
    docs: {
      ...g.docs,
      [TALK]: doc(TALK, {
        type: 'scene',
        log: true,
        nodes: [
          node(`${TALK}#`, {
            text: 'Тоби протягивает блистер.',
            attrs: attrs({ give: ['блистер'], once: true }),
            options: [option({ label: 'завершить разговор', target: `${ROOM}#`, moves: true })],
          }),
        ],
      }),
    },
    nodes: undefined as never,
  });

  const once = enter(gift, save(), `${TALK}#`).save;
  assert.deepEqual(once.inventory, ['блистер']);

  const back = enter(gift, enter(gift, once, `${ROOM}#`).save, `${TALK}#`).save;
  // Поток восстановлен, а вещь не выдана второй раз.
  assert.ok(texts(gift, back).includes('Тоби протягивает блистер.'));
  assert.deepEqual(back.inventory, ['блистер']);
});

test('лог комнаты принадлежит срезу: текст из 00 не всплывёт в 04', () => {
  const g = game();
  const inRoom = enter(g, save(), `${ROOM}#`).save;
  assert.equal(logKey(g, { ...inRoom, activeStage: '04' }), 'p|00|tu.dorm-room', 'ключ берётся из адреса комнаты');

  const later = 'episodes/p/rooms-virt/tu.dorm-room:04';
  const world = content({
    ...g,
    docs: {
      ...g.docs,
      [later]: doc(later, {
        type: 'room',
        log: true,
        fm: { persistent: 'tu.dorm-room', stage: '04' },
        nodes: [node(`${later}#`, { text: 'Тоби нет. На столе письмо.' })],
      }),
    },
    nodes: undefined as never,
  });

  const stage04 = enter(world, { ...inRoom, activeStage: '04' }, `${later}#`).save;
  assert.deepEqual(texts(world, stage04), ['Тоби нет. На столе письмо.']);
  assert.deepEqual(stage04.logs['p|00|tu.dorm-room']!.map((e) => e.text), ['Комната на троих.']);
});

test('log общей комнаты наследуется срезом, а версия его перекрывает', () => {
  const raw = { path: '/content/x.md', fm: {}, type: 'room' as const, nodes: [] };
  const part = (patch: Record<string, unknown>) => ({
    docId: 'rooms/x',
    raw,
    persistent: 'tu.dorm-room',
    stage: null,
    label: null,
    target: null,
    targets: {},
    entry: null,
    available: null,
    log: null,
    exits: undefined,
    items: undefined,
    ...patch,
  });

  const common = part({ log: true });
  assert.equal(mergeRoom('episodes/p', 'tu.dorm-room', '00', common, null).log, true);
  assert.equal(mergeRoom('episodes/p', 'tu.dorm-room', '00', common, part({ log: false, stage: '00' })).log, false);
  assert.equal(mergeRoom('episodes/p', 'tu.dorm-room', '00', common, part({ stage: '00' })).log, true);
  assert.equal(mergeRoom('episodes/p', 'tu.dorm-room', '00', null, part({ stage: '00' })).log, false);
});

test('сейв 11 → 12: лога ещё нет, и выдумывать историю нельзя', () => {
  // Старая запись пришла без поля вовсе — ровно так её и прочитает `JSON.parse`.
  const { logs: _, ...old } = { ...save(), saveVersion: 11 };

  const lifted = migrate(old as SaveState, 12);
  assert.deepEqual(lifted?.logs, {});
  assert.equal(lifted?.saveVersion, 12);
});

const run = (id: string, g: GameContent) => RULES.find((r) => r.id === id)!.run(g);

test('валидатор: reentry — не нода графа', () => {
  const g = game();
  assert.deepEqual(run('log', g).filter((f) => f.severity === 'error'), []);
  // Правила входов и тупиков о нём не судят.
  assert.deepEqual(run('graph', g).filter((f) => f.message.includes(REENTRY)), []);

  const effects = content({
    ...g,
    docs: {
      ...g.docs,
      [TALK]: doc(TALK, {
        type: 'scene',
        nodes: [
          node(`${TALK}#`, { text: 'Разговор.', options: [option({ label: 'уйти', target: `${ROOM}#` })] }),
          node(`${TALK}#${REENTRY}`, {
            text: 'Тоби поднимает голову.',
            attrs: attrs({ set: ['prolog.greeted'] }),
            options: [option({ label: 'спросить', target: `${TALK}#` })],
          }),
        ],
      }),
    },
    nodes: undefined as never,
  });
  const found = run('log', effects).map((f) => f.message);
  assert.ok(found.some((m) => /игровой нодой не является/.test(m)), found.join(' | '));
});

test('валидатор: на reentry нельзя ссылаться, а `log` бывает только у места', () => {
  const g = game();
  const linked = content({
    ...g,
    docs: {
      ...g.docs,
      [HALL]: doc(HALL, {
        type: 'room',
        fm: { persistent: 'tu.h1012', stage: '00' },
        nodes: [node(`${HALL}#`, { options: [option({ label: 'к тоби', target: `${ROOM}#${REENTRY}` })] })],
      }),
      [BOOK]: doc(BOOK, { type: 'item', fm: { log: true }, nodes: [node(`${BOOK}#осмотреть`)] }),
    },
    nodes: undefined as never,
  });

  const found = run('log', linked).map((f) => f.message);
  assert.ok(found.some((m) => /ссылка на "reentry"/.test(m)), found.join(' | '));
  assert.ok(found.some((m) => /своего потока у неё нет/.test(m)), found.join(' | '));
});

test('валидатор: место с двумя входами без лога — предупреждение о пустом потоке', () => {
  const g = game({ log: false, reentry: false });
  const warned = run('log', g).filter((f) => f.severity === 'warn');

  // В комнату ведут разговор и аудитория — два входа снаружи.
  assert.equal(warned.length, 1);
  assert.match(warned[0]!.message, /сюда ведёт 2 входа/);

  // С `log: true` претензии нет.
  assert.deepEqual(run('log', game({ reentry: false })).filter((f) => f.severity === 'warn'), []);
});
