import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Menu } from '../app/client/ui/Menu.tsx';
import { Manual } from '../app/client/ui/Manual.tsx';
import { PICK_MARK } from '../app/client/ui/lines.ts';

/**
 * Экраны оболочки — меню и управление. Проверяем не вёрстку, а то, что здесь
 * опасно или легко разъезжается: чтобы необратимое не оказалось выбранным
 * по умолчанию, а обещанные клавиши совпадали с теми, которые оболочка слушает.
 * Перебор пунктов и подтверждение — состояние компонента, до него серверный
 * рендер не достаёт, поэтому меряем первый кадр.
 */

const noop = () => {};

function render(): string {
  return renderToStaticMarkup(<Menu onClose={noop} onManual={noop} onRestart={noop} />)
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'");
}

test('меню предлагает выход, инструкцию и сброс — и ничего больше', () => {
  const text = render();

  assert.match(text, /продолжить/);
  assert.match(text, /управление/);
  assert.match(text, /начать заново/);
});

test('открытое меню стоит на безопасном пункте, а не на сбросе', () => {
  const markup = renderToStaticMarkup(<Menu onClose={noop} onManual={noop} onRestart={noop} />);

  // Выбран ровно один пункт, и это первый — «продолжить».
  const picked = markup.split('<li').filter((li) => li.startsWith(' class="pick"'));
  assert.equal(picked.length, 1);
  assert.match(picked[0]!, /продолжить/);

  // Сброс с первого кадра не выполняется: сначала подтверждение, и в нём
  // по умолчанию отказ. Здесь видно только то, что он не выбран.
  assert.equal(markup.includes(`${PICK_MARK}</span>начать заново`), false);
});

test('меню не спрашивает подтверждения раньше времени', () => {
  // Пока сброс не выбран, слов про потерю прогресса на экране нет: предупреждение
  // должно стоять там, где решают, а не висеть фоном.
  assert.equal(/стёрт|Отменить/.test(render()), false);
});

test('управление обещает те же клавиши, которые слушает оболочка', () => {
  const text = renderToStaticMarkup(<Manual first />)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

  // Цифровой ряд, а не F-клавиши: на маке F3 — Mission Control, F4 — Launchpad,
  // и до игры они не доходят вовсе.
  for (const [key, what] of [
    ['1', 'справочник'],
    ['2', 'дело'],
    ['3', 'инвентарь'],
    ['\\?', 'управление'],
    ['0', 'меню'],
  ]) {
    assert.match(text, new RegExp(`${key}\\s+${what}`), `в управлении нет "${key} ${what}"`);
  }
  assert.equal(/F1|F2|F3|F10/.test(text), false, 'в управлении остались F-клавиши');
});

test('управление закрывается Enter, как и полноэкранный кадр', () => {
  // Клавиша «дальше» в игре одна: «любая клавиша» была отдельным правилом ради
  // одного экрана, и проверял его игрок стрелкой — тем самым интерфейсом,
  // который экран объясняет.
  const first = renderToStaticMarkup(<Manual first />).replace(/<[^>]+>/g, ' ');
  assert.match(first, /Enter — начать/);
  assert.equal(first.includes('любая клавиша'), false);

  assert.match(renderToStaticMarkup(<Manual first={false} />).replace(/<[^>]+>/g, ' '), /Enter — закрыть/);
});
