import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchor, parseMarkdown, ContentError } from '../app/server/content/markdown.ts';

const SCENE = `---
id: lecture-1
type: scene
---

Аудитория на сорок мест, занято одиннадцать.

→ сесть сзади [[#сзади]]
→ сесть в первый ряд [[#Первый ряд]]

## сзади
- set: margo.demonstrative
- tag: [важное, тихое]

Ты садишься так, чтобы было видно, что ты здесь не за этим.

→ [[#задача]]

## задача

Текст.

\`\`\`options
идти: exits
осмотреть: items
\`\`\`
`;

test('вступление, узлы и переходы', () => {
  const doc = parseMarkdown('lecture-1.md', SCENE);
  assert.equal(doc.type, 'scene');
  assert.deepEqual(
    doc.nodes.map((n) => n.id),
    ['', 'сзади', 'задача'],
  );

  const intro = doc.nodes[0]!;
  assert.equal(intro.transitions.length, 2);
  assert.equal(intro.transitions[0]!.label, 'сесть сзади');
  assert.equal(intro.transitions[0]!.ref, '#сзади');
  assert.match(intro.text, /сорок мест/);
});

test('якорь нормализуется как в Obsidian', () => {
  assert.equal(anchor('  Первый Ряд '), 'первый-ряд');
  const doc = parseMarkdown('x.md', SCENE);
  // `[[#Первый ряд]]` и `## первый-ряд` обязаны сойтись, иначе автор чинит ссылки
  // вместо того, чтобы писать текст.
  assert.equal(anchor(doc.nodes[0]!.transitions[1]!.ref.slice(1)), 'первый-ряд');
});

test('атрибуты читаются только сразу под заголовком', () => {
  const node = parseMarkdown('x.md', SCENE).nodes[1]!;
  assert.deepEqual(node.attrs.set, ['margo.demonstrative']);
  assert.deepEqual(node.attrs.tag, ['важное', 'тихое']);
  // Безусловный переход — метки нет.
  assert.equal(node.transitions[0]!.label, null);
});

test('блок options разбирается в генераторы и не попадает в текст', () => {
  const node = parseMarkdown('x.md', SCENE).nodes[2]!;
  assert.deepEqual(
    node.generators.map((g) => [g.phrase, g.source]),
    [
      ['идти', 'exits'],
      ['осмотреть', 'items'],
    ],
  );
  assert.equal(node.text, 'Текст.');
});

test('дефис в тексте — обычный список, а не атрибут', () => {
  const doc = parseMarkdown('x.md', `---\nid: x\ntype: scene\n---\n\nТекст.\n\n- пункт списка\n`);
  assert.deepEqual(doc.nodes[0]!.attrs.set, []);
  assert.match(doc.nodes[0]!.text, /- пункт списка/);
});

test('пустое вступление не становится узлом', () => {
  const doc = parseMarkdown('x.md', `---\nid: x\ntype: scene\n---\n\n## первый\n\nТекст.\n`);
  assert.deepEqual(
    doc.nodes.map((n) => n.id),
    ['первый'],
  );
});

test('неизвестный атрибут — ошибка, а не молчаливое игнорирование', () => {
  assert.throws(
    () => parseMarkdown('x.md', `---\nid: x\ntype: scene\n---\n\n## a\n- сет: флаг\n\nТекст.\n`),
    (e: unknown) => e instanceof ContentError && /неизвестный атрибут/.test((e as Error).message),
  );
});

test('переход без ссылки — ошибка', () => {
  assert.throws(
    () => parseMarkdown('x.md', `---\nid: x\ntype: scene\n---\n\n→ никуда\n`),
    (e: unknown) => e instanceof ContentError && /переход без ссылки/.test((e as Error).message),
  );
});

test('неизвестный type — ошибка', () => {
  assert.throws(
    () => parseMarkdown('x.md', `---\nid: x\ntype: комната\n---\n\nТекст.\n`),
    (e: unknown) => e instanceof ContentError && /неизвестный type/.test((e as Error).message),
  );
});

const FORK = `---
id: neukoelln
type: scene
---

## протокол

Он читает вслух то, что записал.

→ я сказала иначе [[#записал-я]]
  - if: prolog.confirmed
→ я этого вообще не говорила [[#записал-я]]
  - if: "!prolog.confirmed"

## записал-я

— Протокол — это то, что записал я.

→ [[#дальше]]

## дальше

Конец.
`;

test('условие на переходе разбирается, а не остаётся текстом', () => {
  const doc = parseMarkdown('neukoelln.md', FORK);
  const [first, second] = doc.nodes[0]!.transitions;

  assert.equal(first!.attrs.if, 'prolog.confirmed');
  assert.equal(second!.attrs.if, '!prolog.confirmed');
  // Главное: список ушёл в атрибуты, а не на экран игроку.
  assert.equal(doc.nodes[0]!.text, 'Он читает вслух то, что записал.');
});

test('атрибут перехода без отступа — ошибка, а не молчаливый текст', () => {
  const bad = FORK.replace('  - if: prolog.confirmed', '- if: prolog.confirmed');
  assert.throws(() => parseMarkdown('neukoelln.md', bad), (e: Error) => {
    assert.ok(e instanceof ContentError);
    assert.match(e.message, /с отступом/);
    return true;
  });
});

test('маршрут без атрибутов остаётся без условий', () => {
  const doc = parseMarkdown('neukoelln.md', FORK);
  const route = doc.nodes[1]!.transitions[0]!;
  assert.equal(route.label, null);
  assert.equal(route.attrs.if, null);
});

test('advance — помета на переходе, а не в тексте', () => {
  const doc = parseMarkdown('room.md', `---
id: room
type: room
---

Комната.

→ поговорить [[#разговор]]
→ идти на лекцию [[#выход]]
  - advance

## разговор

Текст.

→ [[#выход]]

## выход

Конец.
`);
  const [talk, leave] = doc.nodes[0]!.transitions;
  assert.equal(talk!.attrs.advance, false);
  assert.equal(leave!.attrs.advance, true);
  assert.equal(doc.nodes[0]!.text, 'Комната.');
});
