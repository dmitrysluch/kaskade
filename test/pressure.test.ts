import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContentError, parseMarkdown } from '../app/server/content/markdown.ts';
import { RULES } from '../app/server/validate/index.ts';
import { enter } from '../app/client/engine/state.ts';
import { migrate } from '../app/client/engine/save.ts';
import { armPressure, pressureClock, roundHere, silence, silenceRoute, tickPressure } from '../app/client/engine/pressure.ts';
import { detailLines, timerGlyphs, timerSegs } from '../app/client/ui/lines.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Раунд «надавить» ([[07b-надавить-тз]]).
 *
 * Движок не знает, какая реплика сильная: он узнаёт раунд по помете, считает
 * активное время и исполняет авторскую ветку молчания. Проверяем ровно это —
 * и то, что перезагрузка не даёт новой полной попытки.
 */

const SCENE = 'episodes/p/scenes/press';
const ROOM = 'episodes/p/rooms-virt/tu.secretariat:03';

function save(patch: Partial<SaveState> = {}): SaveState {
  return {
    saveVersion: 13,
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
    resume: null,
    activeStage: '03',
    currentDate: '04.07.2025',
    lastTransitionId: null,
    activeRoom: null,
    openItem: null,
    roomStates: {},
    episodeState: { episode: 'p', at: `${ROOM}#`, used: [] },
    ...patch,
  };
}

/** Два раунда подряд, молчание в каждом и комната, из которой входят. */
function game(patch: { timeout?: number } = {}): GameContent {
  const { timeout = 9000 } = patch;
  return content({
    episodes: [episode('p', { entry: `${ROOM}#` })],
    docs: {
      [ROOM]: doc(ROOM, {
        type: 'room',
        label: 'секретариат',
        fm: { persistent: 'tu.secretariat', stage: '03' },
        nodes: [
          node(`${ROOM}#`, {
            text: 'Стойка.',
            options: [option({ label: 'надавить', target: `${SCENE}#первый`, moves: true, attrs: attrs({ advance: true }) })],
          }),
        ],
      }),
      [SCENE]: doc(SCENE, {
        type: 'scene',
        log: true,
        nodes: [
          node(`${SCENE}#первый`, {
            text: '> сотрудница — Проект закрыт. Позиций нет.',
            attrs: attrs({ tag: ['pressure'] }),
            options: [
              option({ label: 'позиций — или финансирования', target: `${SCENE}#второй` }),
              option({ label: 'я найду другой грант', target: `${SCENE}#обещать` }),
              option({ label: 'промолчать', target: `${SCENE}#закрыла`, attrs: attrs({ timeout }) }),
            ],
          }),
          node(`${SCENE}#второй`, {
            text: '> сотрудница — Финансирование не моё дело.',
            attrs: attrs({ tag: ['pressure'] }),
            options: [
              option({ label: 'чьё тогда', target: `${SCENE}#имя` }),
              option({ label: 'я подожду', target: `${SCENE}#закрыла` }),
              option({ label: 'промолчать', target: `${SCENE}#закрыла`, attrs: attrs({ timeout }) }),
            ],
          }),
          node(`${SCENE}#имя`, { text: 'Она называет фамилию.', options: [option({ label: '', target: `${ROOM}#` })] }),
          node(`${SCENE}#обещать`, { text: 'Она кивает.', options: [option({ label: '', target: `${ROOM}#` })] }),
          node(`${SCENE}#закрыла`, { text: 'Она закрывает папку.', options: [option({ label: '', target: `${ROOM}#` })] }),
        ],
      }),
    },
  });
}

