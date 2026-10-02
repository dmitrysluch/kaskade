import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../app/server/content/load.ts';
import { validate } from '../app/server/validate/index.ts';
import { buildCatalog, type CatalogOption } from '../app/client/engine/catalog.ts';
import { completeMinigame, fieldHere, fieldOf } from '../app/client/engine/minigame.ts';
import { begin, confirmTransition, dateAt, enter, evalCondition, freshSave, interpolate, previewOf, pagesOf, sceneOf, terms, waitRoute } from '../app/client/engine/state.ts';
import { overlayLines, statusText } from '../app/client/ui/lines.ts';
import type { SaveState } from '../app/shared/types.ts';
import type { StreamEntry } from '../app/client/engine/state.ts';
import { option } from './helpers.ts';
import { CLOSE, EXAMINE } from '../app/shared/pages.ts';
import { plainText } from '../app/shared/entities.ts';
import { said, voiceOf } from '../app/shared/speech.ts';
import { join } from 'node:path';
import { readYaml } from '../app/server/content/yaml.ts';
import { CONTENT } from '../app/server/content/paths.ts';

/**
 * Интеграция на настоящем vault: то, что нельзя проверить на стенде — проходится ли
 * пролог и не появилось ли где-то «не понимаю».
 */

const game = loadContent();

function labels(save: SaveState) {
  return buildCatalog(game, save).map((o) => o.label);
}

function at(addr: string): SaveState {
  const stage = game.docStages[sceneOf(addr)]?.[0];
  const transition = Object.values(game.transitions).find((t) => t.stage === stage);
  if (!transition) return { ...freshSave(game), started: true, episodeState: { ...freshSave(game).episodeState, at: addr } };
  const base = freshSave(game);
  const onCard = enter(game, base, `${transition.docId}#`).save;
  // Контекст тестового входа всегда устанавливается реальным transition.
  const flags = { 'prolog.dorm-done': { value: true, at: null }, 'prolog.lecture-done': { value: true, at: null } };
  const entered = confirmTransition(game, { ...onCard, flags }, transition.docId).save;
  return { ...entered, flags: {}, started: true, episodeState: { ...entered.episodeState, at: addr } };
}

test('контент проходит валидатор', () => {
  // Предупреждения — повод посмотреть, а не повод не собраться; ошибок быть не должно.
  assert.deepEqual(
    validate(game).filter((f) => f.severity === 'error'),
    [],
  );
});

test('пролог начинается вступлением, а не комнатой', () => {
  const save = freshSave(game);
  assert.equal(save.episodeState.at, game.episodes[0]!.entry);

  // Первый кадр — титр: ввода нет, текста в потоке нет, он объект на пустом экране.
  const intro = enter(game, { ...save, started: true }, save.episodeState.at);
  assert.deepEqual(intro.entries, []);
  assert.ok(game.nodes[intro.save.episodeState.at]!.attrs.tag.includes('titlecard'));

  // Дальше кадры доигрывают по маршруту и приводят в комнату с командной строкой.
  let state = intro.save;
  let entries: StreamEntry[] = [];
  for (let i = 0; i < 5; i++) {
    const node = game.nodes[state.episodeState.at]!;
    if (game.docs[sceneOf(node.addr)]?.type === 'transition') {
      const step = confirmTransition(game, state, sceneOf(node.addr));
      state = step.save;
      entries = step.entries;
      continue;
    }
    if (!node.attrs.tag.includes('titlecard')) break;
    const next = node.options.find((o) => o.label === '')!.target!;
    const step = enter(game, state, next);
    state = step.save;
    entries = step.entries;
  }

  assert.ok(entries.length > 0, 'первый экран после вступления пуст');
  assert.ok(labels(state).length > 3, 'в комнате нечего ввести');
});

test('лицо и запись стоят на одном узле: это личное дело', () => {
  const card = game.nodes['episodes/prolog/scenes/00-intro#дело']!;
  assert.ok(card.attrs.tag.includes('titlecard'));
  assert.ok(card.attrs.tag.includes('splash:margo'));
});

test('позвонить не попадает в строку подсказок никогда', () => {
  const episode = game.episodes[0]!;
  assert.equal(episode.verbs.includes('позвонить'), false);
  assert.ok(episode.itemVerbs.includes('позвонить'));
});

test('история копится в пределах сцены, а переход на новое место её начинает заново', () => {
  const room = 'episodes/prolog/rooms-virt/tu.h1012:01#';

  // Осмотреть предмет — та же страница: узел предмета игрока не двигает.
  const look = enter(game, at(room), 'episodes/prolog/items/01-board#осмотреть', false);
  assert.equal(sceneOf(look.save.episodeState.at), sceneOf(room));

  // Уйти в коридор — новая страница.
  const go = enter(game, at(room), 'episodes/prolog/rooms-virt/tu.auditorium-gallery:01#');
  assert.notEqual(sceneOf(go.save.episodeState.at), sceneOf(room));

  // Внутри одной сцены переходы по узлам страницу не сбрасывают.
  const inScene = enter(game, at('episodes/prolog/scenes/01-lecture#стена'), 'episodes/prolog/scenes/01-lecture#число');
  assert.equal(sceneOf(inScene.save.episodeState.at), 'episodes/prolog/scenes/01-lecture');
});

