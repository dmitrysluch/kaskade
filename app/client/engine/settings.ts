/**
 * Настройки доступности ([[07b-надавить-тз]], «Доступность»).
 *
 * Их одна, и она не игровая: «без ограничений по времени» выключает
 * автоматическое исполнение `timeout`, но ничего не убирает из списка — игрок
 * по-прежнему может промолчать сам. Поэтому она живёт рядом с сейвом, но не
 * внутри него: это свойство человека за клавиатурой, а не прохождения.
 */

const KEY = 'kaskade.untimed';

export function untimed(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(KEY) === '1';
}

export function setUntimed(value: boolean): void {
  if (typeof localStorage === 'undefined') return;
  if (value) localStorage.setItem(KEY, '1');
  else localStorage.removeItem(KEY);
}
