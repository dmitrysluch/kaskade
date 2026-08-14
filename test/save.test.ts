import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MIGRATIONS, migrate } from '../app/client/engine/save.ts';
import type { SaveState } from '../app/shared/types.ts';

/**
 * Миграции — единственное настоящее техническое ограничение сериального выпуска
 * ([[06-выпуск]]), и задним числом оно не чинится. Проверяем механизм, пока
 * мигрировать нечего: когда будет что, тест уже стоит.
 */

function save(patch: Partial<SaveState> = {}): SaveState {
  return {
    saveVersion: 6,
    words: { alers: 'white' },
    flags: { 'prolog.phoned': { value: true, at: '12.09.2026' } },
    inventory: ['телефон'],
    splashes: [],
    chapter: 'prolog',
    itemStates: {},
    dates: { blueCard: '31.12.2026' },
    taught: true,
    hinted: true,
    started: true,
    episodeState: { episode: 'prolog', at: 'episodes/prolog/rooms/деканат#', used: [] },
    ...patch,
  };
}

test('сейв текущей версии проходит насквозь', () => {
  const s = save();
  assert.deepEqual(migrate(s, 6), s);
});

test('1 → 2: булев флаг становится записью с датой', () => {
  // Даты у старого сейва нет и взять её неоткуда — честнее пустая, чем выдуманная.
  const old = { ...save(), saveVersion: 1, flags: { 'prolog.phoned': true } } as unknown as SaveState;
  const migrated = migrate(old, 2)!;

  assert.equal(migrated.saveVersion, 2);
  assert.deepEqual(migrated.flags['prolog.phoned'], { value: true, at: null });
  // Слова — единственная валюта между главами, и они обязаны пережить миграцию.
  assert.deepEqual(migrated.words, { alers: 'white' });
});

test('2 → 3: старый сейв не помнит показанных сплэшей — и это честнее', () => {
  // Лицо, увиденное второй раз, — меньшая беда, чем лицо, которое не увидели вовсе.
  const old = { ...save(), saveVersion: 2, splashes: undefined } as unknown as SaveState;
  const migrated = migrate(old, 3)!;

  assert.equal(migrated.saveVersion, 3);
  assert.deepEqual(migrated.splashes, []);
});

test('цепочка миграций идёт по шагу за раз', () => {
  MIGRATIONS[3] = (old) => ({ ...old, chapter: 'глава-1' });
  try {
    const migrated = migrate({ ...save(), saveVersion: 1, flags: {} }, 4)!;
    assert.equal(migrated.saveVersion, 4);
    assert.equal(migrated.chapter, 'глава-1');
  } finally {
    delete MIGRATIONS[3];
  }
});

test('без миграции сейв не тащим — лучше начать заново, чем играть в половине', () => {
  assert.equal(migrate(save({ saveVersion: 3 }), 5), null);
});

test('сейв из будущего не принимается', () => {
  assert.equal(migrate(save({ saveVersion: 9 }), 3), null);
});

test('6 → 7: предметы стали многостраничными', () => {
  const { itemStates: _, ...old } = { ...save(), saveVersion: 6 };

  const migrated = migrate(old as SaveState, 7)!;
  // Где игрок остановился в книге, старый сейв не знает: записи просто нет,
  // и при первом осмотре предмет откроется с начала.
  assert.deepEqual(migrated.itemStates, {});
  assert.deepEqual(migrated.words, { alers: 'white' });
});
