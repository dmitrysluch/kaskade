import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planStages, type PlanDoc } from '../app/server/content/stages.ts';
import type { TransitionDef } from '../app/shared/types.ts';

/**
 * Планирование срезов ([[13-навигация-и-комнаты-тз]], «Stage, дата и монтаж»).
 *
 * Проверяем главное следствие: собирается только то, что действительно играется.
 * Иначе шесть помещений пролога на пять срезов дадут тридцать комнат, из которых
 * двадцать три недостижимы — и каждая честно попадёт в граф и в претензии
 * валидатора.
 */

const EP = { entry: 'episodes/p/scenes/intro#' };

function doc(docId: string, patch: Partial<PlanDoc> = {}): PlanDoc {
  return { docId, path: `/content/${docId}.md`, persistent: null, stage: null, out: [], ...patch };
}

function card(id: string, stage: string, target: string): TransitionDef {
  return {
    id,
    docId: `episodes/p/transitions/${id}`,
    episode: 'p',
    stage,
    date: '12.10.2024',
    location: 'место',
    timeLabel: null,
    target,
  };
}

const world = (...docs: PlanDoc[]) => new Map(docs.map((d) => [d.docId, d]));

test('срез назначения приходит из карточки, а не из имени файла', () => {
  const start = card('00-start', '00', 'episodes/p/rooms-virt/tu.dorm-room:00#');
  const plan = planStages(
    world(
      doc('episodes/p/transitions/00-start', { out: [{ kind: 'room', ref: { persistent: 'tu.dorm-room', stage: '00' } }] }),
      doc('episodes/p/rooms/common-room', { persistent: 'tu.dorm-room' }),
      doc('episodes/p/rooms/00-room', { persistent: 'tu.dorm-room', stage: '00' }),
    ),
    [start],
    [EP],
  );

  assert.deepEqual([...plan.slices.keys()], ['p|tu.dorm-room|00']);
  assert.deepEqual([...(plan.docStages.get('episodes/p/rooms/common-room') ?? [])], ['00']);
});

test('собираются только используемые срезы, а не все подряд', () => {
  // Две карточки — два среза; у общей кухни версии нет ни в одном, и она
  // собирается в оба, потому что в оба есть ссылка. Библиотека живёт только в 05.
  const plan = planStages(
    world(
      doc('episodes/p/rooms/common-kitchen', {
        persistent: 'tu.kitchen',
        out: [{ kind: 'room', ref: { persistent: 'tu.library' } }],
      }),
      doc('episodes/p/rooms/05-library', { persistent: 'tu.library', stage: '05' }),
    ),
    [card('00-start', '00', 'episodes/p/rooms-virt/tu.kitchen:00#'), card('05-in', '05', 'episodes/p/rooms-virt/tu.kitchen:05#')],
    [EP],
  );

  assert.deepEqual([...plan.slices.keys()].sort(), ['p|tu.kitchen|00', 'p|tu.kitchen|05', 'p|tu.library|05']);
  // В нулевом срезе библиотеки нет: версии нет, и собирать её там незачем.
  assert.equal(plan.slices.has('p|tu.library|00'), false);
});

test('сцена, играемая в двух срезах, помнит оба', () => {
  const plan = planStages(
    world(
      doc('episodes/p/rooms/common-hall', {
        persistent: 'tu.hall',
        out: [{ kind: 'doc', docId: 'episodes/p/scenes/talk' }],
      }),
      doc('episodes/p/scenes/talk'),
    ),
    [card('a', '01', 'episodes/p/rooms-virt/tu.hall:01#'), card('b', '03', 'episodes/p/rooms-virt/tu.hall:03#')],
    [EP],
  );

  assert.deepEqual([...(plan.docStages.get('episodes/p/scenes/talk') ?? [])].sort(), ['01', '03']);
});

test('карточка срез не распространяет: она его устанавливает', () => {
  // Из комнаты первого среза ведёт карточка во второй. Всё, что за ней, играется
  // во втором — и первый туда не протекает.
  const plan = planStages(
    world(
      doc('episodes/p/rooms/01-hall', {
        persistent: 'tu.hall',
        stage: '01',
        out: [{ kind: 'doc', docId: 'episodes/p/transitions/02-club' }],
      }),
      doc('episodes/p/transitions/02-club', { out: [{ kind: 'doc', docId: 'episodes/p/scenes/club' }] }),
      doc('episodes/p/scenes/club'),
    ),
    [card('01-in', '01', 'episodes/p/rooms-virt/tu.hall:01#'), card('02-club', '02', 'episodes/p/scenes/club#')],
    [EP],
  );

  assert.deepEqual([...(plan.docStages.get('episodes/p/scenes/club') ?? [])], ['02']);
});

test('переход в чужой срез напрямую — нарушение, а не скрытая карточка', () => {
  const plan = planStages(
    world(
      doc('episodes/p/rooms/01-hall', {
        persistent: 'tu.hall',
        stage: '01',
        out: [{ kind: 'room', ref: { persistent: 'tu.hall', stage: '04' } }],
      }),
    ),
    [card('01-in', '01', 'episodes/p/rooms-virt/tu.hall:01#')],
    [EP],
  );

  assert.equal(plan.violations.length, 1);
  assert.equal(plan.violations[0]!.kind, 'cross-stage');
  assert.match(plan.violations[0]!.message, /только карточка перехода/);
  // И в чужой срез обход не уходит: комната 04 не собирается.
  assert.equal(plan.slices.has('p|tu.hall|04'), false);
});

test('прямая ссылка на файл помещения — нарушение: она обходит слияние', () => {
  const plan = planStages(
    world(
      doc('episodes/p/scenes/intro', { out: [{ kind: 'doc', docId: 'episodes/p/rooms/00-room' }] }),
      doc('episodes/p/rooms/00-room', { persistent: 'tu.dorm-room', stage: '00' }),
    ),
    [card('00-start', '00', 'episodes/p/scenes/intro#')],
    [EP],
  );

  assert.equal(plan.violations.length, 1);
  assert.equal(plan.violations[0]!.kind, 'physical-room');
  assert.match(plan.violations[0]!.message, /rooms-virt\/tu\.dorm-room/);
});

test('до первой карточки — неигровой пролог, и он виден отдельно', () => {
  const plan = planStages(
    world(
      doc('episodes/p/scenes/intro', { out: [{ kind: 'doc', docId: 'episodes/p/transitions/00-start' }] }),
      doc('episodes/p/transitions/00-start', { out: [{ kind: 'doc', docId: 'episodes/p/scenes/room' }] }),
      doc('episodes/p/scenes/room'),
    ),
    [card('00-start', '00', 'episodes/p/scenes/room#')],
    [EP],
  );

  assert.ok(plan.preGame.has('episodes/p/scenes/intro'));
  // За карточкой пролог кончается: комната в него уже не входит.
  assert.equal(plan.preGame.has('episodes/p/scenes/room'), false);
});
