import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enter, evalCondition, waitOver, waitRoute } from '../app/client/engine/state.ts';
import { parseMarkdown, ContentError } from '../app/server/content/markdown.ts';
import { RULES } from '../app/server/validate/index.ts';
import { migrate } from '../app/client/engine/save.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { SaveState } from '../app/shared/types.ts';

/**
 * Физическое ожидание (07-оболочка-тз, «Физическое ожидание»).
 *
 * Проверяем не секунды — их отсчитывает оболочка по настоящим часам, — а всё
 * остальное: держится ли маршрут, переживает ли ожидание уход в дочерний узел
 * и читаются ли условия часов. Ошибка здесь выглядит как зависшая игра, и своими
 * глазами её ловить дорого.
 */

const S = 'episodes/p/scenes/s';

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
    episodeState: { episode: 'p', at: `${S}#`, used: [] },
    ...patch,
  };
}

/** Сцена ожидания: часы под рукой, результат за девяносто секунд. */
function game() {
  const waiting = node(`${S}#экспертиза`, {
    attrs: attrs({ wait: { id: 'lab', ms: 90_000 } }),
    text: 'Дверь закрывается.',
    options: [
      option({ label: 'посмотреть на часы', target: `${S}#часы`, moves: true }),
      option({ label: '', target: `${S}#результат`, moves: true }),
    ],
  });
  const clock = node(`${S}#часы`, {
    text: '07:14.',
    options: [option({ label: '', target: `${S}#экспертиза`, moves: true })],
  });
  const done = node(`${S}#результат`, { text: 'Эксперт выходит с папкой.' });
  return content({
    episodes: [episode('p', { entry: `${S}#` })],
    docs: { [S]: doc(S, { nodes: [waiting, clock, done] }) },
  });
}

test('wait в разметке: имя и секунды', () => {
  const parsed = parseMarkdown(
    '/c/s.md',
    `---\nid: s\ntype: scene\n---\n\n## экспертиза\n- wait: lab-result 90s\n\nДверь закрывается.\n\n→ [[#дальше]]\n`,
  );
  assert.deepEqual(parsed.nodes[0]!.attrs.wait, { id: 'lab-result', ms: 90_000 });
});

test('wait без секунд — ошибка разбора, а не молчание', () => {
  assert.throws(
    () => parseMarkdown('/c/s.md', `---\nid: s\ntype: scene\n---\n\n## э\n- wait: lab-result\n\nТекст.\n`),
    ContentError,
  );
});

test('ожидание держит безымянный маршрут и заводится при входе', () => {
  const r = enter(game(), save(), `${S}#экспертиза`);
  // Проход остановился в узле ожидания: результат ещё не показан.
  assert.equal(r.save.episodeState.at, `${S}#экспертиза`);
  assert.deepEqual(r.entries.map((e) => e.text), ['Дверь закрывается.']);
  assert.deepEqual(r.save.wait, { node: `${S}#экспертиза`, id: 'lab', ms: 90_000, elapsed: 0 });
});

test('возврат из дочернего узла не начинает ожидание заново', () => {
  const g = game();
  const started = enter(g, save(), `${S}#экспертиза`).save;
  const lived = { ...started, wait: { ...started.wait!, elapsed: 40_000 } };

  // «посмотреть на часы» и обратно: сорок прожитых секунд остаются прожитыми.
  const clock = enter(g, lived, `${S}#часы`);
  assert.equal(clock.save.wait!.elapsed, 40_000);
  assert.equal(clock.save.episodeState.at, `${S}#экспертиза`, 'часы уводят маршрутом назад в ожидание');
  assert.equal(clock.save.wait!.elapsed, 40_000);
});

test('время вышло — маршрут отдаётся, и только на месте', () => {
  const g = game();
  const started = enter(g, save(), `${S}#экспертиза`).save;

  assert.equal(waitRoute(g, started), null, 'пока не прожито — никуда');

  const over = { ...started, wait: { ...started.wait!, elapsed: 90_000 } };
  assert.equal(waitOver(over, `${S}#экспертиза`), true);
  assert.equal(waitRoute(g, over), `${S}#результат`);

  // Игрок ушёл смотреть на часы: печать дочернего узла маршрут не перебивает.
  const away = { ...over, episodeState: { ...over.episodeState, at: `${S}#часы` } };
  assert.equal(waitRoute(g, away), null);
});

