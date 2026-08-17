import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdmView } from '../app/client/adm/Adm.tsx';
import { loadContent } from '../app/server/content/load.ts';
import { movesFrom, sceneGraph, shortestPath, storyMap, walkSteps } from '../app/shared/graph.ts';
import { SceneMap } from '../app/client/adm/Scene.tsx';
import { place } from '../app/client/adm/layout.ts';
import { isAdmPath } from '../app/client/ui/mode.ts';
import { attrs, content, doc, episode, node, option } from './helpers.ts';

/**
 * Карта и путь для служебного просмотра (`/adm`).
 *
 * Это инструмент чтения, и врать он не имеет права: слой должен быть настоящим
 * расстоянием от входа, недостижимое — честно недостижимым, а путь — кратчайшим
 * и с теми командами, которыми по нему идут.
 */

const R = 'episodes/p/rooms/room';
const HALL = 'episodes/p/rooms/hall';
const TALK = 'episodes/p/scenes/talk';
const LOST = 'episodes/p/scenes/lost';
const BOOK = 'episodes/p/items/book';

/** Стенд: комната → разговор → аудитория, возврат в комнату и висящая сцена. */
function game() {
  return content({
    episodes: [episode('p', { entry: `${R}#`, verbs: ['осмотреть', 'идти'], closed: [LOST] })],
    docs: {
      [R]: doc(R, {
        type: 'room',
        label: 'комната',
        nodes: [
          node(`${R}#`, {
            text: 'Комната.',
            options: [
              option({ label: 'поговорить', target: `${TALK}#`, kind: 'story' }),
              option({ label: 'осмотреть учебник', target: `${BOOK}#осмотреть`, verb: 'осмотреть' }),
            ],
          }),
        ],
      }),
      [TALK]: doc(TALK, {
        type: 'scene',
        label: 'разговор',
        nodes: [
          node(`${TALK}#`, { text: '— Привет.', options: [option({ label: 'дальше', target: `${TALK}#конец` })] }),
          node(`${TALK}#конец`, {
            text: 'Он уходит.',
            options: [
              option({ label: 'идти в аудиторию', target: `${HALL}#`, attrs: attrs({ advance: true }) }),
              option({ label: '', target: `${R}#` }),
            ],
          }),
        ],
      }),
      [HALL]: doc(HALL, { type: 'room', label: 'аудитория', nodes: [node(`${HALL}#`, { text: 'Аудитория.' })] }),
      // Никто на неё не ссылается: из входа не дойти.
      [LOST]: doc(LOST, { type: 'scene', label: 'потеряшка', nodes: [node(`${LOST}#`, { text: 'Ничей узел.' })] }),
      [BOOK]: doc(BOOK, {
        type: 'item',
        label: 'учебник',
        nodes: [node(`${BOOK}#`), node(`${BOOK}#осмотреть`, { text: 'Учебник.' })],
      }),
    },
  });
}

test('служебный просмотр живёт на своём адресе', () => {
  assert.equal(isAdmPath('/adm'), true);
  assert.equal(isAdmPath('/adm/'), true);
  assert.equal(isAdmPath('/'), false);
  assert.equal(isAdmPath('/m'), false);
});

test('коробка — заметка-место; предметы висят внутри, а не в графе', () => {
  const map = storyMap(game(), 'p');
  const ids = map.boxes.map((b) => b.id).sort();

  // Предмет коробкой не становится: их десятки, и графа они не образуют.
  assert.deepEqual(ids, ['hall', 'lost', 'room', 'talk']);
  assert.deepEqual(map.boxes.find((b) => b.id === 'room')!.items, ['учебник']);
});

test('слой — настоящее расстояние от входа, а не порядок файлов', () => {
  const map = storyMap(game(), 'p');
  const layer = (id: string) => map.boxes.find((b) => b.id === id)!.layer;

  assert.equal(layer('room'), 0);
  assert.equal(layer('talk'), 1);
  assert.equal(layer('hall'), 2);
  // Недостижимое честно помечено, а не подклеено в конец цепочки.
  assert.equal(layer('lost'), -1);
  assert.equal(map.boxes.find((b) => b.id === 'lost')!.closed, true);

  // Недостижимое стоит последней колонкой — оно и на картинке внизу.
  assert.deepEqual(map.columns.at(-1)!.map((b) => b.id), ['lost']);
});

