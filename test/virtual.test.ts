import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addrIn,
  ANY_STAGE,
  formatRoomRef,
  isStarred,
  isVirtual,
  parseRoomRef,
  persistentOfAddr,
  roomRefOf,
  roomStateKey,
  stageOfAddr,
  virtAddr,
  virtDocId,
} from '../app/shared/rooms.ts';

/**
 * Виртуальные адреса помещений ([[13-навигация-и-комнаты-тз]], «Адреса
 * переходов»). Здесь проверяется словарь: четыре формы записи, объектная форма
 * из `exits` и звёздочка — запись «срез подставит оболочка».
 */

test('четыре формы адреса разбираются одним механизмом', () => {
  assert.deepEqual(parseRoomRef('rooms-virt/tu.dorm-room'), { persistent: 'tu.dorm-room' });
  assert.deepEqual(parseRoomRef('rooms-virt/tu.dorm-room#один'), {
    persistent: 'tu.dorm-room',
    node: 'один',
  });
  assert.deepEqual(parseRoomRef('rooms-virt/tu.dorm-room:04'), {
    persistent: 'tu.dorm-room',
    stage: '04',
  });
  assert.deepEqual(parseRoomRef('rooms-virt/tu.dorm-room:04#один'), {
    persistent: 'tu.dorm-room',
    stage: '04',
    node: 'один',
  });
});

test('не виртуальный адрес — не адрес помещения, а обычная ссылка', () => {
  assert.equal(parseRoomRef('rooms/04-room#один'), null);
  assert.equal(parseRoomRef('scenes/02-club'), null);
  assert.equal(parseRoomRef('04-room'), null);
});

test('формат идентификаторов: двоеточие и решётка — разделители, не части имён', () => {
  // Латиница, цифры, точки и дефисы — и ничего больше: id уезжает в сейв.
  assert.equal(parseRoomRef('rooms-virt/TU.Dorm'), null);
  assert.equal(parseRoomRef('rooms-virt/общага'), null);
  assert.equal(parseRoomRef('rooms-virt/tu.dorm:00:01'), null);

  // Ведущие нули и буквенный суффикс среза сохраняются: stage — строка.
  assert.deepEqual(parseRoomRef('rooms-virt/tu.yard:03a'), { persistent: 'tu.yard', stage: '03a' });
  // ID узла остаётся кириллическим: правила узлов не менялись.
  assert.deepEqual(parseRoomRef('rooms-virt/tu.h1012:01#первый-ряд'), {
    persistent: 'tu.h1012',
    stage: '01',
    node: 'первый-ряд',
  });
});

test('объектная форма из exits читается тем же словарём', () => {
  assert.deepEqual(roomRefOf({ persistent: 'tu.dorm-corridor' }), { persistent: 'tu.dorm-corridor' });
  assert.deepEqual(roomRefOf({ persistent: 'tu.dorm-room', stage: '04', node: 'один' }), {
    persistent: 'tu.dorm-room',
    stage: '04',
    node: 'один',
  });

  // Строку тоже принимает: в атрибуте узла писать объект неудобно.
  assert.deepEqual(roomRefOf('rooms-virt/tu.yard'), { persistent: 'tu.yard' });

  // Мусор — не адрес: пусть вызывающий решает, ошибка это или файловая ссылка.
  assert.equal(roomRefOf({ stage: '04' }), null);
  assert.equal(roomRefOf(42), null);
  assert.equal(roomRefOf(null), null);
});

test('канон один: как бы ни написали, наружу уходит одна форма', () => {
  const ref = roomRefOf({ persistent: 'tu.h1012', stage: '01', node: 'до' })!;
  assert.equal(formatRoomRef(ref), 'rooms-virt/tu.h1012:01#до');
  assert.equal(formatRoomRef({ persistent: 'tu.yard' }), 'rooms-virt/tu.yard');
});

test('адрес собранной комнаты знает эпизод, помещение и срез', () => {
  assert.equal(virtDocId('prolog', 'tu.h1012', '01'), 'episodes/prolog/rooms-virt/tu.h1012:01');
  assert.equal(virtAddr('prolog', 'tu.h1012', '01', 'после'), 'episodes/prolog/rooms-virt/tu.h1012:01#после');

  const addr = virtAddr('prolog', 'tu.h1012', '01');
  assert.equal(isVirtual(addr), true);
  assert.equal(stageOfAddr(addr), '01');
  assert.equal(persistentOfAddr(addr), 'tu.h1012');

  // Адрес сцены виртуальным не притворяется.
  assert.equal(isVirtual('episodes/prolog/scenes/02-club#'), false);
  assert.equal(persistentOfAddr('episodes/prolog/scenes/02-club#'), null);
});

test('звёздочка — запись «срез подставит оболочка», и подстановка ровно одна', () => {
  const starred = virtAddr('prolog', 'tu.h1012', ANY_STAGE, 'после');
  assert.equal(isStarred(starred), true);
  assert.equal(addrIn(starred, '01'), 'episodes/prolog/rooms-virt/tu.h1012:01#после');

  // Конкретный адрес подстановкой не трогается — ни сцена, ни готовый срез.
  const exact = virtAddr('prolog', 'tu.h1012', '01', 'после');
  assert.equal(isStarred(exact), false);
  assert.equal(addrIn(exact, '04'), exact);
  assert.equal(addrIn('episodes/prolog/scenes/02-club#', '02'), 'episodes/prolog/scenes/02-club#');
});

test('без контекста звёздочка не разворачивается, а падает', () => {
  // Молча подставить «какой-нибудь» срез нельзя: это тот самый случай, когда
  // игра показала бы чужой день вместо ошибки.
  assert.throws(
    () => addrIn(virtAddr('prolog', 'tu.h1012', ANY_STAGE), null),
    /ждёт среза/,
  );
});

test('состояние помещения принадлежит срезу, а не файлу', () => {
  assert.equal(roomStateKey('prolog', '00', 'tu.dorm-room'), 'prolog|00|tu.dorm-room');
  assert.notEqual(
    roomStateKey('prolog', '00', 'tu.dorm-room'),
    roomStateKey('prolog', '04', 'tu.dorm-room'),
  );
});
