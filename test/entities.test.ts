import { test } from 'node:test';
import assert from 'node:assert/strict';
import { available, kindOf, parseEntities, resolveEntities } from '../app/shared/entities.ts';
import { enter, sessionEntities, textEntry } from '../app/client/engine/state.ts';
import { streamLines } from '../app/client/ui/lines.ts';
import { RULES } from '../app/server/validate/index.ts';
import { content, doc, node } from './helpers.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Явно размеченные сущности (07-оболочка-тз, «Явно размеченные сущности»).
 *
 * Главное здесь не разбор ссылок, а обещание: подсвечено ровно то, что игрок
 * может прямо сейчас спросить или посмотреть в справочнике. Предметы в тексте
 * не размечаются вовсе — они вещи комнаты или собственность Марго, а не
 * справочная ссылка. Ложная подсветка стоит доверия ко всем остальным.
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
    reference: { 'ref-kkw': { id: 'ref-kkw', label: 'KKW', category: 'физика', text: 'Kernkraftwerk, АЭС' } },
    docs: {
      [ROOM]: doc(ROOM, { type: 'room', items: ['00-book'], nodes: [node(`${ROOM}#`, { text })] }),
      'episodes/p/items/00-book': doc('episodes/p/items/00-book', { type: 'item', label: 'учебник' }),
      'episodes/p/items/00-phone': doc('episodes/p/items/00-phone', { type: 'item', label: 'телефон' }),
    },
  });
}

test('разбор: ссылка с формой и без, и счёт одинаковых форм', () => {
  const r = parseEntities('Слово [[word-alers|Алерс]]. Второй раз [[word-alers|Алерс]]. [[ref-kkw|KKW]].');

  // Игрок видит текст без разметки — ни скобок, ни идентификаторов.
  assert.equal(r.text, 'Слово Алерс. Второй раз Алерс. KKW.');
  assert.deepEqual(
    r.mentions.map((m) => [m.id, m.label, m.nth]),
    [
      ['word-alers', 'Алерс', 0],
      ['word-alers', 'Алерс', 1],
      ['ref-kkw', 'KKW', 0],
    ],
  );
});

test('тип следует из id, а не из префикса в разметке', () => {
  const g = game();
  assert.equal(kindOf(g, 'alers'), 'word');
  assert.equal(kindOf(g, 'ref-kkw'), 'reference');
  assert.equal(kindOf(g, 'неведомое'), null);
});

test('предмет сущностью разметки не является', () => {
  // 07-оболочка-тз: предметы доступны как вещи комнаты или собственность Марго,
  // а не как справочная ссылка. Ссылка на предмет — ошибка, а не подсветка.
  assert.equal(kindOf(game(), '00-book'), null);
});

test('доступность: термин всегда, слово — когда карточка уже есть', () => {
  assert.equal(available('reference', 'ref-kkw', save()), true);
  assert.equal(available('word', 'alers', save()), false);
  assert.equal(available('word', 'alers', save({ words: { alers: 'grey' } })), true);
});

test('недоступное упоминание остаётся текстом и не обещает команду', () => {
  const g = game();
  const raw = 'Речь про [[ref-kkw|АЭС]] и что-то про [[alers|Алерса]].';
  const r = resolveEntities(g, save(), raw);

  // Текст печатается целиком: про слово, которого нет, писать можно.
  assert.equal(r.text, 'Речь про АЭС и что-то про Алерса.');
  assert.deepEqual(r.mentions.map((m) => m.id), ['ref-kkw']);
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
  const g = game('Говорили про [[ref-kkw|АЭС]].');
  const r = enter(g, save(), `${ROOM}#`);
  const entry = r.entries.find((e) => e.kind === 'text')!;

  assert.equal(entry.text, 'Говорили про АЭС.');
  assert.deepEqual(entry.mentions?.map((m) => [m.kind, m.id]), [['reference', 'ref-kkw']]);

  const [line] = streamLines([entry], 60);
  assert.equal(line!.find((s) => s.cls === 'term')?.text, 'АЭС');
});

test('сессионная история: уникальные сущности в порядке последних упоминаний', () => {
  const g = game();
  const withWord = save({ words: { alers: 'white' } });
  const stream = [
    textEntry(g, withWord, 'Про [[ref-kkw|KKW]] и про [[alers|Алерса]].'),
    textEntry(g, withWord, 'Снова [[ref-kkw|KKW]].'),
  ];

  const terms = sessionEntities(stream, 'reference');
  assert.deepEqual(terms.map((e) => e.id), ['ref-kkw']);
  // Повтор не заводит вторую запись, а переносит место: теперь оно во второй записи.
  assert.equal(terms[0]!.at, 1);

  const words = sessionEntities(stream, 'word');
  assert.deepEqual(words.map((e) => [e.id, e.at]), [['alers', 0]]);
});

test('история — про выведенное, а не про написанное автором', () => {
  const g = game();
  // Слова у игрока нет: упоминание не подсвечено и в историю не попадает.
  const stream = [textEntry(g, save(), 'Что-то про [[alers|Алерса]].')];
  assert.deepEqual(sessionEntities(stream, 'word'), []);
});

test('валидатор: ссылка в никуда — ошибка', () => {
  const g = game('Про [[неведомое|это]] и [[ref-kkw|KKW]].');
  const found = RULES.find((r) => r.id === 'mentions')!.run(g);

  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, 'error');
  assert.match(found[0]!.message, /неведомое/);
});

test('справочник — заметки: статья приходит с названием и категорией', () => {
  // `reference/<id>.md` вместо строки в общем файле (07-оболочка-тз,
  // «Справочник»): у статьи есть id, чтобы на неё ссылались из текста.
  const g = content({
    reference: {
      'ref-ines': { id: 'ref-ines', label: 'шкала ИНЕС', category: 'физика', text: 'От нуля до семи.' },
    },
  });

  assert.equal(kindOf(g, 'ref-ines'), 'reference');
  // Ссылаются по id, а печатается форма из предложения.
  const r = resolveEntities(g, save(), 'Глава про [[ref-ines|шкалу событий]].');
  assert.equal(r.text, 'Глава про шкалу событий.');
  assert.deepEqual(r.mentions.map((m) => [m.kind, m.id]), [['reference', 'ref-ines']]);
});
