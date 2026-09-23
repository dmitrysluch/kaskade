import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, validate } from '../app/server/validate/index.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';

/**
 * Правила дизайна как автотесты. Каждое правило проверяется на минимальном контенте:
 * важно не «есть ли ошибка вообще», а ловит ли конкретное правило свой конкретный случай.
 */

function run(ruleId: string, game: Parameters<typeof validate>[0]) {
  const rule = RULES.find((r) => r.id === ruleId)!;
  return rule.run(game);
}

test('узел без входа находится', () => {
  const start = node('episodes/p/scenes/start#', { options: [option({ label: 'дальше', target: 'episodes/p/scenes/start#конец' })] });
  const orphan = node('episodes/p/scenes/start#брошенный', { options: [option({ label: 'x', target: 'episodes/p/scenes/start#конец' })] });
  const end = node('episodes/p/scenes/start#конец');

  const game = content({
    episodes: [episode('p')],
    docs: { 'episodes/p/scenes/start': doc('episodes/p/scenes/start', { nodes: [start, orphan, end] }) },
  });

  const found = run('graph', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /нет ни одного входа/);
});

test('узел без выхода находится, а «конец» — законный тупик', () => {
  const start = node('episodes/p/scenes/start#', { options: [option({ label: 'дальше', target: 'episodes/p/scenes/start#тупик' })] });
  const dead = node('episodes/p/scenes/start#тупик');

  const game = content({
    episodes: [episode('p')],
    docs: { 'episodes/p/scenes/start': doc('episodes/p/scenes/start', { nodes: [start, dead] }) },
  });

  const found = run('graph', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /некуда идти/);
});

test('документ длиннее бюджета находится', () => {
  const long = node('docs/x#', { text: 'а'.repeat(201) });
  const game = content({
    docs: { 'docs/x': doc('docs/x', { type: 'doc', nodes: [long] }) },
  });

  const found = run('doc-budget', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /201 знаков/);
});

test('глагол из генератора должен быть объявлен в verbs', () => {
  const room = node('episodes/p/rooms/r#', {
    options: [option({ label: 'осмотреть доска', verb: 'осмотреть', target: 'episodes/p/items/д#осмотреть' })],
  });
  const game = content({
    episodes: [episode('p', { verbs: ['идти'] })],
    docs: { 'episodes/p/rooms/r': doc('episodes/p/rooms/r', { type: 'room', nodes: [room], exits: ['x'] }) },
  });

  const found = run('verbs', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /"осмотреть" не объявлен в verbs/);
});

test('незаявленный глагол предмета — предупреждение, а не запрет', () => {
  // Реестр глаголов остался подсказкой автору ([[99-открытые-вопросы]], «Глаголы
  // и состояния предметов»): доступность команды решает секция предмета, а не
  // список инфинитивов в episode.yaml — он всё равно не склоняет цель.
  const item = doc('episodes/p/items/телефон', {
    type: 'item',
    nodes: [node('episodes/p/items/телефон#'), node('episodes/p/items/телефон#позвонить')],
  });
  const game = content({ episodes: [episode('p', { verbs: [], itemVerbs: [] })], docs: { [item.docId]: item } });

  const found = run('verbs', game);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, 'warn');
  assert.match(found[0]!.message, /ни в verbs, ни в itemVerbs/);
});

test('inHand больше не читается, и валидатор предлагает его убрать', () => {
  const item = doc('episodes/p/items/телефон', {
    type: 'item',
    nodes: [node('episodes/p/items/телефон#'), node('episodes/p/items/телефон#позвонить')],
    inHand: ['позвонить', 'разбить'],
  });
  const game = content({ episodes: [episode('p', { itemVerbs: ['позвонить'] })], docs: { [item.docId]: item } });

  const found = run('verbs', game);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, 'warn');
  assert.match(found[0]!.message, /inHand больше не читается/);
});

test('предмет без единого глагола находится', () => {
  const item = doc('episodes/p/items/камень', { type: 'item', nodes: [node('episodes/p/items/камень#')] });
  const game = content({ docs: { [item.docId]: item } });

  const found = run('generators', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /без единого узла-глагола/);
});

