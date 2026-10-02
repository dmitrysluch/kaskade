import { plainText, resolveEntities, type EntityKind, type EntityMention } from '../../shared/entities.ts';
import { addrIn, isStarred, persistentOfAddr, roomStateKey, stageOfAddr } from '../../shared/rooms.ts';
import { EXAMINE } from '../../shared/pages.ts';
import { said, voiceOf } from '../../shared/speech.ts';
import type { Doc, GameContent, MinigameDef, Node, NodeAddr, Option, SaveState } from '../../shared/types.ts';

/**
 * Состояние и его изменение. Сохраняем состояние, а не сцену (07-оболочка-тз, «Сейв»):
 * слова, флаги, вещи на руках и адрес, где игрок стоит.
 */

export interface StreamEntry {
  /**
   * `grant` — выданное слово: механика должна быть видна, иначе её как бы нет.
   * `time` — разрыв во времени перед кадром: подпись, а не строка прозы.
   */
  kind: 'text' | 'echo' | 'card' | 'grant' | 'time';
  /** Текст без разметки — ровно то, что увидит игрок. */
  text: string;
  /**
   * Размеченные сущности, доступные **в момент вывода** (07-оболочка-тз, «Явно
   * размеченные сущности»). Считаются один раз, здесь, а не при каждой отрисовке:
   * «слово подсвечено, если карточка уже есть» — про тот момент, когда текст
   * показали. Иначе абзац из начала игры загорался бы задним числом, стоит
   * игроку получить слово через два часа, и подсветка перестала бы значить
   * «это можно набрать прямо сейчас».
   */
  mentions?: EntityMention[];
  /**
   * Что выдала эта строка (`kind: 'grant'`). Нужно панели по `2`: слово, которое
   * Марго только что получила, в тексте не размечено — его никто не упоминал,
   * его **дали**. А игрок, нажимающий `2` сразу после выдачи, спрашивает именно
   * про него.
   */
  granted?: { kind: EntityKind | 'item'; id: string; label: string };
}

/** Служебные команды, которые открывают оверлей с содержимым игры. */
export type OverlayCommand = 'справочник' | 'дело' | 'инвентарь';

/**
 * Все служебные команды. `меню` стоит особняком: остальные показывают то, что
 * игрок в игре набрал, а меню говорит о самой игре — и потому оверлеем
 * содержимого не является.
 */
export type SystemCommand = OverlayCommand | 'меню';

/**
 * Служебная команда. Адресных форм у неё нет (07-оболочка-тз, «Служебные
 * команды»): `справочник` открывает хранилище целиком, и `справочник
 * контейнмент` больше не существует.
 *
 * Причина не в экономии: быстрый доступ к одному термину даёт панель по `1`,
 * и она отвечает на другой вопрос — «что это было сейчас». Команда с адресом
 * дублировала панель, но хуже: её надо было вспомнить и набрать целиком, а имя
 * термина игрок к этому моменту как раз и не знает.
 */
export interface SystemCall {
  kind: SystemCommand;
}

/** То же, но заведомо про содержимое: такой вызов умеет нарисовать оверлей. */
export interface OverlayCall extends SystemCall {
  kind: OverlayCommand;
}

export interface Session {
  save: SaveState;
  stream: StreamEntry[];
  overlay: OverlayCall | null;
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
 *   `wait.lab-result >= 60s`  прожито активного времени ожидания
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
      else if (body.startsWith('wait.')) value = waitTerm(body, save);
      else value = save.flags[body]?.value === true;
      return negated ? !value : value;
    });
}

/**
 * Сравнение активного времени ожидания: `wait.<id> < 60s`, `wait.<id> >= 60s`.
 *
 * Больше сравнений нет намеренно (07-оболочка-тз): это два состояния часов на
 * стене, а не общий планировщик. Ожидание с другим id — не «ещё не прожито»,
 * а вопрос не о том ожидании, и любое сравнение с ним ложно.
 */
const WAIT_TERM = /^wait\.([a-z][a-z0-9-]*)\s*(<|>=)\s*(\d+)s$/i;

