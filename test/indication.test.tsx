import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMarkdown } from '../app/server/content/markdown.ts';
import { RULES } from '../app/server/validate/index.ts';
import { enter } from '../app/client/engine/state.ts';
import { commandLines, ADVANCE_MARK, EARNED_MARK } from '../app/client/ui/lines.ts';
import { Manual } from '../app/client/ui/Manual.tsx';
import { collapse } from '../app/client/engine/families.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { CatalogOption } from '../app/client/engine/catalog.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Индикация заработанных реплик и потери предметов (07-оболочка-тз, «Индикация
 * заработанных реплик и потери предметов»).
 *
 * Обе пометы — уведомления, а не механики: они ничего не меняют в проходе и
 * обязаны быть видны ровно там, где случились. Поэтому проверяем то, что руками
 * ловится плохо: что значок ставит автор, а не условие; что он не трогает цвет
 * команды; что потеря объявляется один раз и только о том, что было на руках.
 */

const ROOM = 'episodes/p/rooms/r';
const TALK = 'episodes/p/scenes/talk';

function save(patch: Partial<SaveState> = {}): SaveState {
  return {
    saveVersion: 15,
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
    episodeState: { episode: 'p', at: `${TALK}#`, used: [] },
    ...patch,
  };
}

const cat = (patch: Partial<CatalogOption> = {}): CatalogOption => ({
  ...option(),
  locked: false,
  system: null,
  needs: null,
  ...patch,
});

const segs = (rows: ReturnType<typeof collapse>, max = 60) =>
  commandLines(rows, 0, '', max, 6).map((line) => line.map((s) => `${s.text}|${s.cls ?? ''}`).join(''));

test('помета пишется автором на переходе и разбирается как булева', () => {
  const scene = parseMarkdown(
    'talk.md',
    '---\nid: talk\ntype: scene\n---\n## хаб\n\n> тоби — Ну?\n\n' +
      '→ спросить о коммитторе [[#коммиттор]]\n  - if: word:word-committor\n  - earned\n' +
      '→ промолчать [[#конец]]\n',
  );

  const hub = scene.nodes.find((n) => n.id === 'хаб')!;
  assert.equal(hub.transitions[0]!.attrs.earned, true);
  // Соседняя реплика без пометы — обычная: условие само наградой не делает.
  assert.equal(hub.transitions[1]!.attrs.earned, false);
});

test('в списке у заработанной команды значок, а цвет остаётся цветом категории', () => {
  const lines = segs(
    collapse(
      [
        cat({ label: 'спросить о коммитторе', kind: 'story', attrs: attrs({ earned: true }) }),
        cat({ label: 'промолчать', kind: 'story' }),
      ],
      '',
      false,
    ),
  );

  assert.match(lines[0]!, new RegExp(`${EARNED_MARK} \\|[^|]*story`), lines[0]);
  assert.match(lines[0]!, /спросить о коммитторе\|[^|]*story/);
  // Цвет не изменился: у обеих строк он один и тот же.
  assert.match(lines[1]!, /промолчать\|[^|]*story/);
  assert.doesNotMatch(lines[1]!, new RegExp(EARNED_MARK));
});

test('заработанная и необратимая разом: сначала откуда, потом последствие', () => {
  const lines = segs(
    collapse([cat({ label: 'уйти с ним', kind: 'story', attrs: attrs({ earned: true, advance: true }) })], '', false),
  );
  assert.match(lines[0]!, new RegExp(`${EARNED_MARK} ${ADVANCE_MARK} \\|`), lines[0]);
});

test('смысл значка объясняется один раз — на экране управления', () => {
  const manual = renderToStaticMarkup(<Manual first />).replace(/<[^>]+>/g, ' ');
  assert.match(manual, new RegExp(EARNED_MARK));
  assert.match(manual, /Марго уже сделала или узнала/);
  // И не обещает, что это правильный ход.
  assert.match(manual, /не обязательно лучший/);
});