test('упомянутое слово без карточки находится', () => {
  const n = node('episodes/p/scenes/s#', { attrs: attrs({ give: ['becker'] }) });
  const game = content({ docs: { 'episodes/p/scenes/s': doc('episodes/p/scenes/s', { nodes: [n] }) } });

  const found = run('word-card', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /нет ни карточки words\/becker\.md/);
});

test('блок options, продублированный по узлам, находится', () => {
  const room = doc('episodes/p/rooms/r', {
    type: 'room',
    exits: ['x'],
    nodes: [node('episodes/p/rooms/r#'), node('episodes/p/rooms/r#осмотреться')],
    optionBlocks: [11, 26],
  });
  const game = content({ episodes: [episode('p')], docs: { [room.docId]: room } });

  const found = run('options-scope', game);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.line, 26);
  assert.match(found[0]!.message, /свойство комнаты/);
});

test('подстановка несуществующего флага находится', () => {
  const withFlag = node('episodes/p/scenes/s#', { attrs: attrs({ set: ['prolog.phoned'] }) });
  const uses = node('episodes/p/scenes/s#записка', { text: 'На бумажке дата: {{prolog.phoned.at}}' });
  const broken = node('episodes/p/scenes/s#вторая', { text: 'А тут {{prolog.никогда.at}}' });

  const game = content({
    docs: { 'episodes/p/scenes/s': doc('episodes/p/scenes/s', { nodes: [withFlag, uses, broken] }) },
  });

  const found = run('interpolation', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /prolog\.никогда/);
});

test('диалог, вываливающийся блоком, находится', () => {
  const chain = ['а', 'б', 'в', 'г'].map((id, i, all) =>
    node(`episodes/p/scenes/s#${id}`, {
      text: 'реплика',
      options: all[i + 1]
        ? [option({ label: '', target: `episodes/p/scenes/s#${all[i + 1]}` })]
        : [option({ label: 'ответить', target: 'episodes/p/scenes/s#а' })],
    }),
  );
  const game = content({
    docs: { 'episodes/p/scenes/s': doc('episodes/p/scenes/s', { nodes: chain }) },
  });

  const found = run('dialogue', game);
  assert.ok(found.length > 0);
  assert.equal(found[0]!.severity, 'warn');
  assert.match(found[0]!.message, /без хода игрока/);

  // Две реплики подряд — это норма, а не находка.
  const short = content({
    docs: {
      'episodes/p/scenes/s': doc('episodes/p/scenes/s', {
        nodes: [
          node('episodes/p/scenes/s#а', {
            text: 'раз',
            options: [option({ label: '', target: 'episodes/p/scenes/s#б' })],
          }),
          node('episodes/p/scenes/s#б', {
            text: 'два',
            options: [option({ label: 'ответить', target: 'episodes/p/scenes/s#а' })],
          }),
        ],
      }),
    },
  });
  assert.deepEqual(run('dialogue', short), []);
});

test('сплэши: один человек — один раз, кроме Марго', () => {
  const face = { grid: ['oo', 'oo'], colors: {}, width: 2, height: 2 };
  const scene = (id: string, who: string) =>
    doc(`episodes/p/scenes/${id}`, {
      nodes: [node(`episodes/p/scenes/${id}#`, { attrs: attrs({ tag: [`splash:${who}`] }) })],
    });

  const game = content({
    episodes: [episode('p')],
    characters: {
      margo: { id: 'margo', label: 'Марго', portraits: { p: face } },
      toby: { id: 'toby', label: 'Тоби', portraits: { p: face } },
    },
    docs: {
      'episodes/p/scenes/a': scene('a', 'toby'),
      'episodes/p/scenes/b': scene('b', 'toby'),
      'episodes/p/scenes/c': scene('c', 'margo'),
      'episodes/p/scenes/d': scene('d', 'margo'),
    },
  });

  const found = run('splash', game);
  assert.equal(found.length, 1, 'должен ругаться ровно на Тоби');
  assert.match(found[0]!.message, /"toby" встречается 2 раза/);
});

