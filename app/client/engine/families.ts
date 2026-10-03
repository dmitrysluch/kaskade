import type { CatalogOption } from './catalog.ts';

/**
 * Сворачивание повторяющихся действий комнаты (07-оболочка-тз, «Сворачивание
 * повторяющихся действий комнаты»).
 *
 * Шесть `осмотреть <предмет>` в списке — это шесть строк, из которых игрок
 * читает одно слово шесть раз. Поэтому при пустом вводе семья, собранная одним
 * генератором комнаты, занимает одну строку с префиксом и числом вариантов,
 * а раскрывается тем же способом, которым игрок и так пользуется: подстановкой
 * префикса в строку ввода.
 *
 * Это **не режим**: раскрытая семья — просто непустой ввод, и руками набранный
 * `осмотреть ` даёт тот же список. Поэтому состояние раскрытия никуда не
 * сохраняется, ничего не исполняет и в лог не пишет.
 */

/** Строка списка: либо настоящая команда, либо свёрнутая семья. */
export type Row =
  | { kind: 'option'; option: CatalogOption }
  | { kind: 'family'; key: string; phrase: string; count: number; sample: CatalogOption };

/**
 * Сворачивается ли команда.
 *
 * Исключения — не вкусовые. `advance` и `timeout` срочны или необратимы:
 * спрятать их за префикс значит спрятать последствие. Команда, которая держится
 * на белом слове или вещи в руках, — это применение найденного, и оно обязано
 * быть видно на верхнем уровне. Служебные и серые живут по своим правилам,
 * а авторская опция семьёй не бывает вовсе: у неё нет генератора.
 */
function foldable(option: CatalogOption): boolean {
  return (
    option.family != null &&
    option.system == null &&
    !option.locked &&
    !option.attrs.advance &&
    option.attrs.timeout == null &&
    option.needs == null
  );
}

/**
 * Список строк для показа. При непустом вводе ничего не сворачивается: игрок
 * уже сузил выбор сам, и прятать от него половину найденного незачем.
 *
 * Семья встаёт на место своей первой команды и наследует её категорию и цвет —
 * порядок списка от сворачивания не меняется.
 */
export function collapse(options: CatalogOption[], input: string): Row[] {
  if (input !== '') return options.map((option) => ({ kind: 'option' as const, option }));

  const counts = new Map<string, number>();
  for (const option of options) {
    if (!foldable(option)) continue;
    const key = option.family!.key;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const rows: Row[] = [];
  for (const option of options) {
    const key = foldable(option) ? option.family!.key : null;
    // Одна команда семейства остаётся полной: сворачивать нечего, а префикс
    // вместо неё заставил бы игрока сделать лишний шаг ради одной строки.
    if (key == null || (counts.get(key) ?? 0) < 2) {
      rows.push({ kind: 'option', option });
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ kind: 'family', key, phrase: option.family!.phrase, count: counts.get(key)!, sample: option });
  }
  return rows;
}

/** Что показывает строка семьи: `осмотреть… (6)`. */
export function familyLabel(row: Extract<Row, { kind: 'family' }>): string {
  return `${row.phrase}… (${row.count})`;
}

/** Что подставляется в строку ввода при раскрытии. Пробел обязателен. */
export function familyPrefix(row: Extract<Row, { kind: 'family' }>): string {
  return `${row.phrase} `;
}

/** Команда строки, если это команда: семью выбрать нельзя — её раскрывают. */
export function optionOf(row: Row | undefined): CatalogOption | null {
  return row?.kind === 'option' ? row.option : null;
}
