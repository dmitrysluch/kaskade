import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clip, ellipsis, highlight, spread, width, wrap } from '../app/client/ui/text.ts';
import {
  commandLines,
  detailLines,
  portraitLines,
  statusText,
  streamLines,
  systemLine,
  viewport,
} from '../app/client/ui/lines.ts';
import { days, daysBetween, parseDate } from '../app/shared/dates.ts';
import { fit } from '../app/client/ui/metrics.ts';
import { MARGIN } from '../app/client/ui/text.ts';
import { attrs } from './helpers.ts';
import { SYSTEM_COMMANDS, type CatalogOption } from '../app/client/engine/catalog.ts';

/**
 * Раскладка экрана: каждая строка обязана быть ровно той ширины, которую ей отвели,
 * иначе символьная рамка разъедется. Проверяем именно это, а не «красиво ли».
 */

function opt(label: string, locked = false): CatalogOption {
  return { label, kind: 'story', target: null, attrs: attrs(), verb: null, object: null, moves: false, locked, system: null };
}

test('перенос идёт по словам и держится в ширине', () => {
  const lines = wrap('Аудитория на сорок мест, занято одиннадцать.', 20);
  assert.ok(lines.every((l) => l.length <= 20));
  assert.equal(lines.join(' '), 'Аудитория на сорок мест, занято одиннадцать.');
});

test('пустая строка между абзацами сохраняется', () => {
  assert.deepEqual(wrap('первый\n\nвторой', 20), ['первый', '', 'второй']);
});

test('слово длиннее колонки рвётся, а не вылезает за рамку', () => {
  const lines = wrap('BAYN-OPV-63991-и-так-далее', 8);
  assert.ok(lines.every((l) => l.length <= 8));
});

test('обрезка режет по знакам, а не по сегментам', () => {
  const cut = clip([{ text: 'спросить' }, { text: ' о ' }, { text: 'партии' }], 10);
  assert.equal(width(cut), 10);
  assert.equal(cut.map((s) => s.text).join(''), 'спросить о');
});

test('набранное подсвечивается в любом слове опции', () => {
  const segs = highlight('спросить о партии', 'парт');
  const hit = segs.filter((s) => s.cls === 'hit');
  assert.deepEqual(
    hit.map((s) => s.text),
    ['парт'],
  );
  assert.equal(segs.map((s) => s.text).join(''), 'спросить о партии');
});

test('без ввода не подсвечивается ничего', () => {
  assert.deepEqual(highlight('идти коридор', '   '), [{ text: 'идти коридор' }]);
});

test('узкий экран не ломает раскладку: строка всё равно по ширине', () => {
  const line = spread([{ text: 'очень длинные глаголы' }], [{ text: 'и хоткеи' }], 12);
  assert.equal(width(line), 12);
});

// IBM Plex Mono: знак примерно 0,6 кегля, строка 1,35.
const FONT = { cellRatio: 0.6, lineRatio: 1.35 };

test('сетка заполняет окно: незанятого края не остаётся', () => {
  for (const availW of [640, 900, 1280, 1440]) {
    const m = fit({ availW, availH: 900, rows: 34, ...FONT });
    const cell = m.size * FONT.cellRatio;
    const used = m.cols * cell;
    assert.ok(used <= availW + 1e-6, `кадр шире окна: ${used} > ${availW}`);
    assert.ok(availW - used < cell, `остался незанятый край: ${availW - used}px`);
  }
});

test('строк выходит примерно столько, сколько заказано', () => {
  // Ровно столько не выйдет: ширина знака округляется до пикселя, и кегль вместе
  // с ней прыгает шагом. Заказ — намерение, а не обещание до строки.
  for (const rows of [24, 34, 48]) {
    const m = fit({ availW: 1440, availH: 900, rows, ...FONT });
    assert.ok(Math.abs(m.rows - rows) <= 2, `заказано ${rows}, вышло ${m.rows}`);
  }
});