test('сплэш, который не влезает в кадр, находится при загрузке', () => {
  const huge = { grid: Array.from({ length: 60 }, () => 'o'.repeat(200)), colors: {}, width: 200, height: 60 };
  const game = content({
    episodes: [episode('p')],
    renderers: {
      academic: {
        id: 'academic',
        palette: { bg: '#000', fg: '#fff', dim: '#888', accent: '#0f0' },
        frame: 'light',
        rule: 'light',
        font: { family: 'mono', size: 16, rows: 34, line: 1 },
        effects: [],
        ambience: null,
        keyboard: null,
      },
    },
    characters: { margo: { id: 'margo', label: 'Марго', portraits: { p: huge } } },
    docs: {
      'episodes/p/scenes/a': doc('episodes/p/scenes/a', {
        nodes: [node('episodes/p/scenes/a#', { attrs: attrs({ tag: ['splash:margo'] }) })],
      }),
    },
  });

  const found = run('splash', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /не влезает в кадр/);
});

test('ненарисованное лицо — предупреждение, а не ошибка: текст пишется раньше арта', () => {
  const game = content({
    episodes: [episode('p')],
    docs: {
      'episodes/p/scenes/a': doc('episodes/p/scenes/a', {
        nodes: [node('episodes/p/scenes/a#', { attrs: attrs({ tag: ['splash:toby'] }) })],
      }),
    },
  });

  const found = run('splash', game);
  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, 'warn');
  assert.match(found[0]!.message, /будет пропущен/);
});

test('эпизод, не отдавший своего слова, находится — но пока слов нет, правило молчит', () => {
  const empty = content({ episodes: [episode('p')] });
  assert.deepEqual(run('episode-contract', empty), []);

  const shared = node('episodes/p/scenes/s#', { attrs: attrs({ give: ['becker'] }) });
  const own = node('episodes/q/scenes/s#', { attrs: attrs({ give: ['becker', 'kaskade'] }) });
  const game = content({
    episodes: [episode('p'), episode('q')],
    words: {
      becker: { id: 'becker', label: 'БЕККЕР', category: 'люди', text: '' },
      kaskade: { id: 'kaskade', label: 'KASKADE', category: 'обозначения', text: '' },
    },
    docs: {
      'episodes/p/scenes/s': doc('episodes/p/scenes/s', { nodes: [shared] }),
      'episodes/q/scenes/s': doc('episodes/q/scenes/s', { nodes: [own] }),
    },
  });

  const found = run('episode-contract', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /эпизод "p"/);
});

test('безусловный маршрут не последний — всё, что ниже, недостижимо', () => {
  const S = 'episodes/p/scenes/s';
  const game = content({
    docs: {
      [S]: doc(S, {
        nodes: [
          node(`${S}#`, {
            options: [option({ label: '', target: `${S}#а` }), option({ label: '', target: `${S}#б` })],
          }),
          node(`${S}#а`, { text: 'а' }),
          node(`${S}#б`, { text: 'б' }),
        ],
      }),
    },
  });

  const found = run('routes', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /недостижимо/);

  // Условие на цели прячет её и делает маршрут проваливающимся — это законно.
  const guarded = content({
    docs: {
      [S]: doc(S, {
        nodes: [
          node(`${S}#`, {
            options: [option({ label: '', target: `${S}#а` }), option({ label: '', target: `${S}#б` })],
          }),
          node(`${S}#а`, { text: 'а', attrs: attrs({ if: 'p.был' }) }),
          node(`${S}#б`, { text: 'б' }),
        ],
      }),
    },
  });
  assert.deepEqual(run('routes', guarded), []);
});

test('все опции под условиями и ни одного маршрута — тупик при неудачных флагах', () => {
  const S = 'episodes/p/scenes/s';
  const dead = content({
    docs: {
      [S]: doc(S, {
        nodes: [
          node(`${S}#`, {
            options: [
              option({ label: 'раз', target: `${S}#а`, attrs: attrs({ if: 'p.один' }) }),
              option({ label: 'два', target: `${S}#а`, attrs: attrs({ if: 'p.два' }) }),
            ],
          }),
          node(`${S}#а`, { text: 'а' }),
        ],
      }),
    },
  });
  assert.match(run('routes', dead)[0]!.message, /встанет намертво/);

  // `x` и `!x` покрывают всё: это одна опция, у которой меняется формулировка.
  const total = content({
    docs: {
      [S]: doc(S, {
        nodes: [
          node(`${S}#`, {
            options: [
              option({ label: 'раз', target: `${S}#а`, attrs: attrs({ if: 'p.один' }) }),
              option({ label: 'два', target: `${S}#а`, attrs: attrs({ if: '!p.один' }) }),
            ],
          }),
          node(`${S}#а`, { text: 'а' }),
        ],
      }),
    },
  });
  assert.deepEqual(run('routes', total), []);
});

