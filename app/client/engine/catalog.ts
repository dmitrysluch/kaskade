import { optionAvailable } from './state.ts';
import type { SystemCall, SystemCommand } from './state.ts';
import { emptyAttrs, type Doc, type GameContent, type Option, type SaveState } from '../../shared/types.ts';

/**
 * Каталог — всё, что игрок может сейчас ввести (07-оболочка-тз, «Опция»).
 *
 * Собирается заново на каждое изменение состояния. Опции из разных источников
 * различаются только полями, до которых игроку нет дела: в строке ввода они
 * ведут себя одинаково, и это единственный способ выполнить обещание «игра
 * никогда не говорит „не понимаю“» — вводить можно ровно то, что здесь лежит.
 */

export interface CatalogOption extends Option {
  /** Серое слово: видно в автокомплите, выбрать нельзя. */
  locked: boolean;
  system: SystemCall | null;
}

/**
 * Служебные команды оболочки. `управление` в этот список не входит намеренно:
 * экран управления — метаинструкция, а не действие терминала, он открывается
 * клавишей и не притворяется командой (07-оболочка-тз, «Служебные команды»).
 */
export const SYSTEM_COMMANDS: SystemCommand[] = ['справочник', 'дело', 'предметы'];

function plain(option: Option): CatalogOption {
  return { ...option, locked: false, system: null };
}

function systemOption(kind: SystemCommand, arg: string | null): CatalogOption {
  return {
    label: arg ? `${kind} ${arg}` : kind,
    kind: 'system',
    target: null,
    attrs: emptyAttrs(),
    verb: null,
    object: null,
    moves: false,
    locked: false,
    system: { kind, arg },
  };
}

function docById(content: GameContent, id: string): Doc | undefined {
  return Object.values(content.docs).find((d) => d.id === id);
}

/** Глаголы вещей на руках: предмет приносит их с собой, комната ни при чём. */
function fromInventory(content: GameContent, save: SaveState): CatalogOption[] {
  const out: CatalogOption[] = [];
  for (const id of save.inventory) {
    const doc = docById(content, id);
    if (!doc || doc.type !== 'item') continue;
    for (const verb of doc.inHand) {
      const node = doc.nodes.find((n) => n.id === verb);
      if (!node) continue;
      const option: Option = {
        // Вещь на руках — то же окружение, только оно ездит с игроком.
        label: node.attrs.label ?? `${verb} ${doc.label}`,
        kind: 'environment',
        target: node.addr,
        attrs: node.attrs,
        verb,
        object: doc.docId,
        moves: false,
      };
      if (optionAvailable(content, save, option)) out.push(plain(option));
    }
  }
  return out;
}

/**
 * Слова из «Дела». Серые попадают в список наравне с белыми и именно этим
 * работают: разрыв между «знаю» и «могу сказать» оказывается под пальцами
 * игрока, а не в отдельном меню.
 */
function fromWords(content: GameContent, save: SaveState, phrase: string): CatalogOption[] {
  return Object.entries(save.words).map(([id, state]) => ({
    // Слово из дела — реплика, а не предмет: это ход по истории.
    label: `${phrase} ${content.words[id]?.label ?? id}`,
    kind: 'story' as const,
    target: null,
    attrs: emptyAttrs(),
    verb: phrase.split(/\s+/)[0] ?? phrase,
    object: id,
    moves: false,
    locked: state === 'grey',
    system: null,
  }));
}

export function buildCatalog(content: GameContent, save: SaveState): CatalogOption[] {
  const node = content.nodes[save.episodeState.at];
  const out: CatalogOption[] = [];

  if (node) {
    // Безусловные переходы каталогом не показываются: у них нет метки, потому что
    // игрок их не выбирает — узел уводит сам.
    for (const option of node.options) {
      if (option.label === '') continue;
      if (optionAvailable(content, save, option)) out.push(plain(option));
    }

    for (const pending of node.pending) {
      if (pending.from === 'inventory') out.push(...fromInventory(content, save));
      else out.push(...fromWords(content, save, pending.verb));
    }
  }

  // Служебные команды — такие же опции. Хоткеи отправляют ровно их.
  for (const command of SYSTEM_COMMANDS) out.push(systemOption(command, null));

  // У справочника и дела есть необязательный аргумент: `справочник` открывает
  // список, `справочник контейнмент` — сразу статью. Аргументы обязаны быть
  // опциями, иначе игрок наберёт команду, которой не существует, — а «не понимаю»
  // в этой игре не бывает.
  for (const term of Object.keys(content.reference)) out.push(systemOption('справочник', term));
  for (const id of Object.keys(save.words)) {
    out.push(systemOption('дело', content.words[id]?.label ?? id));
  }

  /*
   * Порядок списка (07-оболочка-тз, «Список всегда показывает, что можно»):
   * действия с окружением, обычные сюжетные, сюжетные с `advance`, служебные.
   * Внутри каждой последовательности порядок остаётся авторским.
   *
   * Сортируем здесь, а не в раскладке: стрелки обязаны ходить в том же порядке,
   * в каком игрок видит строки, а ходят они по каталогу.
   */
  const rank = (o: CatalogOption): number =>
    o.system ? 3 : o.attrs.advance ? 2 : o.kind === 'environment' ? 0 : 1;
  return out
    .map((option, i) => ({ option, i }))
    .sort((a, b) => rank(a.option) - rank(b.option) || a.i - b.i)
    .map((x) => x.option);
}
