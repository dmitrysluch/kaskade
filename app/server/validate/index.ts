import { relative } from 'node:path';
import { ROOT } from '../content/paths.ts';
import { RULES, type Finding } from './rules.ts';
import type { GameContent } from '../../shared/types.ts';

export type { Finding } from './rules.ts';
export { RULES } from './rules.ts';

export function validate(content: GameContent): Finding[] {
  return RULES.flatMap((rule) => rule.run(content));
}

export function formatFinding(f: Finding): string {
  const path = f.file.startsWith('/') ? relative(ROOT, f.file) : f.file;
  const where = f.line == null ? path : `${path}:${f.line}`;
  return `${f.severity === 'error' ? 'ОШИБКА' : 'внимание'}  ${where}\n          ${f.message}  [${f.rule}]`;
}