test('`timeout: 9s` разбирается в миллисекунды, а мусор — в адресную ошибку', () => {
  const ok = parseMarkdown(
    'press.md',
    '---\nid: press\ntype: scene\n---\n## раунд\n- tag: pressure\n\nТекст.\n\n→ промолчать [[#тихо]]\n  - timeout: 9s\n',
  );
  assert.equal(ok.nodes[0]!.transitions[0]!.attrs.timeout, 9000);

  assert.throws(
    () => parseMarkdown('press.md', '---\nid: press\ntype: scene\n---\n→ молчать [[#т]]\n  - timeout: скоро\n'),
    (e: unknown) => e instanceof ContentError && /timeout пишется как/.test(e.message),
  );
  assert.throws(
    () => parseMarkdown('press.md', '---\nid: press\ntype: scene\n---\n→ молчать [[#т]]\n  - timeout: 0s\n'),
    (e: unknown) => e instanceof ContentError && /ноль секунд/.test(e.message),
  );
});

test('вход в раунд взводит таймер, а уход его закрывает', () => {
  const g = game();
  const inRound = enter(g, save(), `${SCENE}#первый`).save;

  assert.equal(roundHere(g, inRound)?.id, 'первый');
  assert.deepEqual(inRound.pressure, { node: `${SCENE}#первый`, remainingMs: 9000 });
  assert.deepEqual(pressureClock(g, inRound), { left: 9000, total: 9000 });

  // Ответ уводит в обычный узел: раунда больше нет, остатка тоже.
  const answered = enter(g, tickPressure(inRound, 4000), `${SCENE}#обещать`).save;
  assert.equal(answered.pressure, null);
  assert.equal(pressureClock(g, answered), null);
});

test('перезагрузка не даёт новой попытки: остаток тот же', () => {
  const g = game();
  const half = tickPressure(enter(g, save(), `${SCENE}#первый`).save, 5000);
  assert.equal(half.pressure?.remainingMs, 4000);

  // Тот же сейв, прочитанный заново, и повторный вход в тот же узел.
  const reloaded = JSON.parse(JSON.stringify(half)) as SaveState;
  assert.equal(armPressure(g, reloaded).pressure?.remainingMs, 4000);
  assert.equal(enter(g, reloaded, `${SCENE}#первый`).save.pressure?.remainingMs, 4000);
});

test('следующий раунд получает свой полный таймер', () => {
  const g = game();
  const next = enter(g, tickPressure(enter(g, save(), `${SCENE}#первый`).save, 7000), `${SCENE}#второй`).save;
  assert.deepEqual(next.pressure, { node: `${SCENE}#второй`, remainingMs: 9000 });
});

test('время вышло — исполняется ровно ветка молчания', () => {
  const g = game();
  const inRound = enter(g, save(), `${SCENE}#первый`).save;

  // Пока что-то осталось, маршрута нет — даже за полсекунды до нуля.
  assert.equal(silenceRoute(g, tickPressure(inRound, 8500)), null);

  const out = tickPressure(inRound, 9000);
  assert.equal(out.pressure?.remainingMs, 0);
  assert.equal(silenceRoute(g, out), `${SCENE}#закрыла`);

  // Молчание — обычная видимая опция: игрок вправе выбрать её сам.
  assert.equal(silence(g.nodes[`${SCENE}#первый`]!)?.label, 'промолчать');

  // Таймер принадлежит узлу: с другого места он ничего не исполняет.
  const elsewhere = { ...out, episodeState: { ...out.episodeState, at: `${ROOM}#` } };
  assert.equal(silenceRoute(g, elsewhere), null);
});

test('остаток ниже нуля не уходит, а прожитое считается только вперёд', () => {
  const g = game({ timeout: 5000 });
  const inRound = enter(g, save(), `${SCENE}#первый`).save;

  assert.equal(tickPressure(tickPressure(inRound, 4000), 4000).pressure?.remainingMs, 0);
  // Ноль уже вышел: дальше тикать нечего.
  assert.equal(tickPressure(tickPressure(inRound, 9000), 1000).pressure?.remainingMs, 0);
});

