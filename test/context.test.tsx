import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { GameScreen, LOWER_ROWS } from '../app/client/ui/Screen.tsx';
import { contextLines, inputLine, inventoryLines, systemLine } from '../app/client/ui/lines.ts';
import { enter, sessionEntities, textEntry } from '../app/client/engine/state.ts';
import { attrs, content, doc, node } from './helpers.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Контекстная панель по `1`, `2`, `3` (07-оболочка-тз, «Контекстная панель»).
 *
 * Проверяем обещание, а не вёрстку: панель отвечает на вопрос «что это было
 * сейчас» — одной сущностью, — и всегда говорит, как отсюда выйти и где лежит
 * полный список. Сам перебор стрелками живёт в оболочке, здесь — то, что она
 * рисует.
 */

const ROOM = 'episodes/p/rooms/r';
const COLS = 60;
const ROWS = 15;

function save(patch: Partial<SaveState> = {}): SaveState {
  return {
    saveVersion: 1,
    words: { alers: 'white' },
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

function game(): GameContent {
  return content({
    words: { alers: { id: 'alers', label: 'Алерс', category: 'имена', text: 'физик, читал лекцию' } },
    reference: {
      'ref-kkw': { id: 'ref-kkw', label: 'KKW', category: 'физика', text: 'Kernkraftwerk — атомная электростанция' },
      'ref-opv': { id: 'ref-opv', label: 'OPV', category: 'порядок', text: 'Общая противоаварийная вентиляция' },
    },
    docs: {
      [ROOM]: doc(ROOM, { type: 'room', items: ['00-book'], nodes: [node(`${ROOM}#`)] }),
      'episodes/p/items/00-book': doc('episodes/p/items/00-book', {
        type: 'item',
        label: 'учебник',
        nodes: [node('episodes/p/items/00-book#', { text: 'Физика реакторов, третье издание.' })],
      }),
    },
  });
}

const text = (lines: ReturnType<typeof contextLines>) =>
  lines.map((line) => line.map((s) => s.text).join('')).join('\n');

test('панель занимает ровно отведённые строки — сетка не шевелится', () => {
  const empty = contextLines('reference', [], 0, game(), save(), COLS, ROWS);
  assert.equal(empty.length, ROWS);

  const g = game();
  const stream = [textEntry(g, save(), 'Про [[ref-kkw|KKW]].')];
  const full = contextLines('reference', sessionEntities(stream, 'reference'), 0, g, save(), COLS, ROWS);
  assert.equal(full.length, ROWS);
  // Каждая строка не шире сетки: панель рисуется в те же знакоместа.
  for (const line of full) assert.ok(line.map((s) => s.text).join('').length <= COLS);
});

test('пустая история говорит, где лежит полный список, и как выйти', () => {
  const out = text(contextLines('word', [], 0, game(), save(), COLS, ROWS));

  assert.match(out, /ещё не встречались слова дела/);
  assert.match(out, /Полный список: «дело»/);
  assert.match(out, /Esc закрыть/);
});

test('справочник показывает статью, «Дело» — карточку с происхождением', () => {
  const g = game();
  const stream = [textEntry(g, save(), 'Речь про [[ref-kkw|KKW]] и про [[alers|Алерса]].')];

  const term = text(contextLines('reference', sessionEntities(stream, 'reference'), 0, g, save(), COLS, ROWS));
  assert.match(term, /Kernkraftwerk/);

  const word = text(contextLines('word', sessionEntities(stream, 'word'), 0, g, save(), COLS, ROWS));
  assert.match(word, /Алерс/);
  assert.match(word, /имена/);
  assert.match(word, /физик, читал лекцию/);
  assert.match(word, /\[белое\]/);
});

test('инвентарь по `3`: карточка вещи и то, что она умеет', () => {
  const g = game();
  const out = text(inventoryLines(g, save({ inventory: ['00-book'] }), 0, COLS, ROWS));

  assert.match(out, /учебник/);
  assert.match(out, /Физика реакторов/);
  assert.match(out, /Esc закрыть/);
});

test('пустой инвентарь говорит об этом и напоминает команду', () => {
  const out = text(inventoryLines(game(), save(), 0, COLS, ROWS));

  assert.match(out, /На руках сейчас ничего нет/);
  assert.match(out, /Полный список: «инвентарь»/);
});

test('вещи комнаты в панель инвентаря не попадают', () => {
  // Стационарный предмет доступен действием комнаты, а не карманом Марго.
  const out = text(inventoryLines(game(), save({ inventory: [] }), 0, COLS, ROWS));
  assert.equal(out.includes('учебник'), false);
});

test('счётчик и подсказка про стрелки появляются, только когда есть что листать', () => {
  const g = game();
  const one = [textEntry(g, save(), 'Про [[ref-kkw|KKW]].')];
  const single = text(contextLines('reference', sessionEntities(one, 'reference'), 0, g, save(), COLS, ROWS));
  assert.equal(/←|→|1\/1/.test(single), false);

  const two = [textEntry(g, save(), 'Про [[ref-kkw|KKW]] и [[ref-opv|OPV]].')];
  const pair = text(contextLines('reference', sessionEntities(two, 'reference'), 1, g, save(), COLS, ROWS));
  assert.match(pair, /2\/2/);
  assert.match(pair, /← → другие/);
});

test('служебная полоса подписывает панели цифрами, а управление — вопросом', () => {
  const line = systemLine(['справочник', 'дело', 'инвентарь'], COLS)
    .map((s) => s.text)
    .join('')
    .trim();

  assert.equal(line, '1 справочник · 2 дело · 3 инвентарь · ? управление');
});


test('панель заменяет нижнюю область, а не ложится поверх неё', () => {
  const g = game();
  const stream = [textEntry(g, save(), 'Про [[ref-kkw|KKW]].')];
  const lines = contextLines('reference', sessionEntities(stream, 'reference'), 0, g, save(), COLS, LOWER_ROWS - 1);

  const screen = (panel: ReturnType<typeof contextLines> | null) =>
    renderToStaticMarkup(
      <GameScreen
        cols={COLS}
        streamRows={4}
        status={[]}
        stream={[]}
        input={inputLine('осмотр')}
        list={[[{ text: 'осмотреть учебник' }]]}
        details={[]}
        system={systemLine(['справочник'], COLS)}
        more={{ up: false, down: false }}
        rule="─"
        panel={panel}
      />,
    ).replace(/<[^>]+>/g, '');

  const open = screen(lines);
  // Пока панель открыта, ввода и списка команд на экране нет.
  assert.equal(open.includes('осмотреть учебник'), false);
  assert.match(open, /Kernkraftwerk/);

  // Закрыли — всё вернулось на место, включая набранное.
  const closed = screen(null);
  assert.match(closed, /осмотреть учебник/);
  assert.match(closed, /осмотр/);
});

test('выданное слово попадает в панель по `2` без всякой разметки', () => {
  // Слово, которое Марго только что получила, в тексте не размечено: его никто
  // не упоминал, его дали. А `2` сразу после выдачи спрашивают именно про него.
  const g = game();
  const stream = [
    { kind: 'grant' as const, text: 'АЛЕРС — в деле, 2', granted: { kind: 'word' as const, id: 'alers', label: 'АЛЕРС' } },
  ];
  const list = sessionEntities(stream, 'word');

  assert.deepEqual(list.map((e) => e.id), ['alers']);
  const out = contextLines('word', list, 0, g, save(), COLS, ROWS)
    .map((line) => line.map((s) => s.text).join(''))
    .join('\n');
  assert.match(out, /Алерс/);
});

test('выданная вещь объявляется строкой — как слово, но в инвентарь', () => {
  const g = content({
    docs: {
      'episodes/p/items/box': doc('episodes/p/items/box', { type: 'item', label: 'коробка' }),
      'episodes/p/scenes/s': doc('episodes/p/scenes/s', {
        nodes: [node('episodes/p/scenes/s#дали', { attrs: attrs({ give: ['box'] }), text: 'Он протягивает её.' })],
      }),
    },
  });

  const r = enter(g, save({ inventory: [], words: {} }), 'episodes/p/scenes/s#дали');
  const grant = r.entries.find((e) => e.kind === 'grant')!;

  // Первая вещь за игру получает клавишу, как и первое слово.
  assert.equal(grant.text, 'КОРОБКА — в инвентаре, 3');
  assert.deepEqual(grant.granted, { kind: 'item', id: 'box', label: 'КОРОБКА' });
  assert.ok(r.save.inventory.includes('box'));

  // Вторая — уже без клавиши: игрок знает, где смотреть.
  const again = enter(g, r.save, 'episodes/p/scenes/s#дали');
  assert.equal(again.entries.some((e) => e.kind === 'grant'), false, 'вещь выдана дважды');
});