test('дату меняет только подтверждённый переход, осмотр и разговор её сохраняют', () => {
  const start = at('episodes/prolog/scenes/02-neukoelln#');
  const scene = enter(game, start, 'episodes/prolog/scenes/02-neukoelln#');
  assert.equal(dateAt(game, scene.save), '08.06.2025');
  const card = enter(game, scene.save, 'episodes/prolog/transitions/03-tu-entry#');
  assert.equal(dateAt(game, card.save), '08.06.2025');
  const moved = confirmTransition(game, card.save, 'episodes/prolog/transitions/03-tu-entry');
  const room = enter(game, moved.save, 'episodes/prolog/rooms-virt/tu.secretariat:03#');
  assert.equal(dateAt(game, room.save), '04.07.2025');
  const look = enter(game, room.save, 'episodes/prolog/items/00-book#обложка', false);
  assert.equal(dateAt(game, look.save), '04.07.2025');
});

test('флаг помнит дату сцены, в которой поставлен', () => {
  // Узел допроса ставит флаг; дата у него — дата заметки, а не системные часы.
  const scene = 'episodes/prolog/scenes/02-neukoelln';
  const setter = game.docs[scene]!.nodes.find((n) => n.attrs.set.length > 0)!;
  const called = enter(game, at(`${scene}#`), setter.addr);

  const flag = called.save.flags[setter.attrs.set[0]!]!;
  assert.equal(flag.value, true);
  assert.equal(flag.at, '08.06.2025');
  assert.equal(
    interpolate(`дата: {{${setter.attrs.set[0]!}.at}}`, called.save),
    'дата: 08.06.2025',
  );
});

test('game.yaml — витрина: настройки эпизода живут только в episode.yaml', () => {
  // Правило приоритета («при расхождении выигрывает эпизод») было худшим из
  // вариантов: значение видно в двух местах, а работает одно. Теперь у каждого
  // поля один владелец, и сборка падает на дубле.
  const shop = readYaml(join(CONTENT, 'game.yaml'));
  for (const entry of shop.episodes as Record<string, unknown>[]) {
    assert.deepEqual(Object.keys(entry), ['id'], `в game.yaml у эпизода лишние поля`);
  }

  // А сам эпизод при этом собран целиком — значит, всё приехало из episode.yaml.
  const episode = game.episodes[0]!;
  assert.equal(episode.renderer, 'academic');
  assert.ok(episode.entry.endsWith('#'));
  assert.ok(episode.verbs.length > 0 && episode.characters.length > 0);
  assert.ok(episode.title && episode.title !== episode.id);
});

test('даты принадлежат переходам, игровые сцены получают их через stage', () => {
  const scenes = Object.values(game.docs).filter((d) => d.type === 'scene');
  assert.ok(scenes.length > 0);
  for (const scene of scenes) {
    assert.equal(scene.date, null);
    if (scene.id !== '00-intro') assert.ok(game.docStages[scene.docId]?.length, `у сцены ${scene.docId} нет контекста`);
  }
});

test('блок options один на комнату, а предметы у каждого состояния свои', () => {
  const вход = game.nodes['episodes/prolog/rooms-virt/tu.dorm-room:00#комната']!;
  const один = game.nodes['episodes/prolog/rooms-virt/tu.dorm-room:00#один']!;

  const verbs = (n: typeof вход) => [...new Set(n.options.flatMap((o) => (o.verb ? [o.verb] : [])))].sort();
  const objects = (n: typeof вход) => n.options.flatMap((o) => (o.object ? [o.object] : [])).sort();

  // Глаголы те же: блок объявлен один раз и действует во всех узлах.
  assert.ok(verbs(вход).length > 0, 'у комнаты не оказалось ни одной опции от генератора');
  assert.deepEqual(verbs(один), verbs(вход));

  // А набор предметов разный: Тоби объявлен на узле, потому что он здесь
  // только до ухода за сигаретами. Вычитания нет — во втором узле его просто нет.
  const toby = 'episodes/prolog/items/00-toby';
  assert.ok(objects(вход).includes(toby), 'до ухода Тоби должен быть в комнате');
  assert.ok(!objects(один).includes(toby), 'после ухода Тоби быть не должно');
});

test('служебные команды есть в каталоге всегда', () => {
  const inRoom = labels(at('episodes/prolog/rooms-virt/tu.dorm-room:00#'));
  for (const command of ['справочник', 'дело', 'инвентарь']) assert.ok(inRoom.includes(command));
});

