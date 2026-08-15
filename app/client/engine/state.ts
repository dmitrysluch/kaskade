import { said, voiceOf } from '../../shared/speech.ts';
import type { GameContent, Node, Option, SaveState } from '../../shared/types.ts';

/**
 * Состояние и его изменение. Сохраняем состояние, а не сцену (07-оболочка-тз, «Сейв»):
 * слова, флаги, вещи на руках и адрес, где игрок стоит.
 */

export interface StreamEntry {
  /** `grant` — выданное слово: механика должна быть видна, иначе её как бы нет. */
  kind: 'text' | 'echo' | 'card' | 'grant';
  text: string;
}

/** Служебные команды, которые открывают оверлей с содержимым игры. */
export type OverlayCommand = 'справочник' | 'дело' | 'предметы';

/**
 * Все служебные команды. `меню` стоит особняком: остальные показывают то, что
 * игрок в игре набрал, а меню говорит о самой игре — и потому оверлеем
 * содержимого не является.
 */
export type SystemCommand = OverlayCommand | 'меню';

/**
 * Служебная команда с необязательным аргументом: `справочник` открывает список,
 * `справочник контейнмент` — сразу статью. Отдельной команды «что такое» нет
 * намеренно: имя команды говорит, откуда взято определение.
 */
export interface SystemCall {
  kind: SystemCommand;
  arg: string | null;
}

/** То же, но заведомо про содержимое: такой вызов умеет нарисовать оверлей. */
export interface OverlayCall extends SystemCall {
  kind: OverlayCommand;
}

export interface Session {
  save: SaveState;
  stream: StreamEntry[];
  overlay: OverlayCall | null;
  /**
   * Какой предмет сейчас читают: `docId` или `null`. Пока книга открыта, список
   * команд состоит из неё одной — комната ждёт снаружи.
   *
   * В сейв не пишется намеренно: страницу помнит `itemStates`, а место, где
   * игрок стоит, — комната. Перезагрузка возвращает в комнату с той же
   * закладкой, и это честнее, чем воскрешать режим чтения из ниоткуда.
   */
  reading: string | null;
  history: string[];
}

/**
 * Условие в `if`. Термы через запятую — это И.
 *
 *   `prolog.signed`      флаг взведён
 *   `!prolog.signed`     флаг не взведён
 *   `has:телефон`        предмет на руках
 *   `word:alers`         слово белое
 *   `date:blueCard`      срок назначен
 */
export function evalCondition(cond: string | null, save: SaveState): boolean {
  if (!cond) return true;
  return cond
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .every((term) => {
      const negated = term.startsWith('!');
      const body = negated ? term.slice(1).trim() : term;
      let value: boolean;
      if (body.startsWith('has:')) value = save.inventory.includes(body.slice(4).trim());
      else if (body.startsWith('word:')) value = save.words[body.slice(5).trim()] === 'white';
      else if (body.startsWith('date:')) value = save.dates[body.slice(5).trim()] != null;
      else value = save.flags[body]?.value === true;
      return negated ? !value : value;
    });
}

/**
 * `{{позвонила.at}}` — единственная форма интерполяции в контенте.
 * Имя флага само содержит точки (`prolog.phoned`), поэтому берём всё до `.at`.
 */
export const INTERPOLATION = /\{\{\s*([^}\s]+)\.at\s*\}\}/g;

/**
 * Подстановка даты флага в текст. Нужна ровно для одного, но важного случая:
 * в квартире Алерса в 2034-м лежит бумажка с датой того самого звонка. Если бы
 * флаг хранил только факт, писать на ней было бы нечего.
 */
export function interpolate(text: string, save: SaveState): string {
  return text.replace(INTERPOLATION, (_, name: string) => save.flags[name]?.at ?? '—');
}

export function nodeAt(content: GameContent, addr: string): Node | undefined {
  return content.nodes[addr];
}

