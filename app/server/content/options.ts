import { ContentError, type RawDoc, type RawGenerator, type RawNode } from './markdown.ts';
import { EXAMINE } from '../../shared/pages.ts';
import { isVirtual } from '../../shared/rooms.ts';
import {
  emptyAttrs,
  type DocType,
  type GeneratorRef,
  type Option,
  type PendingOption,
} from '../../shared/types.ts';

/**
 * Раскрытие генераторов опций (07-оболочка-тз, «Генераторы опций»).
 *
 * Раскрываем на сервере, а не на клиенте, по двум причинам. Клиент тогда вообще не
 * знает про генераторы — он видит плоский список опций и не различает, откуда какая
 * пришла, ровно как игрок. И валидатор видит те же опции, что игрок, а значит правило
 * «глагол объявлен в verbs» проверяется по факту, а не по тексту заметки.
 *
 * Не раскрываются только `words` и `inventory`: их содержимое лежит в сейве, а не
 * в контенте. Они уезжают как pending и раскрываются при сборке строки ввода.
 */

export interface TargetInfo {
  docId: string;
  type: DocType;
  label: string;
  /** Готовое дополнение к команде: `колонку`, `в аудиторию`. */
  target: string;
  /** Дополнения для отдельных глаголов: `подойти: к доске`. */
  targets: Record<string, string>;
  nodeIds: Set<string>;
  /** Глаголы предмета, работающие только когда он на руках. */
  inHand: string[];
  /** Страницы предмета: id секций в порядке `page`. */
  pages: string[];
}

/**
 * Откуда смотрит ссылка.
 *
 * Трёх разных «откуда» здесь не от усложнения, а потому что у собранной комнаты
 * они действительно разные: `[[items/01-board]]`, написанная в общей части,
 * ищется относительно **её файла**, а `[[#после]]` из того же файла указывает
 * на **собранную** комнату и проверяется по её объединённому набору узлов.
 * Один `docId` эти два случая не различает.
 */
export interface RefBase {
  /** Файл, в котором написана ссылка: для сообщений об ошибке. */
  path: string;
  /** База относительного и basename-поиска: заметка-источник. */
  baseDocId: string;
  /** Куда смотрит `[[#якорь]]`: для комнаты — собранное представление. */
  selfDocId: string;
  /** Срез, в котором живёт эта ссылка; `null` — сцена или предмет. */
  stage: string | null;
}

export interface ExpandContext {
  /** `[[файл#узел]]` → адрес. Бросает ContentError, если ссылка битая. */
  resolve(base: RefBase, ref: string, line: number): { docId: string; nodeId: string };
  get(docId: string): TargetInfo | undefined;
}

/** Места, куда переходят: сцена и комната. Предмет и собеседник — ответы, не позиции. */
/**
 * Куда «переходят», а не «к чему обращаются»: у места опция сдвигает игрока
 * и получает категорию `story`. Карточка перехода — тоже место: игрок на ней
 * стоит, пока не подтвердит.
 */
const PLACES: DocType[] = ['scene', 'room', 'transition', 'minigame'];

/** Глагол — первое слово фразы: `спросить о` объявляется в verbs как `спросить`. */
export function verbOf(phrase: string): string {
  return phrase.trim().split(/\s+/)[0] ?? '';
}

function label(phrase: string, object: string): string {
  return `${phrase} ${object}`.replace(/\s+/g, ' ').trim();
}

/**
 * Чем заканчивается сгенерированная команда (07-оболочка-тз, «Генераторы опций»).
 *
 * Оболочка не склоняет русский язык и не пытается: `label` — это название вещи,
 * а после глагола нужна форма, и она пишется в заметке готовой, вместе с предлогом.
 * Порядок: форма для этого глагола → общая форма → название.
 *
 * `target` можно не писать, только если форма буквально совпадает с названием
 * (`учебник`, `окно`, `Тоби`), — падеж совпал, и врать не о чем.
 */
function form(target: TargetInfo, verb: string): string {
  return target.targets[verb] ?? target.target;
}

