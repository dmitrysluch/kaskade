import { useEffect, useState } from 'react';
import { PICK_MARK } from './lines.ts';

/**
 * Меню оболочки (07-оболочка-тз, «Меню и сброс игры»).
 *
 * Второй и последний экран, который говорит не голосом машины, а от лица
 * оболочки: тут не играют, тут решают судьбу партии. Поэтому типографика та же,
 * что у обучающего слоя, — притворяться терминалом ему незачем.
 *
 * Клавиши те же, что в списке команд: `↑ ↓` выбирают, `Enter` выполняет,
 * `Esc` отступает. Ни одной новой связки — иначе игрок учил бы второй интерфейс
 * ради трёх строк.
 *
 * Сброс спрашивает подтверждение, и выбран в нём по умолчанию отказ: это
 * единственное необратимое действие во всей игре, и попасть в него случайным
 * `Enter` нельзя.
 */

export interface MenuItem {
  label: string;
  run: () => void;
  /** Необратимое: показывается цветом ошибки и никогда не выбрано по умолчанию. */
  danger?: boolean;
}

export function Menu({
  onClose,
  onManual,
  onRestart,
  touch = false,
}: {
  onClose: () => void;
  onManual: () => void;
  onRestart: () => void;
  /** Мобильная версия: пункт выбирают касанием, стрелок и Enter там нет. */
  touch?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  const [pick, setPick] = useState(0);

  // Переход в подтверждение и обратно всегда начинается с безопасного пункта.
  useEffect(() => setPick(0), [confirm]);

  const items: MenuItem[] =
    confirm ?
      [
        { label: 'нет, вернуться', run: () => setConfirm(false) },
        { label: 'да, начать заново', run: onRestart, danger: true },
      ]
    : [
        { label: 'продолжить', run: onClose },
        { label: 'управление', run: onManual },
        { label: 'начать заново', run: () => setConfirm(true) },
      ];

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const key = event.key;
      const step = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? items.length - 1 : 0;

      if (key === 'Escape') {
        event.preventDefault();
        // Из подтверждения `Esc` возвращает в меню, а не наружу: отказ от
        // необратимого не должен заодно закрывать экран.
        if (confirm) setConfirm(false);
        else onClose();
      } else if (step) {
        event.preventDefault();
        setPick((p) => (p + step) % items.length);
      } else if (key === 'Enter' && !event.repeat) {
        event.preventDefault();
        items[pick]?.run();
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <div className="manual menu">
      <div className="manual-box">
        {confirm ?
          <>
            <p className="manual-lead">Начать заново?</p>
            <p>
              Дело, слова и всё пройденное будут стёрты, игра начнётся с первого кадра.
              Отменить это нельзя.
            </p>
          </>
        : <p className="manual-lead">Меню</p>}

        <ul className="menu-items">
          {items.map((item, i) => (
            <li
              key={item.label}
              className={[touch || i === pick ? 'pick' : '', item.danger ? 'danger' : ''].filter(Boolean).join(' ')}
            >
              {touch ?
                <button className="tap" type="button" onClick={item.run}>
                  <span className="menu-mark">{PICK_MARK}</span>
                  {item.label}
                </button>
              : <>
                  <span className="menu-mark">{i === pick ? PICK_MARK : ' '}</span>
                  {item.label}
                </>
              }
            </li>
          ))}
        </ul>

        <p className="manual-go">
          {touch ?
            (confirm ? 'коснитесь ответа' : 'коснитесь пункта')
          : `↑ ↓ выбрать · Enter выполнить · Esc ${confirm ? 'отменить' : 'закрыть'}`}
        </p>
      </div>
    </div>
  );
}
