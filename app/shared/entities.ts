/**
 * Явно размеченные сущности (07-оболочка-тз, «Явно размеченные сущности»).
 *
 * Подсвечивается только то, что автор разметил руками. Совпадение текста
 * с названием сущности не значит ничего: «дело» в предложении — обычное слово,
 * а не карточка, и оболочка не должна догадываться, где именно автор имел в виду
 * термин. Догадки читаются игроком как обещание — подсвеченное он пробует
 * набрать, — и каждая ложная подсветка стоит доверия ко всем остальным.
 *
 * Синтаксис — ссылка Obsidian: `[[00-book]]` или `[[00-book|учебник]]`, где
 * после черты стоит форма, напечатанная в предложении. Выбрана она не от
 * бедности: автор пишет в Obsidian, ссылка там кликается и подсвечивается сама,
 * а несуществующая видна как битая ещё до того, как о ней скажет валидатор.
 * Отдельного синтаксиса ради отдельного синтаксиса заводить незачем.
 *
 * Тип сущности не пишется: он **следует из id**. Слово «Дела», предмет
 * и термин справочника живут в разных реестрах, и одно и то же имя в двух
 * из них — уже ошибка контента, а не повод писать префикс в каждом упоминании.
 */

import type { GameContent, SaveState } from './types.ts';

export type EntityKind = 'reference' | 'word' | 'item';

export interface EntityMention {
  kind: EntityKind;
  id: string;
  /** Форма, напечатанная в предложении: склонённая и не обязана совпадать с названием. */
  label: string;
  /**
   * Которое это по счёту вхождение такой же формы в этом блоке текста.
   *
   * Нужно затем, что подсветка ищет форму в строке по тексту, а слово может
   * повториться: размечено первое «учебник», а подсветить второе — ровно та
   * самая догадка, от которой этот файл и заводился.
   */
  nth: number;
}

/** `[[id]]` или `[[id|форма в предложении]]`. */
const LINK = /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g;

/**
 * Снять разметку с текста: вернуть то, что увидит игрок, и упоминания по порядку.
 *
 * Разрешение и доступность сюда не входят — это чистый разбор, и он одинаково
 * нужен и оболочке, и валидатору, у которого нет ни сейва, ни позиции игрока.
 */
export function parseEntities(raw: string): { text: string; mentions: Omit<EntityMention, 'kind'>[] } {
  const mentions: Omit<EntityMention, 'kind'>[] = [];
  const seen = new Map<string, number>();

  const text = raw.replace(LINK, (_, id: string, alias: string | undefined) => {
    const label = (alias ?? id).trim();
    const nth = seen.get(label) ?? 0;
    seen.set(label, nth + 1);
    mentions.push({ id: id.trim(), label, nth });
    return label;
  });

  return { text, mentions };
}

/**
 * Чем оказался id. `null` — ничем: такую ссылку валидатор считает ошибкой,
 * а оболочка печатает форму обычным текстом, не выдумывая ей смысла.
 */
export function kindOf(content: GameContent, id: string): EntityKind | null {
  if (content.words[id]) return 'word';
  if (content.reference[id]) return 'reference';
  const doc = Object.values(content.docs).find((d) => d.id === id);
  return doc?.type === 'item' ? 'item' : null;
}

/**
 * Доступна ли подсветка (07-оболочка-тз, «Явно размеченные сущности»).
 *
 * Правила разные, и различие содержательное. Термин справочника объясняет мир
 * и доступен всегда. Слово «Дела» — инструмент, и подсветить его раньше, чем
 * игрок его получил, значит показать команду, которой у него нет; само
 * упоминание карточку при этом не выдаёт. Предмет подсвечен, только пока он
 * рядом: упоминание отсутствующего предмета не даёт к нему доступ и не должно
 * выглядеть как доступ.
 */
export function available(
  kind: EntityKind,
  id: string,
  save: SaveState,
  here: ReadonlySet<string>,
): boolean {
  if (kind === 'reference') return true;
  if (kind === 'word') return save.words[id] != null;
  return here.has(id) || save.inventory.includes(id);
}

/** Класс подсветки: он же определяет цвет. Термин и слово различаются в палитре. */
export function entityClass(kind: EntityKind): string {
  return kind === 'word' ? 'word' : kind === 'item' ? 'item' : 'term';
}

/**
 * Разметка → упоминания, которые игрок действительно увидит подсвеченными.
 *
 * Недоступное упоминание не исчезает из текста и не становится ошибкой: форма
 * печатается как обычная проза. Это и есть смысл правила «упоминание не даёт
 * доступ» — про предмет, которого нет рядом, можно написать, не обещая игроку
 * команду.
 */
export function resolveEntities(
  content: GameContent,
  save: SaveState,
  here: ReadonlySet<string>,
  raw: string,
): { text: string; mentions: EntityMention[] } {
  const parsed = parseEntities(raw);
  const mentions: EntityMention[] = [];
  for (const mention of parsed.mentions) {
    const kind = kindOf(content, mention.id);
    if (kind && available(kind, mention.id, save, here)) mentions.push({ ...mention, kind });
  }
  return { text: parsed.text, mentions };
}
