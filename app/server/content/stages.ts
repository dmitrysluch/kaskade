import { ANY_STAGE, persistentOfAddr, stageOfAddr } from '../../shared/rooms.ts';
import type { RoomRef, TransitionDef } from '../../shared/types.ts';

/**
 * Планирование срезов мира ([[13-навигация-и-комнаты-тз]], «Stage, дата и монтаж»).
 *
 * Срез — не номер файла и не префикс id, а состояние игры, которое устанавливает
 * карточка перехода. Отсюда вопрос, на который отвечает этот модуль: **в каких
 * срезах играется каждая заметка**.
 *
 * Без ответа приходится собирать помещения на все срезы подряд. В прологе это
 * шесть помещений на пять срезов — тридцать комнат, из которых осмысленны
 * семь: остальные двадцать три недостижимы, и каждая честно попадёт в граф,
 * в `/adm` и в претензии валидатора о тупиках.
 *
 * Обход идёт по сырым ссылкам и **не** смотрит на условия: цель — узнать, куда
 * игра вообще может привести, а не что случится при конкретных флагах.
 */

/** Куда ведёт ссылка: в заметку или в помещение по логическому адресу. */
export type Out = { kind: 'doc'; docId: string } | { kind: 'room'; ref: RoomRef };

export interface PlanDoc {
  docId: string;
  /** Путь файла: нужен сообщениям о нарушениях. */
  path: string;
  /** Постоянный адрес помещения; `null` — заметка помещением не является. */
  persistent: string | null;
  /** Срез версии; `null` — общая часть или не комната. */
  stage: string | null;
  out: Out[];
}

export type Violation = {
  file: string;
  kind: 'cross-stage' | 'physical-room';
  message: string;
};

export interface StagePlan {
  /** В каких срезах играется заметка. */
  docStages: Map<string, Set<string>>;
  /** Что собирать: ключ `episode|persistent|stage`. */
  slices: Map<string, { episode: string; persistent: string; stage: string }>;
  /** Заметки до первой карточки перехода: там контекста ещё нет. */
  preGame: Set<string>;
  violations: Violation[];
}

const sliceKey = (episode: string, persistent: string, stage: string) => `${episode}|${persistent}|${stage}`;

function episodeOf(docId: string): string | null {
  const m = /^episodes\/([^/]+)\//.exec(docId);
  return m ? m[1]! : null;
}

/**
 * Собрать план.
 *
 * `docs` — все заметки с уже разобранными исходящими ссылками; `transitions` —
 * реестр карточек. Срезы эпизода задают сами карточки: срез существует тогда,
 * когда в него есть чем войти.
 */
