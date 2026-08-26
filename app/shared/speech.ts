/**
 * Кто говорит (07-оболочка-тз, «Кто говорит»).
 *
 *   `> — Знаю.`             собеседник сцены
 *   `> тоби — Маннитол.`    названный собеседник
 *   `— Нет, ...`            Марго
 *   обычный абзац           ремарка, описание, действие
 *
 * Определение одно на всю игру: этим же признаком поток красится на экране и по
 * нему же предпросмотр ищет реплику Марго. Разъедься эти два места — и в области
 * деталей однажды окажется ремарка, поданная как то, что Марго скажет.
 */

/** Имена совпадают с классами палитры: цвет роли задан в game.yaml. */
export type Voice = 'speech' | 'margo' | 'remark';

/** Реплику собеседника автор пишет цитатой — в Obsidian так и надо. */
const QUOTE = /^\s*>\s?/;
const DASH = /^\s*—\s/;

/** Метка говорящего: всё, что стоит между `> ` и первым ` — `. */
const NAMED = /^([^—]{1,40}?)\s+—\s/;

export function voiceOf(line: string): Voice {
  if (QUOTE.test(line)) return 'speech';
  if (DASH.test(line)) return 'margo';
  return 'remark';
}

export interface Said {
  voice: Voice;
  /**
   * Кто говорит, если названо. `null` — собеседник сцены: пока он один, имя
   * не нужно, и `00-talk` с `01-lecture` живут без него.
   */
  name: string | null;
  /** Сама строка без служебных знаков и без метки. */
  text: string;
}

/**
 * Разбор строки потока (07-оболочка-тз, «Когда собеседников больше одного»).
 *
 * Метка появилась там, где говорящих стало двое: цвет `speech` у них общий,
 * и различать их ремаркой значило бы тратить прозу на работу разметки.
 * Пишется она строчными, как команда, — это служебное имя, а не реплика,
 * и капитализацию решает оболочка.
 */
export function speakerOf(line: string): Said {
  const voice = voiceOf(line);
  if (voice === 'margo') return { voice, name: null, text: line.trimStart() };
  if (voice === 'remark') return { voice, name: null, text: line };

  const body = line.replace(QUOTE, '');
  // Реплика без метки начинается с тире — проверяем это первым, иначе тире
  // внутри самой фразы притворится границей имени.
  if (DASH.test(body)) return { voice, name: null, text: body.trimStart() };

  const named = NAMED.exec(body);
  if (!named) return { voice, name: null, text: body };
  return { voice, name: named[1]!.trim(), text: body.slice(named[0].length - 2).trimStart() };
}

/**
 * Строка без служебных знаков. Знак цитаты снимается целиком: `>` на экране
 * занят приглашением ввода, а кто говорит, видно по цвету. У ремарки не
 * снимается ничего — её отступы принадлежат тексту.
 */
export function said(line: string): string {
  return speakerOf(line).text;
}

/** Как метка выглядит на экране: имя пишут строчными, показывают с большой. */
export function speakerLabel(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}