test('два маршрута с одним условием: второй недостижим', () => {
  const S = 'episodes/p/scenes/s';
  const game = content({
    docs: {
      [S]: doc(S, {
        nodes: [
          node(`${S}#`, {
            options: [
              option({ label: '', target: `${S}#а`, attrs: attrs({ if: 'p.был' }) }),
              option({ label: '', target: `${S}#б`, attrs: attrs({ if: 'p.был' }) }),
              option({ label: '', target: `${S}#в` }),
            ],
          }),
          node(`${S}#а`, { text: 'а' }),
          node(`${S}#б`, { text: 'б' }),
          node(`${S}#в`, { text: 'в' }),
        ],
      }),
    },
  });

  const found = run('routes', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /одно и то же условие/);
});

test('условие и на переходе, и на цели — сказано дважды', () => {
  const S = 'episodes/p/scenes/s';
  const game = content({
    docs: {
      [S]: doc(S, {
        nodes: [
          node(`${S}#`, {
            options: [option({ label: 'дальше', target: `${S}#а`, attrs: attrs({ if: 'p.был' }) })],
          }),
          node(`${S}#а`, { text: 'а', attrs: attrs({ if: 'p.был' }) }),
        ],
      }),
    },
  });

  // Узел заодно тупиковый — правило про это тоже сработает; ищем своё.
  assert.ok(run('routes', game).some((f) => /сказано дважды/.test(f.message)));
});

test('сцена без date: находится — дату нельзя унаследовать у предыдущей заметки', () => {
  const game = content({
    episodes: [episode('p')],
    docs: {
      'episodes/p/scenes/s': doc('episodes/p/scenes/s', { nodes: [node('episodes/p/scenes/s#')] }),
      // У слова даты нет и не должно быть: оно не место.
      'words/w': doc('words/w', { type: 'word', nodes: [node('words/w#')] }),
    },
  });

  const found = run('dates', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /нет date:/);
});

test('дата в чужом формате находится при загрузке', () => {
  const game = content({
    episodes: [episode('p')],
    docs: {
      'episodes/p/scenes/s': doc('episodes/p/scenes/s', { date: '2026-05-12', nodes: [node('episodes/p/scenes/s#')] }),
    },
  });

  assert.match(run('dates', game)[0]!.message, /не разбирается/);
});

test('дата, уехавшая назад по ходу пролога, находится', () => {
  const game = content({
    episodes: [episode('p')],
    docs: {
      'episodes/p/scenes/01-a': doc('episodes/p/scenes/01-a', { date: '14.10.2024', nodes: [node('episodes/p/scenes/01-a#')] }),
      'episodes/p/rooms/01-r': doc('episodes/p/rooms/01-r', { type: 'room', date: '14.10.2024', nodes: [node('episodes/p/rooms/01-r#')] }),
      'episodes/p/scenes/02-b': doc('episodes/p/scenes/02-b', { date: '01.01.2024', nodes: [node('episodes/p/scenes/02-b#')] }),
    },
  });

  const found = run('dates', game);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /поехала назад/);
  assert.match(found[0]!.file, /02-b/);
});

test('срок, не объявленный в эпизоде, находится', () => {
  const game = content({
    episodes: [episode('p', { dates: { blueCard: { label: 'BLUE CARD', at: null, expired: 'истекла' } } })],
    docs: {
      'episodes/p/scenes/s': doc('episodes/p/scenes/s', {
        date: '12.05.2026',
        nodes: [
          node('episodes/p/scenes/s#', { attrs: attrs({ dates: { blueCard: '31.12.2026' } }) }),
          node('episodes/p/scenes/s#б', { attrs: attrs({ dates: { hearing: '03.03.2027' } }) }),
          node('episodes/p/scenes/s#в', { attrs: attrs({ dates: { blueCard: 'скоро' } }) }),
        ],
      }),
    },
  });

  const found = run('dates', game);
  assert.equal(found.length, 2);
  assert.match(found[0]!.message, /"hearing" не объявлен/);
  assert.match(found[1]!.message, /не разбирается как дата/);
});

