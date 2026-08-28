import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from '../app/client/engine/catalog.ts';
import { enter, pageAt } from '../app/client/engine/state.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { SaveState } from '../app/shared/types.ts';

/**
 * Страницы предмета (07-оболочка-тз, «Страницы предмета — состояния»).
 *
 * Многостраничная вещь остаётся одним предметом: секции с `page` — её состояния.
 * Проверяем то, что руками ловится плохо: что осмотр возвращает игрока на ту же
 * страницу, а не в начало, и что состояние переживает переходы.
 */

const R = 'episodes/p/rooms/r';
const BOOK = 'episodes/p/items/book';

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
    episodeState: { episode: 'p', at: `${R}#`, used: [] },
    ...patch,
  };
}

/** Комната с многостраничным предметом; порядок секций в файле нарочно обратный. */
function game() {
  const book = doc(BOOK, {
    type: 'item',
    label: 'учебник',
    // Порядок задаёт `page`, а не то, как секции лежат в файле.
    pages: ['обложка', 'оглавление', 'вклейка'],
    nodes: [
      node(`${BOOK}#`, { text: 'Учебник, библиотечный.' }),
      node(`${BOOK}#вклейка`, { text: 'Разрез Mark I.', attrs: attrs({ page: 3, give: ['word-mark-i'] }) }),
      node(`${BOOK}#обложка`, { text: 'Sicherheitsbehälter.', attrs: attrs({ page: 1 }) }),
      node(`${BOOK}#оглавление`, { text: 'Глава первая.', attrs: attrs({ page: 2 }) }),
    ],
  });

  return content({
    episodes: [episode('p', { entry: `${R}#`, verbs: ['осмотреть'] })],
    words: { 'word-mark-i': { id: 'word-mark-i', label: 'MARK I', category: 'обозначения', text: '' } },
    docs: {
      [BOOK]: book,
      [R]: doc(R, {
        type: 'room',
        items: ['book'],
        nodes: [
          node(`${R}#`, {
            text: 'комната',
            // Так эту опцию отдаёт сервер: цель — первая страница, текущую
            // подставит каталог.
            options: [
              option({
                label: 'осмотреть учебник',
                kind: 'environment',
                verb: 'осмотреть',
                object: BOOK,
                target: `${BOOK}#обложка`,
              }),
            ],
          }),
        ],
      }),
    },
  });
}

const labels = (g: ReturnType<typeof game>, s: SaveState, reading: string | null = null) =>
  buildCatalog(g, s, reading)
    .filter((o) => !o.system)
    .map((o) => o.label);

test('первый осмотр открывает минимальный page, а не первую секцию файла', () => {
  const g = game();
  const first = buildCatalog(g, save()).find((o) => o.verb === 'осмотреть')!;

  assert.equal(first.target, `${BOOK}#обложка`);
  assert.equal(pageAt(g, save(), BOOK)?.id, 'обложка');
});

test('осмотр возвращает на текущую страницу, а не в начало', () => {
  const g = game();
  const opened = enter(g, save(), `${BOOK}#оглавление`, false).save;

  // В сейве лежит id секции: номер задаёт только порядок и может переехать.
  assert.equal(opened.itemStates['book'], 'оглавление');
  const again = buildCatalog(g, opened).find((o) => o.verb === 'осмотреть')!;
  assert.equal(again.target, `${BOOK}#оглавление`);
});

test('одностраничный предмет читать нечем — режим ему не нужен', () => {
  const ONE = 'episodes/p/items/note';
  const g = content({
    episodes: [episode('p', { entry: `${R}#`, verbs: ['осмотреть'] })],
    docs: {
      [ONE]: doc(ONE, {
        type: 'item',
        label: 'записка',
        pages: ['лист'],
        nodes: [node(`${ONE}#`), node(`${ONE}#лист`, { text: 'Одна страница.', attrs: attrs({ page: 1 }) })],
      }),
      [R]: doc(R, { type: 'room', nodes: [node(`${R}#`, { text: 'комната' })] }),
    },
  });

  // Внутри такого предмета листать нечего: остаётся одна команда выхода,
  // и открывать ради неё отдельный уровень незачем — это решает App.
  assert.deepEqual(
    buildCatalog(g, save(), ONE).filter((o) => !o.system).map((o) => o.label),
    ['закрыть записка'],
  );
});