test('знак шириной в целое число пикселей: иначе рейки рамки едут по строкам', () => {
  // Строка собрана из нескольких span: ширина каждого округляется отдельно,
  // и дробный знак копит остаток по-разному в разных строках.
  for (const availH of [640, 780, 900, 1200]) {
    const m = fit({ availW: 1440, availH, rows: 34, ...FONT });
    const cell = m.size * FONT.cellRatio;
    assert.ok(Math.abs(cell - Math.round(cell)) < 1e-9, `знак шириной ${cell}px`);
  }
});

test('клетки стыкуются: высота строки — ровно кегль на множитель', () => {
  // `line: 1` значит «клетки стыкаются»: полублоки портрета не разъезжаются
  // на полоски, вертикальные рейки идут сплошной линией.
  const m = fit({ availW: 1440, availH: 900, rows: 34, cellRatio: 0.6, lineRatio: 1 });
  assert.equal(m.line, m.size);
});

test('высота задаёт кегль, а ширина следует за ним', () => {
  // Единственная настройка — число строк. Меньше строк: буквы крупнее, и в ту же
  // ширину их влезает меньше — строка текста становится короче сама собой.
  const few = fit({ availW: 1440, availH: 900, rows: 24, ...FONT });
  const many = fit({ availW: 1440, availH: 900, rows: 48, ...FONT });

  assert.ok(few.size > many.size, 'меньше строк — а буквы не крупнее');
  assert.ok(few.cols < many.cols, 'крупнее буквы — а колонок не меньше');
});

test('шире окно — больше колонок, а кегль на месте', () => {
  const laptop = fit({ availW: 1280, availH: 900, rows: 34, ...FONT });
  const wide = fit({ availW: 1900, availH: 900, rows: 34, ...FONT });

  assert.equal(wide.size, laptop.size);
  assert.ok(wide.cols > laptop.cols);
});

test('кегль упирается в потолок и в пол, раскладка не рассыпается', () => {
  const huge = fit({ availW: 3200, availH: 2400, rows: 34, ...FONT });
  assert.equal(huge.size, 30);
  assert.ok(huge.rows > 34, 'кегль упёрся в потолок — строк должно стать больше');

  // Совсем низкое окно: мельче десяти пикселей букв не бывает, поэтому строк
  // остаётся меньше заказанного. Раскладке при этом должно хватать.
  const low = fit({ availW: 1440, availH: 200, rows: 34, ...FONT });
  assert.equal(low.size, 10);
  assert.ok(low.rows >= 12, `в окно влезло только ${low.rows} строк`);
});

test('узкое окно сужает сетку, но не ниже минимума', () => {
  const narrow = fit({ availW: 320, availH: 900, rows: 34, ...FONT });
  assert.ok(narrow.cols >= 40, `сетка ужалась до ${narrow.cols} колонок`);
});

test('портрет паруется в полублоки, и прозрачные половины остаются пустыми', () => {
  const lines = portraitLines({
    grid: ['hs', 'co', 'oo', 'so'],
    colors: { h: '#eb564b', s: '#ffb570', c: '#272736' },
    width: 2,
    height: 4,
  });

  // Четыре ряда пикселей — две строки клеток.
  assert.equal(lines.length, 2);
  assert.equal(lines[0]!.length, 2);

  // Обе половины закрашены: верх — цветом текста, низ — цветом фона.
  assert.deepEqual(lines[0]![0], { text: '▀', color: '#eb564b', bg: '#272736' });
  // Низ прозрачный — фон не назначается вовсе, сквозь него виден фон терминала.
  assert.deepEqual(lines[0]![1], { text: '▀', color: '#ffb570' });
  // Верх прозрачный — знак переворачивается, иначе он взял бы цвет текста
  // и половина клетки оказалась бы закрашенной ни с того ни с сего.
  assert.deepEqual(lines[1]![0], { text: '▄', color: '#ffb570' });
  // Обе половины пустые — просто пробел.
  assert.deepEqual(lines[1]![1], { text: ' ' });
});

