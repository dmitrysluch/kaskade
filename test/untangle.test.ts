import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze,
  bandMapping,
  bands,
  crosses,
  isSolved,
  layoutText,
  onSegment,
  overlaps,
  parseDocuments,
  permuteBand,
  shifted,
  words,
  THREADS,
  type Cell,
} from '../app/shared/untangle.ts';
import { FIELD, STUDY, threadsOf } from './minigame-field.ts';

/**
 * Чистая часть мини-игры ([[07a-мини-игра]]).
 *
 * Главное требование здесь одно: **одинаковая геометрия обязана всегда давать
 * одинаковый текст**. Остальное — геометрия, которую руками не проверишь:
 * общий конец нитей это соединение, а не пересечение, и ноль пересечений
 * ещё не планарная раскладка.
 */

const layout = (which: 'start' | 'solution'): Record<number, Cell> =>
  Object.fromEntries(Object.entries(FIELD).map(([id, p]) => [Number(id), p[which]]));

test('общий конец двух нитей — соединение, а крест — пересечение', () => {
  // Крест.
  assert.equal(crosses([0, 0], [4, 4], [0, 4], [4, 0]), true);
  // Общий конец: так нити и соединяются в точке.
  assert.equal(crosses([0, 0], [4, 4], [0, 0], [4, 0]), false);
  // Касание концом в середине чужой нити — не пересечение, а точка на нити.
  assert.equal(crosses([0, 0], [4, 0], [2, 0], [2, 4]), false);
  assert.equal(onSegment([2, 0], [0, 0], [4, 0]), true);
  assert.equal(onSegment([0, 0], [0, 0], [4, 0]), false, 'конец — не «лежит на нити»');
  // Параллельные и коллинеарные: наложение считается отдельно.
  assert.equal(crosses([0, 0], [4, 0], [0, 1], [4, 1]), false);
  assert.equal(overlaps([0, 0], [4, 0], [2, 0], [6, 0]), true);
  assert.equal(overlaps([0, 0], [2, 0], [2, 0], [4, 0]), false, 'стык концами — не наложение');
});

test('авторская раскладка планарна, а стартовая — та самая путаница из ТЗ', () => {
  const threads = threadsOf();
  const start = analyze(layout('start'), threads);
  const solution = analyze(layout('solution'), threads);

  // Числа из ТЗ: «В приведённом start 23 пересечения».
  assert.equal(start.crossings.length, 23);
  assert.equal(isSolved(start), false);
  assert.equal(isSolved(solution), true);
  // Пары идут по возрастанию: по этому порядку потом применяются обмены.
  assert.deepEqual(
    [...start.crossings].sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    start.crossings,
  );
});

test('ноль пересечений — ещё не победа: точка на чужой нити остаётся ошибкой', () => {
  const points: Record<number, Cell> = { 0: [0, 0], 1: [4, 0], 2: [2, 0] };
  const threads = [{ id: 0, points: [0, 1] as [number, number] }];
  const a = analyze(points, threads);

  assert.equal(a.crossings.length, 0);
  assert.deepEqual(a.onThread, [{ point: 2, thread: 0 }]);
  assert.equal(isSolved(a), false);
});

test('две точки в одной клетке видны разбору: такой ход движок не примет', () => {
  const a = analyze({ 0: [1, 1], 1: [1, 1] }, []);
  assert.deepEqual(a.collisions, [[0, 1]]);
});

