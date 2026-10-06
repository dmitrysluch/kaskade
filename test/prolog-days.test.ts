import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadContent } from '../app/server/content/load.ts';
import { buildCatalog } from '../app/client/engine/catalog.ts';
import { confirmTransition, enter, freshSave, openLevel, sceneOf, streamOf } from '../app/client/engine/state.ts';
import type { SaveState } from '../app/shared/types.ts';

const game = loadContent();
const room = (name: string, stage: string) => `episodes/prolog/rooms-virt/tu.${name}:${stage}#`;
const AFTER = 'prolog.after-lecture-done';
const NOTICE = 'prolog.band-notice-read';
const MET = 'prolog.band-met';
const POLICE = 'prolog.police-done';
const labels = (save: SaveState) => buildCatalog(game, save).filter(o => !o.locked).map(o => o.label);
const restored = (save: SaveState): SaveState => JSON.parse(JSON.stringify(save));

function withFlags(save: SaveState, names: string[]): SaveState {
  return { ...save, flags: { ...save.flags, ...Object.fromEntries(names.map(name => [name, { value: true, at: save.currentDate }])) } };
}

function changeStage(save: SaveState, stage: string): SaveState {
  const transition = Object.values(game.transitions).find(t => t.stage === stage)!;
  const card = enter(game, save, `${transition.docId}#`).save;
  return confirmTransition(game, card, transition.docId).save;
}

function start(stage = '01', flags: string[] = []): SaveState {
  // В 02 попадают только после лекции; остальные условия выставляет сам тест.
  const names = stage === '02' || flags.includes(AFTER) ? [...flags, 'prolog.lecture-done'] : flags;
  return changeStage(withFlags({ ...freshSave(game), started: true }, names), stage);
}

function act(save: SaveState, label: string): SaveState {
  const options = buildCatalog(game, save).filter(o => !o.locked && o.label === label);
  assert.equal(options.length, 1, `ожидалась одна команда «${label}» в ${save.episodeState.at}`);
  const option = options[0]!;
  const openItem = openLevel(game, save, option);
  if (!option.target) return { ...save, openItem };
  const result = enter(game, save, option.target, option.moves).save;
  return { ...result, openItem: sceneOf(result.episodeState.at) === sceneOf(save.episodeState.at) ? openItem : null };
}

test('00: сон во всех состояниях комнаты помечен advance и требует найденной ошибки', () => {
  for (const id of ['комната', 'после-разговора', 'один']) {
    const sleep = game.nodes[`${room('dorm-room', '00')}${id}`]!.options.find(o => o.label === 'лечь спать');
    assert.ok(sleep?.attrs.advance);
    assert.equal(sleep.attrs.if, 'word:word-only-case');
    assert.equal(sleep.target, 'episodes/prolog/scenes/00-night#');
  }
});

test('01: комната открыта до лекции, но сон недоступен до завершения разговора с Алерсом', () => {
  for (const flags of [[], ['prolog.lecture-done']]) {
    let save = enter(game, start('01', flags), room('dorm-corridor', '01')).save;
    assert.ok(labels(save).includes('идти в комнату'));
    assert.ok(!labels(save).includes('заглянуть'));
    save = act(save, 'идти в комнату');
    assert.ok(!labels(save).includes('лечь спать'));
    assert.ok(labels(save).includes('идти в жилой коридор'));
  }
});

test('01: полный и оба коротких ответа Алерсу ведут домой пешком, сон переносит в 02', () => {
  for (const branch of ['собраться', 'у-двери-позиция', 'у-двери-учебник']) {
    let save = enter(game, start('01', ['prolog.lecture-done']), `episodes/prolog/scenes/01-after-lecture#${branch}`).save;
    assert.ok(save.flags[AFTER]?.value);
    if (sceneOf(save.episodeState.at).endsWith('tu.h1012:01')) save = act(save, 'идти в аудиторную галерею');
    assert.ok(!labels(save).includes('уйти'));
    for (const label of ['идти во двор', 'идти в общагу', 'идти в комнату']) save = act(save, label);
    assert.equal(save.currentDate, '14.10.2024');
    assert.ok(!save.flags[MET], 'группа не является условием сна');
    assert.ok(buildCatalog(game, save).find(o => o.label === 'лечь спать')?.attrs.advance);
    save = act(save, 'лечь спать');
    assert.equal(save.episodeState.at, 'episodes/prolog/transitions/02-club-entry#');
    assert.equal(save.activeStage, '01', 'дата меняется только после подтверждения карточки');
    save = confirmTransition(game, save, 'episodes/prolog/transitions/02-club-entry').save;
    assert.equal(save.activeStage, '02');
    assert.equal(save.currentDate, '08.06.2025');
  }
});

test('01: прогулка и reload не сбрасывают доступность сна', () => {
  let save = enter(game, start('01', [AFTER]), room('dorm-room', '01')).save;
  save = act(save, 'идти в жилой коридор');
  save = act(restored(save), 'идти в комнату');
  assert.ok(labels(save).includes('лечь спать'));
  assert.equal(save.currentDate, '14.10.2024');
});

test('01: после лекции музыка появляется и при повторном входе, без объявления', () => {
  let save = enter(game, start(), room('dorm-corridor', '01')).save;
  assert.ok(!labels(save).includes('заглянуть'));
  save = act(save, 'идти во двор');
  save = withFlags(save, [AFTER, 'prolog.lecture-done']);
  save = act(restored(save), 'идти в общагу');
  assert.ok(labels(save).includes('заглянуть'));
  assert.match(streamOf(game, save).map(e => e.text).join('\n'), /слышна гитара/);
  save = act(save, 'идти в комнату');
  save = act(save, 'идти в жилой коридор');
  assert.ok(labels(save).includes('заглянуть'), 'проход мимо не расходует встречу');
});

