/**
 * Общие типы контента и состояния. Один файл на клиент и сервер: то, что уезжает
 * по /api/content, и то, что лежит в сейве, должно описываться одними и теми же
 * словами — иначе рассинхрон обнаружится в рантайме, а не в typecheck.
 */

/**
 * Адрес узла: `<docId>#<nodeId>`, где docId — путь от `content/` без `.md`.
 * Пустой nodeId означает вступление файла — текст до первого `##`.
 */
export type NodeAddr = string;

export type DocType = 'scene' | 'room' | 'item' | 'word' | 'doc' | 'person';

/** Зарезервированные ключи атрибутов узла (07-оболочка-тз, «Узлы, атрибуты, переходы»). */
export interface Attrs {
  if: string | null;
  set: string[];
  unset: string[];
  give: string[];
  take: string[];
  cost: number | null;
  once: boolean;
  goto: NodeAddr | null;
  tag: string[];
  /** Чем опция называется в строке ввода, если `<глагол> <предмет>` читается плохо. */
  label: string | null;
  /**
   * Предметы и выходы, которые есть в этом состоянии комнаты. Складываются
   * с постоянными из frontmatter; вычитания нет — если предмет приходится
   * вычитать, значит он не постоянный и объявлен не там.
   */
  items: string[];
  exits: string[];
  /**
   * Именованные даты, которые ставит узел: `- dates: {blueCard: 31.12.2026}`.
   * Срок объявляется в `episode.yaml`, а узел его двигает — так работает не только
   * Blue Card, но любой срок, который однажды понадобится.
   */
  dates: Record<string, string>;
  /**
   * Номер страницы предмета. Секция с `page` — состояние вещи, а не действие:
   * её заголовок не становится глаголом и команды не создаёт. Порядок задаёт
   * число, состояние в сейве хранится по заголовку.
   */
  page: number | null;
  /**
   * Помета на переходе: команда закрывает текущий набор возможностей и продолжает
   * историю. Не «важная команда» и не предупреждение о последствиях в сюжете —
   * она сообщает ровно то, что персонаж знает, а игрок из интерфейса не видит:
   * вернуться к оставшимся действиям комнаты или разговора будет нельзя.
   */
  advance: boolean;
}

export function emptyAttrs(): Attrs {
  return {
    if: null,
    set: [],
    unset: [],
    give: [],
    take: [],
    cost: null,
    once: false,
    goto: null,
    tag: [],
    label: null,
    items: [],
    exits: [],
    dates: {},
    page: null,
    advance: false,
  };
}

/**
 * Опция — единственная единица ввода (07-оболочка-тз, «Опция»).
 *
 * Для игрока у неё есть только `label`. Всё остальное — движок, и в интерфейсе
 * не проявляется никак: переход в сцене, глагол с целью и служебная команда
 * выглядят и исполняются одинаково.
 */
/**
 * Категория происхождения опции (07-оболочка-тз, «Опция»). Путь ввода, выбора,
 * исполнения и записи в историю у всех один — категория нужна только раскладке
 * и цвету.
 *
 * Назначается **по источнику опции, а не по её словам**: действие предмета
 * `позвонить` — тоже `environment`, а авторская реплика со словом «взять»
 * останется `story`. В Markdown не пишется никогда.
 */
export type OptionKind = 'environment' | 'story' | 'system';

export interface Option {
  label: string;
  kind: OptionKind;
  /** Куда ведёт. null — опция исполняет атрибуты и не меняет позицию. */
  target: NodeAddr | null;
  attrs: Attrs;
  /** Глагол, если опцию построил генератор; у меток переходов — null. */
  verb: string | null;
  /** Цель глагола: id предмета, комнаты или слова. */
  object: string | null;
  /**
   * Сдвигает ли опция игрока. Сцены и комнаты — места, туда переходят; предметы
   * и собеседники — ответы, их текст приходит в поток, а игрок остаётся, где был.
   */
  moves: boolean;
}

/**
 * Генератор, который сервер раскрыть не может: `words` и `inventory` живут
 * в сейве, а не в контенте. Раскрывается клиентом при сборке каталога.
 */