test('соответствие нитей позициям детерминировано и зависит от всех индексов', () => {
  const first = bandMapping('00-study-ines', 1907, 0, 0, 0, THREADS);
  assert.deepEqual(bandMapping('00-study-ines', 1907, 0, 0, 0, THREADS), first);
  assert.notDeepEqual(bandMapping('00-study-ines', 1907, 0, 0, 1, THREADS), first);
  assert.notDeepEqual(bandMapping('00-study-ines', 1908, 0, 0, 0, THREADS), first);
  assert.notDeepEqual(bandMapping('другая', 1907, 0, 0, 0, THREADS), first);

  // Это перестановка ID нитей, а не выборка: каждая нить встречается один раз.
  assert.deepEqual([...first].sort((a, b) => a - b), Array.from({ length: THREADS }, (_, i) => i));
  // Короткая полоса берёт первые N той же перестановки.
  assert.deepEqual(bandMapping('00-study-ines', 1907, 0, 0, 0, 5), first.slice(0, 5));
});

test('одинаковая геометрия даёт одинаковый текст, и путь к ней ни при чём', () => {
  const { docs } = parseDocuments(STUDY);
  const threads = threadsOf();
  const crossings = analyze(layout('start'), threads).crossings;

  const once = layoutText('00-study-ines', 1907, docs, crossings);
  const again = layoutText('00-study-ines', 1907, docs, crossings);
  assert.deepEqual(once, again);

  // Распутанное поле возвращает авторский порядок — побитово.
  const solved = layoutText('00-study-ines', 1907, docs, []);
  assert.deepEqual(
    solved.map((d) => d.paragraphs.map((p) => p.flatMap((b) => b.words.map((w) => w.text)))),
    docs.map((d) => d.paragraphs.map((p) => p.map((w) => w.text))),
  );
});

test('обмен трогает только позиции пересекшихся нитей', () => {
  const band = bands(words('раз два три четыре пять шесть семь восемь девять десять одиннадцать двенадцать'))[0]!;
  const mapping = Array.from({ length: THREADS }, (_, i) => i);

  const swapped = permuteBand(band, mapping, [[0, 11]]);
  assert.equal(swapped[0]!.text, 'двенадцать');
  assert.equal(swapped[11]!.text, 'раз');
  assert.deepEqual(swapped.slice(1, 11), band.slice(1, 11));

  // Нить, которой в полосе нет, свою пару не меняет: так ведёт себя короткая
  // последняя полоса абзаца.
  const short = band.slice(0, 4);
  assert.deepEqual(permuteBand(short, mapping.slice(0, 4), [[0, 11]]), short);
});

test('стартовая перестановка из ТЗ трогает все двенадцать позиций', () => {
  const { docs } = parseDocuments(STUDY);
  const crossings = analyze(layout('start'), threadsOf()).crossings;
  assert.equal(shifted('00-study-ines', 1907, docs, crossings), THREADS);
});

test('перемещаемая единица — видимое слово', () => {
  const parsed = words('Фукусима-1, 11 марта `INES 7` [[ref-ines|шкала ИНЕС]] *два слова*');

  assert.deepEqual(parsed.map((w) => w.text), [
    'Фукусима-1,',
    '11 марта',
    'INES 7',
    'шкала ИНЕС',
    'два',
    'слова',
  ]);
  // Код и ссылка — одна единица даже с пробелом внутри подписи.
  assert.equal(parsed[2]!.code, true);
  assert.equal(parsed[3]!.link, 'ref-ines');
  // Акцент сохраняется на каждом получившемся слове.
  assert.equal(parsed[4]!.em, true);
  assert.equal(parsed[5]!.em, true);
});

test('документы делятся заголовками, а блочная разметка в них запрещена', () => {
  const { docs, problems } = parseDocuments(STUDY);
  assert.deepEqual(docs.map((d) => d.label), ['Учебник', 'Справочник']);
  assert.deepEqual(problems, []);

  const bad = parseDocuments('Шапка без заголовка.\n\n### Книга\n\n- список\n\n> цитата\n\n→ [[scenes/x]]');
  assert.match(bad.problems.join(' | '), /текст до первого/);
  assert.match(bad.problems.join(' | '), /список/);
  assert.match(bad.problems.join(' | '), /цитата/);
  assert.match(bad.problems.join(' | '), /игровой маршрут/);
});
