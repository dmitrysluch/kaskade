import { ADVANCE_HINT, useAdvance } from './advance.ts';
import { cardBox, type FrameGlyphs } from './Screen.tsx';
import type { Seg } from './text.ts';

/**
 * Сплэш — лицо во весь кадр (07-оболочка-тз, «Лицо — сплэш»).
 *
 * Терминал перестаёт быть терминалом: рамка уходит, текст уходит, ввод не
 * принимается, в центре пустого экрана лицо. Кадр ждёт нового `Enter`, и только
 * тогда всё возвращается — игрок смотрит столько, сколько ему нужно, а не
 * сколько назначил рендерер.
 *
 * Постоянной панели сбоку нет намеренно: то, что всегда на экране, перестаёт
 * быть событием.
 */
export function Splash({
  lines,
  card,
  glyphs,
  onDone,
}: {
  lines: Seg[][];
  /** Запись под лицом: `splash:` и `titlecard` на одном узле — это личное дело. */
  card?: string;
  glyphs?: FrameGlyphs;
  /** `null` — дальше ничего нет: финальное лицо не закрывается вовсе. */
  onDone: (() => void) | null;
}) {
  useAdvance(onDone);

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
      {onDone && <div className="frame-hint">{ADVANCE_HINT}</div>}
    </div>
  );
}