test('advance принадлежит только вводимой сюжетной опции', () => {
  const S = 'episodes/p/scenes/s';
  const game = content({
    docs: {
      [S]: doc(S, {
        date: '12.05.2026',
        nodes: [
          node(`${S}#`, {
            options: [
              option({ label: '', target: `${S}#а`, attrs: attrs({ advance: true }) }),
              option({
                label: 'осмотреть доску',
                kind: 'environment',
                verb: 'осмотреть',
                target: `${S}#а`,
                attrs: attrs({ advance: true }),
              }),
              option({ label: 'уйти', target: `${S}#а`, attrs: attrs({ advance: true }) }),
            ],
          }),
          node(`${S}#а`, { text: 'а' }),
        ],
      }),
    },
  });

  const found = run('routes', game).filter((f) => /advance/.test(f.message));
  assert.equal(found.length, 2);
  assert.match(found[0]!.message, /на маршруте без метки/);
  assert.match(found[1]!.message, /категории "environment"/);
});

test('выход из хаба, закрывающий темы, просит advance', () => {
  const S = 'episodes/p/scenes/talk';
  const R = 'episodes/p/rooms/r';
  const hub = (exit: ReturnType<typeof option>) =>
    content({
      docs: {
        [S]: doc(S, {
          date: '12.05.2026',
          nodes: [
            node(`${S}#хаб`, {
              options: [
                option({ label: 'спросить о лекции', target: `${S}#тема`, moves: true }),
                exit,
              ],
            }),
            node(`${S}#тема`, {
              attrs: attrs({ once: true }),
              text: 'тема',
              options: [option({ label: '', target: `${S}#хаб` })],
            }),
          ],
        }),
        [R]: doc(R, { type: 'room', date: '12.05.2026', nodes: [node(`${R}#`, { text: 'комната' })] }),
      },
    });

  const open = run('hub', hub(option({ label: 'иди уже', target: `${R}#`, moves: true })));
  assert.equal(open.length, 1);
  assert.equal(open[0]!.severity, 'warn');
  assert.match(open[0]!.message, /без возврата/);

  // Помеченный выход правило не трогает: игрок предупреждён.
  const marked = option({ label: 'иди уже', target: `${R}#`, moves: true, attrs: attrs({ advance: true }) });
  assert.deepEqual(run('hub', hub(marked)), []);
});

test('метка длиннее строки списка находится: вертикальный список не переносит', () => {
  const S = 'episodes/p/scenes/s';
  const game = content({
    docs: {
      [S]: doc(S, {
        date: '12.05.2026',
        nodes: [
          node(`${S}#`, {
            options: [
              option({ label: 'спросить о партии', target: `${S}#а` }),
              option({
                label: 'спросить о том, что он думает про третий и четвёртый барьеры разом',
                target: `${S}#а`,
              }),
            ],
          }),
          node(`${S}#а`, { text: 'а' }),
        ],
      }),
    },
  });

  const found = run('routes', game).filter((f) => /длиннее/.test(f.message));
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /в строку списка она не влезет/);
});

test('страница — состояние предмета, а не действие', () => {
  const I = 'episodes/p/items/book';
  const game = content({
    episodes: [episode('p', { verbs: ['осмотреть'] })],
    docs: {
      [I]: doc(I, {
        type: 'item',
        label: 'учебник',
        pages: ['обложка', 'вклейка'],
        inHand: ['вклейка'],
        nodes: [
          node(`${I}#`),
          node(`${I}#обложка`, { attrs: attrs({ page: 1 }) }),
          node(`${I}#вклейка`, { attrs: attrs({ page: 1 }) }),
          node(`${I}#осмотреть`),
        ],
      }),
    },
  });

  const found = run('pages', game).map((f) => f.message);
  // Номер повторился у обеих секций, «вклейка» стала глаголом через inHand,
  // и рядом со страницами живёт конкурирующий `## осмотреть`.
  assert.equal(found.filter((m) => /встречается в предмете дважды/.test(m)).length, 2);
  assert.ok(found.some((m) => /объявлена глаголом/.test(m)));
  assert.ok(found.some((m) => /два ответа на одну команду/.test(m)));
});

