import { persistSave } from '../engine/save.ts';
import { freshSave } from '../engine/state.ts';
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
 * Состояние собирается **чистое**, а не «как будто игрок дошёл»: флагов,
 * слов и вещей у него нет. Выдумывать их значило бы выдумывать прохождение,
 * и узел бы проверялся не в том состоянии, в каком его увидит игрок. Что
 * узлу нужно, видно на его карточке: `if`, `⚑` и `+` там написаны.
 */
export function debugSave(content: GameContent, addr: string): SaveState {
  const base = freshSave(content);
  // Эпизод берём из адреса: `episodes/<id>/...` — иначе отладочный вход
  // во вторую главу играл бы с рендерером и сроками первой.
  const episode = content.episodes.find((e) => addr.startsWith(`episodes/${e.id}/`));

  return {
    ...base,
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
export function playFrom(content: GameContent, addr: string): void {
  persistSave(debugSave(content, addr));
  location.href = '/';
}
