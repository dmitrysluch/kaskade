import { freshSave } from './state.ts';
import type { GameContent, SaveState } from '../../shared/types.ts';

/**
 * Сейв в localStorage. Сохранение автоматическое, слота ручного сейва нет.
 *
 * Версионирование заведено с первого дня намеренно ([[06-выпуск]]): миграции —
 * единственное настоящее техническое ограничение сериального выпуска, и задним
 * числом оно не чинится. Пока миграций нет, но место для них есть.
 */

const KEY = 'kaskade.save';

/** from → функция, поднимающая сейв на версию from+1. */
export const MIGRATIONS: Record<number, (save: SaveState) => SaveState> = {
  // 1 → 2: флаг перестал быть булевым и начал помнить дату сцены. У старых
  // сейвов даты нет и взять её неоткуда — честнее пустая, чем выдуманная.
  1: (save) => ({
    ...save,
    flags: Object.fromEntries(
      Object.entries(save.flags as unknown as Record<string, boolean | { value: boolean; at: string | null }>).map(
        ([name, state]) => [name, typeof state === 'boolean' ? { value: state, at: null } : state],
      ),
    ),
  }),

  // 2 → 3: появились сплэши, и игра должна помнить, какие уже показаны.
  // Старому сейву честнее считать, что не показан ни один: лицо, увиденное
  // второй раз, — меньшая беда, чем лицо, которое не увидели вовсе.
  2: (save) => ({ ...save, splashes: save.splashes ?? [] }),

  // 3 → 4: текущая дата уехала из сейва — она всегда берётся из заметки, где
  // игрок стоит. Взамен появились сроки, и старому сейву они достаются пустыми:
  // начальные лежат в episode.yaml, а назначенные узлом игрок назначит заново,
  // когда дойдёт до той сцены. Ставить их задним числом было бы выдумкой.
  3: (save) => {
    const { date: _, ...episodeState } = save.episodeState as typeof save.episodeState & { date?: string | null };
    return { ...save, dates: save.dates ?? {}, episodeState };
  },

  // 4 → 5: появился обучающий слой. Тому, кто уже играет, инструкцию показывать
  // поздно и обидно — считаем, что он её видел; команда `управление` на месте.
  4: (save) => ({ ...save, taught: true, hinted: true }),

  // 5 → 6: подсказка-пример уходит по делу, а не по счётчику команд.
  5: (save) => {
    const { entered: _, ...rest } = save as SaveState & { entered?: number };
    return { ...rest, hinted: rest.hinted ?? true };
  },

  // 6 → 7: предметы стали многостраничными. Где игрок остановился в книге,
  // старый сейв не знает, и выдумывать страницу нельзя: записи просто нет,
  // при первом осмотре предмет откроется с начала.
  6: (save) => ({ ...save, itemStates: save.itemStates ?? {} }),
};

export function migrate(save: SaveState, target: number): SaveState | null {
  let current = save;
  while (current.saveVersion < target) {
    const step = MIGRATIONS[current.saveVersion];
    if (!step) return null;
    current = { ...step(current), saveVersion: current.saveVersion + 1 };
  }
  // Сейв из будущего — не наше дело: лучше начать заново, чем играть в половине.
  return current.saveVersion === target ? current : null;
}

export function loadSave(content: GameContent): SaveState {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  if (!raw) return freshSave(content);
  try {
    const parsed = JSON.parse(raw) as SaveState;
    const migrated = migrate(parsed, content.saveVersion);
    if (!migrated) return freshSave(content);
    // Узел мог исчезнуть, пока автор правил заметки: тогда начинаем эпизод сначала,
    // а не показываем пустой экран.
    if (!content.nodes[migrated.episodeState.at]) return freshSave(content);
    return migrated;
  } catch {
    return freshSave(content);
  }
}

export function persistSave(save: SaveState): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(save));
}

export function clearSave(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
