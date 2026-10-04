import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, ContentError } from '../app/server/content/markdown.ts';
import { docGenerators, expandNode, type ExpandContext, type TargetInfo } from '../app/server/content/options.ts';
import type { RoomExit } from '../app/shared/types.ts';

/**
 * Раскрытие генераторов — то место, где «удобно автору» превращается в «одинаково
 * для игрока». Стенд подменяет vault: важен не резолв ссылок, а какие опции выходят.
 */

const TARGETS: Record<string, TargetInfo> = {
  'rooms/коридор': {
    docId: 'rooms/коридор',
    type: 'room',
    label: 'коридор',
    // Форма после глагола пишется в заметке готовой, вместе с предлогом:
    // склонять русский язык оболочка не умеет и не пробует.
    target: 'в коридор',
    targets: {},
    nodeIds: new Set(['']),
    inHand: [],
    pages: [],
  },
  'items/телефон': {
    docId: 'items/телефон',
    type: 'item',
    label: 'телефон',
    target: 'телефон',
    targets: {},
    nodeIds: new Set(['', 'осмотреть', 'взять', 'позвонить']),
    inHand: ['позвонить'],
    pages: [],
  },
  'scenes/оклик': {
    docId: 'scenes/оклик',
    type: 'scene',
    label: 'оклик',
    target: 'оклик',
    targets: {},
    nodeIds: new Set(['', 'у-двери']),
    inHand: [],
    pages: [],
  },
  'rooms/библиотека': {
    docId: 'rooms/библиотека',
    type: 'room',
    label: 'библиотека',
    target: 'в библиотеку',
    targets: { ехать: 'на автобусе в библиотеку' },
    nodeIds: new Set(['', 'стойка']),
    inHand: [],
    pages: [],
  },
  'rooms/столовая': {
    docId: 'rooms/столовая',
    type: 'room',
    label: 'столовая',
    // Формы нет — у `TargetInfo` она совпадает с названием, как на сборке.
    target: 'столовая',
    targets: {},
    nodeIds: new Set(['']),
    inHand: [],
    pages: [],
  },
  'items/доска': {
    docId: 'items/доска',
    type: 'item',
    label: 'доска',
    target: 'доску',
    targets: { подойти: 'к доске' },
    nodeIds: new Set(['', 'осмотреть', 'подойти']),
    inHand: [],
    pages: [],
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

/** База ссылок стенда: одна заметка, срез не задан — как у сцены. */
const BASE = { path: 'room.md', baseDocId: 'rooms/пультовая', selfDocId: 'rooms/пультовая', stage: null, place: 'room' as const };

/**
 * Раскрыть вступление комнаты со стандартными генераторами. Выход пишется
 * строкой, когда подпись не при чём, и записью целиком, когда она есть
 * ([[13a-локальные-подписи-выходов-тз]]).
 */
function expand(doc: ReturnType<typeof room>, exits: (string | RoomExit)[], items: string[]) {
  const list = exits.map((e) => (typeof e === 'string' ? { ref: e, target: null } : e));
  return expandNode(ctx, BASE, doc.nodes[0]!, list, items, docGenerators(doc, list, items));
}

test('комната без блока options ведёт себя очевидным образом', () => {
  const doc = room('\nОписание.\n');
  const { options } = expand(doc, ['коридор'], ['доска']);

  assert.deepEqual(
    options.map((o) => o.label),
    ['идти в коридор', 'осмотреть доску'],
  );
});

test('комната — место: `идти` ведёт в неё целиком и сдвигает игрока', () => {
  const doc = room('\nОписание.\n');
  const { options } = expand(doc, ['коридор'], []);
  const идти = options[0]!;

  assert.equal(идти.target, 'rooms/коридор#');
  assert.equal(идти.moves, true);
});

test('предмет отвечает только на то, что умеет, и не двигает игрока', () => {
  const doc = room('\n```options\nосмотреть: items\nвзять: items\n```\n');
  const { options } = expand(doc, [], ['доска', 'телефон']);

  // У доски есть только `осмотреть` — `взять доску` не появляется.
  assert.deepEqual(
    options.map((o) => o.label),
    ['осмотреть доску', 'осмотреть телефон', 'взять телефон'],
  );
  assert.equal(options.every((o) => !o.moves), true);
});

test('после глагола стоит готовая форма, а не название вещи', () => {
  const doc = room('\n```options\nосмотреть: items\nподойти: items\n```\n');
  const { options } = expand(doc, [], ['доска']);

  // Общая форма — из `target`, а глагол, которому нужна своя, берёт её из
  // `targets`: склонять русский язык оболочка не умеет и не пробует.
  assert.deepEqual(
    options.map((o) => o.label),
    ['осмотреть доску', 'подойти к доске'],
  );

  // Название при этом остаётся названием: в «предметах» и в карточке — `доска`.
  assert.deepEqual(
    options.map((o) => o.object),
    ['items/доска', 'items/доска'],
  );
});

test('форма не написана — берётся название: падеж и так совпал', () => {
  const doc = room('\n```options\nосмотреть: items\n```\n');
  const { options } = expand(doc, [], ['телефон']);
  assert.deepEqual(options.map((o) => o.label), ['осмотреть телефон']);
});

test('комната отдаёт предмету только то, на что он отвечает', () => {
  const doc = room('\n```options\nосмотреть: items\nпозвонить: items\n```\n');
  const { options } = expand(doc, [], ['телефон']);

  assert.deepEqual(
    options.map((o) => o.label),
    ['осмотреть телефон'],
  );
});

test('глаголы вещей на руках сами в список места не лезут', () => {
  // ([[99-открытые-вопросы]], «Глаголы и состояния предметов»): с ростом
  // инвентаря они вытеснили бы действия текущей сцены.
  const doc = room('\nОписание.\n');
  const { pending } = expand(doc, ['коридор'], []);
  assert.deepEqual(pending, []);
});

test('явный генератор по инвентарю остаётся: его пишет автор', () => {
  const doc = room('\n```options\nпоказать: inventory\n```\n');
  const { pending } = expand(doc, [], []);
  assert.deepEqual(pending, [{ verb: 'показать', from: 'inventory' }]);
});

test('неизвестный источник — ошибка с именем файла', () => {
  const doc = room('\n```options\nосмотреть: карманы\n```\n');
  assert.throws(
    () => expand(doc, [], []),
    (e: unknown) => e instanceof ContentError && /неизвестный источник/.test((e as Error).message),
  );
});

test('источник пуст — генератор молча не отдаёт ничего', () => {
  const doc = room('\n```options\nосмотреть: items\n```\n');
  const { options } = expand(doc, [], []);
  assert.deepEqual(options, []);
});

test('авторская опция перекрывает сгенерированную с тем же текстом', () => {
  const doc = room('\nОписание.\n\n→ идти в коридор [[оклик#у-двери]]\n');
  const { options } = expand(doc, ['коридор'], []);

  // Команда одна, и ведёт она в разговор, а не в комнату из `exits`.
  assert.deepEqual(
    options.map((o) => o.label),
    ['идти в коридор'],
  );
  assert.equal(options[0]!.target, 'scenes/оклик#у-двери');
});

test('перекрытие считается по тексту: другая команда генератору не мешает', () => {
  const doc = room('\nОписание.\n\n→ догнать его [[оклик#у-двери]]\n');
  const { options } = expand(doc, ['коридор'], []);

  assert.deepEqual(
    options.map((o) => o.label),
    ['догнать его', 'идти в коридор'],
  );
});

/**
 * Локальные подписи выходов ([[13a-локальные-подписи-выходов-тз]]).
 *
 * Одна и та же комната называется по-разному из разных точек входа: со двора
 * идут «в общагу», из лифта — «на этаж 2». Подпись принадлежит записи `exits`
 * и меняет только текст команды: адрес, категория и поведение те же.
 */

test('локальная подпись важнее формы глагола, формы комнаты и названия', () => {
  const doc = room('\n```options\nехать: exits\n```\n');

  // Без подписи работают прежние уровни: форма глагола, потом форма комнаты.
  assert.deepEqual(
    expand(doc, ['библиотека', 'коридор', 'столовая'], []).options.map((o) => o.label),
    ['ехать на автобусе в библиотеку', 'ехать в коридор', 'ехать столовая'],
  );

  // С подписью — она, и ровно она, какой бы уровень ни был написан у цели.
  assert.deepEqual(
    expand(
      doc,
      [
        { ref: 'библиотека', target: 'на этаж 1' },
        { ref: 'коридор', target: 'на этаж 2' },
        { ref: 'столовая', target: 'на этаж EG' },
      ],
      [],
    ).options.map((o) => o.label),
    ['ехать на этаж 1', 'ехать на этаж 2', 'ехать на этаж EG'],
  );
});

test('подпись меняет текст, но не адрес, не категорию и не ход', () => {
  const doc = room('\nОписание.\n');
  const { options } = expand(doc, [{ ref: 'коридор', target: 'в общагу' }], []);
  const [идти] = options;

  assert.equal(идти!.label, 'идти в общагу');
  assert.equal(идти!.target, 'rooms/коридор#');
  assert.equal(идти!.object, 'rooms/коридор');
  assert.equal(идти!.moves, true);
  assert.equal(идти!.kind, 'story');
});

test('подпись локальна: вторая комната называет ту же цель иначе', () => {
  const yard = room('\nДвор.\n');
  const stairs = room('\nЛестница.\n');

  assert.equal(expand(yard, [{ ref: 'коридор', target: 'в общагу' }], []).options[0]!.label, 'идти в общагу');
  assert.equal(expand(stairs, [{ ref: 'коридор', target: 'наверх' }], []).options[0]!.label, 'идти наверх');
  // Сама комната назначения не переименована: её форма на месте.
  assert.equal(expand(stairs, ['коридор'], []).options[0]!.label, 'идти в коридор');
});

test('подпись живёт вместе с явным узлом в адресе', () => {
  const doc = room('\nОписание.\n');
  const { options } = expand(doc, [{ ref: 'библиотека#стойка', target: 'к стойке' }], []);

  assert.equal(options[0]!.label, 'идти к стойке');
  assert.equal(options[0]!.target, 'rooms/библиотека#стойка');
});

test('подписи бывают только у выходов: предмет и явный список их не получают', () => {
  const doc = room('\n```options\nосмотреть: items\nидти: [коридор]\n```\n');
  const { options } = expand(doc, [{ ref: 'коридор', target: 'в общагу' }], ['доска']);

  // Явный список ссылок — не `exits`: подстановка к нему не применяется.
  assert.deepEqual(options.map((o) => o.label), ['осмотреть доску', 'идти в коридор']);
});

test('авторская подмена сравнивается с итоговой меткой, а не с прежней', () => {
  // Подмена переименована вслед за выходом: одна команда, ведёт в разговор.
  const fixed = room('\nОписание.\n\n→ идти в общагу [[оклик#у-двери]]\n');
  const { options } = expand(fixed, [{ ref: 'коридор', target: 'в общагу' }], []);
  assert.deepEqual(options.map((o) => o.label), ['идти в общагу']);
  assert.equal(options[0]!.target, 'scenes/оклик#у-двери');
});

test('устаревшая подмена после переименования — ошибка с обеими метками', () => {
  const stale = room('\nОписание.\n\n→ идти в коридор [[оклик#у-двери]]\n');

  assert.throws(
    () => expand(stale, [{ ref: 'коридор', target: 'в общагу' }], []),
    (e: unknown) =>
      e instanceof ContentError &&
      /«идти в коридор»/.test((e as Error).message) &&
      /«идти в общагу»/.test((e as Error).message),
  );

  // Без подписи та же пара — обычное перекрытие.
  assert.deepEqual(expand(stale, ['коридор'], []).options.map((o) => o.label), ['идти в коридор']);
});