test('шкала убывает геометрически и называет секунды словом', () => {
  const glyphs = timerGlyphs('blocks');
  const full = timerSegs(9000, 9000, glyphs).map((s) => s.text).join('');
  const half = timerSegs(4500, 9000, glyphs).map((s) => s.text).join('');
  const last = timerSegs(400, 9000, glyphs).map((s) => s.text).join('');

  assert.equal(full.startsWith(glyphs.full.repeat(glyphs.width)), true);
  assert.match(full, /9 с$/);
  assert.equal((half.match(/▰/g) ?? []).length, glyphs.width / 2);
  assert.match(half, /5 с$/, 'секунды округляются вверх: ноль показывается только по истечении');
  // Пока осталось хоть что-то, видна хотя бы одна клетка.
  assert.equal((last.match(/▰/g) ?? []).length, 1);
  assert.equal((timerSegs(0, 9000, glyphs)[0]!.text.match(/▰/g) ?? []).length, 0);

  assert.throws(() => timerGlyphs('спираль'), /нет шкалы времени/);
});

test('шкала занимает вторую строку деталей, предпросмотр остаётся в первой', () => {
  const timer = { left: 6000, total: 9000, glyphs: timerGlyphs('blocks') };
  const lines = detailLines('— Позиций или финансирования?', false, null, timer, 60, 2);

  assert.equal(lines.length, 2, 'высота области не меняется');
  assert.match(lines[0]!.map((s) => s.text).join(''), /Марго: — Позиций/);
  assert.match(lines[1]!.map((s) => s.text).join(''), /▰.*6 с/);
  // В раунде нет `advance`: предупреждению в этой строке делать нечего.
  assert.equal(lines[1]!.some((s) => s.text.includes('нельзя вернуться')), false);
});

test('сейв 12 → 13: под таймером никто не стоял', () => {
  const { pressure: _, ...old } = { ...save(), saveVersion: 12 };
  const lifted = migrate(old as SaveState, 13);

  assert.equal(lifted?.pressure, null);
  assert.equal(lifted?.saveVersion, 13);
});

const run = (id: string, g: GameContent) => RULES.find((r) => r.id === id)!.run(g);

test('валидатор пропускает живое давление', () => {
  assert.deepEqual(run('pressure', game()), []);
});

test('валидатор: один таймер, видимая метка и выход из молчания', () => {
  const g = game();
  // Без спреда `...g`: иначе хелпер оставит прежнюю карту узлов.
  const two = content({
    episodes: g.episodes,
    docs: {
      ...g.docs,
      [SCENE]: doc(SCENE, {
        type: 'scene',
        nodes: [
          node(`${SCENE}#первый`, {
            attrs: attrs({ tag: ['pressure'] }),
            options: [
              option({ label: 'а', target: `${SCENE}#закрыла`, attrs: attrs({ timeout: 9000 }) }),
              option({ label: '', target: `${SCENE}#закрыла`, attrs: attrs({ timeout: 9000 }) }),
            ],
          }),
          node(`${SCENE}#закрыла`, { text: 'Конец разговора.' }),
        ],
      }),
    },
  });

  const found = run('pressure', two).map((f) => f.message);
  assert.ok(found.some((m) => /переходов с `timeout` 2/.test(m)), found.join(' | '));
  assert.ok(found.some((m) => /ответов кроме молчания 0/.test(m)), found.join(' | '));
  assert.ok(found.some((m) => /из молчания некуда идти/.test(m)), found.join(' | '));
  // Безымянное молчание — это ещё и автоматический маршрут: отсчёт решал бы
  // не игрок и не автор, а движок.
  assert.ok(found.some((m) => /автоматический маршрут/.test(m)), found.join(' | '));

  // Единственное молчание без метки: игрок не видит того, что может выбрать.
  const mute = content({
    episodes: g.episodes,
    docs: {
      ...g.docs,
      [SCENE]: doc(SCENE, {
        type: 'scene',
        nodes: [
          node(`${SCENE}#первый`, {
            attrs: attrs({ tag: ['pressure'] }),
            options: [
              option({ label: 'раз', target: `${SCENE}#закрыла` }),
              option({ label: 'два', target: `${SCENE}#закрыла` }),
              option({ label: '', target: `${SCENE}#закрыла`, attrs: attrs({ timeout: 9000 }) }),
            ],
          }),
          node(`${SCENE}#закрыла`, { text: 'Папка закрыта.', options: [option({ label: '', target: `${ROOM}#` })] }),
        ],
      }),
    },
  });
  assert.ok(run('pressure', mute).some((f) => /молчание без метки/.test(f.message)));
});