test('возврат отличается от хода вперёд', () => {
  const map = storyMap(game(), 'p');
  const back = map.edges.find((e) => e.to.endsWith('/room'))!;
  const forward = map.edges.find((e) => e.to.endsWith('/hall'))!;

  assert.equal(back.back, true, 'возврат в комнату должен быть помечен');
  assert.equal(forward.back, false);
});

test('путь — кратчайший и с командами, которыми по нему идут', () => {
  const g = game();
  const path = shortestPath(g, `${R}#`, `${HALL}#`)!;

  assert.deepEqual(
    path.map((s) => [s.via, s.addr]),
    [
      [null, `${R}#`],
      ['поговорить', `${TALK}#`],
      ['дальше', `${TALK}#конец`],
      ['идти в аудиторию', `${HALL}#`],
    ],
  );

  // Необратимый шаг виден: по нему вычитывают, что ветка закрылась.
  assert.deepEqual(path.map((s) => s.advance), [false, false, false, true]);
});

test('маршрут без метки не выдумывает себе команду', () => {
  const g = game();
  // Из конца разговора в комнату ведёт переход без метки — игрок его не выбирает.
  const path = shortestPath(g, `${TALK}#конец`, `${R}#`)!;
  assert.deepEqual(path.map((s) => s.via), [null, null]);
});

test('пути нет — так и сказано, а не пустой список', () => {
  const g = game();
  assert.equal(shortestPath(g, `${HALL}#`, `${R}#`), null);
  assert.equal(shortestPath(g, `${R}#`, 'нет такого узла'), null);

  // Путь в себя — один шаг, а не ошибка.
  assert.deepEqual(shortestPath(g, `${R}#`, `${R}#`), [{ addr: `${R}#`, via: null, advance: false }]);
});

test('на настоящем прологе карта собирается и путь читается', () => {
  const real = loadContent();
  const map = storyMap(real, 'prolog');

  assert.ok(map.boxes.length > 10, `заметок на карте ${map.boxes.length}`);
  assert.ok(map.edges.length > map.boxes.length / 2, 'связей подозрительно мало');
  // Вход обязан лежать на нулевом слое: иначе карта считает не от начала игры.
  const entry = real.episodes[0]!.entry;
  assert.equal(map.boxes.find((b) => entry.startsWith(`${b.docId}#`))!.layer, 0);

  // И пролог обязан проходиться от входа до последнего титра.
  const last = Object.keys(real.nodes).filter((a) => a.includes('07-titles'))[0]!;
  const path = shortestPath(real, entry, last);
  assert.ok(path && path.length > 20, `путь до финала — ${path?.length ?? 0} шагов`);
});

test('карта рисуется: коробка на заметку, связь на переход', () => {
  const markup = renderToStaticMarkup(<AdmView content={game()} />);

  // Четыре заметки-места — четыре коробки; предмет коробкой не стал.
  const svg = /<svg[\s\S]*?<\/svg>/.exec(markup)![0];
  assert.equal(svg.split('<rect').length - 1, 4);
  assert.equal(svg.includes('учебник'), false, 'предмет попал на карту коробкой');
  // Но в выборе узлов он есть: путь читают и внутрь предмета.
  assert.match(markup, /учебник/);

  // Связей столько же, сколько насчитала арифметика, и возврат нарисован иначе.
  const map = storyMap(game(), 'p');
  assert.equal(svg.split('<path').length - 1, map.edges.length);
  assert.match(svg, /adm-edge adm-edge-back/);

  // Вход и закрытая заметка подписаны — иначе карту приходится сверять с yaml.
  assert.match(markup, /вход/);
  assert.match(markup, /закрыта/);
  assert.match(markup, /adm-lost/);
});

test('на настоящем прологе карта не рушится и влезает в разумный лист', () => {
  const markup = renderToStaticMarkup(<AdmView content={loadContent()} />);
  const size = /width="(\d+)" height="(\d+)"/.exec(markup)!;

  assert.ok(Number(size[1]) < 1200, `карта шириной ${size[1]}px — в окно не влезет`);
  assert.ok(Number(size[2]) > 400, 'карта подозрительно низкая');
  assert.match(markup, /заметок/);
});

