import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown } from '../app/server/content/markdown.ts';
import { docGenerators } from '../app/server/content/options.ts';
import { buildCatalog } from '../app/client/engine/catalog.ts';
import { enter, openScreen, openWindow } from '../app/client/engine/state.ts';
import { RULES } from '../app/server/validate/index.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';
import type { GameContent, SaveState } from '../app/shared/types.ts';

/**
 * Вложенные предметы (07-оболочка-тз, «Вложенные предметы — контейнер и его окна»).
 *
 * Компьютер с окнами — не многостраничный предмет: окна доступны одновременно,
 * их набор растёт по флагам, а переключение между ними не листание. Проверяем то,
 * что руками ловится плохо: что список окон живой, что открытое окно переживает
 * уход и перезагрузку и что комната всё это время ждёт снаружи.
 */

const R = 'episodes/p/rooms/r';
const PC = 'episodes/p/items/00-computer';
const THESIS = 'episodes/p/items/00-thesis';
const CALC = 'episodes/p/items/00-calc';
const MAIL = 'episodes/p/items/00-mail';

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
    episodeState: { episode: 'p', at: `${R}#`, used: [] },
    ...patch,
  };
}

/** Команда «осмотреть окно» — ровно то, что собрал бы генератор `осмотреть: items`. */
function window(target: string, label: string, object: string) {
  return option({ label, kind: 'environment', target, verb: 'осмотреть', object, moves: false });
}

/**
 * Комната с компьютером. У компьютера три окна: диссертация, расчёт с двумя
 * страницами и письмо, которое приходит по флагу.
 */
function game(): GameContent {
  const pc = doc(PC, {
    type: 'item',
    label: 'компьютер',
    target: 'компьютер',
    items: ['00-thesis', '00-calc', '00-mail'],
    nodes: [
      node(`${PC}#`, { text: 'Старый HP ProBook.' }),
      node(`${PC}#осмотреть`, {
        text: 'На экране открыты окна.',
        options: [
          window(`${THESIS}#осмотреть`, 'осмотреть thesis.tex', THESIS),
          window(`${CALC}#шапка`, 'осмотреть расчёт', CALC),
          window(`${MAIL}#осмотреть`, 'осмотреть письмо', MAIL),
        ],
      }),
    ],
  });

  const thesis = doc(THESIS, {
    type: 'item',
    label: 'thesis.tex',
    target: 'thesis.tex',
    parent: PC,
    nodes: [node(`${THESIS}#осмотреть`, { text: 'Оборванная фраза.' })],
  });

  const calc = doc(CALC, {
    type: 'item',
    label: 'расчёт',
    target: 'расчёт',
    parent: PC,
    pages: ['шапка', 'числа'],
    nodes: [
      node(`${CALC}#шапка`, { text: 'Редкие переходы.', attrs: attrs({ page: 1 }) }),
      node(`${CALC}#числа`, { text: 'Последние числа не проверены.', attrs: attrs({ page: 2 }) }),
      node(`${CALC}#скопировать`, { text: 'Скопировала.', attrs: attrs({ set: ['prolog.copied'] }) }),
    ],
  });

  const mail = doc(MAIL, {
    type: 'item',
    label: 'письмо',
    target: 'письмо',
    parent: PC,
    nodes: [node(`${MAIL}#осмотреть`, { text: 'Тема: приглашение.', attrs: attrs({ if: 'prolog.mail' }) })],
  });

  return content({
    episodes: [episode('p', { entry: `${R}#`, verbs: ['осмотреть'], itemVerbs: ['скопировать'] })],
    docs: {
      [R]: doc(R, {
        type: 'room',
        label: 'комната',
        items: ['00-computer'],
        nodes: [
          node(`${R}#`, {
            text: 'Общага.',
            options: [window(`${PC}#осмотреть`, 'осмотреть компьютер', PC)],
          }),
        ],
      }),
      [PC]: pc,
      [THESIS]: thesis,
      [CALC]: calc,
      [MAIL]: mail,
    },
  });
}

const labels = (g: GameContent, s: SaveState) =>
  buildCatalog(g, s).filter((o) => !o.system).map((o) => o.label);