/**
 * Текущая дата — та, что записана в заметке, где игрок стоит (07-оболочка-тз,
 * «Как показано, что прошло время»).
 *
 * Не текущее значение, которое кто-то когда-то положил в сейв: заметка без `date:`
 * тогда молча показывала бы чужое время, и опечатка доехала бы до игрока. `date:`
 * обязателен у сцен и комнат, это проверяет валидатор. У предмета и слова даты нет
 * и не должно быть — они не место, и позиции не меняют.
 */
export function dateAt(content: GameContent, save: SaveState): string | null {
  return content.nodes[save.episodeState.at]?.date ?? null;
}

/** Страницы предмета: узлы-секции в порядке `page`. У обычной заметки пусто. */
export function pagesOf(content: GameContent, docId: string): Node[] {
  const doc = content.docs[docId];
  if (!doc) return [];
  return doc.pages.flatMap((id) => {
    const node = content.nodes[`${docId}#${id}`];
    return node ? [node] : [];
  });
}

/**
 * На какой странице открыт предмет (07-оболочка-тз, «Страницы предмета»).
 *
 * Записи нет — предмет ещё не открывали, отдаём первую страницу. Записанной
 * секции больше нет в контенте (автор переименовал заголовок) — тоже первую,
 * но с жалобой в консоль: молчаливый сброс запрещён, а рушить прохождение
 * из-за правки заметки хуже, чем показать книгу с начала.
 */
export function pageAt(content: GameContent, save: SaveState, docId: string): Node | null {
  const pages = pagesOf(content, docId);
  if (pages.length === 0) return null;

  const saved = save.itemStates[content.docs[docId]?.id ?? ''];
  if (saved == null) return pages[0]!;

  const found = pages.find((n) => n.id === saved);
  if (found) return found;
  console.warn(`страницы "${saved}" в "${docId}" больше нет — открываю с начала`);
  return pages[0]!;
}

/**
 * Точная реплика, которую Марго скажет, если выбрать эту опцию (07-оболочка-тз,
 * «Команда короче реплики»).
 *
 * Считается из целевого узла и в контенте не дублируется: метка — короткое ядро,
 * реплика живёт там, где она и прозвучит.
 *
 * Узел читается сверху, ремарки пропускаются: произнести их оболочке нечем,
 * а показать в области реплики значит соврать, будто это скажет Марго. Пропуск
 * кончается на первой же реплике — она либо Марго, и тогда попадает
 * в предпросмотр, либо собеседника, и тогда за этим ходом слов Марго нет.
 *
 * Так устроены, например, три подстановки в `00-talk`: перед репликой стоит
 * «Ты правишь три слова карандашом и читаешь вслух», и игрок всё равно видит,
 * что именно прочтёт вслух.
 */
export function previewOf(content: GameContent, option: Option): string | null {
  const text = (option.target ? content.nodes[option.target]?.text : '') ?? '';
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const voice = voiceOf(line);
    if (voice === 'remark') continue;
    return voice === 'margo' ? said(line).trim() : null;
  }
  return null;
}

/** Срок с подписью и датой — то, что показывает статус. Только назначенные. */
export interface Term {
  name: string;
  label: string;
  at: string;
  /** Чем показывается прошедший срок: карта истекла, а срок — истёк. */
  expired: string;
}

export function terms(content: GameContent, save: SaveState): Term[] {
  const episode = content.episodes.find((e) => e.id === save.episodeState.episode);
  if (!episode) return [];
  // Порядок — как объявлено в episode.yaml: статус не должен перетасовываться
  // от того, в каком порядке узлы назначали сроки.
  return Object.entries(episode.dates).flatMap(([name, def]) => {
    const at = save.dates[name];
    return at ? [{ name, label: def.label, at, expired: def.expired }] : [];
  });
}

/**
 * Заметка, которой принадлежит узел. Она же — граница истории на экране: поток
 * копится в пределах одной сцены или комнаты, а переход на новое место начинает
 * страницу заново. Прокрутка тогда листает разговор, а не всю игру.
 */
