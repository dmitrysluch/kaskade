import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../app/client/engine/catalog.ts';
import { openLevel, openScreen } from '../app/client/engine/state.ts';
import { RULES } from '../app/server/validate/index.ts';
import { SCREEN } from '../app/shared/pages.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Предмет, у которого есть свой экран (07-оболочка-тз, «Предмет, у которого
 * есть свой экран»).
 *
 * Яблоко в аудитории — вещь с одним ответом и собственной командой «спросить
 * про яблоко». Контейнером оно не является, страниц у него нет, в инвентарь
 * не попадает — до тега эта команда была написана и недостижима. Проверяем
 * ровно эту дырку: что тег открывает уровень, что на уровне видно действие
 * вещи, и что документу со страницами он ничего не добавляет.
 */

const R = 'episodes/p/rooms/r';
const APPLE = 'episodes/p/items/01-apple';
const BOOK = 'episodes/p/items/00-book';
const PC = 'episodes/p/items/00-computer';
const WINDOW = 'episodes/p/items/00-thesis';

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
    pressure: null,
    resume: [],
    activeStage: null,
    currentDate: null,
    lastTransitionId: null,
    activeRoom: null,
    openItem: null,
    roomStates: {},
    episodeState: { episode: 'p', at: `${R}#`, used: [] },
    ...patch,
  };
}

/** Команда комнаты на предмет — ровно то, что собрал бы `осмотреть: items`. */
function look(target: string, label: string, object: string) {
  return option({ label, kind: 'environment', target, verb: 'осмотреть', object, moves: false });
}

/**
 * Аудитория с яблоком, учебник на две страницы и компьютер с окном: три вещи,
 * три разных ответа на вопрос «что открывает уровень».
 */
function game(): GameContent {
  return content({
    episodes: [episode('p', { entry: `${R}#`, verbs: ['осмотреть'] })],
    docs: {
      [R]: doc(R, {
        type: 'room',
        label: 'аудитория',
        items: ['01-apple', '00-book', '00-computer'],
        nodes: [
          node(`${R}#`, {
            text: 'Сорок мест, занято десять.',
            options: [
              look(`${APPLE}#осмотреть`, 'осмотреть яблоко', APPLE),
              look(`${BOOK}#обложка`, 'осмотреть учебник', BOOK),
              look(`${PC}#осмотреть`, 'осмотреть компьютер', PC),
            ],
          }),
        ],
      }),
      [APPLE]: doc(APPLE, {
        type: 'item',
        label: 'яблоко',
        target: 'яблоко',
        nodes: [
          node(`${APPLE}#`, { text: 'Зелёное яблоко на столе у доски.' }),
          node(`${APPLE}#осмотреть`, { text: 'Целое, без наклейки.', attrs: attrs({ tag: [SCREEN] }) }),
          node(`${APPLE}#спросить`, {
            text: 'Алерс смотрит на яблоко.',
            attrs: attrs({ once: true, label: 'спросить про яблоко' }),
          }),
        ],
      }),
      [BOOK]: doc(BOOK, {
        type: 'item',
        label: 'учебник',
        target: 'учебник',
        pages: ['обложка', 'глава'],
        nodes: [
          node(`${BOOK}#обложка`, { text: 'Sicherheitsbehälter.', attrs: attrs({ page: 1 }) }),
          node(`${BOOK}#глава`, { text: 'Единственный случай.', attrs: attrs({ page: 2 }) }),
          // Собственное действие документа принадлежит сцене, а не бумаге.
          node(`${BOOK}#вернуть`, { text: 'Ты отдаёшь учебник.' }),
        ],
      }),
      [PC]: doc(PC, {
        type: 'item',
        label: 'компьютер',
        target: 'компьютер',
        items: ['00-thesis'],
        nodes: [
          node(`${PC}#осмотреть`, {
            text: 'На экране окно.',
            options: [look(`${WINDOW}#первая`, 'осмотреть thesis.tex', WINDOW)],
          }),
        ],
      }),
      [WINDOW]: doc(WINDOW, {
        type: 'item',
        label: 'thesis.tex',
        target: 'thesis.tex',
        parent: PC,
        pages: ['первая', 'вторая'],
        nodes: [
          node(`${WINDOW}#первая`, { text: 'Оборванная фраза.', attrs: attrs({ page: 1 }) }),
          node(`${WINDOW}#вторая`, { text: 'И вторая.', attrs: attrs({ page: 2 }) }),
        ],
      }),
    },
  });
}

const labels = (g: GameContent, s: SaveState) =>
  buildCatalog(g, s).filter((o) => !o.system).map((o) => o.label);

const of = (g: GameContent, s: SaveState, label: string) =>
  buildCatalog(g, s).find((o) => o.label === label)!;

test('тег на узле предмета — свойство вещи, а не узла', () => {
  const g = game();
  assert.equal(g.docs[APPLE]!.screen, true);
  assert.equal(g.docs[BOOK]!.screen, false);
});