/** Комната, в которой протокол забирают, и разговор, где он уже не на руках. */
function game(): GameContent {
  return content({
    episodes: [episode('p', { entry: `${ROOM}#` })],
    docs: {
      [ROOM]: doc(ROOM, {
        type: 'room',
        label: 'отделение',
        nodes: [
          node(`${ROOM}#`, {
            text: 'Стол, стул, лампа.',
            options: [
              option({ label: 'вернуть протокол', target: `${ROOM}#вернуть`, moves: false }),
              option({ label: 'вернуть ещё раз', target: `${ROOM}#снова`, moves: false }),
              option({ label: 'забыть слово', target: `${ROOM}#забыть`, moves: false }),
            ],
          }),
          node(`${ROOM}#вернуть`, {
            text: 'Ты отдаёшь папку.',
            attrs: attrs({ take: ['02-protocol'] }),
          }),
          node(`${ROOM}#снова`, { attrs: attrs({ take: ['02-protocol'] }) }),
          node(`${ROOM}#забыть`, { attrs: attrs({ take: ['word-ahlers'] }) }),
        ],
      }),
      'episodes/p/items/02-protocol': doc('episodes/p/items/02-protocol', {
        type: 'item',
        label: 'протокол',
        nodes: [node('episodes/p/items/02-protocol#осмотреть', { text: 'Два листа.' })],
      }),
    },
    words: {
      'word-ahlers': { id: 'word-ahlers', label: 'АЛЕРС', category: 'слова', text: '', details: [] },
    },
  });
}

test('ушедшая из инвентаря вещь объявляется в потоке своей строкой', () => {
  const g = game();
  const carried = save({ inventory: ['02-protocol'], episodeState: { episode: 'p', at: `${ROOM}#`, used: [] } });
  const back = enter(g, carried, `${ROOM}#вернуть`, false);

  assert.deepEqual(
    back.entries.map((e) => `${e.kind}: ${e.text}`),
    ['text: Ты отдаёшь папку.', 'lost: ПРОТОКОЛ — больше не в инвентаре'],
  );
  assert.deepEqual(back.save.inventory, []);
});

test('потеря объявляется один раз и только о том, что было на руках', () => {
  const g = game();
  const empty = save({ episodeState: { episode: 'p', at: `${ROOM}#`, used: [] } });

  // Вещи на руках не было: повторный `take` молчит.
  assert.deepEqual(enter(g, empty, `${ROOM}#снова`, false).entries, []);

  // Слово — не вещь: «Дело» своих уведомлений о потере не имеет.
  const known = { ...empty, words: { 'word-ahlers': 'white' as const } };
  assert.deepEqual(enter(g, known, `${ROOM}#забыть`, false).entries, []);
});

function run(id: string, game: GameContent) {
  return RULES.find((r) => r.id === id)!.run(game).map((f) => f.message);
}

test('валидатор: значок без условия, на маршруте и на узле', () => {
  const ok = content({
    episodes: [episode('p')],
    docs: {
      [TALK]: doc(TALK, {
        nodes: [
          node(`${TALK}#`, {
            options: [
              option({ label: 'спросить о коммитторе', target: `${TALK}#конец`, attrs: attrs({ if: 'word:word-committor', earned: true }) }),
              // Безусловный выход рядом: иначе узел ловится другим правилом.
              option({ label: 'промолчать', target: `${TALK}#конец` }),
            ],
          }),
          node(`${TALK}#конец`),
        ],
      }),
    },
  });
  assert.deepEqual(run('routes', ok), []);

  const wrong = content({
    episodes: [episode('p')],
    docs: {
      [TALK]: doc(TALK, {
        nodes: [
          node(`${TALK}#`, {
            attrs: attrs({ earned: true }),
            options: [
              option({ label: 'спросить о коммитторе', target: `${TALK}#конец`, attrs: attrs({ earned: true }) }),
              option({ label: '', target: `${TALK}#конец`, attrs: attrs({ earned: true }) }),
            ],
          }),
          node(`${TALK}#конец`),
        ],
      }),
    },
  });

  const found = run('routes', wrong);
  assert.equal(found.filter((m) => /earned.*без условия/.test(m)).length, 1, found.join(' · '));
  assert.equal(found.filter((m) => /earned стоит на маршруте без метки/.test(m)).length, 1);
  assert.equal(found.filter((m) => /earned стоит на узле/.test(m)).length, 1);
});