test('пролог проходится до конца, и на каждом шаге есть что ввести', () => {
  // Демо-срез снимаем: проверяем содержимое, а не текущую настройку показа.
  const full: typeof game = {
    ...game,
    episodes: game.episodes.map((e) => ({ ...e, closed: [] })),
  };
  let save: SaveState = { ...freshSave(full), started: true };
  let result = enter(full, save, save.episodeState.at);
  save = result.save;
  const tried = new Map<string, Set<string>>();

  for (let step = 0; step < 400; step++) {
    // `конец` — единственный законный тупик: дальше пролога пока ничего нет.
    if (save.episodeState.at.endsWith('#конец')) return;

    /*
     * Физическое ожидание само не идёт: время считает оболочка. Обход проживает
     * его как игрок — заглядывает на часы, пока время не вышло, и уходит
     * безымянным маршрутом, когда вышло. Половина срока за заход: так узел
     * успевает показать оба состояния часов, а не одно.
     */
    const waiting = save.wait;
    if (waiting && waiting.node === save.episodeState.at) {
      save = { ...save, wait: { ...waiting, elapsed: Math.min(waiting.ms, waiting.elapsed + waiting.ms / 2) } };
      const next = waitRoute(full, save);
      if (next) {
        save = enter(full, { ...save, wait: null }, next).save;
        continue;
      }
    }

    /*
     * Поле мини-игры ([[07a-мини-игра]]) обход проходит авторским решением:
     * `solution` для этого и хранится — валидатору и тестам. Распутывать граф
     * перебором здесь нечестно и незачем: проверяется проход пролога, а не
     * планарность, и её уже проверил валидатор.
     */
    const field = fieldHere(full, save);
    if (field) {
      const solution = Object.fromEntries(
        Object.entries(field.points).flatMap(([id, p]) => (p.solution ? [[Number(id), p.solution] as const] : [])),
      );
      const placed = { ...save, minigames: { ...save.minigames, [field.id]: { points: solution, solved: true, completionApplied: false } } };
      assert.ok(fieldOf(field, placed).solved, `авторское решение не распутывает ${field.id}`);
      save = completeMinigame(full, placed, field).save;
      continue;
    }

    const node = full.nodes[save.episodeState.at]!;
    if (full.docs[sceneOf(node.addr)]?.type === 'transition') {
      const moved = confirmTransition(full, save, sceneOf(node.addr));
      assert.notEqual(moved.save.episodeState.at, save.episodeState.at, 'карточка не продолжилась');
      save = moved.save;
      continue;
    }
    // Полноэкранный кадр ввод не принимает: и титр, и монтаж уводит нажатие,
    // а не команда. Для обхода это один и тот же безымянный маршрут.
    if (node.attrs.tag.includes('titlecard') || node.attrs.tag.includes('montage')) {
      const next = node.options.find((o) => o.label === '')!.target!;
      save = enter(full, save, next).save;
      continue;
    }

    const options = buildCatalog(full, save).filter((o) => o.system === null && !o.locked);
    assert.ok(options.length > 0, `тупик в узле ${save.episodeState.at}`);

    /*
     * Открытую книгу читают до конца и закрывают. Правило «пробуй непробованное»
     * тут не годится: метки страниц одинаковы на всех страницах, и по ним обход
     * решил бы, что уже всё видел, — а именно на последней странице предмет
     * обычно и делает то, ради чего его дали.
     */
    let chosen: CatalogOption;
    if (save.openItem != null) {
      chosen = options.find((o) => o.label === 'вперёд') ?? options[options.length - 1]!;
    } else {
      // Ходим как игрок: сначала то, что здесь ещё не пробовали, и только когда
      // всё исчерпано — команда, закрывающая место (`advance`). Она стоит в каталоге
      // последней, и без этого правила обход крутился бы в комнате вечно.
      const seen = tried.get(save.episodeState.at) ?? new Set<string>();
      tried.set(save.episodeState.at, seen);
      const stage00 = save.activeStage === '00';
      const here = sceneOf(save.episodeState.at);
      const bearing = !stage00 ? []
        : save.words['word-only-case'] === 'white' ? ['лечь спать', 'завалить деда']
        : save.inventory.includes('00-book') ?
          here.endsWith('tu.dorm-room:00') ? ['изучать учебник']
          : here.endsWith('tu.dorm-corridor:00') ? ['идти в комнату']
          : here.endsWith('tu.yard:00') ? ['идти в жилой коридор']
          : ['идти во двор']
        : save.flags['prolog.book-found']?.value ? ['взять учебник']
        : save.words['word-containment'] === 'white' ?
          here.endsWith('tu.faculty-corridor:00') ? ['идти к лифту']
          : here.endsWith('tu.elevator:00') ? ['идти в аудиторную галерею']
          : here.endsWith('tu.auditorium-gallery:00') ? ['идти в библиотеку']
          : ['искать контейнмент']
        : save.words['word-ahlers'] === 'white' ?
          here.endsWith('tu.dorm-room:00') ? ['идти в жилой коридор']
          : here.endsWith('tu.dorm-corridor:00') ? ['идти во двор']
          : here.endsWith('tu.yard:00') ? ['идти в столовую']
          : here.endsWith('tu.canteen:00') ? ['идти к лифту']
          : here.endsWith('tu.elevator:00') ? ['идти в кафедральный коридор']
          : ['искать алерса']
        : ['говорить с тоби', 'что за алерс'];
      chosen =
        bearing.flatMap((label) => options.filter((o) => o.label === label))[0]
        ?? options.find((o) => !seen.has(o.label))
        ?? options[options.length - 1]!;
      seen.add(chosen.label);
    }

    // Тот же переключатель режима, что в оболочке: книгу открывает **цель**,
    // а не глагол, — и авторское «прочитать протокол» открывает её так же,
    // как осмотр из комнаты.
    const page = chosen.target ? full.nodes[chosen.target] : undefined;
    const item = chosen.target ? full.docs[sceneOf(chosen.target)] : undefined;
    const openItem =
      chosen.verb === CLOSE ? null
      : page?.attrs.page != null && item?.type === 'item' && pagesOf(full, item.docId, save).length > 1 ?
        item.docId
      : save.openItem;
    save = { ...save, openItem };

    // У `закрыть` цели нет: она ничего не отыгрывает, только гасит режим.
    if (chosen.target) save = enter(full, save, chosen.target, chosen.moves).save;
  }

  assert.fail(
    `пролог не сошёлся за 400 шагов, застрял на ${save.episodeState.at}; ` +
    `слова=${Object.keys(save.words).join(',')}; вещи=${save.inventory.join(',')}; ` +
    `флаги=${Object.keys(save.flags).join(',')}`,
  );
});

