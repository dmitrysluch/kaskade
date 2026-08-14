import { readFileSync, writeFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { join } from 'node:path';
import { readYaml, strMap } from '../app/server/content/yaml.ts';

/**
 * `npm run portrait -- <png> <папка персонажа>` — переводит PNG в сетку индексов.
 *
 * Рисунок делается в пиксельном редакторе, а в репозитории живёт текстом
 * (07-оболочка-тз, «Портреты»): символ = ключ палитры. Соответствие «цвет → ключ»
 * берётся из `character.yaml`, поэтому палитра остаётся в одном месте, а скрипт
 * только раскладывает по ней пиксели.
 *
 * Оттенок, которого нет в палитре, сводится к ближайшему — но только если он
 * действительно рядом, и о каждом таком случае скрипт говорит вслух. Пиксель-арт
 * рисуется в четыре-шесть цветов, и лишний оттенок почти всегда промах пипетки;
 * а вот цвет, до которого далеко, — это ошибка, и её надо увидеть, а не замазать.
 */

/** Порог в RGB, ниже которого оттенок считается промахом пипетки, а не цветом. */
const MERGE_DISTANCE = 48;

interface Png {
  width: number;
  height: number;
  /** RGBA по 4 байта на пиксель. */
  data: Buffer;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Минимальный декодер: 8 бит, RGBA, без чересстрочности — то, что отдают Aseprite и Piskel. */
function decodePng(file: string): Png {
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${file}: это не PNG`);

  let width = 0;
  let height = 0;
  const idat: Buffer[] = [];

  for (let at = 8; at < buf.length; ) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('ascii', at + 4, at + 8);
    const body = buf.subarray(at + 8, at + 8 + length);

    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, color, , , interlace] = [body[8]!, body[9]!, body[10]!, body[11]!, body[12]!];
      if (depth !== 8 || color !== 6 || interlace !== 0) {
        throw new Error(
          `${file}: поддерживается только 8-битный RGBA без чересстрочности ` +
            `(здесь depth=${depth}, colorType=${color}, interlace=${interlace}). ` +
            'Пересохрани из редактора как обычный PNG с альфой.',
        );
      }
    } else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;

    at += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const data = Buffer.alloc(height * stride);

  // Снимаем построчные фильтры PNG: каждая строка начинается с байта-типа фильтра.
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? data[y * stride + i - 4]! : 0;
      const b = y > 0 ? data[(y - 1) * stride + i]! : 0;
      const c = i >= 4 && y > 0 ? data[(y - 1) * stride + i - 4]! : 0;
      const x = src[i]!;
      const value =
        filter === 0 ? x
        : filter === 1 ? x + a
        : filter === 2 ? x + b
        : filter === 3 ? x + ((a + b) >> 1)
        : filter === 4 ? x + paeth(a, b, c)
        : (() => {
            throw new Error(`${file}: неизвестный фильтр строки ${filter}`);
          })();
      data[y * stride + i] = value & 0xff;
    }
  }

  return { width, height, data };
}

const [, , pngPath, charDir] = process.argv;
if (!pngPath || !charDir) {
  console.error('использование: npm run portrait -- <png> <папка персонажа>');
  process.exit(1);
}

const cfg = readYaml(join(charDir, 'character.yaml'));
const keys = strMap(cfg.palette);

// Ключ палитры → цвет. Берём `default`: сетка одна на все эпизоды, а перекрашивает
// её палитра, поэтому переводим по базовому набору.
const byColor = new Map<string, string>();
let background: string | null = null;
for (const [key, name] of Object.entries(keys)) {
  const value = ((cfg[name] ?? {}) as Record<string, unknown>).default;
  if (value == null) background = key;
  else byColor.set(String(value).toLowerCase(), key);
}
if (!background) throw new Error('в палитре нет ключа без цвета — им обозначается фон');

function rgb(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

const palette = [...byColor].map(([hex, key]) => ({ key, rgb: rgb(hex) }));

/** Ближайший цвет палитры и расстояние до него. */
function nearest(r: number, g: number, b: number) {
  let best = palette[0]!;
  let bestDistance = Infinity;
  for (const entry of palette) {
    const [pr, pg, pb] = entry.rgb;
    const d = Math.hypot(r - pr, g - pg, b - pb);
    if (d < bestDistance) {
      bestDistance = d;
      best = entry;
    }
  }
  return { key: best.key, distance: bestDistance };
}

const png = decodePng(pngPath);
const rows: string[] = [];
const merged = new Map<string, { key: string; count: number }>();
const missing = new Map<string, number>();

for (let y = 0; y < png.height; y++) {
  let row = '';
  for (let x = 0; x < png.width; x++) {
    const at = (y * png.width + x) * 4;
    const [r, g, b, alpha] = [png.data[at]!, png.data[at + 1]!, png.data[at + 2]!, png.data[at + 3]!];
    if (alpha < 128) {
      row += background;
      continue;
    }

    const hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
    const exact = byColor.get(hex);
    if (exact) {
      row += exact;
      continue;
    }

    const near = nearest(r, g, b);
    if (near.distance <= MERGE_DISTANCE) {
      const seen = merged.get(hex) ?? { key: near.key, count: 0 };
      merged.set(hex, { key: near.key, count: seen.count + 1 });
      row += near.key;
    } else {
      missing.set(hex, (missing.get(hex) ?? 0) + 1);
      row += background;
    }
  }
  rows.push(row);
}

if (missing.size > 0) {
  console.error('в картинке есть цвета, до которых от палитры далеко:');
  for (const [hex, n] of [...missing].sort((a, b) => b[1] - a[1])) console.error(`  ${hex}  ${n} px`);
  console.error('\nдобавь их в character.yaml или сведи в редакторе к существующим');
  process.exit(1);
}

for (const [hex, { key, count }] of [...merged].sort((a, b) => b[1].count - a[1].count)) {
  console.log(`  сведено: ${hex} → ${key}  (${count} px)`);
}

const out = join(charDir, 'portrait.txt');
writeFileSync(out, `${rows.join('\n')}\n`);
console.log(`${png.width}×${png.height} → ${out} (панель ${png.width}×${png.height / 2} клеток)`);
