import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../app/server/content/load.ts';
import { buildCatalog } from '../app/client/engine/catalog.ts';
import {
  confirmTransition, enter, freshSave, openLevel, openScreen, sceneOf, streamOf,
  type EnterResult,
} from '../app/client/engine/state.ts';
import type { SaveState } from '../app/shared/types.ts';

const game = loadContent();
const room = (name: string, stage: string) => 'episodes/prolog/rooms-virt/tu.' + name + ':' + stage + '#';
const labels = (save: SaveState) => buildCatalog(game, save).filter(o => !o.locked).map(o => o.label);
const text = (result: EnterResult) => result.entries.map(e => e.text).join('\n');
const restored = (save: SaveState): SaveState => JSON.parse(JSON.stringify(save));

function changeStage(save: SaveState, stage: string): SaveState {
  const transition = Object.values(game.transitions).find(t => t.stage === stage)!;
  const onCard = enter(game, save, transition.docId + '#').save;
  return confirmTransition(game, onCard, transition.docId).save;
}

function start(stage = '00'): SaveState {
  return changeStage({ ...freshSave(game), started: true }, stage);
}

// Повторяем исполнение обычной команды и открытие/закрытие уровня предмета.
function act(save: SaveState, label: string): EnterResult {
  const option = buildCatalog(game, save).find(o => o.label === label && !o.locked);
  assert.ok(option, 'нет команды «' + label + '» в ' + save.episodeState.at);
  const openItem = openLevel(game, save, option);
  if (!option.target) return { save: { ...save, openItem }, entries: [] };
  const result = enter(game, save, option.target, option.moves);
  const moved = sceneOf(result.save.episodeState.at) !== sceneOf(save.episodeState.at);
  return { ...result, save: { ...result.save, openItem: moved ? null : openItem } };
}

test('свет переключается только в 01 и сохраняется после осмотра, прогулки и reload', () => {
  let save = enter(game, start(), room('auditorium-gallery', '00')).save;
  assert.ok(save.episodeState.at.endsWith('#свет'));
  assert.ok(!labels(save).includes('переключить свет'));
  assert.ok(!labels(save).includes('осмотреть выключатель'));

  save = act(save, 'поговорить со студенткой').save;
  save = act(save, 'почему ты плачешь').save;
  assert.equal(save.words['word-ahlers'], 'white');
  const back = act(save, 'оставить её');
  save = back.save;
  assert.ok(save.episodeState.at.endsWith('#свет'));
  assert.deepEqual(back.entries, [], 'resume не повторяет вступление или reentry');

  save = act(save, 'идти во двор').save;
  save = act(restored(save), 'идти в учебный комплекс').save;
  assert.ok(save.episodeState.at.endsWith('#свет'));
  assert.ok(!labels(save).includes('переключить свет'));

  save = changeStage(restored(save), '01');
  assert.ok(save.episodeState.at.endsWith('#полусвет'), 'субботний свет не переносится в понедельник');
  assert.ok(!labels(save).includes('поговорить со студенткой'));
  assert.ok(!labels(save).includes('уйти'));
  assert.equal(labels(save).filter(s => s === 'осмотреть выключатель').length, 1);
  const before = save.episodeState.at;
  save = act(save, 'осмотреть выключатель').save;
  assert.equal(save.episodeState.at, before, 'осмотр не переключает свет');
  save = act(save, 'переключить свет').save;
  assert.ok(save.episodeState.at.endsWith('#свет'));
  save = act(save, 'идти во двор').save;
  save = act(restored(save), 'идти в учебный комплекс').save;
  assert.ok(save.episodeState.at.endsWith('#свет'), 'свет сохраняется после прогулки и reload');
  save = {
    ...save,
    flags: {
      ...save.flags,
      'prolog.lecture-done': { value: true, at: null },
      'prolog.after-lecture-done': { value: true, at: null },
    },
  };
  for (let i = 0; i < 2; i++) {
    assert.ok(!labels(save).includes('уйти'), 'галерея не завершает день при любом положении света');
    save = act(save, 'переключить свет').save;
  }
  save = enter(game, start('03'), room('auditorium-gallery', '03')).save;
  assert.ok(save.episodeState.at.endsWith('#свет'));
  assert.ok(!labels(save).includes('переключить свет'));
  assert.ok(!labels(save).includes('осмотреть выключатель'));
});