test('осмотр вещи с экраном открывает уровень, а одностраничной без тега — нет', () => {
  const g = game();
  const here = save();

  assert.equal(openLevel(g, here, of(g, here, 'осмотреть яблоко')), APPLE);

  // Та же вещь без тега: экран, на котором видно одно «закрыть», не нужен.
  const notagged = game();
  notagged.docs[APPLE] = doc(APPLE, {
    type: 'item',
    label: 'яблоко',
    target: 'яблоко',
    nodes: [node(`${APPLE}#осмотреть`, { text: 'Целое, без наклейки.' })],
  });
  assert.equal(openLevel(notagged, here, of(notagged, here, 'осмотреть яблоко')), null);
});

test('книга и контейнер открывают уровень сами, окно внутри его не подменяет', () => {
  const g = game();
  const here = save();

  assert.equal(openLevel(g, here, of(g, here, 'осмотреть учебник')), BOOK);
  assert.equal(openLevel(g, here, of(g, here, 'осмотреть компьютер')), PC);

  // Окно со своими страницами остаётся окном: уровень — компьютер.
  const inPC = save({ openItem: PC });
  assert.equal(openLevel(g, inPC, of(g, inPC, 'осмотреть thesis.tex')), PC);

  // `закрыть` гасит уровень, чем бы он ни открывался.
  assert.equal(openLevel(g, inPC, of(g, inPC, 'закрыть компьютер')), null);
});

test('на экране вещи видно её собственное действие, а комната ждёт снаружи', () => {
  const g = game();
  const open = save({ openItem: APPLE });

  assert.deepEqual(labels(g, open), ['спросить про яблоко', 'закрыть яблоко']);
  // Перезагрузка возвращает экран яблока, а не описание аудитории.
  assert.equal(openScreen(g, open)?.addr, `${APPLE}#осмотреть`);
});

test('у документа со страницами собственного действия на экране нет', () => {
  const g = game();
  const reading = save({ openItem: BOOK, itemStates: { '00-book': 'обложка' } });

  // Подпись и возврат протокола принадлежат сцене с полицейским, а не бумаге.
  assert.deepEqual(labels(g, reading), ['вперёд', 'закрыть учебник']);
});

function run(id: string, game: GameContent) {
  return RULES.find((r) => r.id === id)!.run(game).map((f) => f.message);
}

test('валидатор: живой экран проходит, а экран без действия — ошибка', () => {
  assert.deepEqual(run('screen', game()), []);

  const empty = content({
    docs: {
      [APPLE]: doc(APPLE, {
        type: 'item',
        label: 'яблоко',
        nodes: [node(`${APPLE}#осмотреть`, { attrs: attrs({ tag: [SCREEN] }) })],
      }),
    },
  });
  assert.match(run('screen', empty)[0]!, /нет ни одного собственного действия/);
});

test('валидатор: тег лишний там, где уровень и так открывается', () => {
  const both = content({
    docs: {
      [PC]: doc(PC, {
        type: 'item',
        items: ['00-thesis'],
        nodes: [
          node(`${PC}#осмотреть`, { attrs: attrs({ tag: [SCREEN] }) }),
          node(`${PC}#включить`),
        ],
      }),
      [BOOK]: doc(BOOK, {
        type: 'item',
        pages: ['обложка', 'глава'],
        nodes: [
          node(`${BOOK}#обложка`, { attrs: attrs({ page: 1, tag: [SCREEN] }) }),
          node(`${BOOK}#глава`, { attrs: attrs({ page: 2 }) }),
          node(`${BOOK}#вернуть`),
        ],
      }),
    },
  });

  const found = run('screen', both);
  assert.equal(found.filter((m) => /есть окна/.test(m)).length, 1);
  assert.equal(found.filter((m) => /страницы — уровень открывают они/.test(m)).length, 1);
  assert.equal(found.filter((m) => /на странице/.test(m)).length, 1);
});

test('валидатор: экран у комнаты и у вложенного окна', () => {
  const wrong = content({
    docs: {
      [R]: doc(R, { type: 'room', nodes: [node(`${R}#`, { attrs: attrs({ tag: [SCREEN] }) })] }),
      [PC]: doc(PC, { type: 'item', items: ['00-thesis'], nodes: [node(`${PC}#осмотреть`)] }),
      [WINDOW]: doc(WINDOW, {
        type: 'item',
        parent: PC,
        nodes: [
          node(`${WINDOW}#осмотреть`, { attrs: attrs({ tag: [SCREEN] }) }),
          node(`${WINDOW}#скопировать`),
        ],
      }),
    },
  });

  const found = run('screen', wrong);
  assert.equal(found.filter((m) => /свой экран бывает только у предмета/.test(m)).length, 1);
  assert.equal(found.filter((m) => /окно открывается внутри контейнера/.test(m)).length, 1);
});
