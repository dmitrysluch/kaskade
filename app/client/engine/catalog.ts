import { openWindow, optionAvailable, pageAt, pagesOf, resolveTarget, sceneOf } from './state.ts';
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
  /**
   * На чём команда держится: вещь на руках или слово «Дела» (07-оболочка-тз,
   * «Команда, которой нужна вещь или слово»). `null` — ни на чём, обычное
   * действие места или разговора.
   */
  needs: Needs | null;
}

/** Требование команды: что именно и как это называется на экране. */
export interface Needs {
  kind: 'word' | 'item';
  id: string;
  label: string;
}

/**
 * Чем держится команда (07-оболочка-тз, «Команда, которой нужна вещь или слово»).
 *
 * Два источника, и оба честные:
 *
 *   1. **Условие автора** — `has:00-book`, `word:word-only-case`. До сих пор
 *      игрок видел только результат: команда есть или её нет. Но «изучать
 *      учебник» есть потому, что учебник на руках, а «спросить о единственном
 *      случае» — потому что слово получено, и это разные вещи: первое про то,
 *      что Марго несёт, второе — про то, что знает. Условие читается и у самой
 *      команды, и у целевого узла: автор вправе написать его в любом.
 *      Отрицание требованием не является — `!has:x` значит «пока этого нет».
 *   2. **Сама цель команды** — слово «Дела» или вещь, которая у Марго в руках.
 *      `спросить о АЛЕРС` держится на слове без всякого `if`, а `позвонить
 *      телефон` — на телефоне в инвентаре. Доска в комнате требованием не
 *      становится: она стоит на месте, и брать её с собой не нужно.
 *
 * Слово важнее вещи: оно и есть механика игры, а вещь у Марго и так в руках.
 */
