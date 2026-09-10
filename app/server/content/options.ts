import { ContentError, type RawDoc, type RawGenerator, type RawNode } from './markdown.ts';
import { EXAMINE } from '../../shared/pages.ts';
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

export interface ExpandContext {
  /** `[[файл#узел]]` → адрес. Бросает ContentError, если ссылка битая. */
  resolve(fromDocId: string, ref: string, line: number): { docId: string; nodeId: string };
  get(docId: string): TargetInfo | undefined;
}

/** Места, куда переходят: сцена и комната. Предмет и собеседник — ответы, не позиции. */
const PLACES: DocType[] = ['scene', 'room'];

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
  fromDocId: string,
  ref: string,
  line: number,
  make: (target: TargetInfo, nodeId: string) => Omit<Option, 'target' | 'moves'>,
): Option {
  const { docId, nodeId } = ctx.resolve(fromDocId, ref, line);
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
  doc: RawDoc,
  docId: string,
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
      doc.path,
      `неизвестный источник "${source}" в блоке options; допустимы: exits, items, words, inventory или явный список`,
      gen.line,
    );
  }

  const options: Option[] = [];
  for (const ref of refs) {
    const { docId: targetId } = ctx.resolve(docId, ref, gen.line);
    const target = ctx.get(targetId)!;

    // Комната — место: `идти` ведёт в неё целиком, узел с именем глагола ей не нужен.
    if (PLACES.includes(target.type)) {
      options.push(
        optionTo(ctx, docId, ref, gen.line, (t) => ({
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
      optionTo(ctx, docId, `${ref}#${paged ? target.pages[0]! : verb}`, gen.line, (t) => ({
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
export function docGenerators(doc: RawDoc, exits: string[], items: string[]): RawGenerator[] {
  const declared = doc.nodes.flatMap((n) => n.generators);
  const generators = [...declared];

  // Комната без блока ведёт себя очевидным образом — иначе автор пишет одно
  // и то же в каждой заметке и однажды забудет.
  if (doc.type === 'room' && declared.length === 0) {
    if (exits.length > 0) generators.push({ phrase: 'идти', source: 'exits', line: 1 });
    if (items.length > 0) generators.push({ phrase: 'осмотреть', source: 'items', line: 1 });
  }

  /*
   * Вещи на руках ездят с игроком: их глаголы доступны везде, где игрок стоит, —
   * и в комнате, и в сцене. Объявлять это в заметке незачем.
   *
   * Раньше руки работали только в комнате, и это была не осторожность, а недосмотр:
   * протокол в отделении выдают посреди допроса, и прочитать бумагу, которую тебе
   * сунули в руки, оказывалось нельзя. `inHand` означает «на руках», а не
   * «на руках, если рядом мебель».
   */
  if (PLACES.includes(doc.type)) generators.push({ phrase: '*', source: 'inventory', line: 1 });

  return generators;
}

export function expandNode(
  ctx: ExpandContext,
  doc: RawDoc,
  docId: string,
  node: RawNode,
  exits: string[],
  items: string[],
  generators: RawGenerator[] = docGenerators(doc, exits, items),
): { options: Option[]; pending: PendingOption[]; generators: GeneratorRef[] } {
  const options: Option[] = [];
  const pending: PendingOption[] = [];

  // Переход — та же опция, что и всё остальное. Метка есть — опция, метки нет —
  // маршрут: узел доигрывает и уводит дальше сам, игроку он не показывается.
  for (const t of node.transitions) {
    options.push(
      optionTo(ctx, docId, t.ref, t.line, () => ({
        label: t.label ?? '',
        // Авторский переход — всегда ход по истории, куда бы он ни вёл.
        kind: 'story' as const,
        attrs: t.attrs,
        verb: null,
        object: null,
      })),
    );
  }

  for (const gen of generators) {
    const r = expandGenerator(ctx, doc, docId, gen, exits, items);
    options.push(...r.options);
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
