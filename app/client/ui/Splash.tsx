import { useEffect } from 'react';
import { cardBox, type FrameGlyphs } from './Screen.tsx';
import type { Seg } from './text.ts';

/**
 * Сплэш — лицо во весь кадр (07-оболочка-тз, «Лицо — сплэш»).
 *
 * Терминал на три секунды перестаёт быть терминалом: рамка уходит, текст уходит,
 * ввод не принимается, в центре пустого экрана лицо. Потом всё возвращается,
 * и разговор идёт дальше с той же строки.
 *
 * Постоянной панели сбоку нет намеренно: то, что всегда на экране, перестаёт
 * быть событием.
 */

/**
 * Сколько лицо держится на экране, приходит из `timing.splash` рендерера: три
 * секунды — достаточно, чтобы разглядеть, мало, чтобы заскучать, но это темп
 * конкретной машины, а не константа кода.
 */
export function Splash({
  lines,
  card,
  glyphs,
  ms,
  onDone,
}: {
  lines: Seg[][];
  /** Запись под лицом: `splash:` и `titlecard` на одном узле — это личное дело. */
  card?: string;
  glyphs?: FrameGlyphs;
  ms: number;
  onDone: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDone, ms);
    return () => clearTimeout(timer);
  }, [ms, onDone]);

  return (
    <div className="splash">
      <div>
        {lines.map((row, y) => (
          <div key={y}>
            {row.map((seg, x) => (
              <span
                key={x}
                style={
                  seg.color != null || seg.bg != null
                    ? {
                        ...(seg.color != null && { color: seg.color }),
                        ...(seg.bg != null && { background: seg.bg }),
                      }
                    : undefined
                }
              >
                {seg.text}
              </span>
            ))}
          </div>
        ))}
        {/* Лицо и запись под ним: игра открывается тем же жанром, которым
            закончится, — человек, опознанный по бумаге. */}
        {card && (
          <div className="splash-card">
            {cardBox(card, glyphs ?? null).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
