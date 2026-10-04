/**
 * Виртуальные адреса помещений ([[13-навигация-и-комнаты-тз]]).
 *
 * Личность помещения в игре — тройка `(episode, stage, persistent)`, а не имя
 * файла. Причина простая: одна и та же комната живёт в нескольких срезах мира,
 * и при адресации по файлу каждый срез приходилось бы держать копией всей
 * комнаты. Общая кухня в общаге должна существовать один раз, а меняться —
 * только там, где действительно меняется.
 *
 * Отсюда два слоя источников: **общая часть** (файл без `stage`) и **версия**
 * (файл со `stage`). Движок сливает их в памяти в «виртуальную комнату»;
 * папки `rooms-virt/` на диске нет и быть не должно.
 *
 * Здесь — только словарь адресов: чистые функции без состояния, одинаково
 * нужные серверу, клиенту и валидатору. Само слияние живёт на сервере
 * (`app/server/content/rooms.ts`): оно работает с разобранными файлами.
 */

import type { Doc, GameContent, Node, RoomExit, RoomRef } from './types.ts';

/** Префикс виртуального адреса. Резолвер узнаёт его раньше файлового поиска. */
export const VIRT = 'rooms-virt/';

/**
 * Stage, который станет известен только в игре.
 *
 * Ссылка из сцены (`[[rooms-virt/tu.h1012#после]]`) не называет срез: срез —
 * это то, где игрок сейчас. Но опции раскрываются на сервере, поэтому адрес
 * обязан существовать уже там. Звёздочка — честная запись «срез подставит
 * оболочка»: адрес остаётся строкой той же формы, её видно в `/adm` и в ошибках,
 * а `nodeAt()` на ней бросает — значит незаметно превратиться в «узла нет»
 * она не может.
 *
 * Бывает только в цели опции, в `goto` и в `exits`. В сейве — никогда.
 */
export const ANY_STAGE = '*';

/** Развернуть динамическую цель для статического графа во всех срезах источника. */
export function targetsIn(content: GameContent, from: string, target: string): string[] {
  if (!isStarred(target)) return [target];
  const docId = docPart(from);
  const stages = content.docStages[docId] ?? [];
  return stages.map((stage) => addrIn(target, stage));
}

/** `persistent` — латиница, цифры, точки и дефисы: `tu.dorm-room`, `ahlers.living-room`. */
const PERSISTENT = /^[a-z0-9][a-z0-9.-]*$/;

/** `stage` — латиница, цифры, дефисы: `00`, `03a`, `05`. Ведущие нули значимы. */
const STAGE = /^[a-z0-9-]+$/;

/**
 * Разобрать `rooms-virt/<persistent>[:<stage>][#<node>]`.
 *
 * `null` — не виртуальный адрес (или испорченный): пусть решает вызывающий,
 * ошибка это или обычная файловая ссылка.
 */
export function parseRoomRef(raw: string): RoomRef | null {
  const body = raw.trim();
  if (!body.startsWith(VIRT)) return null;

  const rest = body.slice(VIRT.length);
  const hash = rest.indexOf('#');
  const head = hash === -1 ? rest : rest.slice(0, hash);
  const node = hash === -1 ? undefined : rest.slice(hash + 1).trim();

  const colon = head.indexOf(':');
  const persistent = (colon === -1 ? head : head.slice(0, colon)).trim();
  const stage = colon === -1 ? undefined : head.slice(colon + 1).trim();

  if (!PERSISTENT.test(persistent)) return null;
  if (stage != null && stage !== ANY_STAGE && !STAGE.test(stage)) return null;

  return {
    persistent,
    ...(stage != null && stage !== '' ? { stage } : {}),
    ...(node != null && node !== '' ? { node } : {}),
  };
}

/**
 * Адрес из объектной формы `exits`: `{persistent: tu.h1012, stage: "04"}`.
 * Во frontmatter пишут объектом — так адрес виден полями, а не разбором строки.
 */
export function roomRefOf(value: unknown): RoomRef | null {
  if (typeof value === 'string') return parseRoomRef(value);
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;

  const raw = value as Record<string, unknown>;
  const persistent = raw.persistent == null ? '' : String(raw.persistent).trim();
  if (!PERSISTENT.test(persistent)) return null;

  const stage = raw.stage == null ? undefined : String(raw.stage).trim();
  const node = raw.node == null ? undefined : String(raw.node).trim();
  if (stage != null && stage !== ANY_STAGE && !STAGE.test(stage)) return null;

  return {
    persistent,
    ...(stage != null && stage !== '' ? { stage } : {}),
    ...(node != null && node !== '' ? { node } : {}),
  };
}

/** Разрешённые поля объектного выхода: адрес и одна подпись, больше ничего. */
const EXIT_KEYS = ['persistent', 'stage', 'node', 'target'];

/**
 * Подпись — буквальный однострочный текст. Нормализуется так же, как потом
 * собирается команда: крайние и повторные пробелы значения не имеют.
 */
