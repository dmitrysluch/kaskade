import { enter, minigameAt, type EnterResult } from './state.ts';
import { analyze, isSolved, type Analysis, type Cell } from '../../shared/untangle.ts';
import type { GameContent, MinigameDef, SaveState } from '../../shared/types.ts';

/**
 * Мини-игра в рантайме ([[07a-мини-игра]]).
 *
 * В сейве лежат только координаты точек, `solved` и `completionApplied`.
 * Пересечения, подсветка и переставленный текст считаются отсюда заново —
 * поэтому одинаковая геометрия всегда даёт одинаковый экран, независимо от
 * того, каким путём игрок к ней пришёл.
 */

/** Поле, на котором игрок стоит прямо сейчас: только вступление, не завершение. */
export function fieldHere(content: GameContent, save: SaveState): MinigameDef | null {
  const addr = save.episodeState.at;
  const def = minigameAt(content, addr);
  return def && addr === `${def.docId}#` ? def : null;
}

/** Координаты точек: сохранённые или стартовые — при первом входе. */
export function pointsOf(def: MinigameDef, save: SaveState): Record<number, Cell> {
  const saved = save.minigames[def.id]?.points;
  if (saved) return saved;
  return Object.fromEntries(Object.entries(def.points).map(([id, p]) => [Number(id), p.start]));
}

export interface Field {
  points: Record<number, Cell>;
  analysis: Analysis;
  solved: boolean;
  /** Узел завершения уже исполнен: поле дальше ничего не выдаёт. */
  done: boolean;
}

export function fieldOf(def: MinigameDef, save: SaveState): Field {
  const points = pointsOf(def, save);
  const analysis = analyze(points, def.threads);
  const state = save.minigames[def.id];
  return {
    points,
    analysis,
    // Победа считается из геометрии, а не читается из сейва: контент автор
    // правит на ходу, и поле обязано судить себя по тому, что сейчас в файле.
    solved: isSolved(analysis),
    done: state?.completionApplied === true,
  };
}

/**
 * Шаг на одну клетку. `null` — ход отклонён: за границу сетки, в занятую
 * клетку или по уже решённому полю. Отклонённый ход не меняет ни сейва,
 * ни текста — никакой «почти правильной» подвижки нет.
 */
export function moveMinigame(
  def: MinigameDef,
  save: SaveState,
  point: number,
  dx: number,
  dy: number,
): SaveState | null {
  const field = fieldOf(def, save);
  if (field.solved) return null;

  const from = field.points[point];
  if (!from) return null;
  const to: Cell = [from[0] + dx, from[1] + dy];
  if (to[0] < 0 || to[1] < 0 || to[0] >= def.grid.columns || to[1] >= def.grid.rows) return null;
  // Занятая клетка — стена: две точки в одной клетке не читаются как две.
  if (Object.entries(field.points).some(([id, c]) => Number(id) !== point && c[0] === to[0] && c[1] === to[1])) {
    return null;
  }

  const points = { ...field.points, [point]: to };
  const solved = isSolved(analyze(points, def.threads));
  return {
    ...save,
    minigames: {
      ...save.minigames,
      [def.id]: { points, solved, completionApplied: save.minigames[def.id]?.completionApplied ?? false },
    },
  };
}

/**
 * `Enter` на решённом поле: одной операцией ставим `completionApplied`,
 * применяем атрибуты узла завершения и входим в него.
 *
 * Атомарность здесь не формальность: `give: word-only-case` обязан случиться
 * ровно один раз, а повторный вход на уже пройденное поле не должен выдать
 * слово заново.
 */
export function completeMinigame(content: GameContent, save: SaveState, def: MinigameDef): EnterResult {
  const field = fieldOf(def, save);
  if (!field.solved) return { save, entries: [] };

  const next: SaveState = {
    ...save,
    minigames: {
      ...save.minigames,
      [def.id]: { points: field.points, solved: true, completionApplied: true },
    },
  };

  if (field.done) {
    // Эффекты уже выданы: показывать нечего, уводит только маршрут завершения.
    const done = content.nodes[`${def.docId}#${def.complete}`];
    const route = done?.options.find((o) => o.label === '')?.target ?? null;
    return route == null ? { save: next, entries: [] } : enter(content, next, route);
  }

  return enter(content, next, `${def.docId}#${def.complete}`);
}
