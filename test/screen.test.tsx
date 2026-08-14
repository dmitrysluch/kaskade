import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CardScreen,
  DETAIL_ROWS,
  FRAMES,
  GameScreen,
  LIST_ROWS,
  LOWER_ROWS,
  OverlayScreen,
  RULES,
  STATUS_ROWS,
} from '../app/client/ui/Screen.tsx';
import {
  commandLines,
  detailLines,
  inputLine,
  statusLine,
  streamLines,
  systemLine,
  viewport,
} from '../app/client/ui/lines.ts';
import { MARGIN, type Seg } from '../app/client/ui/text.ts';

/**
 * Экран — сетка знаков, поэтому его можно проверить арифметикой: если строка
 * на знак длиннее или короче остальных, поля и линейка разъедутся. Глазами такое
 * ловится раз через раз, отсюда этот тест.
 */

function screenText(node: React.ReactElement): string[] {
  return renderToStaticMarkup(node)
    .replace(/<\/div><div[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .split('\n');
}

function assertRectangular(lines: string[], cols: number) {
  for (const [i, line] of lines.entries()) {
    assert.equal([...line].length, cols, `строка ${i} шириной ${[...line].length}, а не ${cols}:\n${line}`);
  }
}

function build(cols: number, rows: number, entries: string[], scroll = 0, rule = '─') {
  // Текст идёт во всю сетку, от поля до поля: поля набираются пробелами.
  const width = cols - MARGIN.text - MARGIN.right;
  const streamRows = Math.max(3, rows - STATUS_ROWS - LOWER_ROWS);
  const stream: Seg[][] = streamLines(
    entries.map((text) => ({ kind: 'text' as const, text })),
    width,
  );

  return (
    <GameScreen
      cols={cols}
      streamRows={streamRows}
      status={statusLine('12.05.2026', cols)}
      stream={viewport(stream, streamRows, scroll)}
      input={inputLine('спросить о парт')}
      list={commandLines([], null, '', width, LIST_ROWS)}
      details={detailLines(null, false, width, DETAIL_ROWS)}
      system={systemLine(['справочник', 'дело', 'предметы'], width)}
      more={{
        up: Math.min(scroll, Math.max(0, stream.length - streamRows)) < Math.max(0, stream.length - streamRows),
        down: scroll > 0,
      }}
      rule={rule}
    />
  );
}

test('экран прямоугольный и занимает окно целиком', () => {
  const lines = screenText(build(80, 24, ['Аудитория на сорок мест, занято одиннадцать.']));
  assertRectangular(lines, 80);
  assert.equal(lines.length, 24);
});

test('рамки у экрана нет', () => {
  const lines = screenText(build(80, 24, ['Он не здоровается и не представляется.']));
  const box = [...Object.values(FRAMES).flatMap((g) => [g.v, g.tl, g.tr, g.bl, g.br])];

  for (const line of lines) {
    for (const glyph of box) assert.ok(!line.includes(glyph), `на экране остался знак рамки ${glyph}`);
  }
});

test('поля — свойство текста: линейка идёт во всю сетку, текст живёт в поле', () => {
  const lines = screenText(build(80, 24, ['Он не здоровается.']));
  const rule = lines.find((l) => l.startsWith('─'))!;

  // Линейка навылет — она делит поверхность, а не документ.
  assert.equal([...rule].length, 80);
  assert.equal(rule.trim().length, 80);

  const text = lines.find((l) => l.includes('Он не здоровается'))!;
  assert.equal(text.indexOf('Он'), MARGIN.text);
});

test('промпт висит в поле, набранное встаёт под повествованием', () => {
  const lines = screenText(build(80, 24, ['Он не здоровается.']));
  const input = lines.find((l) => l.includes('спросить о парт'))!;

  assert.equal(input.indexOf('>'), MARGIN.prompt);
  assert.equal(input.indexOf('спросить'), MARGIN.text);
});

test('статус прижат к правому полю текста, а не к краю сетки', () => {
  const lines = screenText(build(80, 24, ['Текст.']));
  assert.equal(lines[0]!.trimEnd().length, 80 - MARGIN.right);
  assert.ok(lines[0]!.includes('12.05.2026'));
  // Второй строкой — пустая: статус своей линейкой не отделяется.
  assert.equal(lines[1]!.trim(), '');
});

test('узкий экран не ломает раскладку', () => {
  assertRectangular(screenText(build(40, 16, ['Короткая строка.'])), 40);
  assertRectangular(screenText(build(60, 20, ['BAYN-OPV-63991 '.repeat(30)])), 60);
});

test('нижний блок всегда на одном месте', () => {
  const short = screenText(build(80, 24, ['одна строка']));
  const long = screenText(build(80, 24, [Array.from({ length: 50 }, (_, i) => `строка ${i}`).join('\n')]));

  assert.equal(short.length, long.length);
  const inputFromBottom = (lines: string[]) =>
    lines.length - lines.findIndex((l) => l.includes('спросить о парт'));
  assert.equal(inputFromBottom(short), inputFromBottom(long));
  assert.equal(inputFromBottom(short), LOWER_ROWS - 1);
});

test('знак прокрутки стоит на правом конце линейки', () => {
  const many = Array.from({ length: 60 }, (_, i) => `строка ${i}`).join('\n');

  const bottom = screenText(build(80, 24, [many]));
  assertRectangular(bottom, 80);
  const rule = bottom.find((l) => l.startsWith('─'))!;
  assert.ok(rule.endsWith('▲'), 'выше есть текст, а знака нет');

  const scrolled = screenText(build(80, 24, [many], 5));
  assertRectangular(scrolled, 80);
  assert.ok(scrolled.find((l) => l.startsWith('─'))!.endsWith('▼'));
});

test('короткий текст не обещает прокрутки', () => {
  const lines = screenText(build(80, 24, ['одна строка']));
  const rule = lines.find((l) => l.startsWith('─'))!;
  assert.ok(!rule.endsWith('▲') && !rule.endsWith('▼'));
});

test('символ линейки берётся из конфига и не ломает ширину', () => {
  for (const [name, glyph] of Object.entries(RULES)) {
    if (name === 'none') continue;
    const lines = screenText(build(80, 24, ['Текст.'], 0, glyph));
    assertRectangular(lines, 80);
    assert.ok(lines.some((l) => l.startsWith(glyph.repeat(10))), `${name}: линейки нет`);
  }
});

test('оверлей остаётся в коробке: рамка обводит объект', () => {
  const lines = screenText(
    <OverlayScreen
      cols={72}
      rows={20}
      title="ДЕЛО"
      lines={[[{ text: 'АЛЕРС, Ф.' }], [{ text: 'Приглашённый лектор.', cls: 'dim' }]]}
      scroll={0}
      glyphs={FRAMES.light!}
    />,
  );

  assertRectangular(lines, 72);
  assert.ok(lines[0]!.includes('ДЕЛО'));
  assert.ok(lines[1]!.startsWith('│'), 'у оверлея должна быть рамка');
  assert.ok(lines.at(-2)!.includes('Esc'));
});

test('титр — объект: рамка по размеру содержимого, по центру пустого экрана', () => {
  const lines = screenText(
    <CardScreen cols={72} rows={14} text="08.06.2025" glyphs={FRAMES.heavy!} />,
  );

  assertRectangular(lines, 72);
  assert.equal(lines.length, 14);

  const top = lines.findIndex((l) => l.includes('┏'));
  const text = lines.findIndex((l) => l.includes('08.06.2025'));
  const bottom = lines.findIndex((l) => l.includes('┗'));

  // Коробка по размеру содержимого: дата плюс по пробелу с боков.
  assert.equal(lines[top]!.trim(), `┏${'━'.repeat(12)}┓`);
  assert.equal(lines[text]!.trim(), '┃ 08.06.2025 ┃');
  assert.equal(text, top + 1);
  assert.equal(bottom, top + 2);

  // По центру: пустого сверху и снизу поровну, с точностью до строки.
  assert.ok(Math.abs(top - (lines.length - 1 - bottom)) <= 1, 'титр не по центру');
  const left = lines[text]!.indexOf('┃');
  const right = lines[text]!.length - 1 - lines[text]!.lastIndexOf('┃');
  assert.ok(Math.abs(left - right) <= 1, 'титр не по центру по горизонтали');
});

test('длинный титр переносится и не вылезает за экран', () => {
  const long = 'Восьмое июня две тысячи двадцать пятого года, Нойкёльн, отделение полиции';
  const lines = screenText(<CardScreen cols={60} rows={16} text={long} glyphs={FRAMES.light!} />);

  assertRectangular(lines, 60);
  assert.ok(lines.filter((l) => l.includes('│')).length > 1, 'текст не перенёсся');
});

test('псевдо-BIOS идёт без рамки: это не предъявленная вещь, а машина', () => {
  const lines = screenText(<CardScreen cols={72} rows={10} text={'TU BERLIN 4.11\nПАМЯТЬ 640K OK'} glyphs={null} />);

  assertRectangular(lines, 72);
  for (const line of lines) {
    for (const glyph of ['┏', '┃', '┗', '│', '┌']) assert.ok(!line.includes(glyph), `у BIOS есть рамка: ${glyph}`);
  }
  assert.ok(lines.some((l) => l.includes('ПАМЯТЬ 640K OK')));
});
