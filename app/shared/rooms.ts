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

import type { Doc, Node, RoomRef } from './types.ts';

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