export function planStages(
  docs: Map<string, PlanDoc>,
  transitions: TransitionDef[],
  episodes: { entry: string }[],
): StagePlan {
  const docStages = new Map<string, Set<string>>();
  const slices = new Map<string, { episode: string; persistent: string; stage: string }>();
  const violations: Violation[] = [];

  /** Помещения по постоянному адресу: общая часть и версии по срезам. */
  const rooms = new Map<string, { common: PlanDoc | null; versions: Map<string, PlanDoc> }>();
  for (const doc of docs.values()) {
    if (doc.persistent == null) continue;
    const key = `${episodeOf(doc.docId) ?? ''}|${doc.persistent}`;
    const room = rooms.get(key) ?? { common: null, versions: new Map() };
    if (doc.stage == null) room.common = doc;
    else room.versions.set(doc.stage, doc);
    rooms.set(key, room);
  }

  /** Заметка играется в срезе: запомнить и, если это помещение, собрать его. */
  const reach: { docId: string; stage: string }[] = [];
  const mark = (docId: string, stage: string): void => {
    const seen = docStages.get(docId) ?? new Set<string>();
    if (seen.has(stage)) return;
    seen.add(stage);
    docStages.set(docId, seen);
    reach.push({ docId, stage });
  };

  // Засев: цель каждой карточки играется в её срезе. Версия помещения — тоже,
  // даже если на неё пока никто не ссылается: автор её для этого и написал.
  for (const def of transitions) {
    const target = def.target.slice(0, def.target.lastIndexOf('#'));
    if (target !== '' && docs.has(target)) mark(target, def.stage);

    /*
     * Цель-помещение приходит логическим адресом. Явный срез в нём обязан
     * совпадать со срезом самой карточки — расхождение поймает `useRoom`
     * как переход в чужой срез, и это ровно то, чем оно является.
     */
    const persistent = persistentOfAddr(def.target);
    if (persistent != null) {
      const stage = stageOfAddr(def.target);
      useRoom({ persistent, ...(stage != null ? { stage } : {}) }, def.stage, def.docId);
    }
  }
  for (const [key, room] of rooms) {
    const [episode] = key.split('|');
    for (const [stage, version] of room.versions) {
      slices.set(sliceKey(episode!, version.persistent!, stage), {
        episode: episode!,
        persistent: version.persistent!,
        stage,
      });
      mark(version.docId, stage);
      if (room.common) mark(room.common.docId, stage);
    }
  }

  /** Ссылка в помещение: собрать нужный срез и пойти по его содержимому. */
  function useRoom(ref: RoomRef, stage: string, from: string): void {
    const episode = episodeOf(from) ?? '';
    // Явный чужой срез — ошибка, а не скрытая монтажная карточка: срез меняет
    // только карточка перехода.
    if (ref.stage != null && ref.stage !== ANY_STAGE && ref.stage !== stage) {
      violations.push({
        file: docs.get(from)?.path ?? from,
        kind: 'cross-stage',
        message:
          `ссылка на ${ref.persistent}:${ref.stage} из среза ${stage}: ` +
          `сменить срез может только карточка перехода`,
      });
      return;
    }

    const room = rooms.get(`${episode}|${ref.persistent}`);
    if (!room) return;

    /*
     * Собирать нечего — не собираем. Помещение существует в срезе, если есть
     * общая часть (тогда оно есть всюду) или версия именно этого среза.
     * «Ближайшего предыдущего» в ТЗ нет намеренно: пустая комната, собранная
     * из ничего, выглядела бы существующей и молча ломала бы навигацию.
     * Ссылку в такой срез поймает валидатор — как неразрешимую.
     */
    if (room.common == null && !room.versions.has(stage)) return;

    slices.set(sliceKey(episode, ref.persistent, stage), { episode, persistent: ref.persistent, stage });
    if (room.common) mark(room.common.docId, stage);
    const version = room.versions.get(stage);
    if (version) mark(version.docId, stage);
  }

  while (reach.length > 0) {
    const { docId, stage } = reach.pop()!;
    const doc = docs.get(docId);
    if (!doc) continue;

    for (const out of doc.out) {
      if (out.kind === 'room') {
        useRoom(out.ref, stage, docId);
        continue;
      }

      const target = docs.get(out.docId);
      if (!target) continue;
      // Карточка перехода срез не распространяет: она его устанавливает сама.
      if (transitions.some((t) => t.docId === out.docId)) continue;
      // Прямая ссылка на исходник помещения обходила бы слияние.
      if (target.persistent != null) {
        violations.push({
          file: doc.path,
          kind: 'physical-room',
          message:
            `прямая ссылка на файл помещения "${out.docId}": ` +
            `игровой переход пишется логическим адресом rooms-virt/${target.persistent}`,
        });
        continue;
      }
      mark(out.docId, stage);
    }
  }

  /*
   * Неигровой пролог: всё, что достижимо от входа эпизода, не пересекая
   * карточку перехода. Там ещё нет ни дня, ни среза, поэтому там нельзя
   * ни выдавать предметы, ни ставить флаги — только название, BIOS и личное дело.
   */
  const preGame = new Set<string>();
  for (const episode of episodes) {
    const start = episode.entry.slice(0, episode.entry.lastIndexOf('#'));
    const queue = [start];
    while (queue.length > 0) {
      const docId = queue.pop()!;
      const doc = docs.get(docId);
      if (!doc || preGame.has(docId)) continue;
      preGame.add(docId);
      if (transitions.some((t) => t.docId === docId)) continue;
      for (const out of doc.out) if (out.kind === 'doc') queue.push(out.docId);
    }
  }

  return { docStages, slices, preGame, violations };
}
