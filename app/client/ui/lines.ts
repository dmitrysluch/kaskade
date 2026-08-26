import {
  clip,
  codes,
  ellipsis,
  hanging,
  highlight,
  MARGIN,
  mark,
  pad,
  spread,
  width as segWidth,
  wrap,
  type Seg,
  type Span,
} from './text.ts';
import type { CatalogOption } from '../engine/catalog.ts';
import type { OverlayCall, OverlayCommand, StreamEntry, Term } from '../engine/state.ts';
import { days, daysBetween } from '../../shared/dates.ts';
import { speakerLabel, speakerOf } from '../../shared/speech.ts';
import type { GameContent, Portrait, SaveState } from '../../shared/types.ts';

/** Состояние → строки. Всё, что попадает на экран, сначала становится строками знаков. */

/**
 * Кто говорит (07-оболочка-тз, «Кто говорит»). Три слоя разведены цветом и
 * отступом, объяснять игроку ничего не надо; сам признак живёт в `shared/speech`,
 * потому что по нему же предпросмотр ищет реплику Марго.
 *
 * Названный собеседник (`> тоби — ...`) получает имя перед репликой цветом
 * ремарки: отдельного цвета на каждого говорящего не заводится — их может быть
 * сколько угодно, и различать их должно имя, а не оттенок, который надо помнить.
 */
export function streamLines(entries: StreamEntry[], max: number, words: string[] = []): Seg[][] {
  const out: Seg[][] = [];
  // Слова дела подсвечиваются в любом тексте и без разметки в заметках: оболочка
  // знает, какие слова у игрока есть (07-оболочка-тз, «Разметка»).
  const known: Span[] = words.map((text) => ({ text, cls: 'word' }));

  for (const entry of entries) {
    if (out.length > 0) out.push([]);

    for (const source of entry.text.split('\n')) {
      // Эхо команды и карточки говорят не голосом персонажа — разметку к ним
      // не применяем: у них свой класс и свой цвет.
      const said = entry.kind === 'text' ? speakerOf(source) : { voice: entry.kind, name: null, text: source };
      const cls: string = said.voice;
      // Имя печатается перед репликой и переносится вместе с ней: считать
      // ширину надо по тому, что игрок увидит, а не по одной реплике.
      const label = said.name == null ? '' : `${speakerLabel(said.name)} `;

      // Обратные кавычки снимаются до переноса: иначе они займут колонки.
      const plain = codes(`${label}${said.text}`);
      const spans = entry.kind === 'text' ? [...plain.spans, ...known] : [];

      // Эхо печатается с висящим промптом, как это делает терминал: прокрутка
      // назад выглядит как одна колонка с торчащими приглашениями.
      wrap(plain.text, max).forEach((line, i) => {
        const lead = entry.kind === 'echo' && i === 0 ? hanging() : pad();
        // Метка живёт только в первой строке: перенос её не повторяет.
        const named = i === 0 && label !== '' && line.startsWith(label);
        const segs = named
          ? [{ text: label, cls: 'remark' }, ...mark(line.slice(label.length), cls, spans)]
          : mark(line, cls, spans);
        out.push([{ text: lead, cls: 'dim' }, ...segs]);
      });
    }
  }
  return out;
}

/**
 * Что показывает статус: дата текущей заметки, дальше сроки — `12.05.2026 · BLUE
 * CARD 233 дня`. Срок считается от той же даты, поэтому он сам тикает по ходу
 * пролога, и отдельного «сколько осталось» в контенте держать не надо.
 *
 * Прошедший срок показывается словом (`BLUE CARD истекла`), а не отрицательным
 * числом: минус в статусе читается как сбой машины, а не как факт о карте.
 *
 * Срок с непонятной датой не показывается вовсе: соврать в статусе хуже, чем
 * промолчать, а поймает это валидатор при загрузке.
 */
export function statusText(date: string | null, terms: Term[]): string {
  if (!date) return '';
  const parts = [date];
  for (const term of terms) {
    const left = daysBetween(date, term.at);
    if (left == null) continue;
    parts.push(`${term.label} ${left < 0 ? term.expired : days(left)}`);
  }
  return parts.join(' · ');
}

/**
 * Статус — тускло и прижат вправо, по правому полю текста, а не по краю сетки:
 * он часть текстового блока, а не отдельная панель. Своей линейкой не отделяется —
 * он должен выглядеть как то, что может исчезнуть.
 */
export function statusLine(text: string, cols: number): Seg[] {
  if (text === '') return [];
  const gap = Math.max(0, cols - MARGIN.right - text.length);
  return [{ text: ' '.repeat(gap) }, { text, cls: 'echo' }];
}

/**
 * Окно в поток: ровно `rows` строк.
 *
 * Пока текст в окно помещается, он пишется **сверху**, с первой свободной строки:
 * сцена читается как страница, которая заполняется, а не как лента, ползущая
 * вверх от пустого места. Переполнилось — окно едет за концом, свежий текст
 * оказывается рядом со строкой ввода, а старый уходит наверх.
 *
 * `scroll` считается от низа и здесь же зажимается — снаружи его можно крутить
 * сколько угодно, экран не сломается.
 */