test('пока текст помещается, он пишется сверху', () => {
  const lines = [[{ text: 'а' }], [{ text: 'б' }]];
  const view = viewport(lines, 5, 0);

  // Сцена читается как страница, которая заполняется, а не как лента,
  // ползущая вверх от пустого места.
  assert.equal(view.length, 5);
  assert.equal(view[0]![0]!.text, 'а');
  assert.equal(view[1]![0]!.text, 'б');
  assert.deepEqual(view.slice(2), [[], [], []]);
});

test('переполнилось — окно едет за концом, свежий текст рядом с вводом', () => {
  const lines = Array.from({ length: 7 }, (_, i) => [{ text: `строка-${i}` }]);
  assert.deepEqual(
    viewport(lines, 3, 0).map((l) => l[0]?.text),
    ['строка-4', 'строка-5', 'строка-6'],
  );
});

test('прокрутка отсчитывается от низа и сама зажимается по краям', () => {
  const lines = Array.from({ length: 10 }, (_, i) => [{ text: `строка-${i}` }]);

  const bottom = viewport(lines, 4, 0).map((l) => l[0]?.text);
  assert.deepEqual(bottom, ['строка-6', 'строка-7', 'строка-8', 'строка-9']);

  const up = viewport(lines, 4, 3).map((l) => l[0]?.text);
  assert.deepEqual(up, ['строка-3', 'строка-4', 'строка-5', 'строка-6']);

  // Выше начала потока и ниже его конца уехать нельзя, сколько ни жми.
  assert.deepEqual(viewport(lines, 4, 999).map((l) => l[0]?.text), ['строка-0', 'строка-1', 'строка-2', 'строка-3']);
  assert.deepEqual(viewport(lines, 4, -5).map((l) => l[0]?.text), bottom);
});

test('поток режется по ширине колонки и разделяет реплики пустой строкой', () => {
  const lines = streamLines(
    [
      { kind: 'text', text: 'Первая реплика.' },
      { kind: 'echo', text: 'взять телефон' },
    ],
    20,
  );

  assert.ok(lines.every((l) => width(l) <= 20 + MARGIN.text));
  assert.deepEqual(lines[1], []);
  // Между раундами стоит тонкая черта, под ней — сама команда.
  assert.equal(lines[2]![1]!.cls, 'round');
  assert.equal(lines[3]![1]!.cls, 'echo');
});

test('четыре голоса разведены классами: собеседник, Марго, цитата, ремарка', () => {
  const lines = streamLines(
    [
      {
        kind: 'text',
        text:
          '> алерс — Знаю.\n> марго — Нет. Осколки деления распадаются сами.\n' +
          '> «Единственный случай в истории».\nОн не поднимает головы.',
      },
    ],
    60,
  );

  // Речь идёт колонкой: первый сегмент — имя, второй — сама реплика.
  assert.equal(lines[0]![0]!.text.trim(), 'АЛЕРС');
  assert.equal(lines[0]![0]!.cls, 'remark');
  assert.equal(lines[0]![1]!.cls, 'speech');
  assert.equal(lines[0]![1]!.text, 'Знаю.');

  assert.equal(lines[1]![0]!.text.trim(), 'МАРГО');
  assert.equal(lines[1]![1]!.cls, 'margo');
  assert.equal(lines[1]![1]!.text, 'Нет. Осколки деления распадаются сами.');

  // Цитата — `>` без метки: человека за ней нет, колонки говорящего тоже.
  assert.equal(lines[2]![1]!.cls, 'quote');
  assert.equal(lines[2]![1]!.text, '«Единственный случай в истории».');
  assert.equal(lines[2]![0]!.text, ' '.repeat(MARGIN.text));

  assert.equal(lines[3]![1]!.cls, 'remark');
  assert.equal(lines[3]![1]!.text, 'Он не поднимает головы.');
});

test('на узкой сетке та же структура идёт строкой, а не колонкой', () => {
  const [line] = streamLines([{ kind: 'text', text: '> марго — Нет.' }], 32);

  assert.equal(line![1]!.text, 'МАРГО');
  assert.equal(line![2]!.text, ' · ');
  assert.equal(line![3]!.text, 'Нет.');
});