test('валидатор: внутри раунда нет условий, автоматики и чужих режимов', () => {
  const g = game();
  const wrong = content({
    episodes: g.episodes,
    docs: {
      ...g.docs,
      [SCENE]: doc(SCENE, {
        type: 'scene',
        nodes: [
          node(`${SCENE}#первый`, {
            attrs: attrs({ tag: ['pressure', 'montage'], wait: { id: 'пауза', ms: 1000 } }),
            options: [
              option({ label: 'сильный ответ', target: `${SCENE}#имя`, attrs: attrs({ if: 'word:word-ahlers' }) }),
              option({ label: 'необратимо', target: `${SCENE}#имя`, attrs: attrs({ advance: true }) }),
              option({ label: '', target: `${SCENE}#имя` }),
              option({ label: 'промолчать', target: `${SCENE}#имя`, attrs: attrs({ timeout: 9000 }) }),
            ],
          }),
          node(`${SCENE}#имя`, { text: 'Фамилия.', options: [option({ label: '', target: `${ROOM}#` })] }),
        ],
      }),
    },
  });

  const found = run('pressure', wrong).map((f) => f.message);
  assert.ok(found.some((m) => /`if`/.test(m)), found.join(' | '));
  assert.ok(found.some((m) => /`advance`/.test(m)), found.join(' | '));
  assert.ok(found.some((m) => /автоматический маршрут/.test(m)), found.join(' | '));
  assert.ok(found.some((m) => /`wait` в раунде/.test(m)), found.join(' | '));
  assert.ok(found.some((m) => /несовместим с `montage`/.test(m)), found.join(' | '));
});

test('валидатор: в середину давления снаружи не входят', () => {
  const g = game();
  const shortcut = content({
    episodes: g.episodes,
    docs: {
      ...g.docs,
      [ROOM]: doc(ROOM, {
        type: 'room',
        fm: { persistent: 'tu.secretariat', stage: '03' },
        nodes: [
          node(`${ROOM}#`, {
            options: [
              option({ label: 'надавить', target: `${SCENE}#первый`, moves: true }),
              option({ label: 'сразу про финансирование', target: `${SCENE}#второй`, moves: true }),
            ],
          }),
        ],
      }),
    },
  });

  const found = run('pressure', shortcut).map((f) => f.message);
  assert.ok(found.some((m) => /ссылка в середину давления/.test(m)), found.join(' | '));
  // Вход в первый раунд при этом остаётся законным.
  assert.equal(found.filter((m) => /ссылка в середину давления/.test(m)).length, 1);
});

test('валидатор: интервал вне 5–20 секунд и пятый раунд — предупреждения', () => {
  assert.ok(run('pressure', game({ timeout: 2000 })).some((f) => /вне разумного интервала/.test(f.message)));
  assert.ok(run('pressure', game({ timeout: 30000 })).some((f) => /вне разумного интервала/.test(f.message)));

  const g = game();
  const long = content({
    episodes: g.episodes,
    docs: {
      ...g.docs,
      [SCENE]: doc(SCENE, {
        type: 'scene',
        nodes: [
          ...[1, 2, 3, 4, 5].map((i) =>
            node(`${SCENE}#раунд-${i}`, {
              attrs: attrs({ tag: ['pressure'] }),
              options: [
                option({ label: `ответ ${i}`, target: `${SCENE}#конец` }),
                option({ label: `ещё ${i}`, target: `${SCENE}#конец` }),
                option({ label: 'промолчать', target: `${SCENE}#конец`, attrs: attrs({ timeout: 9000 }) }),
              ],
            }),
          ),
          node(`${SCENE}#конец`, { text: 'Разговор кончился.', options: [option({ label: '', target: `${ROOM}#` })] }),
        ],
      }),
    },
  });

  assert.ok(run('pressure', long).some((f) => /5 раундов давления/.test(f.message)));
});
