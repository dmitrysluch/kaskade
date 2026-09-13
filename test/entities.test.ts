import { test } from 'node:test';
import assert from 'node:assert/strict';
import { available, kindOf, parseEntities, resolveEntities } from '../app/shared/entities.ts';
import { enter, itemsHere, sessionEntities, textEntry } from '../app/client/engine/state.ts';
import { streamLines } from '../app/client/ui/lines.ts';
import { RULES } from '../app/server/validate/index.ts';
import { content, doc, node } from './helpers.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Явно размеченные сущности (07-оболочка-тз, «Явно размеченные сущности»).
 *
 * Главное здесь не разбор ссылок, а обещание: подсвечено ровно то, что игрок
 * может прямо сейчас взять в руки, спросить или посмотреть в справочнике.
 * Ложная подсветка стоит доверия ко всем остальным — её и проверяем.
 */

const ROOM = 'episodes/p/rooms/r';

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
    episodeState: { episode: 'p', at: `${ROOM}#`, used: [] },
    ...patch,
  };
}

/** Комната с учебником на столе, слово «Алерс» в реестре, `KKW` в справочнике. */
function game(text = ''): GameContent {
  return content({
    words: { alers: { id: 'alers', label: 'Алерс', category: 'имена', text: 'физик' } },
    reference: { KKW: 'Kernkraftwerk, АЭС' },
    docs: {
      [ROOM]: doc(ROOM, { type: 'room', items: ['00-book'], nodes: [node(`${ROOM}#`, { text })] }),
      'episodes/p/items/00-book': doc('episodes/p/items/00-book', { type: 'item', label: 'учебник' }),
      'episodes/p/items/00-phone': doc('episodes/p/items/00-phone', { type: 'item', label: 'телефон' }),
    },
  });
}

test('разбор: ссылка с формой и без, и счёт одинаковых форм', () => {
  const r = parseEntities('Берёшь [[00-book|учебник]]. Второй [[00-book|учебник]] лежит рядом. [[KKW]].');

  // Игрок видит текст без разметки — ни скобок, ни идентификаторов.
  assert.equal(r.text, 'Берёшь учебник. Второй учебник лежит рядом. KKW.');
  assert.deepEqual(
    r.mentions.map((m) => [m.id, m.label, m.nth]),
    [
      ['00-book', 'учебник', 0],
      ['00-book', 'учебник', 1],
      ['KKW', 'KKW', 0],
    ],
  );
});

test('тип следует из id, а не из префикса в разметке', () => {
  const g = game();
  assert.equal(kindOf(g, 'alers'), 'word');
  assert.equal(kindOf(g, 'KKW'), 'reference');
  assert.equal(kindOf(g, '00-book'), 'item');
  assert.equal(kindOf(g, 'неведомое'), null);
});

test('доступность: термин всегда, слово — с карточкой, предмет — пока рядом', () => {
  const here = new Set(['00-book']);
  assert.equal(available('reference', 'KKW', save(), new Set()), true);

  assert.equal(available('word', 'alers', save(), here), false);
  assert.equal(available('word', 'alers', save({ words: { alers: 'grey' } }), here), true);

  assert.equal(available('item', '00-book', save(), here), true);
  assert.equal(available('item', '00-phone', save(), here), false);
  // Вещь на руках — тоже рядом: она ездит с игроком.
  assert.equal(available('item', '00-phone', save({ inventory: ['00-phone'] }), here), true);
});

test('недоступное упоминание остаётся текстом и не обещает команду', () => {
  const g = game();
  const raw = 'На столе [[00-book|учебник]], в кармане [[00-phone|телефон]], и что-то про [[alers|Алерса]].';
  const r = resolveEntities(g, save(), itemsHere(g, save()), raw);

  // Текст печатается целиком: про отсутствующее писать можно, обещать — нет.
  assert.equal(r.text, 'На столе учебник, в кармане телефон, и что-то про Алерса.');
  assert.deepEqual(r.mentions.map((m) => m.id), ['00-book']);
});

test('подсветка считается в момент вывода, а не при каждой отрисовке', () => {
  const g = game();
  const before = textEntry(g, save(), 'Спроси про [[alers|Алерса]].');
  assert.deepEqual(before.mentions ?? [], []);

  const after = textEntry(g, save({ words: { alers: 'white' } }), 'Спроси про [[alers|Алерса]].');
  assert.deepEqual(after.mentions?.map((m) => m.kind), ['word']);

  // Старая запись не загорается задним числом: она уже показана как показана.
  assert.deepEqual(before.mentions ?? [], []);
});

test('текст узла приходит в поток без разметки', () => {
  const g = game('На столе [[00-book|учебник]].');
  const r = enter(g, save(), `${ROOM}#`);
  const entry = r.entries.find((e) => e.kind === 'text')!;

  assert.equal(entry.text, 'На столе учебник.');
  assert.deepEqual(entry.mentions?.map((m) => [m.kind, m.id]), [['item', '00-book']]);

  const [line] = streamLines([entry], 60);
  assert.equal(line!.find((s) => s.cls === 'item')?.text, 'учебник');
});

test('сессионная история: уникальные сущности в порядке последних упоминаний', () => {
  const g = game();
  const stream = [
    textEntry(g, save(), 'Про [[KKW]] и [[00-book|учебник]].'),
    textEntry(g, save(), 'Снова [[KKW]].'),
  ];

  const terms = sessionEntities(stream, 'reference');
  assert.deepEqual(terms.map((e) => e.id), ['KKW']);
  // Повтор не заводит вторую запись, а переносит место: теперь оно во второй записи.
  assert.equal(terms[0]!.at, 1);

  const items = sessionEntities(stream, 'item');
  assert.deepEqual(items.map((e) => [e.id, e.at]), [['00-book', 0]]);
});

test('история — про выведенное, а не про написанное автором', () => {
  const g = game();
  // Слова у игрока нет: упоминание не подсвечено и в историю не попадает.
  const stream = [textEntry(g, save(), 'Что-то про [[alers|Алерса]].')];
  assert.deepEqual(sessionEntities(stream, 'word'), []);
});

test('валидатор: ссылка в никуда — ошибка', () => {
  const g = game('Про [[неведомое|это]] и [[KKW]].');
  const found = RULES.find((r) => r.id === 'mentions')!.run(g);

  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, 'error');
  assert.match(found[0]!.message, /неведомое/);
});
