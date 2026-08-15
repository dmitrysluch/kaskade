import { useEffect, useRef } from 'react';
import { ADVANCE_MARK, PICK_MARK } from './lines.ts';
import { MARGIN, pad, type Seg } from './text.ts';
import type { CatalogOption } from '../engine/catalog.ts';

/**
 * Мобильный экран (`/m`).
 *
 * Терминал остаётся терминалом: та же сетка знаков, тот же поток, тот же статус,
 * та же линейка. Меняется одно — **команду не набирают, а трогают**. Строки ввода
 * здесь нет вовсе: экранная клавиатура съедает пол-экрана, а набирать русские
 * команды пальцем — наказание, и автокомплит, ради которого строка существует,
 * на телефоне не нужен. Список и так показывает всё, что можно сделать.
 *
 * Отсюда три отличия от большого экрана, и все три вынужденные:
 *
 *   1. Поток прокручивается пальцем, а не окном в `rows` строк: жест ожидаем,
 *      а считать высоту нечем — она пляшет вместе с адресной строкой браузера.
 *   2. Список показывает все команды и прокручивается сам: `+3` пальцем
 *      не раскрыть.
 *   3. Строка команды выше знакоместа — палец не попадает в 16 пикселей.
 *      Шрифт и знаки при этом те же, так что это по-прежнему список терминала,
 *      а не кнопки приложения.
 */

function Row({ segs, cols, cls }: { segs: Seg[]; cols: number; cls?: string | undefined }) {
  return (
    <div className={cls}>
      {segs.map((seg, i) => (
        <span key={i} className={seg.cls} style={seg.color != null ? { color: seg.color } : undefined}>
          {seg.text}
        </span>
      ))}
      {/* Добиваем строку до сетки: подложка статуса обязана идти во всю ширину. */}
      {' '.repeat(Math.max(0, cols - segs.reduce((n, s) => n + s.text.length, 0)))}
    </div>
  );
}

/** Категория опции → класс. Тот же, что в списке большого экрана. */
function kindClass(option: CatalogOption): string {
  if (option.system) return 'system';
  return option.attrs.advance ? 'advance' : option.kind === 'environment' ? 'environment' : 'story';
}

export interface MobileScreenProps {
  cols: number;
  status: Seg[];
  /** Поток целиком: окна в `rows` строк на телефоне нет. */
  stream: Seg[][];
  options: CatalogOption[];
  onPick: (option: CatalogOption) => void;
  /** Служебная полоса: те же команды, но их трогают. */
  system: { label: string; run: () => void }[];
  rule: string;
}

export function MobileScreen({ cols, status, stream, options, onPick, system, rule }: MobileScreenProps) {
  const streamRef = useRef<HTMLDivElement | null>(null);

  // Новый текст всегда внизу: игрок читает то, что только что произошло.
  useEffect(() => {
    const el = streamRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [stream]);

  return (
    <div className="mobile">
      <Row segs={status} cols={cols} cls={status.length > 0 ? 'status' : undefined} />

      <div className="mobile-stream" ref={streamRef}>
        {stream.map((line, i) => (
          <Row key={i} segs={line} cols={cols} />
        ))}
      </div>

      <Row segs={[{ text: rule.repeat(cols), cls: 'rule' }]} cols={cols} />

      <div className="mobile-list">
        {options.map((option, i) => (
          <button key={`${option.label}-${i}`} className="tap" type="button" onClick={() => onPick(option)}>
            <span className="dim">{`${' '.repeat(MARGIN.prompt)}${PICK_MARK} `}</span>
            <span className={[kindClass(option), option.locked ? 'locked' : ''].filter(Boolean).join(' ')}>
              {option.attrs.advance ? `${ADVANCE_MARK} ` : ''}
              {option.label}
            </span>
          </button>
        ))}
        {options.length === 0 && <div className="dim">{`${pad()}нечего сделать`}</div>}
      </div>

      <div className="mobile-bar">
        {system.map((command) => (
          <button key={command.label} className="tap" type="button" onClick={command.run}>
            <span className="system">{command.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
