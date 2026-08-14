import type { CatalogOption } from './catalog.ts';

/**
 * Автокомплит — он же инвентарь слов (07-оболочка-тз).
 *
 * Совпадение ищем по началу любого слова опции, а не только всей строки:
 * в примере из ТЗ «спросить о парт▁» находит «партия BAYN-OPV-63991», то есть
 * игрок дописывает то слово, которое помнит, а не то, с которого опция начинается.
 */

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function matches(catalog: CatalogOption[], input: string): CatalogOption[] {
  const query = norm(input);

  // При пустом вводе список показывает, что можно сделать здесь и сейчас.
  // Служебные команды в него не идут: они и так стоят в своей закреплённой
  // полосе, а их аргументы (`справочник контейнмент`) в списке заняли бы больше
  // места, чем всё остальное вместе, и утопили бы единственное, ради чего он есть.
  if (query === '') return catalog.filter((o) => o.system == null);

  const words = query.split(' ');
  return catalog.filter((option) => {
    const haystack = norm(option.label).split(' ');
    // Каждое введённое слово должно найтись в начале какого-нибудь слова опции.
    return words.every((w) => haystack.some((h) => h.startsWith(w)));
  });
}

/** Ввод коммитится, только если он в точности называет одну доступную опцию. */
export function exact(catalog: CatalogOption[], input: string): CatalogOption | null {
  const query = norm(input);
  return catalog.find((o) => norm(o.label) === query) ?? null;
}

/**
 * Общая приставка всех совпавших вариантов — то, что дописывает Tab, прежде чем
 * начать перебирать варианты.
 */
export function commonPrefix(options: CatalogOption[]): string {
  if (options.length === 0) return '';
  const first = options[0]!.label;
  let end = first.length;
  for (const o of options) {
    let i = 0;
    while (i < end && i < o.label.length && first[i]!.toLowerCase() === o.label[i]!.toLowerCase()) i++;
    end = i;
  }
  return first.slice(0, end);
}
