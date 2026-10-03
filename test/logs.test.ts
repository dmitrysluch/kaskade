import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendLog, enter, streamOf } from '../app/client/engine/state.ts';
import { streamLines } from '../app/client/ui/lines.ts';
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
const roomKey = 'p|00|tu.dorm-room';

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
    pressure: null,
    resume: null,
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

  // Вернулись: прежний поток на месте, реакция дописана, место снова себя
  // описало. Между старым и новым стоит граница посещения — запись без текста.
  const back = enter(g, away, `${ROOM}#`).save;
  assert.deepEqual(texts(g, back), [
    'Комната на троих.',
    'осмотреть учебник',
    'Учебник по контейнменту.',
    'идти в аудиторию',
    '',
    'Тоби оборачивается к тебе.',
    'Комната на троих.',
  ]);
  assert.equal(streamOf(g, back)[4]!.kind, 'visit');
});

test('возврат отделяет старый лог от нового текста тонкой чертой', () => {
  const g = game();
  let s = enter(g, save(), `${ROOM}#`).save;
  s = appendLog(g, s, [{ kind: 'echo', text: 'идти в аудиторию' }]);
  const away = enter(g, s, `${HALL}#`).save;

  const back = enter(g, away, `${ROOM}#`).save;
  const kinds = streamOf(g, back).map((e) => e.kind);
  // Граница стоит ровно между командой ухода и тем, что показал новый вход.
  assert.deepEqual(kinds, ['text', 'echo', 'visit', 'text', 'text']);
  assert.equal(streamOf(g, back).find((e) => e.kind === 'visit')!.text, '');

  // Обычный раунд «эхо → ответ» второй чертой не делится.
  const inside = enter(g, appendLog(g, back, [{ kind: 'echo', text: 'осмотреть учебник' }]), `${BOOK}#осмотреть`, false).save;
  assert.equal(streamOf(g, inside).filter((e) => e.kind === 'visit').length, 1);

  // На экране это та же тонкая черта, что граница раундов.
  const lines = streamLines(streamOf(g, back), 40).map((l) => l.map((seg) => seg.text).join('').trim());
  assert.equal(lines.filter((l) => l.startsWith('┈')).length, 2, 'черта ухода и черта возвращения');
});

test('границы нет там, где делить нечего', () => {
  const g = game();
  // Первый вход: старого лога нет.
  const first = enter(g, save(), `${ROOM}#`).save;
  assert.equal(streamOf(g, first).some((e) => e.kind === 'visit'), false);

  // Возврат в нелогируемое место: лог пуст, и черта повисла бы над пустотой.
  const plain = game({ log: false });
  const away = enter(plain, enter(plain, save(), `${ROOM}#`).save, `${HALL}#`).save;
  assert.equal(streamOf(plain, enter(plain, away, `${ROOM}#`).save).some((e) => e.kind === 'visit'), false);

  // Перезагрузка новым входом не является: прохода нет, структура та же.
  const back = enter(g, enter(g, first, `${HALL}#`).save, `${ROOM}#`).save;
  const reloaded = JSON.parse(JSON.stringify(back)) as SaveState;
  assert.deepEqual(streamOf(g, reloaded).map((e) => e.kind), streamOf(g, back).map((e) => e.kind));

  // Соседних границ не бывает: вход без нового текста черты не ставит.
  const silent = content({
    ...g,
    docs: {
      ...g.docs,
      [HALL]: doc(HALL, {
        type: 'room',
        log: true,
        fm: { persistent: 'tu.h1012', stage: '00' },
        nodes: [node(`${HALL}#`, { options: [option({ label: 'идти в комнату', target: `${ROOM}#`, moves: true })] })],
      }),
    },
    nodes: undefined as never,
  });
  const quiet = enter(silent, enter(silent, enter(silent, save(), `${HALL}#`).save, `${ROOM}#`).save, `${HALL}#`).save;
  assert.equal(streamOf(silent, quiet).some((e) => e.kind === 'visit'), false, 'показывать нечего — делить нечего');
});

test('закрытый разговор возобновляет комнату, а не входит в неё заново', () => {
  const g = game();
  const inRoom = enter(g, save(), `${ROOM}#`).save;
  const talking = enter(g, appendLog(g, inRoom, [{ kind: 'echo', text: 'говорить с тоби' }]), `${TALK}#`).save;

  // Комната приостановлена: адрес возврата записан, поток ждёт.
  assert.equal(talking.resume, `${ROOM}#`);
  assert.deepEqual(texts(g, talking), ['Тоби лежит поперёк кровати.']);

  const back = enter(g, appendLog(g, talking, [{ kind: 'echo', text: 'завершить разговор' }]), `${ROOM}#`).save;
  // Поток остался, комната себя не повторила, реакции и черты нет.
  assert.deepEqual(texts(g, back), ['Комната на троих.', 'говорить с тоби']);
  assert.equal(back.resume, null);
});

