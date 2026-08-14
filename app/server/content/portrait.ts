import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { ContentError } from './markdown.ts';
import { readYaml, strMap } from './yaml.ts';
import type { CharacterDef, Portrait } from '../../shared/types.ts';

/**
 * Портреты (07-оболочка-тз, «Портреты»).
 *
 * Один файл — сетка индексов: символ = ключ палитры, высота вдвое больше высоты
 * панели в клетках. Красит не сетка, а палитра персонажа, и её переопределяет
 * эпизод: Марго 2024 и Марго 2038 — одна и та же сетка, разный цвет волос.
 */

function readGrid(file: string): string[] {
  const lines = readFileSync(file, 'utf8')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.startsWith('#'));

  if (lines.length === 0) throw new ContentError(file, 'портрет пустой');
  if (lines.length % 2 !== 0) {
    throw new ContentError(file, `нечётное число строк (${lines.length}) — полублок ставится на пару`);
  }

  // Ширина — длина строки, и она обязана совпадать у всех: картинка прямоугольная.
  // Добивать пробелами нельзя — так недорисованный край уехал бы в игру молча.
  const width = [...lines[0]!].length;
  lines.forEach((line, i) => {
    const w = [...line].length;
    if (w !== width) throw new ContentError(file, `строка ${i + 1} шириной ${w}, а остальные ${width}`);
  });

  return lines;
}

function buildPortrait(dir: string, cfg: Record<string, unknown>, episode: string): Portrait {
  const file = join(dir, 'portrait.txt');
  const grid = readGrid(file);
  const keys = strMap(cfg.palette);

  const colors: Record<string, string> = {};
  for (const [key, name] of Object.entries(keys)) {
    // Ключа нет в палитре или у ключа нет цвета — значит фон: рендерер оставит
    // клетку прозрачной, и сквозь неё будет виден фон терминала.
    const byEpisode = (cfg[name] ?? {}) as Record<string, unknown>;
    const value = byEpisode[episode] ?? byEpisode.default;
    if (value != null) colors[key] = String(value);
  }

  const unknown = new Set<string>();
  for (const row of grid) for (const ch of row) if (!(ch in keys) && ch !== ' ') unknown.add(ch);
  if (unknown.size > 0) {
    throw new ContentError(file, `в сетке есть знаки без ключа палитры: ${[...unknown].join(' ')}`);
  }

  return { grid, colors, width: [...(grid[0] ?? '')].length, height: grid.length };
}

export function loadCharacters(charactersDir: string, episodes: string[]): Record<string, CharacterDef> {
  const out: Record<string, CharacterDef> = {};
  if (!existsSync(charactersDir)) return out;

  for (const name of readdirSync(charactersDir).sort()) {
    const dir = join(charactersDir, name);
    if (!statSync(dir).isDirectory()) continue;

    const cfgFile = join(dir, 'character.yaml');
    const cfg = readYaml(cfgFile);
    const id = String(cfg.id ?? name);

    // Портреты не у всех: собеседник может быть без арта, и это нормально.
    const portraits: Record<string, Portrait> = {};
    if (existsSync(join(dir, 'portrait.txt'))) {
      for (const episode of episodes) portraits[episode] = buildPortrait(dir, cfg, episode);
    }

    out[id] = { id, label: String(cfg.label ?? basename(dir)), portraits };
  }

  return out;
}
