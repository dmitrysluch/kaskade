import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { ContentError } from './markdown.ts';
import type { Palette, RendererDef } from '../../shared/types.ts';

/** Конфиги: `game.yaml` — витрина, `episode.yaml` — правда об эпизоде. */

export function readYaml(file: string): Record<string, unknown> {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new ContentError(file, 'файл не найден');
  }
  try {
    return (yaml.load(raw) ?? {}) as Record<string, unknown>;
  } catch (e) {
    throw new ContentError(file, `не разбирается YAML: ${(e as Error).message}`);
  }
}

export function str(file: string, v: unknown, what: string): string {
  const s = String(v ?? '').trim();
  if (!s) throw new ContentError(file, `не заполнено обязательное поле ${what}`);
  return s;
}

export function strArray(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  return String(v)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function strMap(v: unknown): Record<string, string> {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return {};
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, String(x)]));
}

/**
 * Палитра по умолчанию. Ключи сверх этих тоже работают: каждый уезжает в CSS
 * переменной `--<ключ>`, поэтому добавить цвет — это строчка в game.yaml,
 * а не правка кода.
 */
const DEFAULT_PALETTE: Palette = {
  bg: '#0b0b0b',
  fg: '#d8d2c4',
  dim: '#6b675e',
  accent: '#8fb3c7',
  // Кто говорит (07-оболочка-тз): собеседник, Марго, ремарка.
  speech: '#d8d2c4',
  margo: '#8fb3c7',
  remark: '#9a958a',
  // Введённая команда: она уже прозвучала, поэтому уходит на второй план.
  echo: '#6b675e',
  frame: '#6b675e',
  rule: '#6b675e',
  error: '#e2a0a0',
};

export function parseRenderer(file: string, id: string, raw: unknown): RendererDef {
  const r = (raw ?? {}) as Record<string, unknown>;
  const font = (r.font ?? {}) as Record<string, unknown>;
  const palette = { ...DEFAULT_PALETTE, ...strMap(r.palette) };

  for (const [key, value] of Object.entries(palette)) {
    if (!/^#[0-9a-fA-F]{3,8}$/.test(value)) {
      throw new ContentError(file, `рендерер "${id}": цвет ${key} должен быть в виде #rrggbb, а не "${value}"`);
    }
  }

  const frame = String(r.frame ?? 'light');
  if (!['light', 'heavy', 'double'].includes(frame)) {
    throw new ContentError(file, `рендерер "${id}": нет рамки "${frame}"; есть light, heavy, double`);
  }

  const rule = String(r.rule ?? 'light');
  if (!['light', 'heavy', 'double', 'dashed', 'none'].includes(rule)) {
    throw new ContentError(file, `рендерер "${id}": нет линейки "${rule}"; есть light, heavy, double, dashed, none`);
  }

  // Длительность полноэкранных состояний. Ноль — законное значение (титр без
  // паузы), отрицательное и нечисловое — нет: экран завис бы навсегда.
  const timingRaw = (r.timing ?? {}) as Record<string, unknown>;
  const ms = (key: string, fallback: number): number => {
    if (timingRaw[key] == null) return fallback;
    const n = Number(timingRaw[key]);
    if (!Number.isFinite(n) || n < 0) {
      throw new ContentError(file, `рендерер "${id}": timing.${key} должен быть числом миллисекунд, а не "${timingRaw[key]}"`);
    }
    return n;
  };

  return {
    id,
    palette,
    frame,
    rule,
    timing: { splash: ms('splash', 3000), titlecard: ms('titlecard', 2400), bios: ms('bios', 2200) },
    font: {
      family: String(font.family ?? 'IBM Plex Mono'),
      size: Number(font.size ?? 16),
      rows: Number(font.rows ?? 34),
      line: Number(font.line ?? 1),
    },
    effects: strArray(r.effects),
    ambience: r.ambience == null ? null : String(r.ambience),
    keyboard: r.keyboard == null ? null : String(r.keyboard),
  };
}