test('page только у предмета, только на секции и только положительным целым', () => {
  const S = 'episodes/p/scenes/s';
  const I = 'episodes/p/items/i';
  const game = content({
    docs: {
      [S]: doc(S, { date: '12.05.2026', nodes: [node(`${S}#глава`, { attrs: attrs({ page: 1 }) })] }),
      [I]: doc(I, {
        type: 'item',
        label: 'папка',
        pages: ['лист'],
        nodes: [
          node(`${I}#`, { attrs: attrs({ page: 1 }) }),
          node(`${I}#лист`, { attrs: attrs({ page: 0 }) }),
        ],
      }),
    },
  });

  const found = run('pages', game).map((f) => f.message);
  assert.ok(found.some((m) => /страницы бывают только у предметов/.test(m)));
  assert.ok(found.some((m) => /карточка предмета, а не первая страница/.test(m)));
  assert.ok(found.some((m) => /целое положительное число/.test(m)));
});

test('предмет со страницами не обязан иметь ни одного глагола', () => {
  const I = 'episodes/p/items/book';
  const game = content({
    episodes: [episode('p', { verbs: ['осмотреть'] })],
    docs: {
      [I]: doc(I, {
        type: 'item',
        label: 'учебник',
        pages: ['обложка'],
        nodes: [node(`${I}#`), node(`${I}#обложка`, { attrs: attrs({ page: 1 }) })],
      }),
    },
  });

  assert.deepEqual(run('pages', game), []);
  assert.deepEqual(run('generators', game), []);
  // И секцию-страницу не требует объявлять в itemVerbs.
  assert.deepEqual(run('verbs', game), []);
});

/** Сцена-стенд для меток говорящих: важен только текст реплик. */
const SC = 'episodes/p/scenes/talk';
function scene(text: string) {
  return content({
    episodes: [episode('p', { entry: `${SC}#` })],
    docs: {
      [SC]: doc(SC, {
        type: 'scene',
        nodes: [
          node(`${SC}#`, { text, options: [option({ label: 'дальше', target: `${SC}#конец` })] }),
          node(`${SC}#конец`, { text: 'Конец.' }),
        ],
      }),
    },
  });
}

test('метка говорящего: ремарка вместо имени — ошибка', () => {
  // Ремарка, у которой съели перевод строки, встаёт именем.
  const found = run('speakers', scene('> тоби — Норм.\n\n> спрашивает парень справа, не бармен. — Что это?'));
  const errors = found.filter((f) => f.severity === 'error');

  assert.equal(errors.length, 1);
  assert.match(errors[0]!.message, /это ремарка, а не имя/);
});

test('метка говорящего: устная реплика без метки — ошибка', () => {
  // 07-оболочка-тз: безымянных устных реплик нет, разговор один на один
  // исключением не является.
  const found = run(
    'speakers',
    scene('> тоби — Раз.\n\n> тоби — Два.\n\n> парень — Три.\n\n> парень — Четыре.\n\n> — А это кто?'),
  );

  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, 'error');
  assert.match(found[0]!.message, /метка обязательна/);
});

test('цитата без метки законна: это бумага, а не человек', () => {
  assert.deepEqual(
    run('speakers', scene('> тоби — Раз.\n\n> тоби — Два.\n\n> «Единственный случай в истории».')),
    [],
  );
});

test('метка не влезает в колонку — ошибка, пока не объявлено короткое имя', () => {
  const text = '> полицейский — Раз.\n\n> полицейский — Два.';
  const long = run('speakers', scene(text));

  assert.equal(long.length, 1);
  assert.equal(long[0]!.severity, 'error');
  assert.match(long[0]!.message, /объявите короткое имя/);

  // Объявили — претензий нет.
  const withShort = content({
    episodes: [episode('p', { speakers: { полицейский: 'полиц.' } })],
    docs: { 'episodes/p/scenes/s': doc('episodes/p/scenes/s', { nodes: [node('episodes/p/scenes/s#', { text })] }) },
  });
  assert.deepEqual(run('speakers', withShort), []);

  // Сокращение, которое само не влезает, задачу не решает, а прячет.
  const bad = content({
    episodes: [episode('p', { speakers: { полицейский: 'участковый' } })],
    docs: { 'episodes/p/scenes/s': doc('episodes/p/scenes/s', { nodes: [node('episodes/p/scenes/s#', { text })] }) },
  });
  const found = run('speakers', bad);
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /само не влезает/);
});