test('граф заметки: слои считаются от всех входов, а не от вступления', () => {
  const g = sceneGraph(game(), TALK);

  // В разговор входят снаружи только через вступление — оно и нулевой слой.
  assert.deepEqual(g.columns[0]!.map((n) => n.id), ['']);
  assert.deepEqual(g.columns[1]!.map((n) => n.id), ['конец']);
  assert.equal(g.nodes.find((n) => n.id === '')!.entrance, true);
});

test('узел подписан командой, которой в него приходят', () => {
  const g = sceneGraph(game(), TALK);
  const end = g.nodes.find((n) => n.id === 'конец')!;

  // Не именем секции: в диалоге узел узнают по реплике, которая к нему ведёт.
  assert.deepEqual(end.via, ['дальше']);

  // Маршрут метки не выдумывает, а `advance` виден на том узле, куда он ведёт.
  const hall = sceneGraph(game(), HALL);
  assert.equal(hall.nodes[0]!.advance, false);
  const talkExit = sceneGraph(game(), TALK).exits.find((e) => e.to.startsWith(HALL))!;
  assert.equal(talkExit.label, 'идти в аудиторию');
});

test('выходы наружу перечислены отдельно и не путаются со связями', () => {
  const g = sceneGraph(game(), TALK);

  // Внутри — одна связь, наружу — две: в аудиторию и обратно в комнату.
  assert.equal(g.edges.length, 1);
  assert.deepEqual(
    g.exits.map((e) => [e.label, e.to]).sort(),
    [
      ['идти в аудиторию', `${HALL}#`],
      [null, `${R}#`],
    ].sort(),
  );
});

test('узел, в который никто не входит, виден отдельно', () => {
  // В стенде такого нет — соберём заметку с висящей секцией.
  const g = content({
    episodes: [episode('p', { entry: `${TALK}#` })],
    docs: {
      [TALK]: doc(TALK, {
        type: 'scene',
        nodes: [
          node(`${TALK}#`, { text: 'Начало.' }),
          node(`${TALK}#висит`, { text: 'Сюда не попасть.' }),
        ],
      }),
    },
  });

  const scene = sceneGraph(g, TALK);
  assert.equal(scene.nodes.find((n) => n.id === 'висит')!.layer, -1);
  assert.deepEqual(scene.columns.at(-1)!.map((n) => n.id), ['висит']);
});

test('граф заметки рисуется: коробка на узел, механика помечена', () => {
  const markup = renderToStaticMarkup(
    <SceneMap
      content={game()}
      docId={TALK}
      selected={null}
      onSelect={() => {}}
      walk={[]}
      candidates={new Set()}
      onFollow={() => {}}
    />,
  );

  assert.equal(markup.split('<rect').length - 1, 2);
  assert.match(markup, /дальше/);
  // Выходы наружу подписаны под картинкой — по ним видно, чем сцена кончается.
  assert.match(markup, /наружу/);
  assert.match(markup, /идти в аудиторию/);
});

test('на настоящей лекции граф заметки собирается', () => {
  const real = loadContent();
  const scene = sceneGraph(real, 'episodes/prolog/scenes/01-lecture');

  assert.ok(scene.nodes.length > 20, `узлов ${scene.nodes.length}`);
  assert.ok(scene.columns.length > 5, 'лекция должна быть глубокой');
  // Каждый узел, кроме входов, обязан быть чем-то подписан: иначе в него
  // не приходят вовсе, и это находка, а не норма.
  const mute = scene.nodes.filter((n) => !n.entrance && n.via.length === 0);
  assert.deepEqual(mute.map((n) => n.id), []);
});

test('широкий слой переносится в ряды, а не уезжает за горизонт', () => {
  const box = { w: 100, h: 40, gapX: 10, gapY: 10 };
  const wide = [Array.from({ length: 23 }, (_, i) => ({ id: i }))];

  const strip = place(wide, box);
  const wrapped = place(wide, box, 6);

  assert.equal(strip.width, 23 * 110 - 10);
  assert.equal(wrapped.width, 6 * 110 - 10);
  // Ни одна коробка не потеряна и ни одна не легла на другую.
  assert.equal(wrapped.boxes.length, 23);
  assert.equal(new Set(wrapped.boxes.map((b) => `${b.x},${b.y}`)).size, 23);
});