test('реплика не путается с эхом команды', () => {
  const lines = streamLines(
    [
      { kind: 'text', text: '> алерс — Да. Всё верно.\nОн не спорит.' },
      { kind: 'echo', text: 'взять телефон' },
    ],
    40,
  );

  // Сетка узкая: та же структура идёт строкой — имя, точка, речь.
  assert.equal(lines[0]!.map((seg) => seg.text).join('').trim(), 'АЛЕРС · Да. Всё верно.');
  assert.ok((lines[0]!.at(-1)!.cls ?? '').includes('speech'));
  assert.equal(lines[1]![1]!.text, 'Он не спорит.');

  // Эхо печатается с висящим промптом: `>` стоит в поле, команда — под текстом.
  const echo = lines.findIndex((l) => l.some((seg) => seg.cls === 'echo'));
  assert.equal(lines[echo]![0]!.text.indexOf('>'), MARGIN.prompt);
  assert.equal(lines[echo]![1]!.text, 'взять телефон');
});

test('срок в статусе склоняется по-русски и считается от даты заметки', () => {
  assert.equal(days(1), '1 день');
  assert.equal(days(2), '2 дня');
  assert.equal(days(5), '5 дней');
  assert.equal(days(11), '11 дней');
  assert.equal(days(111), '111 дней');
  assert.equal(days(233), '233 дня');
  // Срок может и пройти: показываем как есть, а не выдумываем «просрочено».
  assert.equal(days(-3), '-3 дня');

  assert.equal(daysBetween('12.05.2026', '31.12.2026'), 233);
  assert.equal(daysBetween('31.12.2026', '12.05.2026'), -233);
  // Февраль тридцать первого не бывает — такая дата не разбирается вовсе.
  assert.equal(parseDate('31.02.2026'), null);
  assert.equal(parseDate('2026-05-12'), null);
});

test('статус: дата, потом сроки, и ни слова, если даты нет', () => {
  const terms = [{ name: 'blueCard', label: 'BLUE CARD', at: '31.12.2026', expired: 'истекла' }];
  assert.equal(statusText('12.05.2026', terms), '12.05.2026 · BLUE CARD 233 дня');
  assert.equal(statusText('12.05.2026', []), '12.05.2026');
  assert.equal(statusText(null, terms), '');
  // Сломанная дата срока молчит: соврать в статусе хуже, чем промолчать.
  assert.equal(statusText('12.05.2026', [{ name: 'x', label: 'X', at: 'скоро', expired: 'истёк' }]), '12.05.2026');
});

test('разметка означает механику: размеченное автором и коды, и ничего сверх', () => {
  const lines = streamLines(
    [
      {
        kind: 'text',
        text: 'Он читает `H 1012` и говорит про контейнмент вслух.',
        mentions: [{ kind: 'word', id: 'containment', label: 'контейнмент', nth: 0 }],
      },
    ],
    60,
  );
  const segs = lines[0]!;
  const text = segs.map((s) => s.text).join('');

  // Обратные кавычки сняты: колонок они не занимают.
  assert.ok(!text.includes('`'), `кавычки остались: ${text}`);
  assert.equal(segs.find((s) => s.cls === 'code')?.text, 'H 1012');
  assert.equal(segs.find((s) => s.cls === 'word')?.text, 'контейнмент');
});

test('подсвечено ровно то вхождение, которое размечено', () => {
  // Разметка стоит на втором «дело»; первое — обычное слово в предложении.
  const [line] = streamLines(
    [
      {
        kind: 'text',
        text: 'Дело житейское. Дело о делопроизводстве.',
        mentions: [{ kind: 'word', id: 'delo', label: 'Дело', nth: 1 }],
      },
    ],
    60,
  );
  const marked = line!.filter((s) => s.cls === 'word');
  assert.deepEqual(marked.map((s) => s.text), ['Дело']);
  // Именно второе: до него в строке уже прошло одно неразмеченное.
  const before = line!.slice(0, line!.indexOf(marked[0]!)).map((s) => s.text).join('');
  assert.equal(before.includes('житейское'), true);

  // Без разметки не подсвечивается ничего: совпадение текста ничего не значит.
  const [none] = streamLines([{ kind: 'text', text: 'Дело о делопроизводстве.' }], 60);
  assert.equal(none!.some((s) => s.cls === 'word'), false);
});