function optionTo(
  ctx: ExpandContext,
  base: RefBase,
  ref: string,
  line: number,
  make: (target: TargetInfo, nodeId: string) => Omit<Option, 'target' | 'moves'>,
): Option {
  const { docId, nodeId } = ctx.resolve(base, ref, line);
  const target = ctx.get(docId)!;
  return {
    ...make(target, nodeId),
    target: `${docId}#${nodeId}`,
    moves: PLACES.includes(target.type),
  };
}

/**
 * Категория опции определяется целью, а не глаголом: место — это ход по истории,
 * предмет — действие с окружением. Так `идти в коридор` остаётся `story`, а
 * `осмотреть доску` и `позвонить` — `environment`, хотя пишутся одинаково.
 */
function kindOf(target: TargetInfo): Option['kind'] {
  return PLACES.includes(target.type) ? 'story' : 'environment';
}

function expandGenerator(
  ctx: ExpandContext,
  base: RefBase,
  gen: RawGenerator,
  exits: string[],
  items: string[],
): { options: Option[]; pending: PendingOption[] } {
  const source = gen.source;

  if (source === 'words' || source === 'inventory') {
    return { options: [], pending: [{ verb: gen.phrase, from: source }] };
  }

  const verb = verbOf(gen.phrase);
  const refs =
    Array.isArray(source) ? source
    : source === 'exits' ? exits
    : source === 'items' ? items
    : null;

  if (refs === null) {
    throw new ContentError(
      base.path,
      `неизвестный источник "${source}" в блоке options; допустимы: exits, items, words, inventory или явный список`,
      gen.line,
    );
  }

  const options: Option[] = [];
  for (const ref of refs) {
    const { docId: targetId } = ctx.resolve(base, ref, gen.line);
    const target = ctx.get(targetId)!;

    // Комната — место: `идти` ведёт в неё целиком, узел с именем глагола ей не нужен.
    if (PLACES.includes(target.type)) {
      options.push(
        optionTo(ctx, base, ref, gen.line, (t) => ({
          label: label(gen.phrase, form(t, verb)),
          kind: kindOf(t),
          attrs: emptyAttrs(),
          verb,
          object: t.docId,
        })),
      );
      continue;
    }

    // Предмет отвечает только на то, что умеет. Глагол из `inHand` комната не отдаёт:
    // он появится, когда предмет окажется на руках.
    if (target.inHand.includes(verb)) continue;

    /*
     * Наличие страниц само значит «этот предмет можно осмотреть»: узел
     * `## осмотреть` для этого не нужен и запрещён (07-оболочка-тз, «Страницы
     * предмета»). Цель здесь — первая страница: сервер сейва не видит, а текущую
     * подставит клиент при сборке каталога. Валидатор при этом видит настоящую
     * опцию с настоящим глаголом, и граф остаётся целым.
     */
    const paged = verb === EXAMINE && target.pages.length > 0;
    if (!paged && !target.nodeIds.has(verb)) continue;

    options.push(
      optionTo(ctx, base, `${ref}#${paged ? target.pages[0]! : verb}`, gen.line, (t) => ({
        label: label(gen.phrase, form(t, verb)),
        kind: kindOf(t),
        attrs: emptyAttrs(),
        verb,
        object: t.docId,
      })),
    );
  }

  return { options, pending: [] };
}

/**
 * Генераторы комнаты, общие на все её узлы (07-оболочка-тз, «Правила разрешения
 * опций»): `exits`, `items` и блок `options` объявляются один раз и действуют
 * везде. Дублировать их в `вход`, `осмотреться` и далее нельзя — это два места
 * для одной правки и гарантированное расхождение.
 */
