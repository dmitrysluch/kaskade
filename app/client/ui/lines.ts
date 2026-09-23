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
import { itemActions, type CatalogOption } from '../engine/catalog.ts';
import type { OverlayCall, OverlayCommand, SessionEntity, StreamEntry, Term } from '../engine/state.ts';
import { days, daysBetween } from '../../shared/dates.ts';
import { speakerLabel, speakerOf } from '../../shared/speech.ts';
import { entityClass, plainText, type EntityKind, type EntityMention } from '../../shared/entities.ts';
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
/**
 * Колонка говорящего (07-оболочка-тз, «Метка говорящего и отдельная колонка»).
 *
 * Реплика — двухколоночная строка: имя в левой колонке, речь в правой. Это
 * транскрипт, а не проза с подписями: имя повторяется у каждой реплики, даже
 * когда человек говорит дважды подряд, и строка не зависит от соседней.
 *
 * Колонка **не является постоянным полем потока**: описание, текст комнаты,
 * цитата и системная строка занимают обе колонки и начинаются от обычного
 * левого края. Поэтому сцена без диалога не получает пустого отступа.
 */
export const SPEAKER_WIDTH = 12;

/** Промежуток между колонками. Тире оболочка не печатает — его заменяет колонка. */
const SPEAKER_GAP = 2;

/**
 * Уже колонки речи не остаётся: на телефоне двенадцать знаков под имя съедают
 * треть строки. Там та же структура показывается в строку — `МАРГО · текст`.
 */
const MIN_SPEECH = 34;

export function streamLines(entries: StreamEntry[], max: number, focus: EntityMention | null = null): Seg[][] {
  const out: Seg[][] = [];
  // Ширина сетки: `max` приходит уже без полей, а колонка имени считается от края.
  const cols = max + MARGIN.text + MARGIN.right;
  const inline = max - SPEAKER_WIDTH - SPEAKER_GAP < MIN_SPEECH;
  const textCol = MARGIN.text + SPEAKER_WIDTH + SPEAKER_GAP;

  for (const entry of entries) {
    if (out.length > 0) out.push([]);
    /*
     * Подсвечивается только размеченное автором (07-оболочка-тз, «Явно
     * размеченные сущности»), и ровно те вхождения, которые он разметил:
     * счётчик общий на всю запись, поэтому перенос строки не сбивает счёт.
     */
    const spans = entitySpans(entry, focus);
    const seen = new Map<string, number>();

    for (const source of entry.text.split('\n')) {
      // Эхо команды и карточки говорят не голосом персонажа — разметку к ним
      // не применяем: у них свой класс и свой цвет.
      const said = entry.kind === 'text' ? speakerOf(source) : { voice: entry.kind, name: null, text: source };
      const cls: string = said.voice;
      const label = said.name == null ? null : speakerLabel(said.name);

      // Обратные кавычки снимаются до переноса: иначе они займут колонки.
      const plain = codes(label != null && inline ? `${label} · ${said.text}` : said.text);
      const marks = entry.kind === 'text' ? [...plain.spans, ...spans] : [];

      // Реплика с колонкой: текст переносится по своей колонке, имя стоит
      // в первой строке и по правому краю — так оно примыкает к речи.
      if (label != null && !inline) {
        const width = Math.max(1, cols - textCol - MARGIN.right);
        wrap(plain.text, width).forEach((line, i) => {
          const gutter = i === 0 ? label.padStart(textCol - SPEAKER_GAP) : '';
          out.push([
            { text: gutter.padEnd(textCol), cls: 'remark' },
            ...mark(line, cls, marks, seen),
          ]);
        });
        continue;
      }

      // Эхо печатается с висящим промптом, как это делает терминал: прокрутка
      // назад выглядит как одна колонка с торчащими приглашениями.
      wrap(plain.text, max).forEach((line, i) => {
        const lead = entry.kind === 'echo' && i === 0 ? hanging() : pad();
        // В строчном режиме имя живёт только в первой строке — перенос его
        // не повторяет, продолжение идёт обычным отступом.
        const head = inline && label != null && i === 0 && line.startsWith(label);
        const segs =
          head ?
            [
              { text: label, cls: 'remark' },
              { text: ' · ', cls: 'dim' },
              ...mark(line.slice(label.length + 3), cls, marks, seen),
            ]
          : mark(line, cls, marks, seen);
        out.push([{ text: lead, cls: 'dim' }, ...segs]);
      });
    }
  }
  return out;
}

