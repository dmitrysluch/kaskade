import { ContentError, type RawDoc } from './markdown.ts';
import { emptyAttrs } from '../../shared/types.ts';
import { parseDate } from '../../shared/dates.ts';
import { parseRoomRef, roomRefOf } from '../../shared/rooms.ts';

/** Проверяем исходники до merge: иначе старые поля общей комнаты потеряются. */
export function validateNavigationSource(doc: RawDoc, docId: string): void {
  const fail = (message: string): never => { throw new ContentError(doc.path, message, 1); };
  const fm = doc.fm;
  if (doc.type === 'scene' || doc.type === 'room') {
    for (const key of ['date', 'location', 'timeLabel']) {
      if (key in fm) fail(`${key} в ${doc.type} больше не поддерживается: перенесите поле в transitions/* (ТЗ 14)`);
    }
  }
  if (doc.type === 'room') {
    if (typeof fm.persistent !== 'string' || !parseRoomRef(`rooms-virt/${fm.persistent}`)) {
      fail('комнате нужен постоянный адрес persistent (ТЗ 13)');
    }
    if (fm.stage != null && (typeof fm.stage !== 'string' || !/^[a-z0-9-]+$/.test(fm.stage))) {
      fail('stage комнаты — строка, например "00"');
    }
    if (fm.available != null && typeof fm.available !== 'boolean') fail('available — булево поле');
    if (fm.exits != null && (!Array.isArray(fm.exits) || fm.exits.some((ref) =>
      !roomRefOf(ref) || (typeof ref === 'object' && ref !== null &&
        Object.keys(ref).some((key) => !['persistent', 'stage', 'node'].includes(key))) ||
      (typeof ref === 'object' && ref !== null && 'stage' in ref && typeof ref.stage !== 'string')))) {
      fail('exits комнаты — список логических адресов {persistent, stage?, node?}, без ссылок на файлы');
    }
  }
  const inTransitions = /^episodes\/[^/]+\/transitions\/[^/]+$/.test(docId);
  if (inTransitions !== (doc.type === 'transition')) fail('папка transitions/ и type: transition должны совпадать');
  if (doc.type !== 'transition') return;
  if (typeof fm.stage !== 'string' || !/^[a-z0-9-]+$/.test(fm.stage)) fail('transition требует строковый stage');
  if (typeof fm.date !== 'string' || parseDate(fm.date) == null) fail('transition требует календарную date в формате ДД.ММ.ГГГГ');
  if (typeof fm.location !== 'string' || !fm.location.trim()) fail('transition требует непустую location');
  if (fm.timeLabel != null && (typeof fm.timeLabel !== 'string' || !fm.timeLabel.trim() || /[\r\n]/.test(fm.timeLabel) || fm.timeLabel.trim().split(/\s+/).length > 4)) {
    fail('timeLabel — одна строка, не более четырёх слов');
  }
  if (Object.keys(fm).some((key) => !['id', 'type', 'stage', 'date', 'location', 'timeLabel'].includes(key))) {
    fail('у transition допустимы только id, type, stage, date, location, timeLabel');
  }
  const node = doc.nodes[0];
  if (doc.nodes.length !== 1 || !node || node.id || node.text.trim() || node.generators.length ||
      JSON.stringify(node.attrs) !== JSON.stringify(emptyAttrs()) || node.transitions.length !== 1) {
    fail('transition содержит ровно один безымянный маршрут, без текста, узлов и эффектов');
  }
  const route = node!.transitions[0]!;
  if (route.label || JSON.stringify(route.attrs) !== JSON.stringify(emptyAttrs())) fail('маршрут transition не допускает условий или эффектов');
  const room = parseRoomRef(route.ref);
  if (room) {
    if (room.stage != null && room.stage !== fm.stage) fail('stage цели transition должен совпадать со stage перехода');
  } else if (!/^scenes\/[a-z0-9-]+(?:#[^\s]+)?$/.test(route.ref)) {
    fail('цель transition — rooms-virt/ или scenes/ своего эпизода');
  }
}
