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

  // 7 → 8: появилось физическое ожидание. Незаконченного у старого сейва быть
  // не может — механики не существовало, — и `null` здесь не потеря данных,
  // а честное «никто ничего не ждёт».
  7: (save) => ({ ...save, wait: save.wait ?? null }),

  /*
   * 11 → 12: появился лог контекста ([[07-оболочка-тз]], «Лог контекста и
   * повторный вход»). Миграция однозначная — пустой объект: что игрок видел
   * до обновления, записи просто нет, и выдумывать историю нельзя. Отклонять
   * такой сейв незачем: первый же вход начнёт вести лог, а пустоту на текущем
   * экране закроет текст места или `## reentry`, если автор его написал.
   *
   * Промежуточные 8 → 11 конвертеров не имеют: эти версии жили только в
   * разработке, между переносом контента на логические адреса и этой правкой.
   */
  11: (save) => ({ ...save, logs: save.logs ?? {} }),

  /*
   * 12 → 13: появились раунды «надавить» ([[07b-надавить-тз]]). В старом сейве
   * незавершённого раунда быть не может — механики не существовало, — поэтому
   * `null` здесь не потеря данных, а честное «никто не молчит под таймером».
   */
  12: (save) => ({ ...save, pressure: save.pressure ?? null }),

  /*
   * 13 → 14: у приостановленного места появился адрес возврата
   * ([[07-оболочка-тз]], «Неявный `resume`»). `null` честен: кого старый сейв
   * приостановил, записи нет, и первый же выход из сцены сработает как обычный
   * вход — худшее, что случится, это лишний раз показанный текст комнаты.
   */
  13: (save) => ({ ...save, resume: save.resume ?? null }),

  /*
   * 8 → 9 миграции нет намеренно ([[14-переходы-и-даты-тз]], «Дата и сохранение»).
   *
   * В девятой версии игровой день и срез мира приходят из подтверждённой
   * карточки перехода, а до неё их не существует. У старой записи этих полей
   * нет, и вывести их не из чего: дата лежала в заметке, где стоял игрок,
   * а адрес этой заметки в новой схеме означает другое место. Подставить
   * «какой-нибудь» день — это и есть то, от чего мы ушли; поэтому старая
   * запись честно объявляется несовместимой, а не поднимается наугад.
   */
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

/**
 * Что нашлось в хранилище.
 *
 * `incompatible` — сейв, который поднять нельзя: миграции для его версии нет
 * ([[14-переходы-и-даты-тз]], «Дата и сохранение»). Молча начать заново здесь
 * запрещено, и правильно: игрок потерял бы прохождение, не узнав об этом.
 * Экран спрашивает, а запись остаётся в хранилище до подтверждения.
 */
export type Loaded =
  | { kind: 'save'; save: SaveState }
  | { kind: 'fresh'; save: SaveState }
  | { kind: 'incompatible'; from: number };

export function loadSave(content: GameContent): Loaded {
  const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
  if (!raw) return { kind: 'fresh', save: freshSave(content) };

  let parsed: SaveState;
  try {
    parsed = JSON.parse(raw) as SaveState;
  } catch {
    // Испорченный JSON поднять нечем и жалеть нечего: это не прохождение,
    // а мусор, и разговаривать о нём с игроком незачем.
    return { kind: 'fresh', save: freshSave(content) };
  }

  const migrated = migrate(parsed, content.saveVersion);
  if (!migrated) return { kind: 'incompatible', from: Number(parsed.saveVersion ?? 0) };

  // Узел мог исчезнуть, пока автор правил заметки: тогда начинаем эпизод сначала,
  // а не показываем пустой экран.
  if (!content.nodes[migrated.episodeState.at]) return { kind: 'fresh', save: freshSave(content) };
  return { kind: 'save', save: migrated };
}

export function persistSave(save: SaveState): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(save));
}

export function clearSave(): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.removeItem(KEY);
}
