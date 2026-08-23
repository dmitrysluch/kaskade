import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../app/server/content/load.ts';
import { validate } from '../app/server/validate/index.ts';
import { buildCatalog } from '../app/client/engine/catalog.ts';
import { begin, dateAt, enter, evalCondition, freshSave, interpolate, previewOf, sceneOf, terms } from '../app/client/engine/state.ts';
import { overlayLines, statusText } from '../app/client/ui/lines.ts';
import type { SaveState } from '../app/shared/types.ts';
import type { StreamEntry } from '../app/client/engine/state.ts';
import { option } from './helpers.ts';
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
  return { ...freshSave(game), started: true, episodeState: { ...freshSave(game).episodeState, at: addr } };
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

test('позвонить нет, пока телефон не взят, — и это не флаг, а механика', () => {
  const withPhone = 'episodes/prolog/rooms/06-corridor#';
  const before = at(withPhone);
  assert.equal(
    labels(before).some((l) => l.startsWith('позвонить')),
    false,
  );
  assert.ok(labels(before).includes('взять телефон'));

  const taken = enter(game, before, 'episodes/prolog/items/06-phone#взять', false);
  assert.ok(taken.save.inventory.includes('06-phone'));
  assert.ok(labels(taken.save).includes('позвонить'));

  // Позиция не сдвинулась: предмет отвечает, но никуда не ведёт.
  assert.equal(taken.save.episodeState.at, withPhone);
});

test('позвонить не попадает в строку подсказок никогда', () => {
  const episode = game.episodes[0]!;
  assert.equal(episode.verbs.includes('позвонить'), false);
  assert.ok(episode.itemVerbs.includes('позвонить'));
});

test('once не даёт позвонить дважды', () => {
  const withPhone = { ...at('episodes/prolog/rooms/06-dean#'), inventory: ['06-phone'] };
  const called = enter(game, withPhone, 'episodes/prolog/items/06-phone#позвонить', false);

  assert.equal(called.save.flags['prolog.phoned']?.value, true);
  assert.equal(
    labels(called.save).some((l) => l.startsWith('позвонить')),
    false,
  );
});

test('история копится в пределах сцены, а переход на новое место её начинает заново', () => {
  const room = 'episodes/prolog/rooms/01-hall#';

  // Осмотреть предмет — та же страница: узел предмета игрока не двигает.
  const look = enter(game, at(room), 'episodes/prolog/items/01-board#осмотреть', false);
  assert.equal(sceneOf(look.save.episodeState.at), sceneOf(room));

  // Уйти в коридор — новая страница.
  const go = enter(game, at(room), 'episodes/prolog/rooms/01-corridor#');
  assert.notEqual(sceneOf(go.save.episodeState.at), sceneOf(room));

  // Внутри одной сцены переходы по узлам страницу не сбрасывают.
  const inScene = enter(game, at('episodes/prolog/scenes/01-lecture#стена'), 'episodes/prolog/scenes/01-lecture#число');
  assert.equal(sceneOf(inScene.save.episodeState.at), 'episodes/prolog/scenes/01-lecture');
});

test('дата берётся из заметки, где игрок стоит, а не из сейва', () => {
  const start = { ...freshSave(game), started: true };
  const scene = enter(game, start, 'episodes/prolog/scenes/06-signature#');
  assert.equal(dateAt(game, scene.save), '11.09.2026');

  // У комнаты своя дата, и статус показывает её же.
  const room = enter(game, scene.save, 'episodes/prolog/rooms/06-dean#');
  assert.equal(dateAt(game, room.save), '11.09.2026');

  // Дата в сейве не хранится вовсе: показывать нечего, кроме как из заметки.
  assert.equal('date' in room.save.episodeState, false);
});

