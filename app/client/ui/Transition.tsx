import { useCallback, useState } from 'react';
import { ADVANCE_HINT, useAdvance } from './advance.ts';
import { CardScreen, type FrameGlyphs } from './Screen.tsx';

/**
 * Переход между эпизодами (07-оболочка-тз, «Переключение эпизодов»).
 *
 *   1. ambience.fadeOut()   звук уходит первым — ухо переезжает раньше глаза
 *   2. titlecard            рамка по размеру содержимого, ввод не принимается
 *   3. bios                 3–4 строки, шрифт уже новый
 *   4. mount(renderer)      новый рендерер, новый ambience
 *
 * Прологу нужны только титры между 2024 и 2026, но механизм заведён целиком:
 * иначе на первом же настоящем эпизоде пролог пришлось бы переписывать.
 *
 * Титру рамка положена: в этой игре он не подпись к кадру, а предъявленная
 * запись. Голый текст на чёрном остаётся за катсценой, которая бывает один раз
 * за игру. Псевдо-BIOS рамки не получает: это не вещь, которую предъявляют,
 * а машина, говорящая от себя.
 *
 * Ни один кадр не закрывается по таймеру: каждый ждёт отдельного нового нажатия
 * `Enter`. Последовательность не может проехать сама и не может быть проскочена
 * удерживаемой клавишей.
 */
export function Transition({
  card,
  bios,
  cols,
  rows,
  glyphs,
  onDone,
}: {
  card: string;
  bios: string[];
  cols: number;
  rows: number;
  glyphs: FrameGlyphs;
  onDone: () => void;
}) {
  const [stage, setStage] = useState<'card' | 'bios'>('card');

  // Каждый кадр ждёт своего нажатия: карточка уводит в bios, bios — дальше.
  const next = useCallback(
    () => (stage === 'card' && bios.length > 0 ? setStage('bios') : onDone()),
    [stage, bios.length, onDone],
  );
  useAdvance(next);

  return stage === 'card' ?
      <CardScreen cols={cols} rows={rows} text={card} glyphs={glyphs} hint={ADVANCE_HINT} />
    : <CardScreen cols={cols} rows={rows} text={bios.join('\n')} glyphs={null} hint={ADVANCE_HINT} />;
}