export interface PendingOption {
  verb: string;
  from: 'words' | 'inventory';
}

/**
 * Генератор в исходном виде. Игроку не виден никогда — нужен валидатору: без него
 * глагол, на который ни один предмет не отвечает, не выдаёт ни одной опции и потому
 * проходит незамеченным, хотя объявлен нигде не был.
 */
export interface GeneratorRef {
  verb: string;
  phrase: string;
  source: string;
}

export interface Node {
  id: string;
  addr: NodeAddr;
  /** Внутриигровая дата сцены. Ею штампуются флаги, которые узел ставит. */
  date: string | null;
  /** Строка заголовка в файле — чтобы валидатор ругался с адресом, а не вообще. */
  line: number;
  attrs: Attrs;
  text: string;
  options: Option[];
  pending: PendingOption[];
  generators: GeneratorRef[];
}

export interface Doc {
  id: string;
  docId: string;
  /** Абсолютный путь: нужен только для сообщений об ошибках. */
  path: string;
  type: DocType;
  label: string;
  /**
   * Готовое дополнение к команде: `колонку`, `в аудиторию`. Оболочка не склоняет
   * русский язык — форма пишется в заметке, вместе с предлогом. По умолчанию
   * совпадает с `label`: `учебник`, `окно`, `Тоби` в падеже не меняются.
   */
  target: string;
  /** Формы для отдельных глаголов, если общей не хватает: `подойти: к доске`. */
  targets: Record<string, string>;
  date: string | null;
  fm: Record<string, unknown>;
  nodes: Node[];
  /** Комнаты: выходы и предметы. */
  exits: string[];
  items: string[];
  /** Предметы: глаголы, работающие только когда предмет на руках. */
  inHand: string[];
  /** Страницы предмета: id секций в порядке `page`. У остальных заметок пусто. */
  pages: string[];
  /**
   * Строки, в которых объявлен блок `options`. Узлы после раскрытия все получают
   * общий список комнаты, поэтому посчитать объявления по ним уже нельзя — а знать,
   * что автор написал блок дважды, надо.
   */
  optionBlocks: number[];
}

export interface Palette {
  bg: string;
  fg: string;
  dim: string;
  accent: string;
  [key: string]: string;
}

export interface RendererDef {
  id: string;
  palette: Palette;
  /** Набор символов рамки — только для оверлеев: `light`, `heavy`, `double`. */
  frame: string;
  /** Символ линейки между потоком и вводом: `light`, `heavy`, `double`, `dashed`, `none`. */
  rule: string;
  /** `rows` — сколько строк должно влезать в окно; ширина следует из неё (metrics.ts). */
  font: { family: string; size: number; rows: number; line: number };
  effects: string[];
  ambience: string | null;
  keyboard: string | null;
}

export interface EpisodeDef {
  id: string;
  title: string;
  renderer: string;
  entry: NodeAddr;
  /** Глаголы персонажа. Показываются в строке подсказок. */
  verbs: string[];
  /** Глаголы, которые приносят предметы. В строке подсказок не показываются никогда. */
  itemVerbs: string[];
  characters: string[];
  /** Переопределение палитры персонажа эпизодом: в прологе у Марго цветные волосы. */
  paletteOverride: Record<string, string>;
  ambience: string | null;
  /**
   * Сроки эпизода: имя → подпись в статусе и начальная дата. Дальше их двигают
   * узлы (`- dates: {blueCard: 31.12.2026}`), а спрашивать о них можно в `if`
   * через `date:blueCard`. Заведено не под Blue Card, а под любой срок.
   */
  dates: Record<string, { label: string; at: string | null; expired: string }>;
  /**
   * Обучающий слой: где висит подсказка-пример и что в ней написано. Слой
   * отдельный от терминала — это инструкция к игре, а не игра.
   */
  tutorial: { at: NodeAddr | null; hint: string };
  /**
   * Заметки, закрытые для показа: переходы в них не появляются в строке ввода.
   *
   * Это не механика игры, а рубильник для демо — поэтому он живёт в `episode.yaml`,
   * который не приезжает из Obsidian. Резать условиями в самих заметках нельзя:
   * следующая синхронизация вернёт их как были.
   */
  closed: string[];
}