test('выдача слова видна в потоке: первая с хоткеем, дальше без', () => {
  const lines = streamLines(
    [
      { kind: 'grant', text: 'КОНТЕЙНМЕНТ — в деле, 2' },
      { kind: 'grant', text: 'BLUE CARD — в деле' },
    ],
    60,
  );
  assert.equal(lines[0]![1]!.cls, 'grant');
  assert.match(lines[0]!.map((s) => s.text).join(''), /КОНТЕЙНМЕНТ — в деле, 2/);
  assert.equal(lines[2]!.map((s) => s.text).join('').includes(', 2'), false);
});

test('прошедший срок показывается словом, а не минусом', () => {
  const term = { name: 'blueCard', label: 'BLUE CARD', at: '31.12.2026', expired: 'истекла' };
  assert.equal(statusText('01.01.2029', [term]), '01.01.2029 · BLUE CARD истекла');
  assert.equal(statusText('31.12.2026', [term]), '31.12.2026 · BLUE CARD 0 дней');
  assert.equal(statusText('30.12.2026', [term]), '30.12.2026 · BLUE CARD 1 день');
});


test('список вертикальный: по команде на строку, маркер в своей колонке', () => {
  const look = opt('осмотреть учебник');
  look.kind = 'environment';
  const talk = opt('поговорить с Тоби');
  const leave = opt('идти на лекцию');
  leave.attrs.advance = true;

  const lines = commandLines([look, talk, leave], 1, '', 60, 7);
  const text = lines.map((l) => l.map((s) => s.text).join('').trimEnd());

  // Порядок плотный: окружение, сюжет, advance — без пустых разделителей.
  // Команды стоят на той же колонке, что набранное и повествование, а маркер
  // висит в поле — как промпт.
  assert.equal(text[0], `${' '.repeat(MARGIN.text)}осмотреть учебник`);
  assert.equal(text[1], `${' '.repeat(MARGIN.prompt)}›${' '.repeat(MARGIN.text - MARGIN.prompt - 1)}поговорить с Тоби`);
  assert.equal(text[2], `${' '.repeat(MARGIN.text)}▶ идти на лекцию`);
  assert.equal(text[3], '', 'свободное место остаётся под списком');
  assert.equal(lines.length, 7);

  // Маркер — не часть команды: в метке его нет.
  assert.equal(talk.label, 'поговорить с Тоби');
});

test('без выбора маркера нет ни у кого', () => {
  const lines = commandLines([opt('а'), opt('б')], null, '', 60, 3);
  assert.equal(lines.map((l) => l.map((s) => s.text).join('')).some((l) => l.includes('›')), false);
});

test('вариантов больше, чем строк: окно едет за выбором', () => {
  const many = Array.from({ length: 12 }, (_, i) => opt(`вариант-${i}`));
  const text = (pick: number) =>
    commandLines(many, pick, '', 60, 4).map((l) => l.map((s) => s.text).join('').trim());

  assert.ok(text(0).includes('› вариант-0'));
  const far = text(11);
  assert.ok(far.some((l) => l.startsWith('› вариант-11')), `выбранного не видно: ${far.join(' | ')}`);
  assert.equal(far.length, 4, 'высота списка не меняется');
});

test('детали показывают реплику Марго целиком, а предупреждение — под ней', () => {
  const rows = 3;
  const plain = detailLines('— Нет. Осколки деления распадаются сами.', false, 60, rows);
  assert.equal(plain.length, rows);
  assert.equal(
    plain[0]!.map((s) => s.text).join('').trim(),
    'Марго: — Нет. Осколки деления распадаются сами.',
  );
  assert.equal(plain[1]!.length, 0);

  // У advance-команды предупреждение идёт следом, в той же области.
  const warned = detailLines('— Ладно.', true, 60, rows);
  assert.match(warned[1]!.map((s) => s.text).join(''), /нельзя вернуться/);

  // Без реплики область пустая, но высоту держит.
  assert.equal(detailLines(null, false, 60, rows).length, rows);
  assert.equal(detailLines(null, false, 60, rows).every((l) => l.length === 0), true);
});

