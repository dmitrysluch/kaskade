import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseMarkdown } from '../app/server/content/markdown.ts';
import { parseMinigame } from '../app/server/content/minigames.ts';
import { RULES } from '../app/server/validate/index.ts';
import { withoutSolutions } from '../app/server/bundle.ts';
import { completeMinigame, fieldHere, fieldOf, moveMinigame, pointsOf } from '../app/client/engine/minigame.ts';
import { enter } from '../app/client/engine/state.ts';
import { UntangleScreen } from '../app/client/ui/Untangle.tsx';
import { analyze } from '../app/shared/untangle.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import { FIELD, STUDY, threadsOf } from './minigame-field.ts';
import type { GameContent, MinigameDef, SaveState } from '../app/shared/types.ts';

/**
 * Мини-игра в контенте, валидаторе и рантайме ([[07a-мини-игра]]).
 *
 * Проверяем то, что ломается молча: что поле — это позиция игрока и
 * перезагрузка возвращает его же, что эффекты завершения выдаются ровно один
 * раз и только после нового `Enter`, и что валидатор ловит непланарное
 * `solution` — глазами такую раскладку не проверить.
 */

const GAME = 'episodes/p/minigames/00-study-ines';
const ROOM = 'episodes/p/rooms/dorm';
const STUDY_SCENE = 'episodes/p/scenes/00-study';

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
    taught: true,
    hinted: true,
    started: true,
    wait: null,
    activeStage: null,
    currentDate: null,
    lastTransitionId: null,
    activeRoom: null,
    openItem: null,
    roomStates: {},
    episodeState: { episode: 'p', at: `${STUDY_SCENE}#`, used: [] },
    ...patch,
  };
}

/** Тот же файл, что в ТЗ: frontmatter, два документа и узел завершения. */
const SOURCE = [
  '---',
  'id: 00-study-ines',
  'type: minigame',
  'subtype: untangle',
  'label: шкала событий',
  'grid: {columns: 24, rows: 18}',
  'seed: 1907',
  'complete: complete',
  'points:',
  ...Object.entries(FIELD).map(
    ([id, p]) => `  ${id}: {start: [${p.start.join(', ')}], solution: [${p.solution.join(', ')}]}`,
  ),
  'threads:',
  ...threadsOf().map((t) => `  - {id: ${t.id}, points: [${t.points.join(', ')}]}`),
  '---',
  '',
  STUDY,
  '',
  '## complete',
  '- tag: montage',
  '- set: prolog.study-ines',
  '- give: word-only-case',
  '- timeLabel: за полночь',
  '',
  'Ты обводишь строку и ставишь на поле двойку.',
  '',
  `→ [[rooms/dorm]]`,
  '',
].join('\n');

function parsed(): MinigameDef {
  const raw = parseMarkdown('/content/00-study-ines.md', SOURCE);
  return parseMinigame(raw, '00-study-ines', GAME, 'шкала событий');
}

/** Мир: сцена-диспетчер, поле и комната, в которую уводит завершение. */
function game(def = parsed()): GameContent {
  return content({
    episodes: [episode('p', { entry: `${STUDY_SCENE}#` })],
    minigames: { [GAME]: def },
    docs: {
      [STUDY_SCENE]: doc(STUDY_SCENE, {
        type: 'scene',
        nodes: [node(`${STUDY_SCENE}#`, { options: [option({ label: '', target: `${GAME}#`, moves: true })] })],
      }),
      [GAME]: doc(GAME, {
        type: 'minigame',
        label: 'шкала событий',
        nodes: [
          // Вступление мини-игры пустое: её текст — это документы поля.
          node(`${GAME}#`),
          node(`${GAME}#complete`, {
            text: 'Ты обводишь строку и ставишь на поле двойку.',
            attrs: attrs({ tag: ['montage'], set: ['prolog.study-ines'], give: ['word-only-case'] }),
            options: [option({ label: '', target: `${ROOM}#`, moves: true })],
          }),
        ],
      }),
      [ROOM]: doc(ROOM, { type: 'room', label: 'комната', nodes: [node(`${ROOM}#`, { text: 'Общага.' })] }),
    },
    words: { 'word-only-case': { id: 'word-only-case', label: 'единственный случай', category: 'слова', text: '', details: [] } },
  });
}

const run = (id: string, g: GameContent) => RULES.find((r) => r.id === id)!.run(g);

/** Раскладка точек из авторского решения — ей поле обязано сдаться. */
function solvedPoints() {
  return Object.fromEntries(Object.entries(FIELD).map(([id, p]) => [Number(id), p.solution]));
}

