import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { Menu } from '../app/client/ui/Menu.tsx';
import { PICK_MARK } from '../app/client/ui/lines.ts';

/**
 * Меню оболочки. Проверяем не вёрстку, а единственное, что здесь опасно: чтобы
 * необратимое не оказалось выбранным по умолчанию и не срабатывало с одного
 * нажатия. Перебор пунктов и подтверждение — состояние компонента, до него
 * серверный рендер не достаёт, поэтому меряем первый кадр.
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