test('метка говорящего: одиночный голос — предупреждение, а не ошибка', () => {
  // Так выглядит и потерянная метка, и законный прохожий: решает автор.
  const found = run('speakers', scene('> тоби — Раз.\n\n> тоби — Два.\n\n> девушка — Вот эти двое.'));

  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, 'warn');
  assert.match(found[0]!.message, /девушка/);
});

test('метка говорящего: сцена с одним собеседником тоже её требует', () => {
  // Раньше один собеседник обходился без метки. Теперь нет: появление второго
  // не должно менять грамматику написанного задним числом.
  const found = run('speakers', scene('> — Знаю.\n\n> — Издание девяносто восьмого года.'));

  assert.equal(found.length, 2);
  assert.ok(found.every((f) => f.severity === 'error'));
});

test('монтажный кадр не принимает команд', () => {
  const M = 'episodes/p/scenes/club';
  const found = run(
    'montage',
    content({
      episodes: [episode('p', { entry: `${M}#` })],
      docs: {
        [M]: doc(M, {
          type: 'scene',
          nodes: [
            node(`${M}#`, {
              attrs: attrs({ tag: ['montage'] }),
              text: 'Тоби тормозит у железной двери.',
              // Помеченная опция здесь — команда, которой игрок не увидит.
              options: [option({ label: 'войти', target: `${M}#конец` }), option({ label: '', target: `${M}#конец` })],
            }),
            node(`${M}#конец`, { text: 'Внутри.' }),
          ],
        }),
      },
    }),
  );

  assert.equal(found.length, 1);
  assert.equal(found[0]!.severity, 'error');
  assert.match(found[0]!.message, /безымянный маршрут/);
});

test('монтаж и титр на одном узле — две несовместимые композиции', () => {
  const M = 'episodes/p/scenes/club';
  const found = run(
    'montage',
    content({
      episodes: [episode('p', { entry: `${M}#` })],
      docs: {
        [M]: doc(M, {
          type: 'scene',
          nodes: [
            node(`${M}#`, {
              attrs: attrs({ tag: ['montage', 'titlecard', 'splash:margo'] }),
              text: 'Кадр.',
              options: [option({ label: '', target: `${M}#конец` })],
            }),
            node(`${M}#конец`, { text: 'Дальше.' }),
          ],
        }),
      },
    }),
  );

  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /titlecard, splash:margo/);
});

test('атрибут не на своём месте не молчит: `once` на переходе — ошибка', () => {
  // На переходе движок читает только `if` и `advance`. `- once` под репликой
  // выглядит работающим запретом, а реплику можно сказать сколько угодно раз:
  // молчаливое игнорирование здесь дороже ошибки.
  const scene = doc('episodes/p/scenes/s', {
    nodes: [
      node('episodes/p/scenes/s#хаб', {
        options: [
          option({ label: 'спросить', target: 'episodes/p/scenes/s#тема', attrs: attrs({ once: true }) }),
          option({ label: 'уйти', target: 'episodes/p/scenes/s#конец', attrs: attrs({ advance: true, if: 'флаг' }) }),
        ],
      }),
      node('episodes/p/scenes/s#тема'),
      node('episodes/p/scenes/s#конец'),
    ],
  });

  const found = run('transition-attrs', content({ docs: { [scene.docId]: scene } }));
  assert.equal(found.length, 1);
  assert.match(found[0]!.message, /`once`/);
  // `if` и `advance` на переходе законны и не ловятся.
});

test('атрибуты сгенерированной опции — атрибуты её узла, и претензий к ним нет', () => {
  const item = doc('episodes/p/items/phone', {
    type: 'item',
    nodes: [node('episodes/p/items/phone#'), node('episodes/p/items/phone#позвонить', { attrs: attrs({ once: true }) })],
  });
  const room = doc('episodes/p/rooms/r', {
    type: 'room',
    nodes: [
      node('episodes/p/rooms/r#', {
        options: [
          option({
            label: 'позвонить телефон',
            verb: 'позвонить',
            object: 'episodes/p/items/phone',
            target: 'episodes/p/items/phone#позвонить',
            attrs: attrs({ once: true }),
          }),
        ],
      }),
    ],
  });

  const found = run('transition-attrs', content({ docs: { [item.docId]: item, [room.docId]: room } }));
  assert.deepEqual(found, []);
});
