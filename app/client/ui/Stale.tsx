import { useEffect } from 'react';
import { PICK_MARK } from './lines.ts';

/**
 * Сейв от прежней версии игры ([[14-переходы-и-даты-тз]], «Дата и сохранение»).
 *
 * Молча начать заново здесь нельзя, и это не формальность: игрок потерял бы
 * прохождение, не узнав об этом, а самое обидное — узнал бы не сразу. Молча
 * открыть тоже нельзя: старая запись не знает ни среза, ни даты, и игра
 * подставила бы вместо них что попало — дату первой комнаты или системные часы.
 *
 * Поэтому экран говорит прямо и ждёт подтверждения. До него запись остаётся
 * в хранилище: пока игрок не согласился, ничего не стёрто.
 *
 * Типографика — обучающего слоя и меню: это разговор оболочки о партии,
 * а не текст игры.
 */
export function Stale({
  from,
  to,
  onRestart,
  touch = false,
}: {
  /** Версия найденной записи и версия игры: цифры объясняют, что случилось. */
  from: number;
  to: number;
  onRestart: () => void;
  touch?: boolean;
}) {
  useEffect(() => {
    if (touch) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Enter' || event.repeat) return;
      event.preventDefault();
      onRestart();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRestart, touch]);

  return (
    <div className="manual menu">
      <div className="manual-box">
        <p className="manual-lead">Сохранение от прежней версии</p>
        <p>
          Запись сделана игрой версии {from}, сейчас {to}. Перенести её нечем: в старой
          записи нет ни дня, ни места, и подставить их вместо автора игра не станет.
        </p>
        <p>Начать заново? Дело, слова и всё пройденное будут стёрты. Отменить это нельзя.</p>

        <ul className="menu-items">
          <li className="pick danger">
            {touch ?
              <button className="tap" type="button" onClick={onRestart}>
                <span className="menu-mark">{PICK_MARK}</span>
                начать заново
              </button>
            : <>
                <span className="menu-mark">{PICK_MARK}</span>
                начать заново
              </>
            }
          </li>
        </ul>

        <p className="manual-go">{touch ? 'коснитесь' : 'Enter — начать заново'}</p>
      </div>
    </div>
  );
}