test('01: без объявления вопрос о музыке предшествует вопросу про басиста; после встречи можно спать', () => {
  let save = enter(game, start('01', [AFTER]), room('dorm-corridor', '01')).save;
  save = act(save, 'заглянуть');
  assert.ok(labels(save).includes('что играете'));
  assert.ok(!labels(save).includes('вам басист нужен'));
  for (const label of ['что играете', 'вам басист нужен', 'а ты просто в ми миноре играй', 'выйти в коридор']) save = act(save, label);
  assert.ok(!labels(save).includes('заглянуть'));
  save = act(restored(save), 'идти в комнату');
  assert.ok(labels(save).includes('лечь спать'));
});

test('оба объявления запоминаются при осмотре и открывают прямой вопрос музыканту', () => {
  for (const stage of ['00', '01']) {
    let save = enter(game, start(stage), room('auditorium-gallery', stage)).save;
    save = act(save, 'осмотреть доску');
    assert.ok(!save.flags[NOTICE]);
    save = act(save, 'осмотреть объявление о прослушивании');
    assert.ok(save.flags[NOTICE]?.value);
    const close = buildCatalog(game, save).find(o => o.verb === 'закрыть' && !o.locked)!;
    save = act(save, close.label);
    if (stage === '00') save = changeStage(save, '01');
    save = enter(game, withFlags(save, [AFTER, 'prolog.lecture-done']), room('dorm-corridor', '01')).save;
    save = act(save, 'заглянуть');
    assert.ok(labels(save).includes('вам басист нужен'));
    assert.ok(!labels(save).includes('что играете'));
  }
});

test('встречу можно оборвать на любой реплике, и после reload она не начинается заново', () => {
  for (const path of [[], ['что играете'], ['что играете', 'вам басист нужен']]) {
    let save = enter(game, start('01', [AFTER]), room('dorm-corridor', '01')).save;
    save = act(save, 'заглянуть');
    for (const label of path) save = act(save, label);
    save = act(save, 'выйти в коридор');
    save = act(save, 'идти в комнату');
    assert.ok(labels(save).includes('лечь спать'));
    save = act(restored(save), 'идти в жилой коридор');
    assert.ok(!labels(save).includes('заглянуть'));
  }
});

test('встреча с группой не появляется в других днях даже при сохранённых флагах', () => {
  for (const stage of ['00', '02', '03']) {
    const save = enter(game, start(stage, [AFTER, NOTICE]), room('dorm-corridor', stage)).save;
    assert.ok(!labels(save).includes('заглянуть'));
  }
});

test('реплики Марго в сцене с музыкантами не произносятся автоматически', () => {
  for (const node of game.docs['episodes/prolog/scenes/01-band']!.nodes.filter(n => /> марго —/.test(n.text))) {
    const incoming = Object.values(game.nodes).flatMap(n => n.options.filter(o => o.target === node.addr));
    assert.ok(incoming.length > 0);
    assert.ok(incoming.every(o => o.label !== ''), node.addr);
  }
});

test('02: до окончания полиции сон недоступен', () => {
  const save = enter(game, start('02'), room('dorm-room', '02')).save;
  assert.ok(!labels(save).includes('лечь спать'));
});

test('02: все финальные ответы возвращают домой в ту же дату, а не в следующий месяц', () => {
  for (const label of ['у меня осталась запись', 'иди спать', 'промолчать']) {
    let save = enter(game, start('02'), 'episodes/prolog/scenes/02-neukoelln#ночь').save;
    save = act(save, label);
    assert.equal(save.episodeState.at, `${room('dorm-room', '02')}комната`);
    assert.equal(save.activeStage, '02');
    assert.equal(save.currentDate, '08.06.2025');
    assert.ok(save.flags[POLICE]?.value);
    assert.ok(buildCatalog(game, save).find(o => o.label === 'лечь спать')?.attrs.advance);
    save = act(save, 'идти в жилой коридор');
    save = act(restored(save), 'идти в комнату');
    save = act(save, 'лечь спать');
    assert.equal(save.episodeState.at, 'episodes/prolog/transitions/03-tu-entry#');
    assert.equal(save.currentDate, '08.06.2025');
    save = confirmTransition(game, restored(save), 'episodes/prolog/transitions/03-tu-entry').save;
    assert.equal(save.activeStage, '03');
    assert.equal(save.currentDate, '04.07.2025');
  }
});

test('01 и 02 не наследуют ночное окно и играющую колонку из субботы', () => {
  for (const stage of ['01', '02']) {
    let save = withFlags(start(stage), ['prolog.study-only-case', 'prolog.study-definitions']);
    save = enter(game, save, room('dorm-room', stage)).save;
    const look = buildCatalog(game, save).filter(o => o.verb === 'осмотреть');
    for (const [label, item] of [['осмотреть колонку', 'campus-speaker'], ['осмотреть окно', 'campus-dorm-window']]) {
      assert.equal(look.filter(o => o.label === label).length, 1);
      assert.equal(look.find(o => o.label === label)?.target, `episodes/prolog/items/${item}#осмотреть`);
      save = act(save, label!);
    }
    assert.doesNotMatch(streamOf(game, save).map(e => e.text).join('\n'), /Во дворе темно|Никогда не умереть|съехал в сентябре/);
  }
});