test('чтение — отдельный уровень: комната из списка уходит', () => {
  const g = game();

  // Пока книга закрыта, в списке комната и ни одной команды листания.
  assert.deepEqual(labels(g, save()), ['осмотреть учебник']);

  // Открыли — список принадлежит книге.
  const opened = enter(g, save(), `${BOOK}#обложка`, false).save;
  assert.deepEqual(labels(g, opened, BOOK), ['вперёд', 'закрыть учебник']);
});

test('листание знает края книги', () => {
  const g = game();

  const first = enter(g, save(), `${BOOK}#обложка`, false).save;
  assert.deepEqual(labels(g, first, BOOK), ['вперёд', 'закрыть учебник']);

  const middle = enter(g, first, `${BOOK}#оглавление`, false).save;
  assert.deepEqual(labels(g, middle, BOOK), ['вперёд', 'назад', 'закрыть учебник']);

  const last = enter(g, middle, `${BOOK}#вклейка`, false).save;
  assert.deepEqual(labels(g, last, BOOK), ['назад', 'закрыть учебник']);
});

test('служебные команды есть и внутри книги', () => {
  const g = game();
  const opened = enter(g, save(), `${BOOK}#обложка`, false).save;
  const system = buildCatalog(g, opened, BOOK).filter((o) => o.system).map((o) => o.label);

  assert.deepEqual(system, ['справочник', 'дело', 'предметы', 'меню']);
});

test('закрыть возвращает комнату, а закладку оставляет', () => {
  const g = game();
  const read = enter(g, save(), `${BOOK}#вклейка`, false).save;

  // `закрыть` ничего не исполняет: цели у неё нет, режим гасит оболочка.
  const close = buildCatalog(g, read, BOOK).find((o) => o.label === 'закрыть учебник')!;
  assert.equal(close.target, null);
  assert.equal(close.verb, 'закрыть');

  // Вышли — комната на месте, листания нет, страница помнится.
  assert.deepEqual(labels(g, read), ['осмотреть учебник']);
  assert.equal(read.itemStates['book'], 'вклейка');
  assert.equal(buildCatalog(g, read).find((o) => o.verb === 'осмотреть')!.target, `${BOOK}#вклейка`);
});

test('страница показывает свой текст и применяет свои атрибуты', () => {
  const g = game();
  const opened = enter(g, save(), `${BOOK}#обложка`, false);
  assert.deepEqual(opened.entries.map((e) => e.text), ['Sicherheitsbehälter.']);
  assert.equal(opened.save.words['word-mark-i'], undefined);

  // Слово выдаётся на той странице, где разрез, а не на входе в предмет.
  const flipped = enter(g, opened.save, `${BOOK}#вклейка`, false);
  assert.equal(flipped.save.words['word-mark-i'], 'white');
  assert.ok(flipped.entries.some((e) => e.kind === 'grant'));

  // Позиция игрока при этом не двигается: читают, стоя в комнате, и `закрыть`
  // возвращает список, а не переносит откуда-то обратно.
  assert.equal(flipped.save.episodeState.at, `${R}#`);
});

test('исчезнувшая секция открывает книгу с начала, а не рушит сейв', () => {
  const g = game();
  const stale = save({ itemStates: { book: 'форзац' } });

  assert.equal(pageAt(g, stale, BOOK)?.id, 'обложка');
  assert.equal(buildCatalog(g, stale).find((o) => o.verb === 'осмотреть')!.target, `${BOOK}#обложка`);
});

test('состояние переживает переход в другую заметку и обратно', () => {
  const g = game();
  const opened = enter(g, save(), `${BOOK}#вклейка`, false).save;
  const elsewhere = { ...opened, episodeState: { ...opened.episodeState, at: `${BOOK}#` } };
  const back = { ...elsewhere, episodeState: { ...elsewhere.episodeState, at: `${R}#` } };

  assert.equal(buildCatalog(g, back).find((o) => o.verb === 'осмотреть')!.target, `${BOOK}#вклейка`);
});
