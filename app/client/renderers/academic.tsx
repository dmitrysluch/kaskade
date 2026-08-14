import type { ReactNode } from 'react';
import type { RendererDef } from '../../shared/types.ts';

/**
 * `academic` — старая академическая машина TU, 2024 и 2026 ([[04-стиль-и-звук]]).
 * Монохром, широкий кегль, ни одного эффекта: чисто, стабильно, электричества вдоволь.
 * Вся разница между рендерерами живёт здесь, в переменных и классах, — каркас общий.
 */
export function Academic({ def, children }: { def: RendererDef; children: ReactNode }) {
  // Вся палитра целиком, а не четыре известных ключа: добавить цвет должно быть
  // можно строчкой в game.yaml, не трогая код.
  const style: Record<string, string> = {};
  for (const [key, value] of Object.entries(def.palette)) style[`--${key}`] = value;
  style['--font'] = def.font.family;
  style['--size'] = `${def.font.size}px`;

  return (
    <div className={['renderer', ...def.effects].join(' ')} style={style as React.CSSProperties}>
      {children}
    </div>
  );
}
