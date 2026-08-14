import { readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
export const CONTENT = join(ROOT, 'content');

/** Служебные папки Obsidian и мусор ОС в контент не входят. */
const SKIP = new Set(['.obsidian', '.trash', '.git', 'node_modules']);

export function walkMarkdown(dir = CONTENT): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (SKIP.has(name) || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkMarkdown(full));
    else if (name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Путь от `content/` без расширения: `episodes/prolog/scenes/lecture-1`. */
export function docIdOf(file: string): string {
  return relative(CONTENT, file).split(sep).join('/').replace(/\.md$/, '');
}