export function sceneOf(addr: string): string {
  const hash = addr.indexOf('#');
  return hash === -1 ? addr : addr.slice(0, hash);
}

/** Опция отпадает, если её условие не выполнено или её узел уже отыгран по `once`. */
export function optionAvailable(content: GameContent, save: SaveState, option: Option): boolean {
  if (!evalCondition(option.attrs.if, save)) return false;
  if (option.target == null) return true;

  // Заметка закрыта для показа (`closed` в episode.yaml) — переход в неё
  // не предлагается. Граф при этом целый: закрыт вход, а не связь.
  const episode = content.episodes.find((e) => e.id === save.episodeState.episode);
  if (episode?.closed.includes(sceneOf(option.target))) return false;

  const target = content.nodes[option.target];
  if (!target) return false;
  if (!evalCondition(target.attrs.if, save)) return false;
  if (target.attrs.once && save.episodeState.used.includes(option.target)) return false;
  return true;
}

/** Что узел выдал игроку: id выданных слов — их выдачу надо показать в потоке. */
interface Applied {
  save: SaveState;
  granted: string[];
}

function applyAttrs(content: GameContent, save: SaveState, node: Node, stamp: string | null): Applied {
  // Флаг штампуется датой сцены, в которой поставлен, а не реальным временем.
  const flags = { ...save.flags };
  for (const f of node.attrs.set) flags[f] = { value: true, at: stamp };
  for (const f of node.attrs.unset) delete flags[f];

  // `give` одинаково выдаёт и слово, и вещь: для игры это один жест — «теперь это
  // у тебя есть», — а что именно, видно по тому, есть ли карточка слова.
  const words = { ...save.words };
  const granted: string[] = [];
  let inventory = [...save.inventory];
  for (const name of node.attrs.give) {
    if (content.words[name]) {
      if (words[name] !== 'white') granted.push(name);
      words[name] = 'white';
    } else if (!inventory.includes(name)) inventory.push(name);
  }
  for (const name of node.attrs.take) {
    delete words[name];
    inventory = inventory.filter((x) => x !== name);
  }

  // Срок назначает узел: в ABH выдают карту, и с этого момента у неё есть дата.
  // Имя срока обязано быть объявлено в episode.yaml — это проверяет валидатор.
  const dates = { ...save.dates, ...node.attrs.dates };

  // Страница — состояние предмета, и запоминается она здесь, а не в обработчике
  // команды: тогда состояние обновляется при любом входе — из комнаты, с рук,
  // из разговора — и переживает переходы само собой.
  const item = node.attrs.page == null ? null : content.docs[sceneOf(node.addr)];
  const itemStates = item ? { ...save.itemStates, [item.id]: node.id } : save.itemStates;

  const used = node.attrs.once ? [...new Set([...save.episodeState.used, node.addr])] : save.episodeState.used;

  return {
    save: {
      ...save,
      flags,
      words,
      inventory,
      dates,
      itemStates,
      episodeState: { ...save.episodeState, used },
    },
    granted,
  };
}

/**
 * Выдача слова видна в потоке: `КОНТЕЙНМЕНТ — в деле, 2`. Хоткей показывается
 * только у первого за игру — дальше он уже знаком, а строка должна быть короткой.
 *
 * Без этой строки механика прогрессии невидима: `give:` срабатывает на первом же
 * узле разговора, и если это происходит молча, игрок не узнает, что словарь есть.
 */
function grantLine(content: GameContent, id: string, first: boolean): string {
  const label = content.words[id]?.label ?? id;
  return `${label.toUpperCase()} — в деле${first ? ', 2' : ''}`;
}