test('хаб на два десятка тем влезает в лист', () => {
  const real = loadContent();
  const markup = renderToStaticMarkup(
    <SceneMap
      content={real}
      docId="episodes/prolog/scenes/00-talk"
      selected={null}
      onSelect={() => {}}
      walk={[]}
      candidates={new Set()}
      onFollow={() => {}}
    />,
  );
  const width = Number(/width="(\d+)"/.exec(markup)![1]);
  assert.ok(width < 1600, `хаб шириной ${width}px — глазом не охватить`);
});

test('из узла видно все ходы: по ним путь и собирают', () => {
  const g = game();
  const moves = movesFrom(g, `${TALK}#конец`);

  assert.deepEqual(
    moves.map((m) => [m.label, m.target, m.advance]),
    [
      ['идти в аудиторию', `${HALL}#`, true],
      [null, `${R}#`, false],
    ],
  );
  assert.deepEqual(movesFrom(g, `${HALL}#`), []);
});

test('путь собирается по узлам, а не парой концов', () => {
  // Ровно тот случай, ради которого конструктор и нужен: из комнаты в комнату
  // ведут две разные ветки, и кратчайший показал бы одну, а прочитать надо обе.
  const g = content({
    episodes: [episode('p', { entry: `${R}#` })],
    docs: {
      [R]: doc(R, {
        type: 'room',
        nodes: [
          node(`${R}#`, {
            text: 'Развилка.',
            options: [
              option({ label: 'налево', target: `${R}#лево` }),
              option({ label: 'направо', target: `${R}#право` }),
            ],
          }),
          node(`${R}#лево`, { text: 'Слева.', options: [option({ label: 'дальше', target: `${R}#конец` })] }),
          node(`${R}#право`, { text: 'Справа.', options: [option({ label: 'дальше', target: `${R}#конец` })] }),
          node(`${R}#конец`, { text: 'Сошлись.' }),
        ],
      }),
    },
  });

  const left = walkSteps(g, [`${R}#`, `${R}#лево`, `${R}#конец`]);
  const right = walkSteps(g, [`${R}#`, `${R}#право`, `${R}#конец`]);

  assert.deepEqual(left.map((s) => s.via), [null, 'налево', 'дальше']);
  assert.deepEqual(right.map((s) => s.via), [null, 'направо', 'дальше']);
  // Концы у обоих одни и те же, длина тоже: кратчайший выберет одну ветку
  // и про вторую не скажет ничего — за этим и нужен конструктор.
  const short = shortestPath(g, `${R}#`, `${R}#конец`)!;
  assert.equal(short.length, 3);
  assert.equal(short.map((s) => s.via).filter((v) => v === 'налево' || v === 'направо').length, 1);
});

test('шаг, которого в графе нет, не выбрасывается, а помечается', () => {
  const g = game();
  // Автор правил заметку, и связь между этими узлами пропала.
  const steps = walkSteps(g, [`${TALK}#`, `${HALL}#`]);

  assert.equal(steps[1]!.broken, true);
  assert.equal(steps[1]!.via, null);
  // Молча подменять такой путь кратчайшим значило бы соврать.
  assert.equal(steps.length, 2);
});

test('путь виден на графе: номера шагов и подсвеченная связь', () => {
  const walk = [`${TALK}#`, `${TALK}#конец`];
  const markup = renderToStaticMarkup(
    <SceneMap
      content={game()}
      docId={TALK}
      selected={null}
      onSelect={() => {}}
      walk={walk}
      candidates={new Set([`${HALL}#`, `${R}#`])}
      onFollow={() => {}}
    />,
  );

  assert.equal(markup.split('adm-step-no').length - 1, 2, 'шаги не пронумерованы');
  assert.match(markup, /adm-edge-walk/);
  assert.match(markup, /adm-walk-last/);

  // Выход из последнего узла становится кнопкой: путь уходит в соседнюю заметку.
  assert.match(markup, /<button[^>]*adm-exit[^>]*>идти в аудиторию/);
});