test('описание коридора и воспоминание выводятся один раз, при возвращении остаётся короткая ремарка', () => {
  const first = enter(game, start(), room('dorm-corridor', '00'));
  const introduction = text(first);
  assert.match(introduction, /марго/);
  let save = act(first.save, 'осмотреть сушилку').save;
  assert.equal(save.episodeState.at, first.save.episodeState.at);
  save = act(save, 'идти на общую кухню').save;
  const back = act(restored(save), 'идти в жилой коридор');
  assert.ok(back.entries.filter(e => e.kind === 'text').length === 1);
  assert.doesNotMatch(text(back), /марго/);
  assert.equal(streamOf(game, back.save).filter(e => e.text === introduction).length, 1);

  save = enter(game, start('03'), room('dorm-corridor', '03')).save;
  assert.doesNotMatch(streamOf(game, save).map(e => e.text).join('\n'), /марго/);
});

test('холодильник хранит выбранную коробку, чтение и закрытие не выдают еду и не повторяют кухню', () => {
  let save = enter(game, start(), room('dorm-kitchen', '00')).save;
  const kitchen = save.episodeState.at;
  const possessions = { inventory: save.inventory, words: save.words, flags: save.flags, date: save.currentDate };
  save = act(save, 'осмотреть холодильник').save;
  assert.deepEqual(labels(save).filter(s => s.startsWith('осмотреть ')), [
    'осмотреть коробку Марго', 'осмотреть коробку Тоби', 'осмотреть банку из D.12',
  ]);
  save = act(save, 'осмотреть коробку Тоби').save;
  assert.equal(sceneOf(openScreen(game, restored(save))!.addr), 'episodes/prolog/items/campus-food-toby');
  const closed = act(save, 'закрыть холодильник');
  save = closed.save;
  assert.deepEqual(closed.entries, []);
  assert.equal(save.episodeState.at, kitchen);
  assert.equal(save.openItem, null);
  assert.deepEqual(
    { inventory: save.inventory, words: save.words, flags: save.flags, date: save.currentDate },
    possessions,
  );
  assert.match(text(act(save, 'осмотреть плиту')), /марго/);
  const later = enter(game, start('03'), room('dorm-kitchen', '03')).save;
  assert.doesNotMatch(text(act(later, 'осмотреть плиту')), /марго/);
});

test('осмотры дверей не дают имя в 00, в 03 меняются только предусмотренные таблички и доступ', () => {
  for (const stage of ['00', '03']) {
    let save = enter(game, start(stage), room('faculty-corridor', stage)).save;
    const menu = labels(save);
    assert.equal(menu.filter(s => s === 'осмотреть 2.14').length, 1);
    assert.equal(menu.filter(s => s === 'осмотреть список номеров').length, 1);
    assert.equal(menu.includes('идти в секретариат'), stage === '03');
    assert.ok(!menu.some(s => /идти в (кабинет Алерса|проектную администрацию|соседнюю группу|бюро докторантуры)/.test(s)));
    assert.ok(menu.includes('осмотреть стенд программ'));
    for (const label of ['осмотреть 2.14', 'осмотреть список номеров']) {
      const result = act(save, label);
      if (stage === '00') assert.doesNotMatch(text(result), /ahlers|алерс/i);
      else assert.match(text(result), /ahlers/i);
      assert.equal(result.save.words['word-ahlers'], undefined);
      save = result.save;
    }
  }
});