function waitTerm(body: string, save: SaveState): boolean {
  const m = WAIT_TERM.exec(body);
  const state = save.wait;
  if (!m || state == null || state.id !== m[1]) return false;
  const bound = Number(m[3]) * 1000;
  return m[2] === '<' ? state.elapsed < bound : state.elapsed >= bound;
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

/**
 * Узел по адресу.
 *
 * Бросает на адресе, который ещё ждёт среза (`…:*#узел`): такого узла в карте
 * нет и быть не может, и вернуть `undefined` значило бы молча притвориться,
 * что узла не существует. Разница огромна: «нет узла» прячет команду из списка
 * и рвёт ребро графа, а «срез не подставлен» — программная ошибка, которую
 * надо видеть сразу. Подставляет срез `resolveTarget`.
 */
export function nodeAt(content: GameContent, addr: string): Node | undefined {
  if (isStarred(addr)) {
    throw new Error(`адрес ${addr} не разрешён: срез подставляется resolveTarget, а не читается напрямую`);
  }
  return content.nodes[addr];
}

/**
 * Дату задаёт только подтверждённый transition (ТЗ 14).
 * До первой карточки календарного контекста нет.
 */
export function dateAt(content: GameContent, save: SaveState): string | null {
  return save.currentDate;
}

/** Срез мира, в котором игрок сейчас. `null` — контекст ещё не установлен. */
export function stageOf(save: SaveState): string | null {
  return save.activeStage;
}

/**
 * Подтвердить карточку перехода: одной операцией установить контекст и войти
 * в цель ([[14-переходы-и-даты-тз]], «Исполнение и экран»).
 *
 * Состояния других помещений этого среза не сбрасываются: переезд в квартиру
 * тем же вечером не должен обнулять секретариат. Ошибка разрешения цели сейв
 * не меняет вовсе — лучше остаться на карточке, чем оказаться нигде.
 */
export function confirmTransition(content: GameContent, save: SaveState, docId: string): EnterResult {
  const def = Object.values(content.transitions).find((t) => t.docId === docId);
  if (!def || sceneOf(save.episodeState.at) !== docId) return { save, entries: [] };

  /*
   * Одной операцией: эпизод-владелец, срез, дата, id перехода и вход в цель.
   * Частично подменённый контекст — прямой запрет ТЗ: игрок оказался бы в новой
   * комнате со старой датой или в старой комнате с новой.
   */
  const episode = def.episode === '' ? save.episodeState.episode : def.episode;
  const next: SaveState = {
    ...save,
    activeStage: def.stage,
    currentDate: def.date,
    lastTransitionId: def.id,
    // Новый контекст — новое место: комнату запишет вход в неё, а у сцены
    // своего места нет, и статус честно молчит, пока игрок не войдёт в комнату.
    activeRoom: null,
    // Открытая книга остаётся в прежнем дне вместе с комнатой, где её читали.
    openItem: null,
    episodeState: { ...save.episodeState, episode },
  };
  const target = resolveTarget(content, next, def.target);
  if (!target || content.docs[sceneOf(target)]?.available === false) return { save, entries: [] };
  const node = content.nodes[target]!;
  if (!evalCondition(node.attrs.if, next) || (node.attrs.once && next.episodeState.used.includes(target))) {
    return { save, entries: [] };
  }
  return enter(content, next, def.target);
}

/** Поле мини-игры по адресу узла. `null` — обычная заметка ([[07a-мини-игра]]). */
export function minigameAt(content: GameContent, addr: string): MinigameDef | null {
  return content.minigames[sceneOf(addr)] ?? null;
}

/**
 * Какое окно открыто в контейнере (07-оболочка-тз, «Вложенные предметы»).
 * `null` — ни одного: игрок только что открыл компьютер и ещё ничего не выбрал.
 */
export function openWindow(content: GameContent, save: SaveState, doc: Doc): Doc | null {
  const id = save.itemStates[doc.id];
  const open = id == null ? undefined : Object.values(content.docs).find((d) => d.id === id);
  return open && open.parent === doc.docId ? open : null;
}

/**
 * Что показано открытым уровнем: текущая страница книги, открытое окно
 * контейнера или сам контейнер, если окно ещё не выбрано.
 *
 * Нужно перезагрузке: игрок закрыл вкладку, читая расчёт, — вернуть его надо
 * к расчёту, а не к описанию комнаты, в которой он всё это время стоит.
 */
export function openScreen(content: GameContent, save: SaveState): Node | null {
  const doc = save.openItem == null ? undefined : content.docs[save.openItem];
  if (!doc) return null;

  const shown = doc.items.length > 0 ? (openWindow(content, save, doc) ?? doc) : doc;
  if (shown.pages.length > 0) return pageAt(content, save, shown.docId);
  return shown.nodes.find((n) => n.id === EXAMINE) ?? shown.nodes.find((n) => n.id === '') ?? null;
}

/**
 * Страницы предмета: узлы-секции в порядке `page`. У обычной заметки пусто.
 *
 * Страница с `if` — это состояние бумаги, а не развилка: протокол печатают
 * из того, что человек сказал, и графа «цель раздачи» выглядит по-разному
 * в зависимости от сказанного (07-оболочка-тз, «Страницы предмета»). Поэтому
 * страницы с ложным условием не прячутся «серым», а не существуют вовсе:
 * листание идёт по видимым, и игрок не считает пропущенные номера.
 *
 * `save` необязателен только для мест, где условие заведомо ни на что не влияет
 * (сборка каталога до входа в предмет). Везде, где страницу показывают, он есть.
 */
export function pagesOf(content: GameContent, docId: string, save?: SaveState): Node[] {
  const doc = content.docs[docId];
  if (!doc) return [];
  return doc.pages.flatMap((id) => {
    const node = content.nodes[`${docId}#${id}`];
    if (!node) return [];
    if (save && !evalCondition(node.attrs.if, save)) return [];
    return [node];
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
  const pages = pagesOf(content, docId, save);
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
export function previewOf(content: GameContent, save: SaveState, option: Option): string | null {
  // Разметку снимаем здесь же: предпросмотр — это то, что игрок сейчас прочитает,
  // а `[[ref-ines|шкалу]]` он прочитать не должен нигде и никогда.
  const addr = resolveTarget(content, save, option.target);
  const text = plainText((addr ? content.nodes[addr]?.text : '') ?? '');
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const voice = voiceOf(line);
    if (voice === 'remark') continue;
    return voice === 'margo' ? said(line).trim() : null;
  }
  return null;
}

/**
 * Где Марго находится — подпись для статуса (07-оболочка-тз, «Экран»).
 *
 * Пусто, пока она не вошла ни в одну комнату: на титрах, в BIOS и на карточке
 * перехода места ещё нет, и выдумывать его неоткуда. Пусто и тогда, когда
 * комнату убрали из контента: статус молчит, а не показывает адрес движка.
 */
export function placeLabel(content: GameContent, save: SaveState): string {
  return (save.activeRoom == null ? undefined : content.docs[save.activeRoom]?.label) ?? '';
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

/**
 * Вход в помещение ([[13-навигация-и-комнаты-тз]], «Вход, состояние и опции»).
 *
 * Порядок несущий, и каждый шаг взят из приёмки ТЗ:
 *
 *   1. **вступление-диспетчер** — пустой текст, ни одной опции с меткой, есть
 *      маршрут. Он обязан выигрывать у сохранённой ноды: на нём держится
 *      «книга, полученная вне комнаты, открывает реакцию при возвращении».
 *      Дальше решает автор — условия маршрутов пересчитываются каждый раз;
 *   2. **сохранённая нода** — последнее устойчивое состояние. У общаги вступление
 *      с текстом, и вернуться в него значило бы вернуть ушедшего Тоби;
 *   3. `entry:` — именованный вход, если автор его назвал;
 *   4. вступление;
 *   5. первый узел — на случай комнаты без вступления вовсе.
 */
export function roomEntry(content: GameContent, save: SaveState, docId: string): NodeAddr | null {
  const doc = content.docs[docId];
  if (!doc) return null;

  const intro = doc.nodes.find((n) => n.id === (doc.entry ?? ''));
  const routes = intro?.options.filter((o) => o.verb === null) ?? [];
  const dispatcher =
    intro != null &&
    intro.text.trim() === '' &&
    routes.length > 0 &&
    routes.every((o) => o.label === '');
  if (dispatcher) return intro.addr;

  const persistent = persistentOfAddr(docId);
  const stage = stageOfAddr(docId);
  if (persistent != null && stage != null) {
    const saved = save.roomStates[roomStateKey(save.episodeState.episode, stage, persistent)];
    const node = saved == null ? undefined : doc.nodes.find((n) => n.id === saved);
    if (node) return node.addr;
  }

  const named = doc.entry == null ? undefined : doc.nodes.find((n) => n.id === doc.entry);
  if (named) return named.addr;

  return (intro ?? doc.nodes[0])?.addr ?? null;
}

/**
 * Цель опции → адрес узла. Единственный способ: адрес может ждать среза
 * (`…:*#узел`) или указывать на помещение целиком, и разбираться в этом каждому
 * месту движка по-своему — верный путь к «команда молча исчезла».
 *
 * `null` значит «этого сейчас нет»: нет контекста, нет узла, нет помещения
 * в этом срезе. Опция с таким адресом не показывается, а валидатор ловит
 * причину заранее.
 */
export function resolveTarget(content: GameContent, save: SaveState, target: NodeAddr | null): NodeAddr | null {
  if (target == null) return null;

  const addr = isStarred(target) ? (save.activeStage == null ? null : addrIn(target, save.activeStage)) : target;
  if (addr == null) return null;

  /*
   * Адрес помещения без якоря значит «войти в помещение», а не «войти
   * во вступление», — и проверяется это **раньше** прямого поиска узла:
   * у вступления адрес ровно такой же (`docId#`), и прямой поиск нашёл бы его
   * первым. Тогда возврат в общагу каждый раз возвращал бы ушедшего Тоби.
   *
   * Само вступление при этом не потеряно: правило входа доходит до него,
   * когда сохранённого состояния нет.
   */
  const docId = sceneOf(addr);
  if (addr.endsWith('#') && content.docs[docId]?.type === 'room') return roomEntry(content, save, docId);
  return content.nodes[addr] ? addr : null;
}

/** Опция отпадает, если её условие не выполнено или её узел уже отыгран по `once`. */
export function optionAvailable(content: GameContent, save: SaveState, option: Option): boolean {
  if (!evalCondition(option.attrs.if, save)) return false;
  if (option.target == null) return true;

  // Адрес разрешается первым делом: в цели может ждать среза звёздочка,
  // а может стоять помещение целиком.
  const addr = resolveTarget(content, save, option.target);
  if (addr == null) return false;

  // Заметка закрыта для показа (`closed` в episode.yaml) или помещение закрыто
  // в этом срезе (`available: false`) — переход не предлагается. Граф при этом
  // целый: закрыт вход, а не связь.
  const episode = content.episodes.find((e) => e.id === save.episodeState.episode);
  if (episode?.closed.includes(sceneOf(addr))) return false;
  if (content.docs[sceneOf(addr)]?.available === false) return false;

  const target = content.nodes[addr];
  if (!target) return false;
  if (!evalCondition(target.attrs.if, save)) return false;
  if (target.attrs.once && save.episodeState.used.includes(addr)) return false;
  const transition = Object.values(content.transitions).find((t) => `${t.docId}#` === addr);
  if (transition) {
    const context = { ...save, activeStage: transition.stage, currentDate: transition.date };
    return optionAvailable(content, context, { ...option, target: transition.target });
  }
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
    } else if (!inventory.includes(name)) {
      inventory.push(name);
      granted.push(name);
    }
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
  const doc = content.docs[sceneOf(node.addr)];
  const item = node.attrs.page == null ? null : doc;
  let itemStates = item ? { ...save.itemStates, [item.id]: node.id } : save.itemStates;
  /*
   * Открытое окно контейнера запоминается там же и по той же причине: компьютер,
   * к которому вернулись, показывает то, что на нём было открыто
   * (07-оболочка-тз, «Вложенные предметы»). Пишем при входе в окно, откуда бы
   * он ни шёл, — чтобы состояние не зависело от того, какой командой окно
   * открыли.
   */
  const container = doc?.parent == null ? null : content.docs[doc.parent];
  if (doc && container) itemStates = { ...itemStates, [container.id]: doc.id };

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
  const word = content.words[id];
  if (word) return `${word.label.toUpperCase()} — в деле${first ? ', 2' : ''}`;

  // Вещь объявляется так же, как слово, и по той же причине: `give` срабатывает
  // посреди реплики, и молчаливая выдача не видна. Клавиша другая — инвентарь
  // живёт на `3`, — а строка та же.
  const label = Object.values(content.docs).find((d) => d.id === id)?.label ?? id;
  return `${label.toUpperCase()} — в инвентаре${first ? ', 3' : ''}`;
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
  // Физическое ожидание держит безымянный маршрут само — даже когда авторских
  // опций не осталось. Иначе узел, чьи действия одноразовые, проскакивал бы
  // насквозь, и ждать было бы нечего.
  if (node.attrs.wait && !waitOver(save, node.addr)) return null;
  const own = node.options.filter((o) => o.verb === null && optionAvailable(content, save, o));
  if (own.some((o) => o.label !== '')) return null;
  return own.find((o) => o.label === '') ?? null;
}

/**
 * Сессионная история сущностей (07-оболочка-тз, «Сессионная история сущностей»).
 *
 * Не состояние мира, а навигация: что уже мелькало в этой сессии и где именно.
 * Поэтому она не в сейве и не считается отдельным полем сессии — она **выводится
 * из потока**. Поток и есть то, что игроку вывели; хранить рядом второй список
 * тех же фактов значило бы завести два источника правды и однажды их разойтись.
 *
 * Хранятся уникальные сущности, а не все употребления: повторное упоминание
 * не заводит вторую запись, а переносит существующую в конец и обновляет место.
 */
export interface SessionEntity {
  kind: EntityKind;
  id: string;
  /** Последнее показанное упоминание: по нему панель находит место в потоке. */
  mention: EntityMention;
  /** Номер записи потока, в которой оно встретилось. */
  at: number;
}

export function sessionEntities(stream: StreamEntry[], kind: EntityKind): SessionEntity[] {
  const out = new Map<string, SessionEntity>();
  const put = (id: string, mention: EntityMention, at: number) => {
    // Удаляем перед вставкой: Map держит порядок вставки, и это ровно
    // «последнее упоминание — последним в списке».
    out.delete(id);
    out.set(id, { kind, id, mention, at });
  };

  stream.forEach((entry, at) => {
    // Выданное считается встреченным: строка выдачи и есть то место в потоке,
    // где слово прозвучало впервые.
    const granted = entry.granted;
    if (granted && granted.kind === kind) {
      put(granted.id, { kind, id: granted.id, label: granted.label, nth: 0 }, at);
    }
    for (const mention of entry.mentions ?? []) {
      if (mention.kind !== kind) continue;
      put(mention.id, mention, at);
    }
  });
  return [...out.values()];
}

/**
 * Строка потока с разобранной разметкой. Разметка снимается один раз, при выводе:
 * дальше в потоке лежит то, что игрок прочитал, и ни одна перерисовка этого
 * не меняет.
 */
export function textEntry(content: GameContent, save: SaveState, raw: string): StreamEntry {
  const { text, mentions } = resolveEntities(content, save, raw);
  return mentions.length === 0 ? { kind: 'text', text } : { kind: 'text', text, mentions };
}

/**
 * Запомнить, где игрок остался в помещении ([[13-навигация-и-комнаты-тз]],
 * «Вход, состояние и опции»).
 *
 * Состояние принадлежит срезу, а не файлу: новый срез получает своё, и Тоби,
 * ушедший в субботу, в понедельник не возвращается. Переименование файла общей
 * части состояние не теряет — ключ логический.
 */
function remember(content: GameContent, save: SaveState, node: Node): SaveState {
  if (node.attrs.once) return save;
  const docId = sceneOf(node.addr);
  if (content.docs[docId]?.type !== 'room') return save;

  const persistent = persistentOfAddr(docId);
  const stage = stageOfAddr(docId);
  if (persistent == null || stage == null) return save;

  const key = roomStateKey(save.episodeState.episode, stage, persistent);
  if (save.roomStates[key] === node.id) return save;
  return { ...save, roomStates: { ...save.roomStates, [key]: node.id } };
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
    const addr = resolveTarget(content, state, current);
    const node: Node | undefined = addr == null ? undefined : content.nodes[addr];
    if (!node) break;

    /*
     * Карточка перехода ([[14-переходы-и-даты-тз]]) останавливает проход **до**
     * применения атрибутов: позиция игрока и есть карточка. Отдельного поля
     * «незавершённый переход» в сейве поэтому нет, и всё вытекает само —
     * перезагрузка показывает карточку, эффекты цели не выполнены, статус
     * держит прежнюю дату. Дальше решает подтверждение (`confirmTransition`).
     */
    if (content.docs[sceneOf(node.addr)]?.type === 'transition') {
      state = { ...state, episodeState: { ...state.episodeState, at: node.addr } };
      break;
    }

    /*
     * Поле мини-игры ([[07a-мини-игра]]) останавливает проход так же и по той
     * же причине: позиция игрока и есть поле. Эффекты принадлежат узлу
     * завершения, а он исполняется только после победы и нового `Enter`.
     *
     * Уже пройденное поле не показывается второй раз: если такой файл снова
     * стал целью графа, движок сразу идёт его маршрутом завершения — без
     * текста и без повторных выдач. В нормальном прохождении этот вход закрыт
     * сюжетным флагом, который поставило само завершение.
     */
    const field = minigameAt(content, node.addr);
    if (field && node.id === '') {
      if (!state.minigames[field.id]?.completionApplied) {
        state = { ...state, episodeState: { ...state.episodeState, at: node.addr } };
        break;
      }
      const done = content.nodes[`${field.docId}#${field.complete}`];
      current = done == null ? null : (nextRoute(content, state, done)?.target ?? null);
      if (++hops > 100) throw new Error(`зациклился безусловный переход в ${addr}`);
      continue;
    }

    // Чем штампуется флаг: датой места, где игрок стоит. У предмета своей даты
    // нет — «когда» отвечает комната, в которой его взяли, а не он сам.
    const stamp = dateAt(content, state);
    // Подсказка с клавишей — только у первой выдачи в своё хранилище: дальше
    // игрок уже знает, где смотреть.
    const firstWord = Object.keys(state.words).length === 0;
    const firstItem = state.inventory.length === 0;
    const applied = applyAttrs(content, state, node, stamp);
    state = applied.save;
    /*
     * Куда игрок встанет. `moves` — свойство опции: предмет отвечает, а игрок
     * остаётся, где был. Но если ответ предмета ведёт маршрутом в сцену или
     * комнату, игрок оказывается там — иначе он читал бы новое место, стоя
     * в старом, и список команд остался бы от прежнего узла.
     *
     * Так протокол в отделении и возвращают: бумага — предмет, а «вы свободны»
     * говорят уже в сцене.
     */
    const place = content.docs[sceneOf(node.addr)]?.type;
    if (moves || place === 'scene' || place === 'room' || place === 'minigame') {
      state = { ...state, episodeState: { ...state.episodeState, at: node.addr } };
    }
    /*
     * Где Марго находится — это комната, и меняется оно только входом в другую
     * комнату (07-оболочка-тз, «Экран»). Разговор у двери и открытая книга
     * места не меняют: статус отвечает на «где я», а не «что сейчас на экране».
     */
    if (place === 'room') {
      const room = sceneOf(node.addr);
      if (state.activeRoom !== room) state = { ...state, activeRoom: room };
    }

    /*
     * Полноэкранный кадр останавливает проход: ввод не принимается, дальше
     * уводит компонент кадра, когда игрок нажмёт Enter. Текст такого узла
     * в поток не попадает — он и есть кадр.
     *
     * Титр предъявляет запись, монтаж показывает событие; для прохода это одно
     * и то же — дальше решает не движок, а нажатие.
     */
    if (node.attrs.tag.includes('titlecard') || node.attrs.tag.includes('montage')) break;
    // Подпись идёт до текста и отдельной строкой: разрыв во времени предъявляют
    // раньше, чем игрок начнёт читать, — иначе он съест первую строку кадра.
    /*
     * Ожидание заводится при входе и переживает возвраты: сходить «посмотреть
     * на часы» и вернуться — не повод отсчитывать девяносто секунд заново.
     * Начатое в другом узле ожидание этим и заканчивается: активное оно
     * ровно одно (валидатор следит, чтобы второго и не написали).
     */
    if (node.attrs.wait && !(state.wait?.node === node.addr && state.wait.id === node.attrs.wait.id)) {
      const { id, ms } = node.attrs.wait;
      state = { ...state, wait: { node: node.addr, id, ms, elapsed: 0 } };
    }
    if (node.attrs.timeLabel) entries.push({ kind: 'time', text: node.attrs.timeLabel });
    if (node.text) entries.push(textEntry(content, state, interpolate(node.text, state)));
    applied.granted.forEach((id) => {
      const word = content.words[id];
      const label = word?.label ?? Object.values(content.docs).find((d) => d.id === id)?.label ?? id;
      entries.push({
        kind: 'grant',
        text: grantLine(content, id, word ? firstWord : firstItem),
        granted: { kind: word ? 'word' : 'item', id, label: label.toUpperCase() },
      });
    });

    const next: string | null = node.attrs.goto ?? nextRoute(content, state, node)?.target ?? null;
    current = next;
    // Проход остановился — значит это устойчивое состояние помещения, и его
    // надо помнить. Узел с `once` состоянием не становится: вручение коробки
    // и выбор места — проходные, возвращаться в них нельзя.
    if (next == null) state = remember(content, state, node);
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
  return { save: r.save, stream: r.entries, overlay: null, history: [] };
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
    minigames: {},
    taught: false,
    hinted: false,
    // Начальные сроки — из episode.yaml; дальше их двигают узлы.
    dates: Object.fromEntries(
      Object.entries(episode.dates).flatMap(([name, def]) => (def.at ? [[name, def.at] as const] : [])),
    ),
    started: false,
    wait: null,
    // Контекст пуст: до первой карточки перехода у игры нет ни даты, ни среза.
    activeStage: null,
    currentDate: null,
    lastTransitionId: null,
    activeRoom: null,
    openItem: null,
    roomStates: {},
    episodeState: { episode: episode.id, at: episode.entry, used: [] },
  };
}

/**
 * Физическое ожидание (07-оболочка-тз, «Физическое ожидание»).
 *
 * Время считает оболочка (App.tsx): прибавляется только активное — при видимой
 * вкладке, в фокусе и с закрытыми оверлеями. Здесь живёт то, что от времени
 * зависит: прожито ли оно и куда после этого идти.
 */

/** Прожито ли ожидание этого узла. Чужое или отсутствующее — не прожито. */
export function waitOver(save: SaveState, addr: NodeAddr): boolean {
  return save.wait != null && save.wait.node === addr && save.wait.elapsed >= save.wait.ms;
}

/**
 * Маршрут, которым ожидание заканчивается, — если пора и если игрок на месте.
 *
 * На месте — обязательное условие: из дочернего узла действия («посмотреть на
 * часы») время выходит так же, но перебивать его текст автоматическим переходом
 * нельзя. Маршрут дождётся возвращения; секунды за это время не начисляются
 * повторно, потому что начисляются они не здесь.
 */
export function waitRoute(content: GameContent, save: SaveState): NodeAddr | null {
  const at = save.episodeState.at;
  if (!waitOver(save, at)) return null;
  const node = content.nodes[at];
  if (!node) return null;
  const route = node.options.find(
    (o) => o.verb === null && o.label === '' && optionAvailable(content, save, o),
  );
  return route?.target ?? null;
}
