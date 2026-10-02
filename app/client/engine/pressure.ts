import type { GameContent, Node, Option, SaveState } from '../../shared/types.ts';

/**
 * Раунд «надавить» ([[07b-надавить-тз]]).
 *
 * Движок **не знает**, какая реплика сильная, слабая, правильная или грубая,
 * не ведёт счёт побед и не рисует шкалу превосходства. Он умеет ровно три
 * вещи: узнать раунд по помете, считать его активное время и исполнить
 * авторскую ветку молчания, когда время вышло. Всё остальное — обычный граф.
 */

/** Помета раунда на узле сцены. */
export const PRESSURE = 'pressure';

/** Узел — раунд давления? */
export function isRound(node: Node | undefined): boolean {
  return node?.attrs.tag.includes(PRESSURE) === true;
}

/** Раунд, на котором игрок стоит прямо сейчас. */
export function roundHere(content: GameContent, save: SaveState): Node | null {
  const node = content.nodes[save.episodeState.at];
  return isRound(node) ? node! : null;
}

/**
 * Переход молчания. Он обычная видимая опция: игрок вправе выбрать её сам до
 * истечения времени, и тогда никакого таймера уже не нужно.
 */
export function silence(node: Node): Option | null {
  return node.options.find((o) => o.attrs.timeout != null) ?? null;
}

/**
 * Взвести или сохранить таймер раунда.
 *
 * Остаток не перезаводится, пока игрок стоит на том же узле: перезагрузка
 * и ответ предмета не дают новой полной попытки. Уход с узла раунд закрывает —
 * `PressureState` живёт ровно столько, сколько сам раунд.
 */
export function armPressure(content: GameContent, save: SaveState): SaveState {
  const node = roundHere(content, save);
  const route = node ? silence(node) : null;
  const ms = route?.attrs.timeout ?? null;

  if (node == null || ms == null) return save.pressure == null ? save : { ...save, pressure: null };
  if (save.pressure?.node === node.addr) return save;
  return { ...save, pressure: { node: node.addr, remainingMs: ms } };
}

/** Прожитое активное время. Остаток ниже нуля не уходит: ноль и есть «вышло». */
export function tickPressure(save: SaveState, passed: number): SaveState {
  const state = save.pressure;
  if (!state || state.remainingMs <= 0) return save;
  return { ...save, pressure: { ...state, remainingMs: Math.max(0, state.remainingMs - passed) } };
}

/**
 * Время вышло — какой маршрут исполнять. `null` значит «ещё не вышло» или
 * «игрок давно не здесь»: таймер принадлежит узлу, а не игре вообще.
 */
export function silenceRoute(content: GameContent, save: SaveState): string | null {
  const state = save.pressure;
  if (!state || state.remainingMs > 0 || state.node !== save.episodeState.at) return null;

  const node = content.nodes[state.node];
  const route = node && isRound(node) ? silence(node) : null;
  return route?.target ?? null;
}

/**
 * Что показывает шкала: сколько осталось и сколько было. Числа одни и те же
 * и у терминала, и у мобильной версии — рисуют они их по-разному.
 */
export function pressureClock(content: GameContent, save: SaveState): { left: number; total: number } | null {
  const node = roundHere(content, save);
  const state = save.pressure;
  if (!node || !state || state.node !== node.addr) return null;

  const total = silence(node)?.attrs.timeout ?? null;
  return total == null ? null : { left: state.remainingMs, total };
}
