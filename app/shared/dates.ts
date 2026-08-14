/**
 * Внутриигровые даты.
 *
 * Формат один на всю игру и человеческий — `12.05.2026`: даты пишет автор в
 * заметках, а не машина в логах, и ISO здесь читался бы хуже. Реальное время
 * не используется нигде и никогда: «сегодня» — это дата текущей заметки.
 */

const DATE = /^(\d{2})\.(\d{2})\.(\d{4})$/;

/** `12.05.2026` → миллисекунды UTC. `null`, если это не дата. */
export function parseDate(raw: string): number | null {
  const m = DATE.exec(raw.trim());
  if (!m) return null;
  const [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  // Календарь проверяем обратным преобразованием: 31.02 разобралось бы в 3 марта.
  const back = new Date(ms);
  if (back.getUTCDate() !== d || back.getUTCMonth() !== mo - 1 || back.getUTCFullYear() !== y) return null;
  return ms;
}

const DAY = 24 * 60 * 60 * 1000;

/** Сколько дней от `from` до `to`. `null`, если хоть одна дата не разбирается. */
export function daysBetween(from: string, to: string): number | null {
  const a = parseDate(from);
  const b = parseDate(to);
  if (a == null || b == null) return null;
  return Math.round((b - a) / DAY);
}

/** «233 дня», «1 день», «5 дней» — иначе строка статуса читается как машинный вывод. */
export function days(n: number): string {
  const abs = Math.abs(n) % 100;
  const tail = abs % 10;
  const word =
    abs > 10 && abs < 20 ? 'дней'
    : tail === 1 ? 'день'
    : tail > 1 && tail < 5 ? 'дня'
    : 'дней';
  return `${n} ${word}`;
}