test('демо-срез: закрытая заметка не предлагается, но граф целый', () => {
  /*
   * Срез — настройка показа, а не свойство контента: сейчас открыто всё,
   * и проверять надо механику, а не конкретный список. Механика в том, что
   * переход в закрытую заметку не появляется у игрока, а в графе остаётся.
   */
  const closed = game.episodes[0]!.closed;
  for (const docId of closed) assert.ok(game.docs[docId], `в срезе заметка "${docId}", которой нет`);

  /*
   * Берём любую заметку, в которую ведёт переход из другой, и закрываем её
   * руками: проверяется правило, а не сегодняшнее содержимое `episode.yaml`
   * и не имя сцены — автор переписывает и то, и другое.
   */
  const door = Object.values(game.nodes)
    .flatMap((n) => n.options.map((o) => ({ from: n, to: o.target })))
    .find(({ from, to }) => to != null && sceneOf(to) !== sceneOf(from.addr) && game.nodes[to]);
  assert.ok(door, 'в графе нет ни одного перехода между заметками');

  const doorTo = sceneOf(door.to!);
  const cut = { ...game, episodes: game.episodes.map((e) => ({ ...e, closed: [doorTo] })) };
  const doors = Object.values(game.nodes).filter((n) =>
    n.options.some((o) => o.target?.startsWith(`${doorTo}#`)),
  );

  for (const door of doors) {
    // Маршрут есть в графе…
    assert.ok(door.options.some((o) => o.target?.startsWith(`${doorTo}#`)));
    // …но при закрытой заметке не срабатывает: игрок остаётся на месте.
    assert.equal(enter(cut, at(door.addr), door.addr).save.episodeState.at, door.addr, door.addr);
  }

  // Открытая заметка тем же маршрутом уводит: срез — единственная разница.
  const open = doors.find((d) => d.options.some((o) => o.label === '' && o.target?.startsWith(`${doorTo}#`)));
  if (open && open.options.every((o) => o.label === '' || o.verb !== null)) {
    assert.notEqual(enter(game, at(open.addr), open.addr).save.episodeState.at, open.addr);
  }
});

test('слово, отданное прологом, становится белым', () => {
  // Ищем по графу, а не по имени: слова автор заводит и убирает каждый день,
  // а проверять надо механику — выдал узел, значит слово в деле и его можно
  // произносить.
  const giver = Object.values(game.nodes).find((n) => n.attrs.give.some((id) => game.words[id]));
  assert.ok(giver, 'в прологе ни один узел не отдаёт слова');

  const word = giver.attrs.give.find((id) => game.words[id])!;
  const r = enter(game, at('episodes/prolog/rooms-virt/tu.dorm-room:00#'), giver.addr, false);
  assert.equal(r.save.words[word], 'white');

  // Если слово отдаёт страница предмета, заодно запоминается и сама страница:
  // закладка и выдача происходят одним входом.
  if (giver.attrs.page != null) {
    assert.equal(r.save.itemStates[sceneOf(giver.addr).split('/').pop()!], giver.id);
  }
});

test('в прологе все слова белые: играя за себя, Марго получает всё легально', () => {
  let save = { ...freshSave(game), started: true };
  save = enter(game, save, save.episodeState.at).save;

  for (const addr of Object.keys(game.nodes)) {
    save = enter(game, save, addr, false).save;
  }

  const given = Object.entries(save.words);
  assert.ok(given.length > 0, 'пролог не отдал ни одного слова');
  assert.deepEqual(
    given.filter(([, state]) => state !== 'white'),
    [],
  );
});

test('портрет Марго — сетка индексов, и в прологе волосы крашеные', () => {
  const portrait = game.characters['margo']!.portraits['prolog']!;

  assert.equal(portrait.width, 24);
  assert.equal(portrait.height, 32, 'высота в пикселях вдвое больше высоты панели в клетках');
  assert.equal(portrait.height % 2, 0, 'полублок ставится на пару строк');
  assert.equal(portrait.grid.length, portrait.height);
  for (const row of portrait.grid) assert.equal([...row].length, portrait.width);

  assert.equal(portrait.colors['h'], '#eb564b');
  // Ключ фона цвета не имеет: сквозь него виден фон терминала.
  assert.equal(portrait.colors['o'], undefined);
});