test('заметка мини-игры разбирается в поле: геометрия из YAML, документы из тела', () => {
  const def = parsed();

  assert.equal(def.subtype, 'untangle');
  assert.deepEqual(def.grid, { columns: 24, rows: 18 });
  assert.equal(def.seed, 1907);
  assert.equal(def.complete, 'complete');
  assert.equal(Object.keys(def.points).length, 10);
  assert.equal(def.threads.length, 12);
  assert.deepEqual(def.points[0], { start: [21, 12], solution: [12, 1] });
  assert.deepEqual(def.documents.map((d) => d.label), ['Учебник', 'Справочник']);
  assert.deepEqual(def.problems, []);
});

test('валидатор пропускает поле из ТЗ и ловит непланарное solution', () => {
  assert.deepEqual(run('minigame', game()), []);

  const def = parsed();
  // Меняем две точки решения местами: пересечения появляются, глазами не видно.
  const broken: MinigameDef = {
    ...def,
    points: { ...def.points, 0: { ...def.points[0]!, solution: FIELD[4]!.solution }, 4: { ...def.points[4]!, solution: FIELD[0]!.solution } },
  };
  const found = run('minigame', game(broken)).map((f) => f.message);
  assert.ok(found.some((m) => /solution: нити .* пересекаются/.test(m)), found.join(' | '));
});

test('валидатор: схема, степень точки и стартовая путаница', () => {
  const def = parsed();

  const flat: MinigameDef = {
    ...def,
    points: Object.fromEntries(Object.entries(def.points).map(([id, p]) => [Number(id), { ...p, start: p.solution! }])),
  };
  assert.ok(run('minigame', game(flat)).some((f) => /нет ни одного пересечения/.test(f.message)));

  const strange: MinigameDef = { ...def, subtype: 'threads', grid: { columns: 0, rows: 18 }, complete: 'нет-такого' };
  const found = run('minigame', game(strange)).map((f) => f.message);
  assert.ok(found.some((m) => /единственный подтип/.test(m)), found.join(' | '));
  assert.ok(found.some((m) => /целые положительные/.test(m)), found.join(' | '));
  assert.ok(found.some((m) => /из `complete` в файле нет/.test(m)), found.join(' | '));

  // Пятая нить в одной точке: подсветке неоткуда взять пятый цвет.
  const crowded: MinigameDef = {
    ...def,
    threads: [...def.threads.slice(0, 9), { id: 9, points: [9, 0] }, { id: 10, points: [9, 1] }, { id: 11, points: [9, 2] }, { id: 12, points: [9, 3] }, { id: 13, points: [9, 4] }],
  };
  assert.ok(run('minigame', game(crowded)).some((f) => /больше четырёх цветов/.test(f.message)));
});

test('валидатор: прямая ссылка на завершение и поле без входа', () => {
  const g = game();
  const linked = content({
    episodes: g.episodes,
    minigames: g.minigames,
    docs: {
      ...g.docs,
      [STUDY_SCENE]: doc(STUDY_SCENE, {
        type: 'scene',
        nodes: [node(`${STUDY_SCENE}#`, { options: [option({ label: 'дальше', target: `${GAME}#complete` })] })],
      }),
    },
  });

  const found = run('minigame', linked).map((f) => f.message);
  assert.ok(found.some((m) => /прямая ссылка на завершение/.test(m)), found.join(' | '));
  assert.ok(found.some((m) => /нет ни одного входа/.test(m)), found.join(' | '));
});

test('поле — это позиция игрока: проход останавливается на нём до победы', () => {
  const g = game();
  const r = enter(g, save(), `${STUDY_SCENE}#`);

  assert.equal(r.save.episodeState.at, `${GAME}#`);
  assert.equal(fieldHere(g, r.save)?.id, '00-study-ines');
  // Ни текста, ни эффектов завершения: они принадлежат узлу `complete`.
  assert.deepEqual(r.entries, []);
  assert.deepEqual(r.save.words, {});
  assert.deepEqual(r.save.flags, {});
});

test('первый вход берёт start, шаг пишется в сейв, отклонённый ход не меняет ничего', () => {
  const g = game();
  const def = g.minigames[GAME]!;
  const at = enter(g, save(), `${STUDY_SCENE}#`).save;

  assert.deepEqual(pointsOf(def, at)[0], [21, 12]);

  const moved = moveMinigame(def, at, 0, -1, 0)!;
  assert.deepEqual(moved.minigames['00-study-ines']!.points[0], [20, 12]);
  assert.equal(moved.minigames['00-study-ines']!.solved, false);

  // За границу сетки: ход отклонён.
  const corner = { ...at, minigames: { '00-study-ines': { points: { ...pointsOf(def, at), 0: [0, 0] as [number, number] }, solved: false, completionApplied: false } } };
  assert.equal(moveMinigame(def, corner, 0, -1, 0), null);
  // В занятую клетку — тоже: две точки в одной клетке не читаются как две.
  const tight = { ...at, minigames: { '00-study-ines': { points: { ...pointsOf(def, at), 0: [2, 7] as [number, number] }, solved: false, completionApplied: false } } };
  assert.equal(moveMinigame(def, tight, 0, 0, -1), null, 'точка 1 стоит в [2, 6]');
});