function caption(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

/**
 * Разобрать запись `exits` ([[13a-локальные-подписи-выходов-тз]], «Валидация»).
 *
 * Возвращает причину, а не бросает: один и тот же разбор нужен и frontmatter
 * комнаты, и атрибуту узла, а ругаться им приходится с разными файлами
 * и строками. Молчаливого fallback нет нигде: число, список или пустая
 * подпись — ошибка, а не повод подставить форму комнаты.
 */
export function parseExit(value: unknown): { ok: true; exit: RoomExit } | { ok: false; reason: string } {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text === '') return { ok: false, reason: 'пустая запись в exits' };
    const ref = parseRoomRef(text);
    return { ok: true, exit: { ref: ref ? formatRoomRef(ref) : text, target: null } };
  }

  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, reason: `выход "${String(value)}" — не адрес помещения {persistent, stage?, node?, target?}` };
  }

  const raw = value as Record<string, unknown>;
  const unknown = Object.keys(raw).filter((key) => !EXIT_KEYS.includes(key));
  if (unknown.length > 0) {
    return { ok: false, reason: `у выхода неизвестное поле "${unknown[0]!}"; допустимы: ${EXIT_KEYS.join(', ')}` };
  }
  if ('stage' in raw && typeof raw.stage !== 'string') {
    return { ok: false, reason: 'stage выхода — строка, например "04"' };
  }

  const ref = roomRefOf(raw);
  if (!ref) return { ok: false, reason: `выход ${JSON.stringify(raw)} не разбирается в адрес помещения` };

  if (!('target' in raw)) return { ok: true, exit: { ref: formatRoomRef(ref), target: null } };
  if (typeof raw.target !== 'string') {
    return { ok: false, reason: `подпись выхода ${ref.persistent} — строка, а не ${JSON.stringify(raw.target)}` };
  }
  if (/[\r\n]/.test(raw.target)) {
    return { ok: false, reason: `подпись выхода ${ref.persistent} занимает одну строку` };
  }
  const target = caption(raw.target);
  if (target === '') {
    return { ok: false, reason: `пустая подпись выхода ${ref.persistent}: подпись либо есть, либо её нет` };
  }

  return { ok: true, exit: { ref: formatRoomRef(ref), target } };
}

/** Проекция в адреса: графу и планировщику срезов подписи не нужны. */
export function exitRefs(exits: RoomExit[]): string[] {
  return exits.map((e) => e.ref);
}

/** Обратно в канон: одна форма записи на весь движок. */
export function formatRoomRef(ref: RoomRef): string {
  const stage = ref.stage == null ? '' : `:${ref.stage}`;
  const node = ref.node == null || ref.node === '' ? '' : `#${ref.node}`;
  return `${VIRT}${ref.persistent}${stage}${node}`;
}

/** docId собранной комнаты: он же уезжает в сейв, в граф и в `/adm`. */
export function virtDocId(episode: string, persistent: string, stage: string): string {
  return `episodes/${episode}/${VIRT}${persistent}:${stage}`;
}

/** Адрес узла собранной комнаты. Пустой `node` значит «вход в помещение». */
export function virtAddr(episode: string, persistent: string, stage: string, node = ''): string {
  return `${virtDocId(episode, persistent, stage)}#${node}`;
}

/** Часть адреса до `#`. Та же логика, что у `sceneOf`, но без импорта клиента. */
function docPart(addr: string): string {
  const hash = addr.indexOf('#');
  return hash === -1 ? addr : addr.slice(0, hash);
}

export function isVirtual(addr: string): boolean {
  return docPart(addr).includes(`/${VIRT}`);
}

/** Адрес ждёт среза: срез подставит оболочка, до тех пор узла по нему нет. */
export function isStarred(addr: string): boolean {
  return docPart(addr).endsWith(`:${ANY_STAGE}`);
}

export function stageOfAddr(addr: string): string | null {
  const doc = docPart(addr);
  const colon = doc.lastIndexOf(':');
  return colon === -1 ? null : doc.slice(colon + 1);
}

export function persistentOfAddr(addr: string): string | null {
  const doc = docPart(addr);
  const at = doc.indexOf(`/${VIRT}`);
  if (at === -1) return null;
  const head = doc.slice(at + VIRT.length + 1);
  const colon = head.lastIndexOf(':');
  return colon === -1 ? head : head.slice(0, colon);
}

/**
 * Подставить срез вместо звёздочки. Всё остальное отдаётся как есть — адрес
 * сцены, предмета и конкретного среза подстановки не требует.
 */
export function addrIn(addr: string, stage: string | null): string {
  if (!isStarred(addr)) return addr;
  if (stage == null) {
    throw new Error(`адрес ${addr} ждёт среза, а контекст не установлен — нужен переход`);
  }
  const doc = docPart(addr);
  return `${doc.slice(0, -ANY_STAGE.length)}${stage}${addr.slice(doc.length)}`;
}

/** Ключ состояния помещения в сейве: состояние принадлежит срезу, не файлу. */
export function roomStateKey(episode: string, stage: string, persistent: string): string {
  return `${episode}|${stage}|${persistent}`;
}