test('длинную реплику обрезает многоточие, а не пересказ', () => {
  const long =
    '— Оболочка рассчитана на проектную аварию — аварию, условия которой перечислены ' +
    'в проекте. Авария, условия которой в проекте не перечислены, называется запроектной.';
  const shown = detailLines(long, false, 40, 2);
  const text = shown.map((l) => l.map((s) => s.text).join('').trim());

  // Голова фразы дословна: это и есть гарантия, ради которой предпросмотр живёт.
  assert.equal(text[0], 'Марго: — Оболочка рассчитана на');
  assert.match(text[1]!, /…$/, 'обрезка молчит о том, что дальше есть ещё');

  // Показанное — начало реплики слово в слово; последнее могло лишиться точки,
  // прилипшей к многоточию.
  const shownWords = text.join(' ').replace('Марго: ', '').replace(/…$/, '').trim().split(/\s+/);
  const said = long.split(/\s+/);
  assert.deepEqual(shownWords.slice(0, -1), said.slice(0, shownWords.length - 1));
  assert.ok(said[shownWords.length - 1]!.startsWith(shownWords.at(-1)!));

  // Ширина колонки не превышена ни на знак: многоточие — часть строки.
  for (const line of shown) assert.ok(line.map((s) => s.text).join('').length <= 40 + MARGIN.text);

  // Короткая реплика многоточия не получает.
  assert.equal(
    detailLines('— Ладно.', false, 40, 2)[0]!.map((s) => s.text).join('').includes('…'),
    false,
  );

  // Предупреждение advance отнимает строку, и обрезка это учитывает.
  const warned = detailLines(long, true, 40, 2).map((l) => l.map((s) => s.text).join('').trim());
  assert.match(warned[0]!, /…$/);
  assert.match(warned[1]!, /нельзя вернуться/);
});

test('многоточие режет по границе слова и влезает в колонку', () => {
  assert.equal(ellipsis('— Оболочка рассчитана на проектную', 40), '— Оболочка рассчитана на проектную…');
  // Не влезает — уходит последнее слово целиком, а не его половина.
  assert.equal(ellipsis('— Оболочка рассчитана на проектную', 34), '— Оболочка рассчитана на…');
  // Одно длинное слово рвать приходится: пустой строки в деталях быть не должно.
  assert.equal(ellipsis('BAYNOPV63991', 6), 'BAYNO…');
  assert.equal(ellipsis('BAYNOPV63991', 6).length, 6);

  // Точка, прилипшая к многоточию, уходит: слов это не меняет, вида — очень.
  assert.equal(ellipsis('Всё перечислено в проекте.', 40), 'Всё перечислено в проекте…');
});

test('служебная полоса закреплена и не зависит от ввода', () => {
  const line = systemLine(SYSTEM_COMMANDS, 80);
  const text = line.map((s) => s.text).join('').trim();

  assert.equal(text, '1 справочник · 2 дело · 3 инвентарь · 0 меню · ? управление');
  // Все служебные — своим цветом.
  assert.equal(line.filter((s) => s.cls === 'system').length, 5);

  // Полоса не ломает сетку и на узком экране: лишнее режется, а не переносится.
  assert.equal(systemLine(SYSTEM_COMMANDS, 30).map((s) => s.text).join('').length, 30 + MARGIN.text);
});