test('предмет со вложенными получает генератор окон без всякого блока options', () => {
  const pc = parseMarkdown(
    'computer.md',
    '---\nid: 00-computer\ntype: item\nitems: [00-thesis]\n---\nHP ProBook.\n\n## осмотреть\n\nДва окна.\n',
  );

  assert.deepEqual(
    docGenerators(pc, [], ['00-thesis']).map((g) => `${g.phrase}: ${String(g.source)}`),
    ['осмотреть: items'],
  );
});

test('открытый контейнер показывает свои окна, а комната ждёт снаружи', () => {
  const g = game();
  const open = save({ openItem: PC });

  // Окно с `if` ещё не пришло; «осмотреть компьютер» из комнаты в список
  // не попадает — игрок уже внутри.
  assert.deepEqual(labels(g, open), ['осмотреть thesis.tex', 'осмотреть расчёт', 'закрыть компьютер']);
});

test('окно с условием появляется по флагу прямо во время сцены', () => {
  const g = game();
  const open = save({ openItem: PC, flags: { 'prolog.mail': { value: true, at: null } } });

  assert.ok(labels(g, open).includes('осмотреть письмо'));
});

test('открытое окно запоминается: возврат к компьютеру показывает его же', () => {
  const g = game();
  const opened = enter(g, save({ openItem: PC }), `${THESIS}#осмотреть`, false).save;

  assert.equal(opened.itemStates['00-computer'], '00-thesis');
  assert.equal(openWindow(g, opened, g.docs[PC]!)?.docId, THESIS);
  // Игрок всё это время стоит в комнате: контейнер — не место.
  assert.equal(opened.episodeState.at, `${R}#`);
});

test('собственные действия показываются у открытого окна, а не у всех сразу', () => {
  const g = game();
  const onThesis = enter(g, save({ openItem: PC }), `${THESIS}#осмотреть`, false).save;
  assert.equal(labels(g, onThesis).includes('скопировать расчёт'), false);

  const onCalc = enter(g, save({ openItem: PC }), `${CALC}#шапка`, false).save;
  const here = labels(g, onCalc);
  assert.ok(here.includes('скопировать расчёт'), here.join(' · '));
  // Страницы окна листаются как у любого предмета, а список окон никуда не делся.
  assert.ok(here.includes('вперёд'));
  assert.ok(here.includes('осмотреть thesis.tex'));
});

test('перезагрузка на открытом окне возвращает окно, а не описание комнаты', () => {
  const g = game();
  const onCalc = enter(g, save({ openItem: PC }), `${CALC}#числа`, false).save;

  assert.equal(openScreen(g, onCalc)?.addr, `${CALC}#числа`);

  // Контейнер без выбранного окна показывает себя.
  assert.equal(openScreen(g, save({ openItem: PC }))?.addr, `${PC}#осмотреть`);
  // Уровня нет — показывать открытым нечего, экран принадлежит комнате.
  assert.equal(openScreen(g, save()), null);
});

function run(id: string, game: GameContent) {
  return RULES.find((r) => r.id === id)!.run(game);
}

test('валидатор: окна и страницы в одном предмете — два ответа на один вопрос', () => {
  const g = game();
  const both = content({
    docs: { [PC]: doc(PC, { type: 'item', items: ['00-thesis'], pages: ['одна'] }) },
  });

  assert.equal(run('nested', g).length, 0);
  assert.match(run('nested', both)[0]!.message, /и окна.*и страницы/);
});

test('валидатор: вложенность глубже одного уровня и окно, которое не открыть', () => {
  const deep = content({
    docs: {
      [PC]: doc(PC, { type: 'item', items: ['00-thesis'] }),
      [THESIS]: doc(THESIS, { type: 'item', parent: PC, items: ['00-calc'], nodes: [node(`${THESIS}#осмотреть`)] }),
      [CALC]: doc(CALC, { type: 'item', parent: THESIS, nodes: [node(`${CALC}#`)] }),
    },
  });

  const found = run('nested', deep).map((f) => f.message);
  assert.equal(found.filter((m) => /глубже одного уровня/.test(m)).length, 1);
  assert.equal(found.filter((m) => /нельзя открыть/.test(m)).length, 1);
});

test('валидатор: окно, лежащее ещё и в комнате, принадлежит двум местам', () => {
  const g = game();
  const shared = content({
    ...g,
    docs: { ...g.docs, [R]: doc(R, { type: 'room', items: ['00-computer', '00-thesis'] }) },
  });

  assert.match(run('nested', shared)[0]!.message, /перечислен ещё и здесь/);
});
