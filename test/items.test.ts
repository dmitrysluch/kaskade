import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, itemActions } from '../app/client/engine/catalog.ts';
import { overlayLines } from '../app/client/ui/lines.ts';
import { RULES } from '../app/server/validate/index.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Предметы после рефакторинга ([[99-открытые-вопросы]], «Глаголы и состояния
 * предметов»).
 *
 * Главное — что список текущего места принадлежит месту: вещь на руках больше
 * не досыпает в него свои глаголы. Проверяем и обратную сторону: вещь при этом
 * не потеряна, её действия лежат в хранилище, и сцена по-прежнему может сама
 * объявить действие с предметом.
 */

const ROOM = 'episodes/p/rooms/r';
const PHONE = 'episodes/p/items/phone';
const BOOK = 'episodes/p/items/book';

function save(patch: Partial<SaveState> = {}): SaveState {
  return {
    saveVersion: 1,
    words: {},
    flags: {},
    inventory: ['phone'],
    splashes: [],
    chapter: 'p',
    dates: {},
    itemStates: {},
    taught: true,
    hinted: true,
    started: true,
    wait: null,
    episodeState: { episode: 'p', at: `${ROOM}#`, used: [] },
    ...patch,
  };
}

/** Комната со столом, телефон на руках, книга на три страницы. */
function game(roomNode = node(`${ROOM}#`, { text: 'Пультовая.' })): GameContent {
  return content({
    episodes: [episode('p', { entry: `${ROOM}#` })],
    docs: {
      [ROOM]: doc(ROOM, { type: 'room', label: 'пультовая', nodes: [roomNode] }),
      [PHONE]: doc(PHONE, {
        type: 'item',
        label: 'телефон',
        target: 'телефон',
        nodes: [
          node(`${PHONE}#`, { text: 'Кнопочный, чужой.' }),
          node(`${PHONE}#позвонить`, { text: 'Гудки.' }),
          node(`${PHONE}#разбить`, { text: 'Не сейчас.', attrs: attrs({ if: 'злость' }) }),
        ],
      }),
      [BOOK]: doc(BOOK, {
        type: 'item',
        label: 'учебник',
        target: 'учебник',
        pages: ['обложка', 'вклейка'],
        nodes: [
          node(`${BOOK}#`, { text: 'Физика реакторов.' }),
          node(`${BOOK}#обложка`, { text: 'Обложка.', attrs: attrs({ page: 1 }) }),
          node(`${BOOK}#вклейка`, { text: 'Вклейка.', attrs: attrs({ page: 2 }) }),
        ],
      }),
    },
  });
}

test('вещь на руках не досыпает свои глаголы в список места', () => {
  const labels: string[] = buildCatalog(game(), save())
    .filter((o) => o.system === null)
    .map((o) => o.label);

  assert.deepEqual(labels, [] as string[]);
  assert.equal(labels.some((l) => l.startsWith('позвонить')), false);
});

test('действия предмета — его секции, и условия у них работают', () => {
  const g = game();
  assert.deepEqual(
    itemActions(g, save(), PHONE).map((o) => o.label),
    ['позвонить телефон'],
  );

  // Секция с условием появляется вместе с флагом, как любая опция.
  const angry = save({ flags: { злость: { value: true, at: null } } });
  assert.deepEqual(
    itemActions(g, angry, PHONE).map((o) => o.label),
    ['позвонить телефон', 'разбить телефон'],
  );
});

test('страницы — состояния вещи, а не действия; осмотр у них один', () => {
  const g = game();
  const actions = itemActions(g, save({ inventory: ['book'] }), BOOK);

  assert.deepEqual(actions.map((o) => o.label), ['осмотреть учебник']);
  // Ведёт осмотр на страницу, а не на несуществующий узел «осмотреть».
  assert.equal(actions[0]!.target, `${BOOK}#обложка`);
});

test('сцена может объявить действие с предметом сама — это и есть контекст', () => {
  // `показать Алерсу бланк` принадлежит сцене и проверяет наличие вещи;
  // само по себе наличие опции не создаёт.
  const withOption = node(`${ROOM}#`, {
    text: 'Пультовая.',
    options: [
      option({
        label: 'показать телефон',
        kind: 'environment',
        target: `${PHONE}#позвонить`,
        attrs: attrs({ if: 'has:phone' }),
      }),
    ],
  });

  const labels = (s: SaveState) =>
    buildCatalog(game(withOption), s)
      .filter((o) => o.system === null)
      .map((o) => o.label);

  assert.deepEqual(labels(save()), ['показать телефон']);
  assert.deepEqual(labels(save({ inventory: [] })), []);
});

test('хранилище показывает вещи, а по выбору — её действия', () => {
  const g = game();
  const text = (storage: Parameters<typeof overlayLines>[4]) =>
    overlayLines({ kind: 'предметы', arg: null }, g, save(), 60, storage)
      .map((line) => line.map((s) => s.text).join(''))
      .join('\n');

  const list = text({ pick: 0, open: null, act: 0 });
  assert.match(list, /телефон/);
  assert.match(list, /Кнопочный, чужой/);
  // Пока вещь не открыта, действий не видно: список должен читаться списком.
  assert.equal(list.includes('позвонить телефон'), false);

  const opened = text({ pick: 0, open: PHONE, act: 0 });
  assert.match(opened, /позвонить телефон/);
});

test('пустые руки говорят об этом прямо', () => {
  const out = overlayLines({ kind: 'предметы', arg: null }, game(), save({ inventory: [] }), 60, null)
    .map((line) => line.map((s) => s.text).join(''))
    .join('\n');

  assert.match(out, /На руках ничего нет/);
});

test('валидатор: выданный предмет просят объявить переносимым', () => {
  const g = game(node(`${ROOM}#`, { text: 'Пультовая.', attrs: attrs({ give: ['phone'] }) }));
  const found = RULES.find((r) => r.id === 'portable')!.run(g);

  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, 'warn');
  assert.match(found[0]!.message, /portable: true/);
});
