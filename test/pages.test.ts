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

const labels = (g: ReturnType<typeof game>, s: SaveState) => buildCatalog(g, s).map((o) => o.label);

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

test('листание появляется после осмотра и знает края книги', () => {
  const g = game();

  // Не открывали — листать нечего.
  assert.deepEqual(labels(g, save()).filter((l) => l.startsWith('листать')), []);

  const opened = enter(g, save(), `${BOOK}#обложка`, false).save;
  assert.deepEqual(labels(g, opened).filter((l) => l.startsWith('листать')), ['листать учебник вперёд']);

  const middle = enter(g, opened, `${BOOK}#оглавление`, false).save;
  assert.deepEqual(labels(g, middle).filter((l) => l.startsWith('листать')), [
    'листать учебник вперёд',
    'листать учебник назад',
  ]);

  const last = enter(g, middle, `${BOOK}#вклейка`, false).save;
  assert.deepEqual(labels(g, last).filter((l) => l.startsWith('листать')), ['листать учебник назад']);
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

  // Игрок при этом остался в комнате: предмет не модальный экран.
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
