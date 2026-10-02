import { persistentOfAddr, stageOfAddr } from './rooms.ts';
import type { GameContent, SaveState } from './types.ts';

/**
 * Лог контекста (07-оболочка-тз, «Лог контекста и повторный вход»).
 *
 * Повторный вход не должен открывать строку ввода над пустым потоком. Поэтому
 * буфер потока — часть сейва: у активного контекста он есть всегда, а `log: true`
 * означает, что он не выбрасывается после ухода и вернётся при возвращении.
 *
 * Лог — **история предъявления, а не игровое состояние**: из него не выполняются
 * ни `give`, ни `set`, ни автоматические маршруты, а опции, условия и текущий
 * узел всегда считаются заново из обычного сейва.
 */

/** Зарезервированный узел новой реакции на повторный вход. */
export const REENTRY = 'reentry';

/**
 * Ключ контекста: `(episode, stage, persistent)` у комнаты и
 * `(episode, stage, scene id)` у сцены.
 *
 * `null` — у этого места своего потока нет: карточка перехода и поле мини-игры
 * занимают экран целиком, а предмет, справочник и меню только снимают верхний
 * слой и возвращают тот же экран.
 */
export function logKey(content: GameContent, save: SaveState): string | null {
  const addr = save.episodeState.at;
  const docId = addr.slice(0, addr.indexOf('#') === -1 ? addr.length : addr.indexOf('#'));
  const doc = content.docs[docId];
  if (!doc) return null;

  const episode = save.episodeState.episode;
  if (doc.type === 'room') {
    // У собранной комнаты срез и помещение уже написаны в её адресе: ключ берём
    // оттуда, а не из активного контекста. Так лог комнаты `00` не попадёт
    // в ту же комнату в `04`.
    const persistent = persistentOfAddr(docId);
    const stage = stageOfAddr(docId);
    return persistent == null || stage == null ? null : `${episode}|${stage}|${persistent}`;
  }
  if (doc.type === 'scene') return `${episode}|${save.activeStage ?? ''}|${doc.id}`;
  return null;
}

/** Хранит ли контекст свой поток после ухода. */
export function logged(content: GameContent, save: SaveState): boolean {
  const addr = save.episodeState.at;
  const docId = addr.slice(0, addr.indexOf('#') === -1 ? addr.length : addr.indexOf('#'));
  return content.docs[docId]?.log === true;
}
