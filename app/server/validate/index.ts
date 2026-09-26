import { relative } from 'node:path';
import { ROOT } from '../content/paths.ts';
import { RULES, type Finding } from './rules.ts';
import type { GameContent } from '../../shared/types.ts';

export type { Finding } from './rules.ts';
export { RULES } from './rules.ts';

/**
 * Одинаковые находки сливаются в одну.
 *
 * Общая часть помещения собирается в несколько срезов, и узел из неё живёт
 * в каждом. Правило, которое судит по узлу, честно найдёт одно и то же столько
 * раз, сколько есть срезов, — а автор получит стену повторов, в которой новая
 * ошибка не видна. Логическая тождественность здесь — файл, строка и текст:
 * это ровно то, что автор будет править.
 */
export function validate(content: GameContent): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];

  for (const found of RULES.flatMap((rule) => rule.run(content))) {
    const key = `${found.rule}|${found.file}|${found.line ?? ''}|${found.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(found);
  }

  return out;
}

export function formatFinding(f: Finding): string {
  const path = f.file.startsWith('/') ? relative(ROOT, f.file) : f.file;
  const where = f.line == null ? path : `${path}:${f.line}`;
  return `${f.severity === 'error' ? 'ОШИБКА' : 'внимание'}  ${where}\n          ${f.message}  [${f.rule}]`;
}