test('названный собеседник: имя в своей колонке и своим цветом', () => {
  const lines = streamLines([{ kind: 'text', text: '> тоби — Маннитол.' }], 72);
  const segs = lines[0]!;

  // Имя пишут строчными, показывают прописными: это служебная метка, и
  // капитализацию решает оболочка, а не автор. Тире оболочка не печатает —
  // границу между именем и речью держит колонка.
  assert.equal(segs[0]!.text.trim(), 'ТОБИ');
  assert.equal(segs[0]!.cls, 'remark');
  assert.equal(segs[1]!.text, 'Маннитол.');
  assert.equal(segs[1]!.cls, 'speech');
  assert.equal(segs.map((s) => s.text).join('').includes('—'), false);
});

test('имя стоит в первой строке, а перенос идёт по колонке речи', () => {
  const lines = streamLines([{ kind: 'text', text: '> тоби — Он тоже не будет. Драка без заявителей — дальше не идёт.' }], 48);

  assert.equal(lines[0]![0]!.text.trim(), 'ТОБИ');
  // Вторая строка — продолжение реплики: имя не повторяется, но колонка держится.
  assert.equal(lines[1]![0]!.text.trim(), '');
  assert.equal(lines[1]![0]!.text.length, lines[0]![0]!.text.length);
  // Тире внутри фразы границей имени не стало.
  const text = lines.map((l) => l.map((s) => s.text).join('')).join(' ');
  assert.ok(text.includes('заявителей — дальше'), 'тире внутри фразы съедено');
});

test('короткое экранное имя из эпизода встаёт в колонку вместо длинной метки', () => {
  // Метка в тексте остаётся человеческой: её читает автор, а не игрок.
  const [line] = streamLines(
    [{ kind: 'text', text: '> полицейский — Пакетики ваши?' }],
    48,
    null,
    { полицейский: 'полиц.' },
  );

  assert.equal(line![0]!.text.trim(), 'ПОЛИЦ.');
  assert.equal(line![1]!.text, 'Пакетики ваши?');
});

test('имя, не влезшее в колонку, занимает свою строку, а не съедает промежуток', () => {
  const lines = streamLines([{ kind: 'text', text: '> полицейский — Пакетики ваши?' }], 48);

  assert.equal(lines[0]!.map((s) => s.text).join('').trim(), 'ПОЛИЦЕЙСКИЙ');
  assert.equal(lines[1]!.at(-1)!.text, 'Пакетики ваши?');
  // Речь начинается с той же колонки, что и у коротких имён.
  const short = streamLines([{ kind: 'text', text: '> тоби — Пакетики ваши?' }], 48);
  assert.equal(lines[1]![0]!.text.length, short[0]![0]!.text.length);
});

test('цитата колонки говорящего не занимает', () => {
  const segs = streamLines([{ kind: 'text', text: '> «Единственный случай в истории».' }], 72)[0]!;

  assert.equal(segs[0]!.text, ' '.repeat(MARGIN.text));
  assert.equal(segs[1]!.cls, 'quote');
  assert.equal(segs[1]!.text, '«Единственный случай в истории».');
});

test('раунды разделены тонкой чертой перед командой, но не в начале потока', () => {
  const lines = streamLines(
    [
      { kind: 'text', text: 'Аудитория.' },
      { kind: 'echo', text: 'сесть сзади' },
      { kind: 'text', text: 'Ты садишься.' },
    ],
    40,
  );

  const rules = lines.filter((l) => l.some((s) => s.cls === 'round'));
  assert.equal(rules.length, 1, 'черта одна: перед командой');

  // Стоит она выше эха, а не ниже: под чертой — то, что случилось в ответ.
  const at = lines.findIndex((l) => l.some((s) => s.cls === 'round'));
  assert.ok(lines[at + 1]!.some((s) => s.cls === 'echo'));

  // Черта тоньше линейки: у рамки сплошной знак, здесь точечный.
  const glyph = rules[0]!.find((s) => s.cls === 'round')!.text;
  assert.equal(glyph.includes('─'), false);
  assert.equal(glyph.includes('━'), false);

  // Первая команда потока черты не получает: делить там нечего.
  const first = streamLines([{ kind: 'echo', text: 'сесть сзади' }], 40);
  assert.equal(first.some((l) => l.some((s) => s.cls === 'round')), false);
});