export function needsOf(content: GameContent, save: SaveState, option: Option): Needs | null {
  const word = (id: string): Needs => ({ kind: 'word', id, label: content.words[id]?.label ?? id });
  const thing = (id: string, label?: string): Needs => ({ kind: 'item', id, label: label ?? id });

  const target = option.target == null ? undefined : content.nodes[option.target];
  const terms = [option.attrs.if, target?.attrs.if ?? null]
    .filter((c): c is string => c != null)
    .flatMap((cond) => cond.split(',').map((t) => t.trim()))
    .filter((term) => term !== '' && !term.startsWith('!'));

  const needed = terms.find((t) => t.startsWith('word:'))?.slice(5).trim();
  if (needed != null) return word(needed);

  const carried = terms.find((t) => t.startsWith('has:'))?.slice(4).trim();
  if (carried != null) return thing(carried, docById(content, carried)?.label);

  if (option.object != null) {
    if (content.words[option.object]) return word(option.object);
    const doc = content.docs[option.object];
    if (doc?.type === 'item' && save.inventory.includes(doc.id)) return thing(doc.id, doc.label);
  }
  return null;
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
export const SYSTEM_COMMANDS: SystemCommand[] = ['справочник', 'дело', 'инвентарь', 'меню'];

function plain(option: Option): CatalogOption {
  // Требование дописывается один раз, на выходе каталога: источников опций
  // полдесятка, и считать его в каждом — верный способ однажды забыть.
  return { ...option, locked: false, system: null, needs: null };
}

/**
 * Цель опции разрешается **один раз**, на входе в каталог: дальше оболочка,
 * поток и `enter` видят конкретный адрес узла.
 *
 * Иначе каждое место движка разбиралось бы со звёздочкой и с «помещением
 * целиком» само — и однажды одно из них сделало бы это иначе.
 */
function resolved(content: GameContent, save: SaveState, option: CatalogOption): CatalogOption {
  const addr = resolveTarget(content, save, option.target);
  return addr == null || addr === option.target ? option : { ...option, target: addr };
}

function systemOption(kind: SystemCommand): CatalogOption {
  return {
    label: kind,
    kind: 'system',
    target: null,
    attrs: emptyAttrs(),
    verb: null,
    object: null,
    moves: false,
    locked: false,
    system: { kind },
    needs: null,
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
function leafOptions(content: GameContent, save: SaveState, doc: Doc): CatalogOption[] {
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
  return out;
}

function closeOption(doc: Doc): CatalogOption {
  return plain({
    label: closeLabel(doc.label),
    kind: 'environment',
    target: null,
    attrs: emptyAttrs(),
    verb: CLOSE,
    object: doc.docId,
    moves: false,
  });
}

function readingOptions(content: GameContent, save: SaveState, doc: Doc): CatalogOption[] {
  return [...leafOptions(content, save, doc), closeOption(doc)];
}

/**
 * Открытый контейнер: компьютер с окнами, ящик с бумагами (07-оболочка-тз,
 * «Вложенные предметы — контейнер и его окна»).
 *
 * Список окон не строится здесь заново: это обычные опции узла контейнера,
 * раскрытые тем же генератором `осмотреть: items`, что команды комнаты на её
 * предметы. Значит и условия, и авторское перекрытие работают ровно так же,
 * а окно с `if` появляется по флагу прямо во время сцены.
 *
 * Собственные действия — у открытого окна, а не у всех сразу: `скопировать
 * расчёт` предлагается, когда расчёт на экране. Переключение окон при этом
 * остаётся одной командой: список окон никуда не уходит, и «назад к списку»
 * значило бы «никуда».
 */
function containerOptions(content: GameContent, save: SaveState, doc: Doc): CatalogOption[] {
  const shown = doc.nodes.find((n) => n.id === EXAMINE) ?? doc.nodes.find((n) => n.id === '') ?? doc.nodes[0];
  const out: CatalogOption[] = [];

  for (const raw of shown?.options ?? []) {
    if (raw.label === '') continue;
    const option = retarget(content, save, raw);
    if (!optionAvailable(content, save, option)) continue;
    out.push(resolved(content, save, plain(option)));
  }

  /*
   * Собственные действия самого контейнера. Исполнимое действие всегда
   * показывается в интерфейсе предмета (07-оболочка-тз, «Предметы»), а
   * интерфейс компьютера — это его открытый экран: больше их показать негде.
   * `осмотреть` сюда не идёт — им контейнер и открыли.
   */
  out.push(...itemActions(content, save, doc.docId).filter((o) => o.verb !== EXAMINE));

  const open = openWindow(content, save, doc);
  if (open) {
    out.push(...itemActions(content, save, open.docId).filter((o) => o.verb !== EXAMINE));
    out.push(...leafOptions(content, save, open));
  }

  out.push(closeOption(doc));
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
    if (optionAvailable(content, save, option)) out.push(resolved(content, save, plain(option)));
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
    needs: null,
  }));
}

/**
 * `save.openItem` — открытый уровнем предмет. Пока он задан, комната из списка
 * уходит целиком: игрок читает или разбирается с вещью, а не действует в месте.
 * Служебные команды остаются — они часть оболочки, а не содержимого сцены.
 */
export function buildCatalog(content: GameContent, save: SaveState): CatalogOption[] {
  const node = content.nodes[save.episodeState.at];
  const out: CatalogOption[] = [];
  const open = save.openItem ? content.docs[save.openItem] : undefined;

  if (open) {
    // Контейнер и книга — один уровень с разным содержимым: у книги листают
    // один текст, у контейнера переключают окна.
    out.push(...(open.items.length > 0 ? containerOptions : readingOptions)(content, save, open));
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
      out.push(resolved(content, save, plain(option)));
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
  // Служебные команды открывают хранилища целиком: адресных форм у них нет
  // (07-оболочка-тз, «Служебные команды»). Быстрый путь к одной записи — панель
  // по цифре, и она отвечает на другой вопрос, чем полный список.
  for (const command of SYSTEM_COMMANDS) out.push(systemOption(command));

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
    .map((x) => ({ ...x.option, needs: needsOf(content, save, x.option) }));
}