test('флаг помнит дату сцены, в которой поставлен', () => {
  const inRoom = {
    ...at('episodes/prolog/rooms/06-corridor#'),
    inventory: ['06-phone'],
    episodeState: { ...at('episodes/prolog/rooms/06-corridor#').episodeState, date: '11.09.2026' },
  };
  const called = enter(game, inRoom, 'episodes/prolog/items/06-phone#позвонить', false);

  const flag = called.save.flags['prolog.phoned']!;
  assert.equal(flag.value, true);
  // Дата берётся из сцены, в которой игрок стоит, а не из системных часов:
  // у предмета своей даты нет и быть не должно.
  assert.equal(flag.at, '11.09.2026');

  assert.equal(interpolate('дата: {{prolog.phoned.at}}', called.save), 'дата: 11.09.2026');
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

test('у каждой сцены пролога есть внутриигровая дата', () => {
  const scenes = Object.values(game.docs).filter((d) => d.type === 'scene');
  assert.ok(scenes.length > 0);
  for (const scene of scenes) assert.ok(scene.date, `у сцены ${scene.docId} нет date`);
});

test('блок options один на комнату, а предметы у каждого состояния свои', () => {
  const вход = game.nodes['episodes/prolog/rooms/00-room#']!;
  const один = game.nodes['episodes/prolog/rooms/00-room#один']!;

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
  const inRoom = labels(at('episodes/prolog/rooms/05-room#'));
  for (const command of ['справочник', 'дело', 'предметы']) assert.ok(inRoom.includes(command));
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

  for (let step = 0; step < 200; step++) {
    // `конец` — единственный законный тупик: дальше пролога пока ничего нет.
    if (save.episodeState.at.endsWith('#конец')) return;

    const node = full.nodes[save.episodeState.at]!;
    // Титульная карточка ввод не принимает — дальше уводит Transition.
    if (node.attrs.tag.includes('titlecard')) {
      const next = node.options.find((o) => o.label === '')!.target!;
      save = enter(full, save, next).save;
      continue;
    }

    const options = buildCatalog(full, save).filter((o) => o.system === null && !o.locked);
    assert.ok(options.length > 0, `тупик в узле ${save.episodeState.at}`);

    // Ходим как игрок: сначала то, что здесь ещё не пробовали, и только когда
    // всё исчерпано — команда, закрывающая место (`advance`). Она стоит в каталоге
    // последней, и без этого правила обход крутился бы в комнате вечно.
    const seen = tried.get(save.episodeState.at) ?? new Set<string>();
    tried.set(save.episodeState.at, seen);
    const chosen = options.find((o) => !seen.has(o.label)) ?? options[options.length - 1]!;
    seen.add(chosen.label);
    save = enter(full, save, chosen.target!, chosen.moves).save;
  }

  assert.fail(`пролог не сошёлся за 200 шагов, застрял на ${save.episodeState.at}`);
});

test('демо-срез: сцены 00–02 открыты, 03 закрыта, граф целый', () => {
  const closed = game.episodes[0]!.closed;
  assert.deepEqual(closed, ['episodes/prolog/scenes/03-birthday'], 'демо-срез съехал');

  // Дверь в Нойкёльн открыта: коридор снова предлагает уйти.
  const done = { value: true, at: '15.10.2024' };
  const corridor = {
    ...at('episodes/prolog/rooms/01-corridor#'),
    flags: { 'prolog.dorm-done': done, 'prolog.lecture-done': done },
  };
  assert.ok(labels(corridor).includes('уйти'));

  // А дальше срез: маршруты в день рождения есть в графе, но не срабатывают.
  // Ищем по графу: концовок у сцены несколько, и автор их переписывает.
  const doors = Object.values(game.nodes).filter((n) =>
    n.options.some((o) => o.label === '' && o.target?.startsWith('episodes/prolog/scenes/03-birthday#')),
  );
  assert.ok(doors.length > 0, 'в графе нет ни одного входа в день рождения');
  for (const door of doors) {
    assert.equal(enter(game, at(door.addr), door.addr).save.episodeState.at, door.addr, door.addr);
  }
});

test('слово, отданное прологом, становится белым', () => {
  // Ищем по графу, а не по имени: слова автор заводит и убирает каждый день,
  // а проверять надо механику — выдал узел, значит слово в деле и его можно
  // произносить.
  const giver = Object.values(game.nodes).find((n) => n.attrs.give.some((id) => game.words[id]));
  assert.ok(giver, 'в прологе ни один узел не отдаёт слова');

  const word = giver.attrs.give.find((id) => game.words[id])!;
  const r = enter(game, at('episodes/prolog/rooms/00-room#'), giver.addr, false);
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

test('титр передаёт дату статусу', () => {
  // Карточка гаснет, терминал возвращается — и в статусе уже новая дата, та самая,
  // что была в рамке. Титр не подписывает кадр, а устанавливает отсчёт.
  const card = Object.values(game.nodes).find((n) => n.attrs.tag.includes('titlecard'))!;
  assert.ok(card.date, 'у титра нет собственной даты — статусу нечего передавать');

  const after = enter(game, at(card.addr), card.addr);
  assert.equal(dateAt(game, after.save), card.date);
  // И на самой карточке текст в поток не уезжает: это объект, а не реплика.
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
  assert.equal(seen('episodes/prolog/rooms/00-room#'), '12.10.2024 · BLUE CARD 810 дней');
  assert.equal(seen('episodes/prolog/scenes/04-abh#'), '12.05.2026 · BLUE CARD 233 дня');
  assert.equal(seen('episodes/prolog/rooms/06-dean#'), '11.09.2026 · BLUE CARD 111 дней');

  // Срок, который не назначен, не показывается вовсе.
  const noCard: SaveState = { ...at('episodes/prolog/rooms/00-room#'), dates: {} };
  assert.equal(statusText(dateAt(game, noCard), terms(game, noCard)), '12.10.2024');
});

test('срок можно сдвинуть узлом и спросить о нём в условии', () => {
  const start = at('episodes/prolog/rooms/00-room#');
  assert.equal(evalCondition('date:blueCard', start), true);
  assert.equal(evalCondition('date:blueCard', { ...start, dates: {} }), false);

  // Механизм общий: имя срока — любое объявленное, не только blueCard.
  const moved: SaveState = { ...start, dates: { blueCard: '31.12.2028' } };
  assert.equal(statusText(dateAt(game, moved), terms(game, moved)), '12.10.2024 · BLUE CARD 1541 день');
});

test('служебные команды берут аргумент: справочник и дело — сразу статью', () => {
  const save = at('episodes/prolog/rooms/00-room#');
  const anyWord = Object.keys(game.words)[0]!;
  const withWord: SaveState = { ...save, words: { [anyWord]: 'white' } };
  const all = labels(withWord);

  // Аргументы обязаны быть опциями: «не понимаю» в этой игре не бывает.
  const term = Object.keys(game.reference)[0]!;
  assert.ok(all.includes(`справочник ${term}`), `нет опции "справочник ${term}"`);
  assert.ok(all.includes(`дело ${game.words[anyWord]!.label}`));

  // И открывают ровно одну статью, а не список.
  const one = overlayLines({ kind: 'справочник', arg: term }, game, withWord, 60);
  const list = overlayLines({ kind: 'справочник', arg: null }, game, withWord, 60);
  assert.equal(one.length, 1);
  assert.ok(list.length > one.length);
});

test('управление — действие оболочки, а не команда терминала', () => {
  // Метаинструкция не притворяется действием: её нет ни в каталоге, ни в истории.
  const all = labels(at('episodes/prolog/rooms/00-room#'));
  assert.equal(all.includes('управление'), false);
  assert.ok(all.includes('справочник') && all.includes('дело') && all.includes('предметы'));
});

test('меню — команда: сброс обязан находиться набором, а не только клавишей', () => {
  const all = labels(at('episodes/prolog/rooms/00-room#'));
  assert.ok(all.includes('меню'));

  // Оно служебное, значит стоит в конце списка, а не среди действий комнаты.
  const catalog = buildCatalog(game, at('episodes/prolog/rooms/00-room#'));
  const option = catalog.find((o) => o.label === 'меню')!;
  assert.equal(option.kind, 'system');
  assert.equal(option.system?.kind, 'меню');
  assert.equal(catalog.indexOf(option) > catalog.findIndex((o) => !o.system), true);

  // Аргумента у меню нет: `меню сброс` вводить негде и не надо — выбор внутри.
  assert.deepEqual(all.filter((l) => l.startsWith('меню ')), []);
});

test('начать заново — то же состояние, что первый запуск', () => {
  // Сброс проходит через ту же дверь, что запуск: `begin` от чистого сейва.
  const played = enter(game, at('episodes/prolog/rooms/00-room#'), 'episodes/prolog/rooms/00-room#').save;
  assert.notDeepEqual(played.episodeState.at, freshSave(game).episodeState.at);

  const again = begin(game, freshSave(game));
  assert.equal(again.save.episodeState.at, game.episodes[0]!.entry);
  assert.deepEqual(again.save.words, {});
  assert.deepEqual(again.save.flags, {});
  assert.deepEqual(again.save.inventory, []);
  assert.deepEqual(again.save.splashes, []);
  assert.deepEqual(again.save.itemStates, {});
  assert.deepEqual(again.history, []);
  assert.equal(again.reading, null);
  assert.equal(again.overlay, null);
  // Обучающий экран показывается снова: заново — значит и для нового игрока тоже.
  assert.equal(again.save.taught, false);
  assert.equal(again.save.hinted, false);
});

test('выданное слово объявляется в потоке', () => {
  const save = at('episodes/prolog/rooms/00-room#');
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
    .filter((o) => o.label !== '' && previewOf(game, o) != null);

  assert.ok(withReply.length > 10, `предпросмотров всего ${withReply.length}`);
  for (const option of withReply) {
    const target = game.nodes[option.target!]!;
    const preview = previewOf(game, option)!;
    assert.match(preview, /^—\s/, 'предпросмотр показывает реплику Марго');
    // Дословно: строка обязана найтись в узле как есть, а не быть пересказом.
    assert.ok(
      target.text.split('\n').some((l) => l.trim() === preview),
      `предпросмотра "${preview}" нет в узле ${target.addr}`,
    );
  }

  // За действием без реплики Марго предпросмотра нет.
  const look = game.nodes['episodes/prolog/rooms/00-room#']!.options.find((o) => o.verb === 'осмотреть')!;
  assert.equal(previewOf(game, look), null);
});

test('предпросмотр проходит сквозь ремарку, но не сквозь чужую реплику', () => {
  // Настоящий случай из пролога: перед репликой стоит «Ты правишь три слова
  // карандашом и читаешь вслух». Оболочка обязана показать то, что прочтут.
  const afterRemark = Object.values(game.nodes).filter((n) => {
    const lines = n.text.split('\n').filter((l) => l.trim() !== '');
    return lines.length > 1 && !/^[>—]/.test(lines[0]!.trim()) && /^—\s/.test(lines[1]!.trim());
  });

  assert.ok(afterRemark.length > 0, 'в прологе нет узла с ремаркой перед репликой Марго');
  for (const node of afterRemark) {
    const preview = previewOf(game, option({ target: node.addr }));
    assert.equal(preview, node.text.split('\n').filter((l) => l.trim() !== '')[1]!.trim());
  }

  // Узел, который начинает собеседник, предпросмотра не даёт: за этим ходом
  // слов Марго нет, и придумывать их нельзя.
  const answers = Object.values(game.nodes).find((n) => /^>/.test(n.text.trim()))!;
  assert.equal(previewOf(game, option({ target: answers.addr })), null);
});

test('список идёт в одном порядке: окружение, сюжет, advance, служебные', () => {
  const save = at('episodes/prolog/rooms/00-room#один');
  const withFlag: SaveState = {
    ...save,
    flags: { 'prolog.dorm-done': { value: true, at: '12.10.2024' } },
  };
  const kinds = buildCatalog(game, withFlag).map((o) =>
    o.system ? 'system' : o.attrs.advance ? 'advance' : o.kind,
  );

  const rank = { environment: 0, story: 1, advance: 2, system: 3 } as const;
  const order = kinds.map((k) => rank[k as keyof typeof rank]);
  assert.deepEqual(order, [...order].sort((a, b) => a - b), `порядок съехал: ${kinds.join(', ')}`);
  assert.ok(kinds.includes('advance') && kinds.includes('system'));
});
