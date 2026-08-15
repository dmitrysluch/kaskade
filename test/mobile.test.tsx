import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MobileScreen } from '../app/client/ui/Mobile.tsx';
import { GameScreen, DETAIL_ROWS, LIST_ROWS } from '../app/client/ui/Screen.tsx';
import { commandLines, detailLines, inputLine, statusLine, systemLine, viewport } from '../app/client/ui/lines.ts';
import { fit } from '../app/client/ui/metrics.ts';
import { isMobilePath, MOBILE_COLS } from '../app/client/ui/mode.ts';
import { attrs } from './helpers.ts';
import type { CatalogOption } from '../app/client/engine/catalog.ts';

/**
 * Мобильная версия (`/m`). Проверяем ровно то, чем она отличается: адрес,
 * ширину сетки и то, что команда стала целью для пальца, — и то, что на большом
 * экране от этого ничего не изменилось.
 */

function opt(label: string, patch: Partial<CatalogOption> = {}): CatalogOption {
  return {
    label,
    kind: 'environment',
    target: null,
    attrs: attrs(),
    verb: null,
    object: null,
    moves: false,
    locked: false,
    system: null,
    ...patch,
  };
}

const OPTIONS = [
  opt('осмотреть учебник'),
  opt('поговорить с Тоби', { kind: 'story' }),
  opt('идти на лекцию', { kind: 'story', attrs: attrs({ advance: true }) }),
];

function mobile(options = OPTIONS): string {
  return renderToStaticMarkup(
    <MobileScreen
      cols={MOBILE_COLS}
      status={statusLine('12.10.2024', MOBILE_COLS)}
      stream={[[{ text: 'Общага на Франклинштрассе.' }]]}
      options={options}
      onPick={() => {}}
      system={[{ label: 'справочник', run: () => {} }, { label: 'дело', run: () => {} }]}
      rule="━"
    />,
  );
}

test('мобильная версия живёт на своём адресе, а не включается по ширине окна', () => {
  assert.equal(isMobilePath('/m'), true);
  assert.equal(isMobilePath('/m/'), true);
  assert.equal(isMobilePath('/'), false);
  // Похожий адрес — не мобильный: игра одна, и путать её нечем.
  assert.equal(isMobilePath('/margo'), false);
});

test('на телефоне кегль держит ширину строки, а не число строк', () => {
  // Узкий и высокий экран: кегль, выведенный из высоты, оставил бы колонок
  // на полстроки текста.
  const phone = { availW: 390, availH: 800, cellRatio: 0.6, lineRatio: 1 };

  // По высоте кегль выходит такой, что в ширину влезает знаков двадцать с
  // небольшим: сетка отдаёт сорок колонок только потому, что ниже сорока
  // раскладка не собирается вовсе, — и эти колонки уезжают за край экрана.
  const byRows = fit({ ...phone, rows: 34 });
  const real = Math.floor(phone.availW / (byRows.size * phone.cellRatio));
  assert.ok(real < 30, `по высоте влезает ${real} колонок — правило перестало быть верным`);

  const byCols = fit({ ...phone, rows: 34, cols: MOBILE_COLS });
  assert.ok(Math.abs(byCols.cols - MOBILE_COLS) <= 2, `заказано ${MOBILE_COLS}, вышло ${byCols.cols}`);
  assert.ok(byCols.rows > 34, 'строк на телефоне должно стать больше, а не меньше');
});

test('команда — цель для пальца, и метка у неё та же', () => {
  const markup = mobile();
  const buttons = markup.split('<button').length - 1;

  // Три команды и две служебные: каждая своей кнопкой.
  assert.equal(buttons, 5);
  for (const option of OPTIONS) assert.ok(markup.includes(option.label), `нет команды "${option.label}"`);

  // Категории и пометы — те же классы, что на большом экране: цвет не меняется
  // от способа ввода.
  assert.match(markup, /class="environment"/);
  assert.match(markup, /class="advance"/);
  assert.match(markup, /▶/);
});

test('терминал остаётся терминалом: статус, поток и линейка на месте', () => {
  const markup = mobile();

  assert.match(markup, /class="status"/);
  assert.match(markup, /Общага на Франклинштрассе\./);
  assert.match(markup, /class="rule"/);
  assert.match(markup, /━━━/);

  // Строки ввода нет: на телефоне её не набирают.
  assert.equal(markup.includes('class="cursor"'), false);
});

test('на большом экране кликать по-прежнему не по чему', () => {
  // Правило «мышью не играют» держится ровно тем, что на главном экране нет
  // ни одного интерактивного элемента. Мобильная версия — отдельный адрес,
  // и протечь оттуда сюда ничего не должно.
  const markup = renderToStaticMarkup(
    <GameScreen
      cols={80}
      streamRows={6}
      status={statusLine('12.10.2024', 80)}
      stream={viewport([[{ text: 'Текст.' }]], 6, 0)}
      input={inputLine('осм')}
      list={commandLines(OPTIONS, null, '', 72, LIST_ROWS)}
      details={detailLines(null, false, 72, DETAIL_ROWS)}
      system={systemLine(['справочник'], 72)}
      more={{ up: false, down: false }}
      rule="━"
    />,
  );

  assert.equal(markup.includes('<button'), false);
  assert.equal(markup.includes('onclick'), false);
});
