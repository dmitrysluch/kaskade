import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog, needsOf } from '../app/client/engine/catalog.ts';
import { collapse } from '../app/client/engine/families.ts';
import { loadContent } from '../app/server/content/load.ts';
import { commandLines, detailLines } from '../app/client/ui/lines.ts';
import { LIST_ROWS } from '../app/client/ui/Screen.tsx';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Команда, которой нужна вещь или слово (07-оболочка-тз, «Команда, которой
 * нужна вещь или слово»).
 *
 * Условие автор уже написал, и до сих пор игрок видел только результат: команда
 * есть или её нет. Проверяем, что цвет говорит, на чём она держится, и что
 * «держится» понимается узко: отрицание требованием не является, а доска
 * в комнате вещью на руках не становится.
 */

const ROOM = 'episodes/p/rooms/r';
const BOOK = 'episodes/p/items/00-book';
const PHONE = 'episodes/p/items/00-phone';
const STUDY = 'episodes/p/scenes/study';

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
    activeStage: null,
    currentDate: null,
    lastTransitionId: null,
    activeRoom: null,
    openItem: null,
    roomStates: {},
    episodeState: { episode: 'p', at: `${ROOM}#`, used: [] },
    ...patch,
  };
}

/** Комната с книгой на руках, телефоном и сценой, требующей слово. */
function game(): GameContent {
  return content({
    episodes: [episode('p', { entry: `${ROOM}#` })],
    words: {
      'word-only-case': {
        id: 'word-only-case',
        label: 'ЕДИНСТВЕННЫЙ СЛУЧАЙ В ИСТОРИИ',
        category: 'формулировки',
        text: '',
        details: [],
      },
    },
    docs: {
      [ROOM]: doc(ROOM, {
        type: 'room',
        label: 'комната',
        nodes: [node(`${ROOM}#`, { text: 'Общага.' })],
      }),
      [BOOK]: doc(BOOK, { type: 'item', label: 'учебник', target: 'учебник', nodes: [node(`${BOOK}#осмотреть`)] }),
      [PHONE]: doc(PHONE, {
        type: 'item',
        label: 'телефон',
        target: 'телефон',
        nodes: [node(`${PHONE}#позвонить`, { text: 'Гудки.' })],
      }),
      [STUDY]: doc(STUDY, {
        type: 'scene',
        nodes: [
          node(`${STUDY}#`, { text: 'Разбор.' }),
          // Условие у целевого узла, а не у команды: для игрока это одно и то же.
          node(`${STUDY}#сверка`, { text: 'Сверка.', attrs: attrs({ if: 'word:word-only-case' }) }),
        ],
      }),
    },
  });
}

test('условие команды становится требованием: вещь на руках и слово', () => {
  const g = game();

  const withBook = option({ label: 'изучать учебник', target: `${STUDY}#`, attrs: attrs({ if: 'has:00-book' }) });
  assert.deepEqual(needsOf(g, save(), withBook), { kind: 'item', id: '00-book', label: 'учебник' });

  // Условие бывает написано у целевого узла — для игрока это одно и то же.
  const toStudy = option({ label: 'сверить с перечнем', target: `${STUDY}#сверка` });
  assert.deepEqual(needsOf(g, save(), toStudy), {
    kind: 'word',
    id: 'word-only-case',
    label: 'ЕДИНСТВЕННЫЙ СЛУЧАЙ В ИСТОРИИ',
  });
});

test('отрицание требованием не является: `!has:` значит «пока этого нет»', () => {
  const g = game();
  const until = option({ label: 'искать учебник', attrs: attrs({ if: '!has:00-book' }) });
  assert.equal(needsOf(g, save(), until), null);

  // Смешанное условие читается по положительным термам.
  const mixed = option({ label: 'изучать учебник', attrs: attrs({ if: 'has:00-book, !word:word-only-case' }) });
  assert.equal(needsOf(g, save(), mixed)?.kind, 'item');
});

test('слово важнее вещи: оно и есть механика игры', () => {
  const g = game();
  const both = option({ label: 'сверить', attrs: attrs({ if: 'has:00-book, word:word-only-case' }) });
  assert.equal(needsOf(g, save(), both)?.kind, 'word');
});

test('требование берётся и из самой цели: слово «Дела», вещь в руках', () => {
  const g = game();

  // Опция из генератора `спросить: words` держится на слове без всякого `if`.
  const ask = option({ label: 'спросить о АЛЕРС', verb: 'спросить', object: 'word-only-case' });
  assert.equal(needsOf(g, save(), ask)?.kind, 'word');

  // Действие вещи, которая у Марго в руках.
  const call = option({ label: 'позвонить телефон', target: `${PHONE}#позвонить`, verb: 'позвонить', object: PHONE });
  assert.deepEqual(needsOf(g, save({ inventory: ['00-phone'] }), call), {
    kind: 'item',
    id: '00-phone',
    label: 'телефон',
  });

  // Та же команда без вещи в руках требованием не считается: предмет комнаты
  // стоит на месте, и брать его с собой не нужно.
  assert.equal(needsOf(g, save(), call), null);
});

