import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import {
  DETAIL_ROWS,
  GameScreen,
  LIST_ROWS,
  LOWER_ROWS,
  ruleGlyph,
  STATUS_ROWS,
} from '../app/client/ui/Screen.tsx';
import {
  commandLines,
  detailLines,
  inputLine,
  statusLine,
  statusText,
  streamLines,
  systemLine,
  viewport,
} from '../app/client/ui/lines.ts';
import { loadContent } from '../app/server/content/load.ts';
import { buildCatalog, SYSTEM_COMMANDS } from '../app/client/engine/catalog.ts';
import { dateAt, enter, freshSave, previewOf, terms } from '../app/client/engine/state.ts';
import { matches } from '../app/client/engine/completion.ts';
import { MARGIN } from '../app/client/ui/text.ts';
import type { SaveState } from '../app/shared/types.ts';
import type { StreamEntry } from '../app/client/engine/state.ts';

/**
 * `npm run frame` — печатает экран в терминал так, как его увидит игрок.
 *
 * Рамка нарисована знаками, поэтому её видно и без браузера. Полезно, когда правишь
 * раскладку: несовпадение на один знак заметно сразу, а тест скажет только «не сошлось».
 */

const [, , addrArg, inputArg = ''] = process.argv;
const cols = Number(process.env.COLS ?? 96);
const rows = Number(process.env.ROWS ?? 26);

const game = loadContent();
let save: SaveState = { ...freshSave(game), started: true };
let stream: StreamEntry[] = [];

const first = enter(game, save, save.episodeState.at);
save = first.save;
stream = first.entries;

if (addrArg) {
  const addr = game.nodes[addrArg] ? addrArg : `${addrArg}#`;
  if (!game.nodes[addr]) {
    console.error(`нет узла "${addrArg}"`);
    process.exit(1);
  }
  const step = enter(game, save, addr);
  save = step.save;
  stream = step.entries;
}

const episode = game.episodes.find((e) => e.id === save.episodeState.episode)!;

const textWidth = Math.max(1, cols - MARGIN.text - MARGIN.right);
const streamRows = Math.max(3, rows - STATUS_ROWS - LOWER_ROWS);
const lines = streamLines(stream, textWidth);
const catalog = buildCatalog(game, save);
const shown = matches(catalog, inputArg);
// В превью показываем первый вариант: в браузере это то, что выбрал бы игрок
// стрелкой вниз, а здесь надо увидеть саму область деталей.
const picked = shown[0];
const scroll = Number(process.env.SCROLL ?? 0);
const maxScroll = Math.max(0, lines.length - streamRows);

const html = renderToStaticMarkup(
  React.createElement(GameScreen, {
    cols,
    streamRows,
    status: statusLine(statusText(dateAt(game, save), terms(game, save)), cols),
    stream: viewport(lines, streamRows, scroll),
    more: { up: Math.min(scroll, maxScroll) < maxScroll, down: Math.min(scroll, maxScroll) > 0 },
    input: inputLine(inputArg),
    list: commandLines(shown, 0, inputArg, textWidth, LIST_ROWS),
    details: detailLines(
      picked ? previewOf(game, picked) : null,
      picked?.attrs.advance ?? false,
      textWidth,
      DETAIL_ROWS,
    ),
    system: systemLine(SYSTEM_COMMANDS, textWidth),
    rule: ruleGlyph(game.renderers[episode.renderer]!.rule),
  }),
);

/** `rgb(39, 39, 54)` или `#272736` → пара чисел для ANSI. */
function ansi(css: string, layer: 38 | 48): string {
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css);
  const hex = /#([0-9a-f]{6})/i.exec(css);
  const [r, g, b] =
    rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
    : hex ? [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16))
    : [];
  return r == null ? '' : `[${layer};2;${r};${g};${b}m`;
}

// Цвета переводим в ANSI, а не выбрасываем: портрет — пиксель-арт, и посмотреть
// на него глазами без браузера иначе негде.
/**
 * Класс → ключ палитры. В браузере это делает CSS, здесь приходится повторить:
 * иначе в терминале не видно ни того, кто говорит, ни цвета рамки.
 */
const CLASS_COLORS: Record<string, string> = {
  speech: 'speech',
  margo: 'margo',
  remark: 'remark',
  echo: 'echo',
  card: 'dim',
  dim: 'dim',
  locked: 'dim',
  advance: 'advance',
  environment: 'environment',
  story: 'story',
  system: 'system',
  preview: 'preview',
  rail: 'frame',
  rule: 'rule',
  more: 'accent',
  hit: 'accent',
  pick: 'fg',
};

const palette = game.renderers[episode.renderer]!.palette;

const text = html
  .replace(/<\/div><div[^>]*>/g, '\n')
  .replace(/<span style="([^"]*)"[^>]*>/g, (_, style: string) => {
    const fg = /(?:^|;)\s*color:([^;]+)/.exec(style);
    const bg = /background:([^;]+)/.exec(style);
    return (fg ? ansi(fg[1]!, 38) : '') + (bg ? ansi(bg[1]!, 48) : '');
  })
  .replace(/<span class="([^"]*)"[^>]*>/g, (_, cls: string) => {
    // Классов может быть несколько (`locked pick`) — берём первый известный.
    for (const name of cls.split(/\s+/)) {
      const color = palette[CLASS_COLORS[name] ?? ''];
      if (color) return ansi(color, 38);
    }
    return '';
  })
  .replace(/<\/span>/g, '[0m')
  .replace(/<[^>]+>/g, '')
  .replace(/&#x27;/g, "'")
  .replace(/&quot;/g, '"')
  .replace(/&gt;/g, '>')
  .replace(/&lt;/g, '<')
  .replace(/&amp;/g, '&');

console.log(process.env.NO_COLOR ? text.replace(/\[[0-9;]*m/g, '') : text);