test('длительности показа в конфиге нет: кадр ждёт Enter, а не таймер', () => {
  // Решение «игрок уже посмотрел» машина за него не принимает
  // (07-оболочка-тз, «Полноэкранный кадр ждёт Enter»).
  assert.equal('timing' in game.renderers.academic!, false);
});

test('авторский титр сохраняет текущую дату', () => {
  const card = game.nodes['episodes/prolog/scenes/02-titles#']!;
  assert.equal(card.date, null);
  const after = enter(game, at(card.addr), card.addr);
  assert.equal(dateAt(game, after.save), '08.06.2025');
  assert.deepEqual(after.entries, []);
});

test('срок объявлен в episode.yaml и тикает сам, без единой правки в контенте', () => {
  const episode = game.episodes[0]!;
  assert.equal(episode.dates.blueCard?.at, '31.12.2026', 'карта у Марго с самого начала');

  // Одна и та же карта, разные заметки: остаток считается от даты той, где стоишь.
  const seen = (addr: string) => {
    const save: SaveState = { ...at(addr) };
    return statusText(dateAt(game, save), terms(game, save));
  };
  assert.equal(seen('episodes/prolog/rooms-virt/tu.dorm-room:00#'), '12.10.2024 · BLUE CARD 810 дней');
  assert.equal(seen('episodes/prolog/scenes/02-neukoelln#'), '08.06.2025 · BLUE CARD 571 день');
  assert.equal(seen('episodes/prolog/rooms-virt/tu.secretariat:03#'), '04.07.2025 · BLUE CARD 545 дней');

  // Срок, который не назначен, не показывается вовсе.
  const noCard: SaveState = { ...at('episodes/prolog/rooms-virt/tu.dorm-room:00#'), dates: {} };
  assert.equal(statusText(dateAt(game, noCard), terms(game, noCard)), '12.10.2024');
});

test('срок можно сдвинуть узлом и спросить о нём в условии', () => {
  const start = at('episodes/prolog/rooms-virt/tu.dorm-room:00#');
  assert.equal(evalCondition('date:blueCard', start), true);
  assert.equal(evalCondition('date:blueCard', { ...start, dates: {} }), false);

  // Механизм общий: имя срока — любое объявленное, не только blueCard.
  const moved: SaveState = { ...start, dates: { blueCard: '31.12.2028' } };
  assert.equal(statusText(dateAt(game, moved), terms(game, moved)), '12.10.2024 · BLUE CARD 1541 день');
});

test('адресных форм у служебных команд нет: хранилище открывается целиком', () => {
  // 07-оболочка-тз, «Служебные команды»: `справочник контейнмент` больше
  // не существует. Быстрый путь к одной записи — панель по цифре, и она
  // отвечает на другой вопрос: «что это было сейчас», а не «что вообще бывает».
  const save = at('episodes/prolog/rooms-virt/tu.dorm-room:00#');
  const anyWord = Object.keys(game.words)[0]!;
  const withWord: SaveState = { ...save, words: { [anyWord]: 'white' } };
  const all = labels(withWord);

  assert.ok(all.includes('справочник'));
  assert.equal(all.some((l) => l.startsWith('справочник ')), false);
  assert.equal(all.some((l) => l.startsWith('дело ')), false);
  assert.equal(all.some((l) => l.startsWith('инвентарь ')), false);

  // Хранилище показывает всё: статей в справочнике больше одной.
  const list = overlayLines({ kind: 'справочник' }, game, withWord, 60);
  assert.ok(list.length > Object.keys(game.reference).length);
});

test('управление — действие оболочки, а не команда терминала', () => {
  // Метаинструкция не притворяется действием: её нет ни в каталоге, ни в истории.
  const all = labels(at('episodes/prolog/rooms-virt/tu.dorm-room:00#'));
  assert.equal(all.includes('управление'), false);
  assert.ok(all.includes('справочник') && all.includes('дело') && all.includes('инвентарь'));
});

test('меню — команда: сброс обязан находиться набором, а не только клавишей', () => {
  const all = labels(at('episodes/prolog/rooms-virt/tu.dorm-room:00#'));
  assert.ok(all.includes('меню'));

  // Оно служебное, значит стоит в конце списка, а не среди действий комнаты.
  const catalog = buildCatalog(game, at('episodes/prolog/rooms-virt/tu.dorm-room:00#'));
  const option = catalog.find((o) => o.label === 'меню')!;
  assert.equal(option.kind, 'system');
  assert.equal(option.system?.kind, 'меню');
  assert.equal(catalog.indexOf(option) > catalog.findIndex((o) => !o.system), true);

  // Аргумента у меню нет: `меню сброс` вводить негде и не надо — выбор внутри.
  assert.deepEqual(all.filter((l) => l.startsWith('меню ')), []);
});