export function docGenerators(
  doc: { type: DocType; nodes: { generators: RawGenerator[] }[] },
  exits: string[],
  items: string[],
): RawGenerator[] {
  const declared = doc.nodes.flatMap((n) => n.generators);
  const generators = [...declared];

  // Комната без блока ведёт себя очевидным образом — иначе автор пишет одно
  // и то же в каждой заметке и однажды забудет.
  if (doc.type === 'room' && declared.length === 0) {
    if (exits.length > 0) generators.push({ phrase: 'идти', source: 'exits', line: 1 });
    if (items.length > 0) generators.push({ phrase: 'осмотреть', source: 'items', line: 1 });
  }

  /*
   * Контейнер — предмет со вложенными (07-оболочка-тз, «Вложенные предметы»):
   * окна компьютера, бумаги в ящике. Команды на них строятся тем же генератором,
   * что команды комнаты на её предметы, и по той же причине: список окон живой,
   * его считают заново на каждый ход, а окно с `if` появляется по флагу.
   */
  if (doc.type === 'item' && declared.length === 0 && items.length > 0) {
    generators.push({ phrase: 'осмотреть', source: 'items', line: 1 });
  }

  /*
   * Автоматического генератора по инвентарю здесь больше нет
   * ([[99-открытые-вопросы]], «Глаголы и состояния предметов»).
   *
   * Раньше каждая вещь на руках досыпала свои глаголы в список текущего места.
   * На двух вещах это выглядело удобством, а на десяти вытеснило бы из списка
   * то, ради чего сцена написана: разговор о высылке вперемешку с «позвонить
   * телефон». Собственные действия предмета теперь показываются внутри экрана
   * `предметы`, а в основной список попадает только то, что сцена или комната
   * объявила сама, — `показать Алерсу бланк`. Наличие предмета при этом остаётся
   * условием такой опции, но само по себе опцию не создаёт.
   */
  return generators;
}

export function expandNode(
  ctx: ExpandContext,
  base: RefBase,
  node: RawNode,
  exits: string[],
  items: string[],
  generators: RawGenerator[],
): { options: Option[]; pending: PendingOption[]; generators: GeneratorRef[] } {
  const options: Option[] = [];
  const pending: PendingOption[] = [];

  // Переход — та же опция, что и всё остальное. Метка есть — опция, метки нет —
  // маршрут: узел доигрывает и уводит дальше сам, игроку он не показывается.
  for (const t of node.transitions) {
    const { docId, nodeId } = ctx.resolve(base, t.ref, t.line);
    options.push({
        label: t.label ?? '',
        // Авторский переход — всегда ход по истории, куда бы он ни вёл.
        kind: 'story' as const,
        attrs: t.attrs,
        verb: null,
        object: null,
        target: `${docId}#${nodeId}`,
        // Динамический адрес комнаты ещё не имеет конкретного TargetInfo.
        // Авторская метка уже написана: здесь нужен только тип цели.
        moves: isVirtual(docId) || PLACES.includes(ctx.get(docId)!.type),
    });
  }

  /*
   * Авторская опция перекрывает сгенерированную с тем же текстом (07-оболочка-тз,
   * «Авторская опция перекрывает сгенерированную»). Нужно там, где комната в одном
   * своём состоянии отправляет игрока не туда, куда ведёт `exits`: из аудитории,
   * пока Алерс ещё там, `идти в коридор` сначала заходит в разговор у двери.
   *
   * Сравнивается готовый текст команды, а не пара «глагол + цель»: игрок вводит
   * текст, и две одинаковые команды в одном списке — это всегда ошибка.
   *
   * Условия здесь не видны: `if` живёт в сейве, а раскрытие идёт на сервере.
   * Поэтому авторская опция с `if` гасит сгенерированную и тогда, когда скрыта
   * сама. Если выход нужен в обоих случаях, условие ставится на цель перехода,
   * а не на сам переход.
   */
  const authored = new Set(options.map((o) => o.label).filter((label) => label !== ''));

  for (const gen of generators) {
    const r = expandGenerator(ctx, base, gen, exits, items);
    options.push(...r.options.filter((o) => !authored.has(o.label)));
    pending.push(...r.pending);
  }

  return {
    options,
    pending,
    generators: generators.map((g) => ({
      verb: verbOf(g.phrase),
      phrase: g.phrase,
      source: Array.isArray(g.source) ? 'список' : g.source,
    })),
  };
}
