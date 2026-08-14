import { useEffect, useState } from 'react';
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
 * Сколько всё это висит — из `timing` рендерера: темп машины, как палитра.
 */
export function Transition({
  card,
  bios,
  cols,
  rows,
  glyphs,
  timing,
  onDone,
}: {
  card: string;
  bios: string[];
  cols: number;
  rows: number;
  glyphs: FrameGlyphs;
  timing: { titlecard: number; bios: number };
  onDone: () => void;
}) {
  const [stage, setStage] = useState<'card' | 'bios'>('card');

  useEffect(() => {
    if (stage === 'card') {
      const t = setTimeout(bios.length > 0 ? () => setStage('bios') : onDone, timing.titlecard);
      return () => clearTimeout(t);
    }
    const t = setTimeout(onDone, timing.bios);
    return () => clearTimeout(t);
  }, [stage, bios.length, timing.titlecard, timing.bios, onDone]);

  return stage === 'card' ?
      <CardScreen cols={cols} rows={rows} text={card} glyphs={glyphs} />
    : <CardScreen cols={cols} rows={rows} text={bios.join('\n')} glyphs={null} />;
}
