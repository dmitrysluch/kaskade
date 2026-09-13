import { optionAvailable, pageAt, pagesOf, sceneOf } from './state.ts';
import type { SystemCall, SystemCommand } from './state.ts';
import { BACK, closeLabel, CLOSE, EXAMINE, FORWARD, LEAF } from '../../shared/pages.ts';
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
 *
 * `меню` — входит: сброс игры обязан находиться тем, кто его ищет, а ищут его
 * набором. Экран управления при этом остаётся в меню пунктом, и `3` продолжает
 * открывать его напрямую.
 */
export const SYSTEM_COMMANDS: SystemCommand[] = ['справочник', 'дело', 'предметы', 'меню'];

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

/**
 * Осмотр многостраничного предмета ведёт в **текущую** страницу, а не в первую.
 * Сервер сейва не видит и целится в начало; здесь мы знаем, где книга открыта.
 */
function retarget(content: GameContent, save: SaveState, option: Option): Option {
  const target = option.target ? content.nodes[option.target] : undefined;
  if (!target || target.attrs.page == null) return option;
  const page = pageAt(content, save, sceneOf(target.addr));
  return page ? { ...option, target: page.addr } : option;
}

/**
 * Чтение — отдельный уровень: пока книга открыта, список состоит из неё одной.
 * Комната ждёт снаружи и возвращается по `закрыть`.
 *
 * Опций в контенте нет — их строит движок. Имя предмета в метках не нужно:
 * листаешь то, что открыто, и спорить командам не с чем.
 * На первой странице нет «назад», на последней — «вперёд».
 */
function readingOptions(content: GameContent, save: SaveState, doc: Doc): CatalogOption[] {
  const pages = pagesOf(content, doc.docId, save);
  const at = pages.findIndex((n) => n.id === pageAt(content, save, doc.docId)?.id);

  const out: CatalogOption[] = [];
  for (const [step, label] of [[1, FORWARD] as const, [-1, BACK] as const]) {
    const page = at === -1 ? undefined : pages[at + step];
    if (!page) continue;
    out.push(
      plain({
        label,
        kind: 'environment',
        target: page.addr,
        attrs: page.attrs,
        verb: LEAF,
        object: doc.docId,
        moves: false,
      }),
    );
  }

  out.push(
    plain({
      label: closeLabel(doc.label),
      kind: 'environment',
      target: null,
      attrs: emptyAttrs(),
      verb: CLOSE,
      object: doc.docId,
      moves: false,
    }),
  );
  return out;
}

/**
 * Действия предмета — те, что показываются **внутри экрана `предметы`**
 * ([[99-открытые-вопросы]], «Глаголы и состояния предметов»).
 *
 * В основной список они больше не попадают. Раньше попадали: каждая вещь
 * на руках добавляла туда свои глаголы, и с ростом инвентаря они вытеснили бы
 * действия текущей сцены — разговор о высылке вперемешку с «позвонить телефон».
 * Предмет открывают, когда о нём вспомнили, и это отдельный жест.
 *
 * Что считается действием: именованная секция предмета, которая не страница.
 * Отдельного `inHand` для этого не нужно — он говорил то же самое вторым
 * голосом и умел расходиться с содержимым файла.
 */
/**
 * Явный генератор по вещам на руках: `показать: inventory`. Один глагол, тот,
 * который назвал автор, — и только для тех вещей, у которых на него есть ответ.
 */
function fromItems(content: GameContent, save: SaveState, verb: string): CatalogOption[] {
  const out: CatalogOption[] = [];
  for (const id of save.inventory) {
    const doc = docById(content, id);
    if (!doc || doc.type !== 'item') continue;
    const found = itemActions(content, save, doc.docId).filter((o) => o.verb === verb);
    out.push(...found);
  }
  return out;
}

export function itemActions(content: GameContent, save: SaveState, docId: string): CatalogOption[] {
  const doc = content.docs[docId];
  if (!doc || doc.type !== 'item') return [];

  const out: CatalogOption[] = [];
  // Многостраничная вещь отвечает на осмотр страницей, а узла `осмотреть`
  // у неё нет и быть не должно.
  const verbs = doc.pages.length > 0 ? [EXAMINE] : [];
  for (const node of doc.nodes) {
    if (node.id === '' || node.attrs.page != null) continue;
    verbs.push(node.id);
  }

  for (const verb of verbs) {
    const node =
      verb === EXAMINE && doc.pages.length > 0
        ? pageAt(content, save, doc.docId)
        : doc.nodes.find((n) => n.id === verb);
    if (!node) continue;
    const option: Option = {
      // Предмет — то же окружение, только оно ездит с игроком. После глагола
      // идёт готовая форма из заметки, как и у опций комнаты.
      label: node.attrs.label ?? `${verb} ${doc.targets[verb] ?? doc.target}`,
      kind: 'environment',
      target: node.addr,
      attrs: node.attrs,
      verb,
      object: doc.docId,
      moves: false,
    };
    if (optionAvailable(content, save, option)) out.push(plain(option));
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

/**
 * `reading` — `docId` открытого предмета. Пока он задан, комната из списка
 * уходит целиком: игрок читает, а не действует. Служебные команды остаются —
 * они часть оболочки, а не содержимого сцены.
 */
export function buildCatalog(
  content: GameContent,
  save: SaveState,
  reading: string | null = null,
): CatalogOption[] {
  const node = content.nodes[save.episodeState.at];
  const out: CatalogOption[] = [];
  const book = reading ? content.docs[reading] : undefined;

  if (book) {
    out.push(...readingOptions(content, save, book));
  } else if (node) {
    // Безусловные переходы каталогом не показываются: у них нет метки, потому что
    // игрок их не выбирает — узел уводит сам.
    for (const raw of node.options) {
      if (raw.label === '') continue;
      // Перенацеливаем до проверки: условие должно сработать на той странице,
      // которая откроется, а не на первой.
      const option = retarget(content, save, raw);
      if (!optionAvailable(content, save, option)) continue;

      // Листание из комнаты не показывается: `осмотреть` открывает книгу,
      // и дальше список принадлежит ей одной.
      out.push(plain(option));
    }

    for (const pending of node.pending) {
      /*
       * Генератор по инвентарю остался только явным, и раскрывается он одним
       * глаголом: `показать: inventory` в комнате — это авторское решение,
       * что здесь и сейчас показывать есть кому. Всё остальное, что предмет
       * умеет, живёт внутри экрана `предметы` ([[99-открытые-вопросы]]).
       */
      if (pending.from === 'inventory') out.push(...fromItems(content, save, pending.verb));
      else out.push(...fromWords(content, save, pending.verb));
    }
  }

  // Служебные команды — такие же опции. Хоткеи отправляют ровно их.
  for (const command of SYSTEM_COMMANDS) out.push(systemOption(command, null));

  // У справочника и дела есть необязательный аргумент: `справочник` открывает
  // список, `справочник контейнмент` — сразу статью. Аргументы обязаны быть
  // опциями, иначе игрок наберёт команду, которой не существует, — а «не понимаю»
  // в этой игре не бывает.
  // Аргумент — то, что игрок видит в тексте и в списке: название статьи, а не id.
  for (const term of Object.values(content.reference)) out.push(systemOption('справочник', term.label));
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