/**
 * Упоминания записи → подсветка. Одинаковые формы сливаются в один span:
 * искать одно и то же по строке дважды незачем, а номера вхождений при этом
 * складываются.
 *
 * `focus` — сущность, открытая в контекстной панели: её последнее упоминание
 * получает дополнительную пометку поверх обычной подсветки, чтобы глаз нашёл
 * в потоке именно то место, о котором сейчас читают.
 */
function entitySpans(entry: StreamEntry, focus: EntityMention | null): Span[] {
  const byText = new Map<string, Span>();
  for (const mention of entry.mentions ?? []) {
    const focused =
      focus != null &&
      focus.kind === mention.kind &&
      focus.id === mention.id &&
      focus.label === mention.label &&
      focus.nth === mention.nth;
    const key = `${mention.label}\u0000${focused ? 'focus' : ''}`;
    const span = byText.get(key) ?? {
      text: mention.label,
      cls: focused ? `${entityClass(mention.kind)} focus` : entityClass(mention.kind),
      nth: new Set<number>(),
    };
    span.nth!.add(mention.nth);
    byText.set(key, span);
  }
  return [...byText.values()];
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
/*
 * Клавиша рядом с командой в служебной полосе (07-оболочка-тз, «Клавиши»).
 *
 * У `1`, `2` и `3` смысл с командой не совпадает: команда открывает полное
 * хранилище, а клавиша — контекстную панель по одной сущности. Подписаны они
 * всё равно рядом, потому что ищут их вместе и об одном и том же; разницу
 * игрок видит в первую же секунду после нажатия.
 */
const HOTKEY: Partial<Record<string, string>> = {
  справочник: '1',
  дело: '2',
  инвентарь: '3',
  меню: '0',
};

/** Экран управления командой не является и живёт на своей клавише. */
const MANUAL_HINT = '?';

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
    const key = command === 'управление' ? MANUAL_HINT : HOTKEY[command];
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
  инвентарь: 'ИНВЕНТАРЬ',
};

export function overlayTitle(call: OverlayCall): string {
  return TITLES[call.kind];
}

/**
 * Контекстная панель по `1`, `2`, `3` (07-оболочка-тз, «Контекстная панель»).
 *
 * Хоткей не исполняет одноимённую команду и не открывает хранилище: он показывает
 * **одну** сущность — ту, о которой игрок сейчас читает. Полный список нужен
 * редко и по делу, а «что это было только что» — постоянно, и ради этого
 * вываливать на человека двадцать аббревиатур значит отвечать не на тот вопрос.
 *
 * Панель занимает нижнюю область целиком и ровно те же строки, что список команд:
 * сетка от неё не должна шевелиться.
 */
const PANEL: Record<EntityKind, { title: string; empty: string; command: string }> = {
  reference: { title: 'справочник', empty: 'термины справочника', command: 'справочник' },
  word: { title: 'дело', empty: 'слова дела', command: 'дело' },
};

const CLOSE_HINT = 'Esc закрыть';
const SWITCH_HINT = '← → другие';

/** Что показывает панель: статья, карточка слова с происхождением, вступление предмета. */
function entityCard(kind: EntityKind, id: string, content: GameContent, save: SaveState): Seg[][] {
  const out: Seg[][] = [];
  if (kind === 'reference') {
    const term = content.reference[id];
    if (!term) return [[]];
    out.push([{ text: term.label }, { text: '  ' }, { text: term.category, cls: 'dim' }]);
    out.push([]);
    out.push([{ text: plainText(term.text), cls: 'dim' }]);
    return out;
  }
  if (kind === 'word') {
    const word = content.words[id];
    const state = save.words[id];
    out.push([
      { text: word?.label ?? id },
      { text: '  ' },
      { text: word?.category ?? '', cls: 'dim' },
      { text: '  ' },
      { text: state === 'white' ? '[белое]' : '[серое]', cls: state === 'white' ? 'dim' : 'locked' },
    ]);
    out.push([]);
    out.push([{ text: plainText(word?.text ?? ''), cls: 'dim' }]);
    return out;
  }
  return out;
}

/**
 * Компактный инвентарь по `3` (07-оболочка-тз, «Компактный инвентарь по `3`»).
 *
 * Предметы не знание: они не размечаются в тексте, не попадают в сессионную
 * историю и поток не прокручивают. Поэтому и панель у них своя — не «где я это
 * встречал», а «что у меня сейчас с собой».
 *
 * Показывает одну вещь: карточку и то, что вещь умеет. Умения показаны, но
 * отсюда не исполняются — сделать ими что-то можно на полном экране `инвентарь`
 * или командой, которую объявила сцена. Панель отвечает на вопрос «что у меня
 * есть», а не заменяет собой список действий.
 */