export function viewport(lines: Seg[][], rows: number, scroll: number): Seg[][] {
  if (lines.length <= rows) {
    const tail = Array.from({ length: rows - lines.length }, () => [] as Seg[]);
    return [...lines, ...tail];
  }

  const clamped = Math.max(0, Math.min(scroll, lines.length - rows));
  const end = lines.length - clamped;
  return lines.slice(end - rows, end);
}

/**
 * Портрет в полублоках: `▀` красит верхнюю половину клетки цветом текста, нижнюю —
 * цветом фона. Одна клетка = два независимых пикселя, а поскольку клетка
 * моноширинного шрифта примерно 1:2, полупиксель выходит почти квадратным.
 */
export function portraitLines(portrait: Portrait): Seg[][] {
  const lines: Seg[][] = [];
  for (let y = 0; y + 1 < portrait.height; y += 2) {
    const top = portrait.grid[y] ?? '';
    const bottom = portrait.grid[y + 1] ?? '';
    const row: Seg[] = [];

    for (let x = 0; x < portrait.width; x++) {
      const upper = portrait.colors[top[x] ?? ' '];
      const lower = portrait.colors[bottom[x] ?? ' '];

      // Прозрачную половину нельзя рисовать `▀` без цвета: знак возьмёт цвет
      // текста и половина клетки окажется закрашенной. Поэтому знак выбирается
      // по тому, какие половины вообще есть.
      if (upper && lower) row.push({ text: '▀', color: upper, bg: lower });
      else if (upper) row.push({ text: '▀', color: upper });
      else if (lower) row.push({ text: '▄', color: lower });
      else row.push({ text: ' ' });
    }
    lines.push(row);
  }
  return lines;
}

/**
 * Помета `advance` в интерфейсе (07-оболочка-тз, «Опция»).
 *
 * Треугольник служебный: игрок его не вводит, поиск и дополнение его не учитывают,
 * в эхо команды он не попадает. Цвет не единственный сигнал — ту же работу
 * делает знак.
 */
export const ADVANCE_MARK = '▶';
export const ADVANCE_LEGEND = 'продолжает историю; к текущим действиям нельзя вернуться';

/** Маркер выбора: одна зарезервированная позиция в начале каждой строки. */
export const PICK_MARK = '›';

/** Хоткеи: показаны прямо в полосе, отдельной строки под них нет. */
const HOTKEY: Partial<Record<string, string>> = {
  справочник: '1',
  дело: '2',
  меню: '0',
};

/** Категория опции → класс. Цвет — из палитры рендерера, здесь только связь. */
function kindClass(option: CatalogOption): string {
  if (option.system) return 'system';
  return option.attrs.advance ? 'advance' : option.kind === 'environment' ? 'environment' : 'story';
}

function optionSegs(option: CatalogOption, input: string, picked: boolean): Seg[] {
  const marks = [option.locked ? 'locked' : '', kindClass(option), picked ? 'pick' : '']
    .filter(Boolean)
    .join(' ');

  const label = highlight(option.label, input).map((seg) => ({
    ...seg,
    cls: [seg.cls, marks].filter(Boolean).join(' ') || undefined,
  }));
  return option.attrs.advance ? [{ text: `${ADVANCE_MARK} `, cls: marks }, ...label] : label;
}

/**
 * Список команд (07-оболочка-тз, «Список всегда показывает, что можно»).
 *
 * Вертикальный, по одной команде на строку, без горизонтальной раскладки:
 * взгляд движется в одном направлении, `↑`/`↓` всегда значат «предыдущая» и
 * «следующая», а у выбранной строки однозначное место.
 *
 * Категория не владеет ни строкой-заголовком, ни пустым разделителем — список
 * плотный: окружение, сюжет, сюжет с `advance`. Различает их цвет, порядок
 * и знак `▶`, а не геометрические секции.
 *
 * Высота постоянна. Если вариантов больше, окно едет за выбором, а положение
 * ввода, деталей и служебной полосы не меняется.
 */
export function commandLines(
  matches: CatalogOption[],
  pick: number | null,
  input: string,
  max: number,
  rows: number,
): Seg[][] {
  // Окно списка держит выбранное на виду; без выбора показываем начало.
  const from = pick == null ? 0 : Math.max(0, Math.min(pick - rows + 1, matches.length - rows));
  const window = matches.slice(Math.max(0, from), Math.max(0, from) + rows);

  const lines = window.map((option, i) => {
    const index = Math.max(0, from) + i;
    const picked = index === pick;
    // Маркер висит в поле, как промпт: сами команды тогда стоят на той же
    // колонке, что набранное и повествование, и левый край остаётся линией.
    const lead: Seg = {
      text: hanging(picked ? PICK_MARK : ' '),
      ...(picked ? { cls: 'pick' } : {}),
    };
    return clip([lead, ...optionSegs(option, input, picked)], max + MARGIN.text);
  });

  const hidden = matches.length - Math.max(0, from) - window.length;
  if (hidden > 0 && lines.length > 0) {
    lines[lines.length - 1] = clip(
      [...lines[lines.length - 1]!, { text: ` +${hidden}`, cls: 'dim' }],
      max + MARGIN.text,
    );
  }

  while (lines.length < rows) lines.push([]);
  return lines.slice(0, rows);
}