/**
 * Портрет — пиксель-арт на полублоках, а не ASCII из букв (07-оболочка-тз).
 *
 * `grid` — сетка индексов: строка = ряд пикселей, символ = ключ палитры. Рендерер
 * парует строки и выдаёт `▀`: верхний пиксель становится цветом текста, нижний —
 * цветом фона. Отсюда панель в 24 клетки шириной и вдвое меньшей высоты.
 */
export interface Portrait {
  grid: string[];
  /** Ключ палитры → цвет, уже с учётом переопределения эпизодом. Нет ключа — фон. */
  colors: Record<string, string>;
  /** В пикселях; высота всегда чётная. */
  width: number;
  height: number;
}

export interface CharacterDef {
  id: string;
  label: string;
  /** Портреты по эпизодам: палитру переопределяет эпизод. */
  portraits: Record<string, Portrait>;
}

export interface WordDef {
  id: string;
  label: string;
  category: string;
  text: string;
}

export interface DocumentDef {
  id: string;
  label: string;
  grif: string | null;
  date: string | null;
  text: string;
}

export interface GameContent {
  title: string;
  saveVersion: number;
  episodes: EpisodeDef[];
  renderers: Record<string, RendererDef>;
  characters: Record<string, CharacterDef>;
  words: Record<string, WordDef>;
  documents: Record<string, DocumentDef>;
  /**
   * Справочник: термин → строка. Живёт отдельно от «Дела» намеренно — двадцать
   * аббревиатур в списке улик, и список перестаёт читаться как расследование.
   */
  reference: Record<string, string>;
  /** Все узлы игры по адресу — движку больше ничего не нужно. */
  nodes: Record<NodeAddr, Node>;
  docs: Record<string, Doc>;
}

/**
 * Флаг — не булево, а запись: он помнит внутриигровую дату сцены, в которой был
 * поставлен (07-оболочка-тз, «Флаг помнит, когда его поставили»). Реальное время
 * не используется нигде и никогда.
 */
export interface FlagState {
  value: boolean;
  at: string | null;
}

/** Сейв: состояние, а не сцена (07-оболочка-тз, «Сейв»). */
export interface SaveState {
  saveVersion: number;
  /** id слова → степень знания. Серое знает игрок, но не Марго. */
  words: Record<string, 'grey' | 'white'>;
  flags: Record<string, FlagState>;
  inventory: string[];
  /**
   * Узлы, чей сплэш уже показан. Один человек — один сплэш за игру, поэтому
   * помнит об этом сейв, а не сессия. Считаем по узлам, а не по персонажу:
   * так цикл в диалоге не покажет лицо второй раз, а рамочные два сплэша
   * Марго (первый и последний экран) остаются двумя разными.
   */
  splashes: string[];
  chapter: string;
  /**
   * На какой странице открыт многостраничный предмет: его id → id секции.
   * Именно id, а не номер: `page` задаёт только порядок, и автор вправе его
   * переставить, не ломая сохранение.
   */
  itemStates: Record<string, string>;
  /**
   * Сроки: имя → дата. Начальные приходят из `episode.yaml`, дальше их двигают узлы.
   * Текущей даты здесь нет и быть не должно — она всегда берётся из `date:` заметки,
   * в которой игрок стоит (`dateAt`), иначе заметка без даты молча показывала бы
   * чужое время.
   */
  dates: Record<string, string>;
  /** Входили ли уже в стартовый узел: иначе при перезагрузке он сыграет дважды. */
  started: boolean;
  /**
   * Экран управления уже показан. Показывается он один раз, перед первой
   * комнатой, но переоткрывается командой: модалка, исчезнувшая навсегда, —
   * не обучение.
   */
  taught: boolean;
  /**
   * Подсказка-пример отработана: игрок ввёл ровно то, что она предлагала.
   * Уходит она по делу, а не по таймеру — таймер снял бы её у того, кто читает
   * медленно, и оставил бы висеть у того, кто уже всё понял.
   */
  hinted: boolean;
  episodeState: {
    episode: string;
    at: NodeAddr;
    /** Узлы с `once`, которые уже сыграли. */
    used: string[];
  };
}