export function inventoryLines(
  content: GameContent,
  save: SaveState,
  index: number,
  cols: number,
  rows: number,
): Seg[][] {
  const max = Math.max(1, cols - MARGIN.text - MARGIN.right);
  const body: Seg[][] = [];
  const items = save.inventory;

  if (items.length === 0) {
    for (const line of wrap('На руках сейчас ничего нет.', max)) body.push([{ text: line, cls: 'dim' }]);
    body.push([]);
    body.push(
      spread([{ text: 'Полный список: «инвентарь».', cls: 'dim' }], [{ text: CLOSE_HINT, cls: 'dim' }], max),
    );
    return frame(body, [], rows);
  }

  const at = Math.min(Math.max(index, 0), items.length - 1);
  const id = items[at]!;
  const doc = Object.values(content.docs).find((d) => d.id === id);

  body.push(
    spread(
      [{ text: doc?.label ?? id }],
      items.length > 1 ? [{ text: `${at + 1}/${items.length}`, cls: 'dim' }] : [],
      max,
    ),
  );
  body.push([]);
  for (const line of wrap(plainText(doc?.nodes[0]?.text ?? ''), max)) body.push([{ text: line, cls: 'dim' }]);

  const actions = doc ? itemActions(content, save, doc.docId) : [];
  if (actions.length > 0) {
    body.push([]);
    for (const action of actions) body.push([{ text: action.label, cls: 'environment' }]);
  }

  const hints = spread(
    items.length > 1 ? [{ text: SWITCH_HINT, cls: 'dim' }] : [],
    [{ text: CLOSE_HINT, cls: 'dim' }],
    max,
  );
  return frame(body, hints, rows);
}

/**
 * Панель занимает ровно отведённые строки: подсказка прижата к низу, между ней
 * и текстом — воздух. Сетка от открытия панели шевелиться не должна.
 */
function frame(body: Seg[][], hints: Seg[], rows: number): Seg[][] {
  const shown = body.slice(0, Math.max(0, rows - 2));
  const filler = Math.max(0, rows - 1 - shown.length);
  return [
    ...shown.map((line) => [{ text: pad() }, ...line]),
    ...Array.from({ length: filler }, () => [] as Seg[]),
    [{ text: pad() }, ...hints],
  ];
}

export function contextLines(
  kind: EntityKind,
  entities: SessionEntity[],
  index: number,
  content: GameContent,
  save: SaveState,
  cols: number,
  rows: number,
): Seg[][] {
  const max = Math.max(1, cols - MARGIN.text - MARGIN.right);
  const body: Seg[][] = [];
  const names = PANEL[kind];

  if (entities.length === 0) {
    // Пустая история — не пустая панель: игроку говорят, где искать полный список.
    for (const line of wrap(`В этой сессии ещё не встречались ${names.empty}.`, max)) {
      body.push([{ text: line, cls: 'dim' }]);
    }
    body.push([]);
    body.push(spread([{ text: `Полный список: «${names.command}».`, cls: 'dim' }], [{ text: CLOSE_HINT, cls: 'dim' }], max));
  } else {
    const current = entities[Math.min(Math.max(index, 0), entities.length - 1)]!;
    body.push(
      spread(
        [{ text: names.title, cls: 'dim' }],
        entities.length > 1 ? [{ text: `${index + 1}/${entities.length}`, cls: 'dim' }] : [],
        max,
      ),
    );
    body.push([]);
    // Карточка приходит сегментами, но длинный текст всё равно надо переносить.
    for (const line of entityCard(kind, current.id, content, save)) {
      const plain = line.map((seg) => seg.text).join('');
      if (line.length === 1 && plain.length > max) {
        for (const wrapped of wrap(plain, max)) body.push([{ text: wrapped, cls: line[0]!.cls }]);
      } else {
        body.push(line);
      }
    }
  }

  const hints = spread(
    entities.length > 1 ? [{ text: SWITCH_HINT, cls: 'dim' }] : [],
    entities.length === 0 ? [] : [{ text: CLOSE_HINT, cls: 'dim' }],
    max,
  );
  return frame(body, hints, rows);
}

/**
 * Что сейчас выбрано в хранилище вещей: сама вещь и, если её открыли, её действие.
 * Живёт в оболочке, а не в сессии: это положение курсора, а не состояние мира.
 */