test('возврат в другую ноду комнаты печатает её один раз, но входом не считается', () => {
  const g = game();
  const other = content({
    episodes: g.episodes,
    docs: {
      ...g.docs,
      [ROOM]: doc(ROOM, {
        type: 'room',
        label: 'комната',
        log: true,
        fm: { persistent: 'tu.dorm-room', stage: '00' },
        nodes: [
          node(`${ROOM}#`, {
            text: 'Комната на троих.',
            options: [option({ label: 'говорить с тоби', target: `${TALK}#`, moves: true })],
          }),
          node(`${ROOM}#один`, { text: 'Тоби ушёл, дверь оставил открытой.' }),
          node(`${ROOM}#${REENTRY}`, { text: 'Тоби оборачивается к тебе.' }),
        ],
      }),
      [TALK]: doc(TALK, {
        type: 'scene',
        nodes: [
          node(`${TALK}#`, {
            text: 'Тоби лежит поперёк кровати.',
            options: [option({ label: 'иди уже', target: `${ROOM}#один`, moves: true })],
          }),
        ],
      }),
    },
  });

  const talking = enter(other, enter(other, save(), `${ROOM}#`).save, `${TALK}#`).save;
  const back = enter(other, talking, `${ROOM}#один`).save;

  // Нода другая — её текст прозвучал; реакции возвращения всё равно нет.
  // Реплика разговора осталась в логе разговора: у него свой контекст.
  assert.deepEqual(texts(other, back), ['Комната на троих.', 'Тоби ушёл, дверь оставил открытой.']);
  assert.equal(streamOf(other, back).some((e) => e.kind === 'visit'), false);
  assert.equal(back.roomStates[roomKey], 'один', 'новое устойчивое состояние запомнено');
});

test('возобновление не зависит от `log`: игрок никуда и не уходил', () => {
  const g = game({ log: false });
  const talking = enter(g, enter(g, save(), `${ROOM}#`).save, `${TALK}#`).save;

  assert.deepEqual(g.docs[ROOM]!.log, false);
  assert.deepEqual(texts(g, enter(g, talking, `${ROOM}#`).save), ['Комната на троих.']);
});

test('уход в другое помещение — настоящий вход, и приостановленное гаснет', () => {
  const g = game({ log: false, reentry: false });
  const talking = enter(g, enter(g, save(), `${ROOM}#`).save, `${TALK}#`).save;
  assert.deepEqual(talking.logs['p|00|tu.dorm-room'], ['Комната на троих.'].map(() => talking.logs['p|00|tu.dorm-room']![0]!));

  // Из разговора ушли не назад, а в аудиторию: это обычный вход.
  const away = enter(g, talking, `${HALL}#`).save;
  assert.equal(away.resume, null);
  assert.deepEqual(away.logs['p|00|tu.dorm-room'], [], 'нелогируемая комната всё-таки покинута');
  assert.deepEqual(texts(g, away), ['Аудитория на сорок мест.']);
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

  // В комнату ведут разговор и аудитория. Но разговор комната открывает сама,
  // и выход из него — `resume`: настоящий вход остаётся один, из аудитории.
  assert.deepEqual(warned, [], warned.map((f) => f.message).join(' | '));

  // Вторая комната, которая тоже ведёт в разговор, делает его повторный вход
  // настоящим: из разговора в комнату вернётся `resume`, а в сам разговор
  // войдут дважды.
  const second = 'episodes/p/rooms-virt/tu.canteen:00';
  const twice = content({
    episodes: g.episodes,
    docs: {
      ...g.docs,
      // У разговора ни `log`, ни реакции: именно о таком и предупреждают.
      [TALK]: doc(TALK, {
        type: 'scene',
        nodes: [
          node(`${TALK}#`, {
            text: 'Тоби лежит поперёк кровати.',
            options: [option({ label: 'завершить разговор', target: `${ROOM}#`, moves: true })],
          }),
        ],
      }),
      [second]: doc(second, {
        type: 'room',
        fm: { persistent: 'tu.canteen', stage: '00' },
        nodes: [node(`${second}#`, { options: [option({ label: 'говорить с тоби', target: `${TALK}#`, moves: true })] })],
      }),
    },
  });

  const found = run('log', twice).filter((f) => f.severity === 'warn');
  assert.ok(found.some((f) => f.file.includes('talk')), found.map((f) => f.message).join(' | '));
});
