import { parseDocuments, type Cell, type MinigameDoc, type Thread } from '../../shared/untangle.ts';
import type { MinigameDef } from '../../shared/types.ts';
import type { RawDoc } from './markdown.ts';

/**
 * Разбор заметки `type: minigame` ([[07a-мини-игра]]).
 *
 * Разбор нарочно терпеливый: чего не хватает и что написано не так, автор
 * получает списком от валидатора — вместе со всем остальным, что он сейчас
 * правит, а не по одной ошибке за перезагрузку. Поэтому здесь нет исключений:
 * мусор превращается в пустые значения, а судит их правило `minigame`.
 */

function int(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  return Number.isInteger(n) ? n : null;
}

function cell(v: unknown): Cell | null {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const x = int(v[0]);
  const y = int(v[1]);
  return x == null || y == null ? null : [x, y];
}

function points(raw: unknown): MinigameDef['points'] {
  const out: MinigameDef['points'] = {};
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const id = int(key);
    if (id == null || value == null || typeof value !== 'object') continue;
    const pair = value as Record<string, unknown>;
    const start = cell(pair.start);
    const solution = cell(pair.solution);
    if (start == null) continue;
    out[id] = { start, ...(solution == null ? {} : { solution }) };
  }
  return out;
}

function threads(raw: unknown): Thread[] {
  if (!Array.isArray(raw)) return [];
  const out: Thread[] = [];
  for (const item of raw) {
    if (item == null || typeof item !== 'object') continue;
    const t = item as Record<string, unknown>;
    const id = int(t.id);
    const ends = Array.isArray(t.points) ? t.points.map(int) : [];
    if (id == null || ends.length !== 2 || ends[0] == null || ends[1] == null) continue;
    out.push({ id, points: [ends[0], ends[1]] });
  }
  // Порядок строк в YAML не должен ничего менять: считаем по id.
  return out.sort((a, b) => a.id - b.id);
}

export function parseMinigame(raw: RawDoc, id: string, docId: string, label: string): MinigameDef {
  const fm = raw.fm;
  const grid = fm.grid == null || typeof fm.grid !== 'object' ? {} : (fm.grid as Record<string, unknown>);
  // Документы — текст до первого `##`. Дальше идут обычные узлы, и завершение
  // среди них: оно разбирается сценическим парсером, как и всё остальное.
  const body = raw.nodes.find((n) => n.id === '')?.text ?? '';
  const { docs, problems } = parseDocuments(body);

  return {
    id,
    docId,
    label,
    subtype: String(fm.subtype ?? '').trim(),
    grid: { columns: int(grid.columns) ?? 0, rows: int(grid.rows) ?? 0 },
    seed: int(fm.seed) ?? 0,
    complete: String(fm.complete ?? '').trim(),
    points: points(fm.points),
    threads: threads(fm.threads),
    documents: docs,
    problems,
  };
}

/** Поля, которые заметка мини-игры вправе объявить. Остальное — опечатка. */
export const MINIGAME_FIELDS = new Set([
  'id',
  'type',
  'subtype',
  'label',
  'grid',
  'seed',
  'complete',
  'points',
  'threads',
]);

export type { MinigameDoc };