test('начать заново — то же состояние, что первый запуск', () => {
  // Сброс проходит через ту же дверь, что запуск: `begin` от чистого сейва.
  const played = enter(game, at('episodes/prolog/rooms-virt/tu.dorm-room:00#'), 'episodes/prolog/rooms-virt/tu.dorm-room:00#').save;
  assert.notDeepEqual(played.episodeState.at, freshSave(game).episodeState.at);

  const again = begin(game, freshSave(game));
  assert.equal(again.save.episodeState.at, game.episodes[0]!.entry);
  assert.deepEqual(again.save.words, {});
  assert.deepEqual(again.save.flags, {});
  assert.deepEqual(again.save.inventory, []);
  assert.deepEqual(again.save.splashes, []);
  assert.deepEqual(again.save.itemStates, {});
  assert.deepEqual(again.history, []);
  assert.equal(again.save.openItem, null);
  assert.equal(again.overlay, null);
  // Обучающий экран показывается снова: заново — значит и для нового игрока тоже.
  assert.equal(again.save.taught, false);
  assert.equal(again.save.hinted, false);
});

test('выданное слово объявляется в потоке', () => {
  const save = at('episodes/prolog/rooms-virt/tu.dorm-room:00#');
  const giver = Object.values(game.nodes).find((n) => n.attrs.give.some((g) => game.words[g]))!;

  const r = enter(game, save, giver.addr, false);
  const grants = r.entries.filter((e) => e.kind === 'grant');
  assert.equal(grants.length, 1);
  // Первое за игру слово показывается с хоткеем: иначе игрок не узнает, что дело есть.
  assert.match(grants[0]!.text, / — в деле, 2$/);

  // Второй раз то же слово не объявляется: оно уже в деле.
  assert.deepEqual(enter(game, r.save, giver.addr, false).entries.filter((e) => e.kind === 'grant'), []);
});

test('предпросмотр берёт реплику Марго целевого узла, а не выдумывает текст', () => {
  // Ищем по графу, а не по имени узла: реплики автор переписывает каждый день.
  const withReply = Object.values(game.nodes)
    .flatMap((n) => n.options)
    .filter((o) => o.label !== '' && previewOf(game, at('episodes/prolog/rooms-virt/tu.dorm-room:00#'), o) != null);

  assert.ok(withReply.length > 10, `предпросмотров всего ${withReply.length}`);
  for (const option of withReply) {
    const target = game.nodes[option.target!]!;
    const preview = previewOf(game, at('episodes/prolog/rooms-virt/tu.dorm-room:00#'), option)!;
    // Дословно: строка обязана найтись в узле как есть, а не быть пересказом.
    // Сравниваем с текстом без разметки и без метки говорящего: игрок видит
    // форму из ссылки и речь без служебного имени — с этим и обязан совпадать
    // предпросмотр.
    assert.ok(
      plainText(target.text)
        .split('\n')
        .some((l) => said(l).trim() === preview),
      `предпросмотра "${preview}" нет в узле ${target.addr}`,
    );
  }

  /*
   * За действием без реплики Марго предпросмотра нет. Берём ходьбу: у комнаты
   * своих слов нет вовсе. Осмотр для этого уже не годится — в описаниях
   * предметов теперь живут мысли Марго, и они её речь.
   */
  const go = game.nodes['episodes/prolog/rooms-virt/tu.dorm-room:00#комната']!.options.find((o) => o.verb === 'идти')!;
  assert.equal(previewOf(game, at('episodes/prolog/rooms-virt/tu.dorm-room:00#комната'), go), null);
});

test('предпросмотр проходит сквозь ремарку, но не сквозь чужую реплику', () => {
  // Настоящий случай из пролога: перед репликой стоит «Ты правишь три слова
  // карандашом и читаешь вслух». Оболочка обязана показать то, что прочтут.
  const afterRemark = Object.values(game.nodes).filter((n) => {
    const lines = n.text.split('\n').filter((l) => l.trim() !== '');
    return lines.length > 1 && voiceOf(lines[0]!) === 'remark' && voiceOf(lines[1]!) === 'margo';
  });

  assert.ok(afterRemark.length > 0, 'в прологе нет узла с ремаркой перед репликой Марго');
  for (const node of afterRemark) {
    const preview = previewOf(game, at('episodes/prolog/rooms-virt/tu.dorm-room:00#'), option({ target: node.addr }));
    const second = node.text.split('\n').filter((l) => l.trim() !== '')[1]!;
    assert.equal(preview, said(plainText(second)).trim());
  }

  // Узел, который начинает собеседник, предпросмотра не даёт: за этим ходом
  // слов Марго нет, и придумывать их нельзя.
  const answers = Object.values(game.nodes).find((n) => {
    const first = n.text.split('\n').find((line) => line.trim() !== '');
    return first != null && voiceOf(first) === 'speech';
  })!;
  assert.equal(previewOf(game, at('episodes/prolog/rooms-virt/tu.dorm-room:00#'), option({ target: answers.addr })), null);
});

test('список идёт в одном порядке: окружение, сюжет, advance, служебные', () => {
  const base = at('episodes/prolog/rooms-virt/tu.auditorium-gallery:01#');
  const save: SaveState = {
    ...base,
    flags: { 'prolog.lecture-done': { value: true, at: '14.10.2024' } },
  };
  const kinds = buildCatalog(game, save).map((o) =>
    o.system ? 'system' : o.attrs.advance ? 'advance' : o.kind,
  );

  const rank = { environment: 0, story: 1, advance: 2, system: 3 } as const;
  const order = kinds.map((k) => rank[k as keyof typeof rank]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), `порядок съехал: ${kinds.join(', ')}`);
  assert.ok(kinds.includes('advance') && kinds.includes('system'));
});

