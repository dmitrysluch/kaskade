/**
 * Кто говорит (07-оболочка-тз, «Кто говорит»).
 *
 *   `> — Знаю.`      собеседник
 *   `— Нет, ...`     Марго
 *   обычный абзац    ремарка, описание, действие
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

export function voiceOf(line: string): Voice {
  if (QUOTE.test(line)) return 'speech';
  if (DASH.test(line)) return 'margo';
  return 'remark';
}

/**
 * Строка без служебного знака. Знак цитаты снимается целиком: `>` на экране
 * занят приглашением ввода, а кто говорит, видно по цвету. У ремарки не
 * снимается ничего — её отступы принадлежат тексту.
 */
export function said(line: string): string {
  const voice = voiceOf(line);
  if (voice === 'speech') return line.replace(QUOTE, '');
  return voice === 'margo' ? line.trimStart() : line;
}
