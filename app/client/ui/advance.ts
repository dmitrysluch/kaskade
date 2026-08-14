import { useEffect } from 'react';

/**
 * Полноэкранный кадр ждёт Enter (07-оболочка-тз, «Полноэкранный кадр ждёт Enter»).
 *
 * Ни карточка, ни сплэш не закрываются по таймеру: игрок смотрит столько,
 * сколько ему нужно, а не сколько назначил рендерер. Автоматической длительности
 * показа в игре нет вовсе.
 *
 * «Новое нажатие» — техническое требование, а не придирка. `Enter`, которым
 * игрок исполнил последнюю команду сцены, не должен закрыть кадр, появившийся
 * следом: иначе лицо мелькнёт на кадр анимации и исчезнет. Поэтому кадр
 * взводится, только когда клавиша отпущена, и повтор удерживаемой не считается.
 */

/**
 * Нажат ли сейчас Enter. Состояние глобальное, потому что глобальна и клавиатура:
 * кадр обязан знать, держит ли игрок клавишу **с прошлого экрана**, а этого
 * из собственных событий компонента не видно — он к тому моменту ещё не смонтирован.
 */
let held = false;

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') held = true;
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'Enter') held = false;
  });
}

/** Подпись в правом нижнем поле кадра: единственное, что там можно сделать. */
export const ADVANCE_HINT = 'Enter';

/**
 * `onDone === null` — кадр конечный: у финального сплэша Марго следующего экрана
 * не существует, подсказки нет и клавиша не делает ничего.
 */
export function useAdvance(onDone: (() => void) | null): void {
  useEffect(() => {
    if (!onDone) return;

    // Клавишу могли уже держать, когда кадр появился: тогда ждём, пока отпустят.
    let armed = !held;
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Enter') armed = true;
    };
    const down = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      e.preventDefault();
      if (!armed) return;
      onDone();
    };

    window.addEventListener('keyup', up);
    window.addEventListener('keydown', down);
    return () => {
      window.removeEventListener('keyup', up);
      window.removeEventListener('keydown', down);
    };
  }, [onDone]);
}