export interface StoragePick {
  pick: number;
  open: string | null;
  act: number;
}

/**
 * Экран `предметы` ([[99-открытые-вопросы]], «Глаголы и состояния предметов»).
 *
 * Сначала вещи, потом — действия выбранной. Собственные действия предмета живут
 * здесь, а не в списке команд: иначе с ростом инвентаря они вытеснят из него то,
 * ради чего сцена написана. Предмет достают, когда о нём вспомнили, и это
 * отдельный жест — ровно как в жизни лезут в карман.
 */
function storageLines(
  content: GameContent,
  save: SaveState,
  max: number,
  storage: StoragePick | null,
): Seg[][] {
  const out: Seg[][] = [];
  const wrapped = (text: string, cls?: string) => {
    for (const line of wrap(text, max - MARGIN.text)) out.push([{ text: pad() }, { text: line, cls }]);
  };

  if (save.inventory.length === 0) return [[{ text: 'На руках ничего нет.', cls: 'dim' }]];

  const items = save.inventory.map((id) => ({ id, doc: Object.values(content.docs).find((d) => d.id === id) }));
  const at = Math.min(Math.max(storage?.pick ?? 0, 0), items.length - 1);
  const opened = storage?.open ?? null;

  if (opened == null) {
    items.forEach((item, i) => {
      const picked = i === at;
      out.push([
        { text: picked ? hanging(PICK_MARK) : pad(), cls: picked ? 'accent' : undefined },
        { text: item.doc?.label ?? item.id, cls: picked ? undefined : 'dim' },
      ]);
    });
    out.push([]);
    // Описание — только у выбранной вещи: список должен читаться списком.
    wrapped(plainText(items[at]?.doc?.nodes[0]?.text ?? ''), 'dim');
    return out;
  }

  const doc = content.docs[opened];
  out.push([{ text: pad() }, { text: doc?.label ?? opened }]);
  out.push([]);
  wrapped(plainText(doc?.nodes[0]?.text ?? ''), 'dim');
  out.push([]);

  const actions = itemActions(content, save, opened);
  if (actions.length === 0) {
    wrapped('С ней сейчас ничего не сделать.', 'dim');
    return out;
  }
  const act = Math.min(Math.max(storage?.act ?? 0, 0), actions.length - 1);
  actions.forEach((action, i) => {
    const picked = i === act;
    out.push([
      { text: picked ? hanging(PICK_MARK) : pad(), cls: picked ? 'accent' : undefined },
      { text: action.label, cls: picked ? 'environment' : 'dim' },
    ]);
  });
  return out;
}

export function overlayLines(
  call: OverlayCall,
  content: GameContent,
  save: SaveState,
  max: number,
  storage: StoragePick | null = null,
): Seg[][] {
  const { kind } = call;
  const out: Seg[][] = [];
  const push = (text: string, cls?: string) => {
    for (const line of wrap(text, max)) out.push([{ text: line, cls }]);
  };

  if (kind === 'дело') {
    const words = Object.entries(save.words);
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
      push(plainText(word?.text ?? ''), 'dim');
      out.push([]);
    }
    return out;
  }

  if (kind === 'инвентарь') {
    return storageLines(content, save, max, storage);
  }

  /*
   * Справочник — список статей, отсортированный по категориям: двадцать
   * аббревиатур подряд читаются хуже, чем те же двадцать, разложенные
   * на «физика», «места», «порядок». Сортировка — единственное, ради чего
   * категория существует.
   */
  const terms = Object.values(content.reference)
    .sort((a, b) => a.category.localeCompare(b.category) || a.label.localeCompare(b.label));
  if (terms.length === 0) return [[{ text: 'Справочник пуст.', cls: 'dim' }]];

  const width = Math.max(...terms.map((term) => term.label.length));
  let category: string | null = null;
  for (const term of terms) {
    if (term.category !== category) {
      if (category != null) out.push([]);
      category = term.category;
      out.push([{ text: category, cls: 'dim' }]);
    }
    // Статья длиннее строки переносится с отступом под название: список должен
    // читаться колонкой, а не сползать в абзац.
    const lines = wrap(plainText(term.text), Math.max(1, max - width - 2));
    lines.forEach((line, i) => {
      out.push([
        { text: (i === 0 ? term.label : '').padEnd(width) },
        { text: '  ' },
        { text: line, cls: 'dim' },
      ]);
    });
  }
  return out;
}