test('подпись времени — отдельная сущность, а не первая строка прозы', () => {
  // Ищем по графу: подписи автор ставит и убирает вместе с монтажом.
  const timed = Object.values(game.nodes).find((n) => n.attrs.timeLabel != null);
  assert.ok(timed, 'в прологе нет ни одного узла с подписью времени');

  // Подпись живёт атрибутом и из текста не съедена: первая строка кадра
  // остаётся первой строкой кадра.
  assert.ok(timed.attrs.timeLabel!.length > 0);
  assert.equal(timed.text.startsWith(timed.attrs.timeLabel!), false);

  // У обычного узла она приходит в поток отдельной записью и раньше текста.
  const plain = enter(
    game,
    at('episodes/prolog/rooms-virt/tu.dorm-room:00#'),
    'episodes/prolog/rooms-virt/tu.dorm-room:00#',
    false,
  );
  assert.equal(plain.entries[0]!.kind, 'text');
});

/**
 * Аудитория после лекции — единственное место, где выход из комнаты перекрыт
 * авторской опцией. Проверяем обе стороны правила: пока Алерс здесь, `идти
 * в аудиторную галерею` заходит в разговор у двери; когда он ушёл, выход обычный.
 */
test('пока Алерс в аудитории, выход в галерею перекрыт разговором', () => {
  const после = 'episodes/prolog/rooms-virt/tu.h1012:01#после';
  const пусто = 'episodes/prolog/rooms-virt/tu.h1012:01#пусто';
  const идти = (addr: string) => game.nodes[addr]!.options.filter((o) => o.label === 'идти в аудиторную галерею');

  // Команда ровно одна: сгенерированный выход перекрыт, а не добавлен рядом.
  assert.equal(идти(после).length, 1);
  assert.equal(идти(после)[0]!.target, 'episodes/prolog/scenes/01-after-lecture#к-двери');

  assert.equal(идти(пусто).length, 1);
  assert.equal(идти(пусто)[0]!.target, 'episodes/prolog/rooms-virt/tu.auditorium-gallery:01#');
});

test('у двери разговор короткий, но встречу закрывает так же', () => {
  // Кто не подошёл, получает свой вход: один вопрос, один ответ и уход.
  // Проверяем, что короткая ветка тоже ставит флаг конца — иначе аудитория
  // осталась бы навсегда «после лекции», с Алерсом у доски.
  const кДвери = 'episodes/prolog/scenes/01-after-lecture#к-двери';
  const answers = game.nodes[кДвери]!.options.filter((o) => o.label !== '');
  assert.equal(answers.length, 2, 'у двери ровно два ответа');

  for (const answer of answers) {
    const played = enter(game, at(кДвери), answer.target!);
    assert.equal(played.save.flags['prolog.after-lecture-done']?.value, true);
    // И уводит из сцены наружу, в коридор: разговор у двери не возвращается.
    assert.equal(sceneOf(played.save.episodeState.at), 'episodes/prolog/rooms-virt/tu.auditorium-gallery:01');
  }
});

/**
 * Вернуться в уже начатый разговор. Команда в комнате одна, а куда она ведёт —
 * решает вступление сцены: первый раз в знакомство, потом сразу в хаб.
 * Проверяем поведение, а не разметку: важно, где игрок окажется.
 */
function поговорить(room: string, label: string) {
  const found = game.nodes[room]!.options.filter((o) => o.label === label);
  assert.equal(found.length, 1, `в ${room} должна быть одна команда «${label}»`);
  return found[0]!.target!;
}

test('разговор с Алерсом одноразовый: закрыв его, аудиторию застаёшь пустой', () => {
  const target = поговорить('episodes/prolog/rooms-virt/tu.h1012:01#после', 'поговорить с Алерсом');

  // Вход один и тот же, и первым делом — знакомство.
  const first = enter(game, at(target), target);
  assert.equal(first.save.episodeState.at, 'episodes/prolog/scenes/01-after-lecture#знакомство');

  // Закрывает встречу `собрать вещи`: ставит флаг конца и возвращает в аудиторию,
  // уже пустую. Второго входа в разговор из неё нет — Алерс ушёл.
  const собраться = 'episodes/prolog/scenes/01-after-lecture#собраться';
  const done = enter(game, at(собраться), собраться);
  assert.equal(done.save.flags['prolog.after-lecture-done']?.value, true);
  assert.equal(done.save.episodeState.at, 'episodes/prolog/rooms-virt/tu.h1012:01#пусто');

  const empty = game.nodes['episodes/prolog/rooms-virt/tu.h1012:01#пусто']!;
  assert.equal(empty.options.some((o) => o.label === 'поговорить с Алерсом'), false);
});

