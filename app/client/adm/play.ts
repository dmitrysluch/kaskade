import { persistSave } from '../engine/save.ts';
import { freshSave } from '../engine/state.ts';
import type { FlagInfo } from './flags.ts';
import type { GameContent, SaveState } from '../../shared/types.ts';

/**
 * Начать игру с произвольного узла — отладочный вход (`/adm`).
 *
 * Нужен затем, что сцена в конце пролога стоит в получасе игры от начала,
 * а проверять её приходится по десять раз. Пройти этот путь руками ради одной
 * реплики — единственная причина, по которой автор перестаёт её проверять.
 *
 * Живёт только здесь и только на служебном адресе: `/adm` отдаётся при флаге
 * `ADM` и на проде отвечает 404, поэтому отдельного запрета в игре не нужно —
 * кнопки, которая это делает, там просто нет.
 *
 * Состояние **называет автор**, а не угадывает движок: перед входом открывается
 * окно со всеми флагами игры, словами «Дела» и вещами, и отмечается то, что
 * к этому месту должно быть уже сделано. По умолчанию не отмечено ничего —
 * узел проверяется ровно таким, каким написан.
 */
/**
 * Что игроку «уже отдано» на момент отладочного входа. Пусто — чистое
 * состояние: ни флагов, ни слов, ни вещей.
 */
export interface DebugPicks {
  flags?: FlagInfo[];
  words?: string[];
  inventory?: string[];
}

export function debugSave(content: GameContent, addr: string, picks: DebugPicks = {}): SaveState {
  const base = freshSave(content);
  // Эпизод берём из адреса: `episodes/<id>/...` — иначе отладочный вход
  // во вторую главу играл бы с рендерером и сроками первой.
  const episode = content.episodes.find((e) => addr.startsWith(`episodes/${e.id}/`));

  return {
    ...base,
    // Флаг помнит дату сцены, в которой его ставят: в отладочном заходе берём
    // ту же самую, иначе `{{флаг.at}}` в тексте покажет прочерк там, где игрок
    // увидит число.
    flags: Object.fromEntries((picks.flags ?? []).map((f) => [f.name, { value: true, at: f.at }])),
    words: Object.fromEntries((picks.words ?? []).map((id) => [id, 'white' as const])),
    inventory: [...(picks.inventory ?? [])],
    // Обучение и подсказку отладочный заход не показывает: их показывают
    // игроку один раз, и здесь они только мешают.
    taught: true,
    hinted: true,
    // `started: false` — игра войдёт в узел как в первый: отыграет атрибуты,
    // напечатает текст и прокатится по безымянным маршрутам.
    started: false,
    episodeState: {
      ...base.episodeState,
      episode: episode?.id ?? base.episodeState.episode,
      at: addr,
    },
  };
}

/** Записать отладочный сейв и открыть игру. Сейв тот же самый, что у игрока. */
export function playFrom(content: GameContent, addr: string, picks: DebugPicks = {}): void {
  persistSave(debugSave(content, addr, picks));
  location.href = '/';
}