/**
 * Область деталей выбранной команды: точная реплика Марго, а под ней — предупре-
 * ждение `advance`. Высота постоянная, поэтому появление предпросмотра не двигает
 * ни список, ни полосу.
 *
 * Предпросмотр приглушён и в поток не попадает: после `Enter` та же реплика
 * придёт как часть сцены, обычным цветом Марго.
 *
 * Длинную реплику разрешено обрезать, пересказывать — нет: дословность головы
 * фразы и есть гарантия, ради которой предпросмотр существует, а многоточие
 * честно говорит, что дальше есть ещё.
 */
export function detailLines(
  preview: string | null,
  advance: boolean,
  max: number,
  rows: number,
): Seg[][] {
  const lines: Seg[][] = [];
  if (preview) {
    // Строку под предупреждение держим только тогда, когда оно будет.
    const room = Math.max(1, rows - (advance ? 1 : 0));
    const all = wrap(`Марго: ${preview}`, max);
    const shown = all.slice(0, room);
    if (all.length > room) shown[shown.length - 1] = ellipsis(shown[shown.length - 1]!, max);

    for (const line of shown) lines.push([{ text: pad() }, { text: line, cls: 'preview' }]);
  }
  if (advance) lines.push([{ text: pad() }, { text: ADVANCE_LEGEND, cls: 'dim' }]);

  while (lines.length < rows) lines.push([]);
  return lines.slice(0, rows);
}

/**
 * Полоса служебных действий: закреплена внизу и не зависит от ввода. Она часть
 * оболочки, а не содержимого комнаты, — поэтому не исчезает при переходе и не
 * фильтруется набором.
 *
 * `3 управление` стоит здесь ради обнаруживаемости, но командой не является:
 * метаинструкция не притворяется действием терминала.
 */
export function systemLine(commands: string[], max: number): Seg[] {
  const segs: Seg[] = [{ text: pad() }];
  for (const command of [...commands, 'управление']) {
    if (segs.length > 1) segs.push({ text: ' · ', cls: 'dim' });
    const key = command === 'управление' ? '3' : HOTKEY[command];
    if (key) segs.push({ text: `${key} `, cls: 'dim' });
    segs.push({ text: command, cls: 'system' });
  }
  return clip(segs, max + MARGIN.text);
}

export function inputLine(input: string): Seg[] {
  return [
    { text: hanging(), cls: 'dim' },
    { text: input },
    { text: ' ', cls: 'cursor' },
  ];
}

const TITLES: Record<OverlayCommand, string> = {
  справочник: 'СПРАВОЧНИК',
  дело: 'ДЕЛО',
  предметы: 'ПРЕДМЕТЫ',
};

export function overlayTitle(call: OverlayCall): string {
  return call.arg ? `${TITLES[call.kind]} · ${call.arg.toUpperCase()}` : TITLES[call.kind];
}

/** Аргумент команды сопоставляется свободно: игрок печатает строчными. */
function picked(arg: string | null, label: string): boolean {
  return arg == null || label.toLowerCase().startsWith(arg.toLowerCase());
}

export function overlayLines(
  call: OverlayCall,
  content: GameContent,
  save: SaveState,
  max: number,
): Seg[][] {
  const { kind, arg } = call;
  const out: Seg[][] = [];
  const push = (text: string, cls?: string) => {
    for (const line of wrap(text, max)) out.push([{ text: line, cls }]);
  };

  if (kind === 'дело') {
    const words = Object.entries(save.words).filter(([id]) => picked(arg, content.words[id]?.label ?? id));
    if (words.length === 0) return [[{ text: 'Дело пустое.', cls: 'dim' }]];
    for (const [id, state] of words) {
      const word = content.words[id];
      out.push(
        spread(
          [{ text: word?.label ?? id }],
          [{ text: state === 'white' ? '[белое]' : '[серое]', cls: state === 'white' ? 'dim' : 'locked' }],
          max,
        ),
      );
      push(word?.text ?? '', 'dim');
      out.push([]);
    }
    return out;
  }

  if (kind === 'предметы') {
    if (save.inventory.length === 0) return [[{ text: 'На руках ничего нет.', cls: 'dim' }]];
    for (const id of save.inventory) {
      const doc = Object.values(content.docs).find((d) => d.id === id);
      out.push([{ text: doc?.label ?? id }]);
      // Карточка показывает описание и не показывает список действий.
      push(doc?.nodes[0]?.text ?? '', 'dim');
      out.push([]);
    }
    return out;
  }

  const terms = Object.entries(content.reference).filter(([term]) => picked(arg, term));
  if (terms.length === 0) return [[{ text: 'Справочник пуст.', cls: 'dim' }]];
  const pad = Math.max(...terms.map(([term]) => term.length));
  for (const [term, line] of terms) {
    out.push([{ text: term.padEnd(pad) }, { text: '  ' }, { text: line, cls: 'dim' }]);
  }
  return out;
}