test('выдача книги возобновляет библиотеку без повторного описания, обед не закрывает читальный зал', () => {
  let save = start();
  save = { ...save, words: { 'word-ahlers': 'white', 'word-containment': 'white' } };
  const first = enter(game, save, room('library', '00'));
  save = first.save;
  assert.doesNotMatch(text(first), /Обеденный перерыв/);
  assert.ok(labels(save).includes('осмотреть библиотекаршу'));

  let result = first;
  for (const label of [
    'говорить с библиотекаршей', 'нужен Sicherheitsbehälter', 'протянуть билет',
    'не моя, просто заинтересовало', 'забрать учебник',
  ]) {
    result = act(save, label);
    save = result.save;
  }
  assert.ok(save.inventory.includes('00-book'));
  assert.doesNotMatch(text(result), /пуфике|линолеум|В читальном зале тихо/);
  assert.equal(save.episodeState.at, first.save.episodeState.at);
  assert.equal(streamOf(game, restored(save)).filter(e => e.text.includes('пуфике')).length, 1);

  for (const stage of ['01', '03']) {
    const later = enter(game, start(stage), room('library', stage));
    assert.match(text(later), /Обеденный перерыв/);
    assert.ok(labels(later.save).includes('идти во двор'));
    assert.ok(!labels(later.save).some(s => /библиотекарш/.test(s)));
    assert.ok(!labels(later.save).some(s => /каталог/.test(s)));
  }
});

test('двор показывает пять предметов и меняет освещение по чтению только в 00', () => {
  let save = enter(game, start(), room('yard', '00')).save;
  const look = labels(save).filter(s => s.startsWith('осмотреть '));
  assert.equal(look.length, 5);
  assert.equal(look.filter(s => s.includes('контейнер')).length, 4);
  assert.ok(look.includes('осмотреть велосипед'));
  const before = { inventory: save.inventory, words: save.words, date: save.currentDate };
  for (const label of look) save = act(save, label).save;
  assert.deepEqual({ inventory: save.inventory, words: save.words, date: save.currentDate }, before);

  for (const [flag, node] of [
    ['prolog.study-definitions', '#сумерки'], ['prolog.study-only-case', '#ночь'],
  ] as const) {
    save = act(save, 'идти в библиотеку').save;
    save = { ...save, flags: { ...save.flags, [flag]: { value: true, at: null } } };
    save = act(restored(save), 'идти во двор').save;
    assert.ok(save.episodeState.at.endsWith(node));
  }
  save = changeStage(save, '03');
  const later = enter(game, save, room('yard', '03'));
  assert.ok(later.save.episodeState.at.endsWith('#двор'));
  assert.doesNotMatch(text(later), /темно|сумерки/);
});

test('доска в 01 остаётся контейнером, её объявления и автомат не дублируются между версиями', () => {
  for (const stage of ['00', '01', '03']) {
    let save = enter(game, start(stage), room('auditorium-gallery', stage)).save;
    assert.equal(labels(save).filter(s => s === 'осмотреть доску').length, 1);
    assert.equal(labels(save).filter(s => s === 'осмотреть кофейный автомат').length, 1);
    const coffee = act(save, 'осмотреть кофейный автомат');
    if (stage === '01') assert.match(text(coffee), /Ich bin auch kaputt/);
    if (stage === '03') assert.doesNotMatch(text(coffee), /С весны/);
    save = act(save, 'осмотреть доску').save;
    if (stage === '00' || stage === '01') {
      assert.notEqual(save.openItem, null);
      assert.equal(labels(save).filter(s => s.startsWith('осмотреть ')).length, stage === '00' ? 4 : 5);
      for (const [label, item] of [
        ['осмотреть объявление о прослушивании', 'board-orchestra'],
        ['осмотреть объявление об обмене комнаты', 'board-room-swap'],
      ] as const) {
        save = act(save, label).save;
        // `openScreen` отдаёт узел: заметку окна из него достаёт `sceneOf`.
        assert.equal(sceneOf(openScreen(game, save)!.addr), 'episodes/prolog/items/' + stage + '-' + item);
        assert.equal(save.openItem, 'episodes/prolog/items/' + (stage === '00' ? '00-board' : '01-board-notices'));
      }
      const close = buildCatalog(game, save).find(o => o.verb === 'закрыть' && !o.locked);
      assert.ok(close, 'у доски есть команда закрытия');
      save = act(save, close.label).save;
      assert.equal(save.openItem, null);
      assert.equal(sceneOf(save.episodeState.at), sceneOf(room('auditorium-gallery', stage)));
    }
  }
});