test('каталог раскрашивает строку списка тем же цветом', () => {
  const g = game();
  // Карта узлов пересобирается хелпером: спред `...g` принёс бы прежние узлы.
  const g2 = content({
    episodes: g.episodes,
    words: g.words,
    docs: {
      ...g.docs,
      [ROOM]: doc(ROOM, {
        type: 'room',
        label: 'комната',
        nodes: [
          node(`${ROOM}#`, {
            text: 'Общага.',
            options: [
              option({ label: 'изучать учебник', target: `${STUDY}#`, attrs: attrs({ if: 'has:00-book' }), moves: true }),
              option({ label: 'осмотреть учебник', target: `${BOOK}#осмотреть`, verb: 'осмотреть', object: BOOK, kind: 'environment' }),
            ],
          }),
        ],
      }),
    },
  });

  const carrying = save({ inventory: ['00-book'], words: { 'word-only-case': 'white' } });
  const catalog = buildCatalog(g2, carrying);
  const study = catalog.find((o) => o.label === 'изучать учебник')!;
  assert.deepEqual(study.needs, { kind: 'item', id: '00-book', label: 'учебник' });

  const list = commandLines(collapse(catalog, ''), 0, '', 60, LIST_ROWS)
    .map((line) => line.map((seg) => `${seg.text}|${seg.cls ?? ''}`).join(''))
    .join('\n');
  assert.match(list, /изучать учебник\|[^\n]*needs-item/);
  // Служебные команды ни на чём не держатся и цвета не получают.
  assert.ok(!/справочник\|[^\n]*needs-/.test(list), list);
});

test('в деталях команда сама говорит, чем пользуется', () => {
  const needs = { kind: 'item' as const, id: '00-book', label: 'учебник' };
  const rows = 2;

  const lines = detailLines('— Сверю с перечнем.', false, needs, null, 60, rows);
  assert.equal(lines.length, rows, 'высота области не меняется');
  assert.match(lines[1]!.map((s) => s.text).join(''), /использует предмет учебник/);
  assert.equal(lines[1]!.some((s) => s.cls === 'needs-item'), true);

  // Предупреждение и требование живут в одной строке. Вдвоём полная подпись
  // `advance` не влезает, поэтому она становится короткой: знак `▶` в списке
  // к этому моменту уже сказал главное.
  const both = detailLines('— Ладно.', true, needs, null, 60, rows);
  const note = both[1]!.map((s) => s.text).join('');
  assert.match(note, /необратимо/);
  assert.match(note, /использует предмет учебник/);
  assert.ok(note.length <= 60 + 4, note);

  // Один `advance` печатается подписью целиком: объяснять знак больше нечем.
  assert.match(detailLines('— Ладно.', true, null, null, 60, rows)[1]!.map((s) => s.text).join(''), /нельзя вернуться/);

  // Слово называется своим именем и получает свой цвет.
  const word = detailLines(null, false, { kind: 'word', id: 'word-only-case', label: 'ЕДИНСТВЕННЫЙ СЛУЧАЙ' }, null, 60, rows);
  assert.equal(word[0]!.some((s) => s.cls === 'needs-word'), true);
  assert.match(word[0]!.map((s) => s.text).join(''), /использует слово ЕДИНСТВЕННЫЙ СЛУЧАЙ/);
});

test('в прологе требование находится у живых команд', () => {
  const real = loadContent();
  const base = {
    ...save({ inventory: ['00-book'], activeStage: '00', currentDate: '12.10.2024' }),
    episodeState: { episode: 'prolog', at: 'episodes/prolog/rooms-virt/tu.dorm-room:00#комната', used: [] },
  };

  const study = buildCatalog(real, base).find((o) => o.label === 'изучать учебник')!;
  assert.ok(study, 'в комнате нет команды «изучать учебник»');
  assert.deepEqual(study.needs, { kind: 'item', id: '00-book', label: 'учебник' });

  // Слово из «Дела»: команда разговора, собранная генератором по словам.
  const asked = buildCatalog(real, {
    ...base,
    words: { 'word-ahlers': 'white' },
    episodeState: { ...base.episodeState, at: 'episodes/prolog/scenes/00-talk#хаб' },
  }).find((o) => o.needs?.kind === 'word');
  assert.ok(asked == null || asked.needs?.kind === 'word');
});