test('прожитое ожидание уводит маршрутом, который до того держался', () => {
  const g = game();
  const over = (() => {
    const s = enter(g, save(), `${S}#экспертиза`).save;
    return { ...s, wait: { ...s.wait!, elapsed: 90_000 } };
  })();
  const r = enter(g, over, waitRoute(g, over)!);
  assert.equal(r.save.episodeState.at, `${S}#результат`);
});

test('условия часов: два состояния и ничего больше', () => {
  const s = save({ wait: { node: `${S}#экспертиза`, id: 'lab', ms: 90_000, elapsed: 40_000 } });
  assert.equal(evalCondition('wait.lab < 60s', s), true);
  assert.equal(evalCondition('wait.lab >= 60s', s), false);

  const later = { ...s, wait: { ...s.wait!, elapsed: 75_000 } };
  assert.equal(evalCondition('wait.lab < 60s', later), false);
  assert.equal(evalCondition('wait.lab >= 60s', later), true);

  // Чужое и отсутствующее ожидание — не «ещё не прожито», а вопрос не о том.
  assert.equal(evalCondition('wait.other < 60s', s), false);
  assert.equal(evalCondition('wait.lab < 60s', save()), false);
});

function run(game: Parameters<(typeof RULES)[number]['run']>[0]) {
  return RULES.find((r) => r.id === 'wait')!.run(game);
}

test('валидатор: живая сцена ожидания проходит', () => {
  assert.deepEqual(run(game()), []);
});

test('валидатор: ожидание, в котором нечего делать', () => {
  const waiting = node(`${S}#э`, {
    attrs: attrs({ wait: { id: 'lab', ms: 90_000 } }),
    options: [option({ label: '', target: `${S}#дальше` })],
  });
  const found = run(content({ episodes: [episode('p')], docs: { [S]: doc(S, { nodes: [waiting] }) } }));
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /нечего делать/);
});

test('валидатор: ожидание без безымянного маршрута никуда не ведёт', () => {
  const waiting = node(`${S}#э`, {
    attrs: attrs({ wait: { id: 'lab', ms: 90_000 } }),
    options: [option({ label: 'посмотреть на часы', target: `${S}#часы` })],
  });
  const found = run(content({ episodes: [episode('p')], docs: { [S]: doc(S, { nodes: [waiting] }) } }));
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /вести игрока некуда/);
});

test('валидатор: ожидание на предмете и на полноэкранном узле', () => {
  const item = node('items/книга#э', {
    attrs: attrs({ wait: { id: 'lab', ms: 90_000 }, tag: ['montage'] }),
    options: [option({ label: 'ждать', target: 'items/книга#x' }), option({ label: '', target: 'items/книга#x' })],
  });
  const found = run(
    content({ episodes: [episode('p')], docs: { 'items/книга': doc('items/книга', { type: 'item', nodes: [item] }) } }),
  );
  assert.equal(found.length, 2);
  assert.match(found.map((f) => f.message).join(' '), /только в сцене/);
  assert.match(found.map((f) => f.message).join(' '), /полноэкранном/);
});

test('валидатор: второе ожидание из первого', () => {
  const first = node(`${S}#э`, {
    attrs: attrs({ wait: { id: 'lab', ms: 90_000 } }),
    options: [
      option({ label: 'дальше', target: `${S}#ещё` }),
      option({ label: '', target: `${S}#ещё` }),
    ],
  });
  const second = node(`${S}#ещё`, {
    attrs: attrs({ wait: { id: 'other', ms: 30_000 } }),
    options: [option({ label: 'ждать', target: `${S}#к` }), option({ label: '', target: `${S}#к` })],
  });
  const found = run(content({ episodes: [episode('p')], docs: { [S]: doc(S, { nodes: [first, second] }) } }));
  assert.equal(found.filter((f) => /активное бывает одно/.test(f.message)).length, 2);
});

test('валидатор: условие ссылается на ожидание, которого нет', () => {
  const waiting = node(`${S}#э`, {
    attrs: attrs({ wait: { id: 'lab', ms: 90_000 } }),
    options: [
      option({ label: 'часы', target: `${S}#часы`, attrs: attrs({ if: 'wait.labresult < 60s' }) }),
      option({ label: '', target: `${S}#к` }),
    ],
  });
  const found = run(content({ episodes: [episode('p')], docs: { [S]: doc(S, { nodes: [waiting] }) } }));
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /такого ожидания нет/);
});

test('сейв 7 → 8: старый никого не ждёт', () => {
  // У сейва седьмой версии поля `wait` нет вовсе — механики не существовало.
  const { wait: _, ...old } = save({ saveVersion: 7 });
  const migrated = migrate(old as SaveState, 8);
  assert.equal(migrated!.wait, null);
});