test('к Тоби можно вернуться, а книга один раз перебивает вход', () => {
  const room = 'episodes/prolog/rooms-virt/tu.dorm-room:00#комната';
  const говорить = поговорить(room, 'говорить с тоби');

  const first = enter(game, at(говорить), говорить);
  assert.equal(first.save.episodeState.at, 'episodes/prolog/scenes/00-talk#первый-разговор');

  const started = {
    ...first.save,
    flags: { ...first.save.flags, 'prolog.talk-started': { value: true, at: null } },
  };
  assert.equal(enter(game, started, говорить).save.episodeState.at, 'episodes/prolog/scenes/00-talk#хаб');

  // Возврат с книгой первым делом запускает оклик, а после флага больше его не повторяет.
  // Сам оклик — проходной узел: он доигрывает и уводит в хаб разговора, поэтому
  // проверяем не позицию на нём, а что он прозвучал.
  const withBook: SaveState = { ...started, inventory: ['00-book'], episodeState: { ...started.episodeState, at: room } };
  const greeted = enter(game, withBook, 'episodes/prolog/rooms-virt/tu.dorm-room:00#');
  assert.equal(greeted.save.flags['prolog.book-greeted']?.value, true);
  assert.equal(greeted.save.episodeState.at, 'episodes/prolog/scenes/00-talk#хаб');

  const afterGreeting: SaveState = {
    ...withBook,
    flags: { ...withBook.flags, 'prolog.book-greeted': { value: true, at: null } },
  };
  assert.equal(
    enter(game, afterGreeting, 'episodes/prolog/rooms-virt/tu.dorm-room:00#').save.episodeState.at,
    room,
  );

  const afterToby: SaveState = {
    ...afterGreeting,
    flags: { ...afterGreeting.flags, 'prolog.toby-left': { value: true, at: null } },
  };
  assert.equal(
    enter(game, afterToby, 'episodes/prolog/rooms-virt/tu.dorm-room:00#').save.episodeState.at,
    'episodes/prolog/rooms-virt/tu.dorm-room:00#один',
  );
});

test('доска и Тоби независимо открывают несущий маршрут 00', () => {
  const gallery = 'episodes/prolog/rooms-virt/tu.auditorium-gallery:00#';
  /*
   * Доска — контейнер (07-оболочка-тз, «Вложенные предметы»): слово даёт не она,
   * а листок с графиком пересдач. Поэтому открываем доску и выбираем окно
   * ровно так, как это делает оболочка.
   */
  const BOARD = 'episodes/prolog/items/00-board';
  const opened = { ...enter(game, at(gallery), `${BOARD}#осмотреть`, false).save, openItem: BOARD };
  const resits = buildCatalog(game, opened).find((o) => o.object?.endsWith('00-board-resits'))!;
  assert.ok(resits, 'доска не предлагает график пересдач');

  const board = enter(game, opened, resits.target!, resits.moves).save;
  assert.equal(board.words['word-ahlers'], 'white');
  assert.equal(board.flags['prolog.ahlers-board']?.value, true);
  // Открытое окно запомнилось: вернувшись к доске, игрок увидит тот же листок.
  assert.equal(board.itemStates['00-board'], '00-board-resits');

  // Доску закрыли: пока она открыта, список принадлежит ей одной.
  const corridor: SaveState = {
    ...board,
    openItem: null,
    episodeState: { ...board.episodeState, at: 'episodes/prolog/rooms-virt/tu.faculty-corridor:00#' },
  };
  assert.ok(labels(corridor).includes('искать алерса'));

  const program = enter(game, corridor, 'episodes/prolog/items/00-program#искать', false).save;
  assert.equal(program.words['word-containment'], 'white');
  assert.equal(program.flags['prolog.ahlers-program']?.value, true);

  const library: SaveState = {
    ...program,
    episodeState: { ...program.episodeState, at: 'episodes/prolog/rooms-virt/tu.library:00#' },
  };
  assert.ok(labels(library).includes('искать контейнмент'));
  const found = enter(game, library, 'episodes/prolog/items/00-catalog#искать', false).save;
  assert.ok(labels({ ...found, episodeState: { ...found.episodeState, at: library.episodeState.at } }).includes('взять учебник'));

  const talk = enter(
    game,
    at('episodes/prolog/rooms-virt/tu.dorm-room:00#комната'),
    'episodes/prolog/scenes/00-talk#алерс',
  ).save;
  assert.equal(talk.words['word-ahlers'], 'white');
  assert.equal(talk.flags['prolog.ahlers-toby']?.value, true);
});

test('финал 00 либо ведёт на лекцию, либо закрывает игру', () => {
  const night = 'episodes/prolog/scenes/00-night#';
  const base: SaveState = {
    ...at(night),
    words: { 'word-only-case': 'white' },
    episodeState: { ...at(night).episodeState, at: night },
  };

  const going = enter(game, base, 'episodes/prolog/scenes/00-night#идти').save;
  assert.equal(going.flags['prolog.course-added']?.value, true);
  assert.equal(sceneOf(going.episodeState.at), 'episodes/prolog/transitions/01-monday');

  const spared = enter(game, base, 'episodes/prolog/scenes/00-night#пожалеть').save;
  assert.equal(spared.episodeState.at, 'episodes/prolog/scenes/00-night#конец');
  assert.ok(game.nodes[spared.episodeState.at]!.attrs.tag.includes('titlecard'));
  assert.equal(game.nodes[spared.episodeState.at]!.options.length, 0);
});