/**
 * Маршрут — переход без метки: игроку он не показывается, узел доигрывает и уводит
 * дальше сам (07-оболочка-тз, «Опция и маршрут»). Порядок разрешения в узле:
 *
 *   1. собрать опции, отбросить те, чьё условие ложно;
 *   2. выжила хоть одна — ждать ввода;
 *   3. не выжило ни одной — идти по первому подходящему маршруту.
 *
 * Считаются только собственные опции узла: `осмотреть доску` и `идти в коридор`
 * приходят из блока `options` комнаты и стоят в ней всегда — это мебель, а не
 * выбор узла. Считай оболочка их, комната не смогла бы иметь развилку-вступление,
 * а без неё войти в неё в верном состоянии неоткуда.
 */
function nextRoute(content: GameContent, save: SaveState, node: Node): Option | null {
  const own = node.options.filter((o) => o.verb === null && optionAvailable(content, save, o));
  if (own.some((o) => o.label !== '')) return null;
  return own.find((o) => o.label === '') ?? null;
}

export interface EnterResult {
  save: SaveState;
  entries: StreamEntry[];
}

/**
 * Войти в узел: показать текст, исполнить атрибуты, при необходимости прокатиться
 * дальше по безусловным переходам. Позиция меняется только у сцен и комнат —
 * предмет отвечает, но никуда не ведёт.
 */
export function enter(content: GameContent, save: SaveState, addr: string, moves = true): EnterResult {
  const entries: StreamEntry[] = [];
  let state = save;
  let current: string | null = addr;
  let hops = 0;

  while (current != null) {
    const node: Node | undefined = content.nodes[current];
    if (!node) break;

    // Чем штампуется флаг: датой места, где игрок стоит. У предмета своей даты
    // нет — «когда» отвечает комната, в которой его взяли, а не он сам.
    const stamp = node.date ?? dateAt(content, state);
    const first = Object.keys(state.words).length === 0;
    const applied = applyAttrs(content, state, node, stamp);
    state = applied.save;
    if (moves) state = { ...state, episodeState: { ...state.episodeState, at: node.addr } };

    // Титульная карточка останавливает проход: ввод не принимается, дальше уводит
    // Transition, когда доиграет. Её текст — карточка, а не реплика, поэтому
    // в поток он не попадает.
    if (node.attrs.tag.includes('titlecard')) break;
    if (node.text) entries.push({ kind: 'text', text: interpolate(node.text, state) });
    applied.granted.forEach((id, i) => {
      entries.push({ kind: 'grant', text: grantLine(content, id, first && i === 0) });
    });

    const next: string | null = node.attrs.goto ?? nextRoute(content, state, node)?.target ?? null;
    current = next;
    if (++hops > 100) throw new Error(`зациклился безусловный переход в ${addr}`);
  }

  return { save: state, entries };
}

/**
 * Начало сессии: войти туда, где стоит сейв, и показать, что там написано.
 * `started` взводится здесь — узел отыгрывается ровно один раз, и второй запуск
 * не выдаёт слова по второму разу.
 *
 * Через эту же дверь проходит «начать заново»: `begin(content, freshSave(...))`
 * обязано быть неотличимо от первого запуска с чистой машины, иначе сброс
 * оставлял бы хвосты — и заметил бы их не автор, а игрок.
 */
export function begin(content: GameContent, save: SaveState): Session {
  const r = enter(content, { ...save, started: true }, save.episodeState.at);
  return { save: r.save, stream: r.entries, overlay: null, reading: null, history: [] };
}

export function freshSave(content: GameContent): SaveState {
  const episode = content.episodes[0];
  if (!episode) throw new Error('в game.yaml нет ни одного эпизода');
  return {
    saveVersion: content.saveVersion,
    words: {},
    flags: {},
    inventory: [],
    splashes: [],
    chapter: 'prolog',
    itemStates: {},
    taught: false,
    hinted: false,
    // Начальные сроки — из episode.yaml; дальше их двигают узлы.
    dates: Object.fromEntries(
      Object.entries(episode.dates).flatMap(([name, def]) => (def.at ? [[name, def.at] as const] : [])),
    ),
    started: false,
    episodeState: { episode: episode.id, at: episode.entry, used: [] },
  };
}