test('распутанное поле блокируется, а эффекты ждут нового Enter', () => {
  const g = game();
  const def = g.minigames[GAME]!;
  const won = save({
    episodeState: { episode: 'p', at: `${GAME}#`, used: [] },
    minigames: { '00-study-ines': { points: solvedPoints(), solved: true, completionApplied: false } },
  });

  const field = fieldOf(def, won);
  assert.equal(field.solved, true);
  assert.equal(field.done, false);
  // Шаги по решённому полю не принимаются вовсе.
  assert.equal(moveMinigame(def, won, 0, 1, 0), null);
  // Пока Enter не нажат, слово не выдано.
  assert.deepEqual(won.words, {});

  const done = completeMinigame(g, won, def);
  assert.equal(done.save.minigames['00-study-ines']!.completionApplied, true);
  assert.equal(done.save.words['word-only-case'], 'white');
  assert.equal(done.save.flags['prolog.study-ines']?.value, true);
  // Монтаж останавливает проход: игрок стоит на кадре завершения.
  assert.equal(done.save.episodeState.at, `${GAME}#complete`);
});

test('пройденное поле не показывается второй раз и выдач не повторяет', () => {
  const g = game();
  const def = g.minigames[GAME]!;
  const after = completeMinigame(
    g,
    save({
      episodeState: { episode: 'p', at: `${GAME}#`, used: [] },
      minigames: { '00-study-ines': { points: solvedPoints(), solved: true, completionApplied: false } },
    }),
    def,
  ).save;

  // Поле снова стало целью графа: движок сразу идёт маршрутом завершения.
  const again = enter(g, { ...after, episodeState: { ...after.episodeState, at: `${ROOM}#` } }, `${GAME}#`);
  assert.equal(again.save.episodeState.at, `${ROOM}#`);
  assert.equal(fieldHere(g, again.save), null);
  // Слово остаётся одним: повторной выдачи нет.
  assert.deepEqual(Object.keys(again.save.words), ['word-only-case']);
  assert.ok(!again.entries.some((e) => e.kind === 'grant'));
});

test('незавершённое поле восстанавливается из координат, а не из показанного текста', () => {
  const g = game();
  const def = g.minigames[GAME]!;
  const walked = moveMinigame(def, enter(g, save(), `${STUDY_SCENE}#`).save, 3, 0, -1)!;

  // Перезагрузка: тот же сейв — то же поле и тот же текст.
  const first = fieldOf(def, walked);
  const second = fieldOf(def, JSON.parse(JSON.stringify(walked)) as SaveState);
  assert.deepEqual(second.points, first.points);
  assert.deepEqual(second.analysis.crossings, first.analysis.crossings);
});

test('клиенту уезжает поле без авторского решения', () => {
  const g = game();
  const sent = withoutSolutions({ ok: true, content: g });
  assert.ok(sent.ok);
  const def = sent.content.minigames[GAME]!;

  assert.deepEqual(def.points[0], { start: [21, 12] });
  assert.equal(Object.values(def.points).every((p) => p.solution == null), true);
  // На сервере решение остаётся: им проверяется планарность.
  assert.deepEqual(g.minigames[GAME]!.points[0]!.solution, [12, 1]);
});

test('поле рисуется с номерами точек, счётчиком и подписью управления', () => {
  const g = game();
  const def = g.minigames[GAME]!;
  const points = pointsOf(def, save());
  const html = renderToStaticMarkup(
    <UntangleScreen
      def={def}
      points={points}
      analysis={analyze(points, def.threads)}
      selected={3}
      cols={72}
      status={[{ text: '12.10.2024' }]}
      touch={false}
      onSelect={() => {}}
      onMove={() => {}}
      onMenu={() => {}}
      onDone={() => {}}
    />,
  );

  assert.match(html, /пересечений: 23/);
  assert.match(html, /точка 3 · нити/);
  assert.match(html, /УЧЕБНИК/);
  assert.match(html, /СПРАВОЧНИК/);
  // Нити выбранной точки получают номер рядом с цветом: цвет не единственный канал.
  assert.match(html, /mini-tag/);
});

test('мышью по полю не играют: ни одного обработчика', () => {
  const source = readFileSync(new URL('../app/client/ui/Untangle.tsx', import.meta.url), 'utf8');
  const mouse = /on(?:Click|DoubleClick|MouseDown|MouseUp|MouseMove|PointerDown|PointerUp|PointerMove|Drag\w*|Touch\w*)=/
    .exec(source);

  assert.equal(mouse, null, `обработчик мыши в мини-игре: ${mouse?.[0] ?? ''}`);
});
