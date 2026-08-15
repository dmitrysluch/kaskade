import { useEffect, useState, type RefObject } from 'react';

/**
 * Размер экрана в знакоместах.
 *
 * Ширину не задаёт никто: сетка заполняет окно целиком, линейка доходит до краёв
 * страницы, поля набираются пробелами. Единственная настройка — **высота**:
 * `font.rows` из game.yaml говорит, сколько строк должно помещаться в окно, и из
 * этого выводится кегль. Ширина получается сама: сколько таких знаков влезло,
 * столько и колонок.
 *
 * Так высота и ширина связаны одним числом. Меньше строк — крупнее буквы и, как
 * следствие, короче строка; больше строк — мельче буквы и длиннее строка. Автору
 * достаточно одного знакомого понятия: сколько строк он хочет видеть.
 *
 * Меряем реальный шрифт, а не доверяем единице `ch`: фолбэк подставит другой
 * моноширинный, и сетка поедет на знак.
 */

export interface Metrics {
  cols: number;
  rows: number;
  /** Кегль в пикселях, подобранный под высоту окна. */
  size: number;
  /** Высота строки в пикселях: задаётся явно, чтобы клетки стыкались. */
  line: number;
}

/** Уже этого экран перестаёт быть терминалом, но раскладка обязана собраться. */
const MIN_COLS = 40;
const MIN_ROWS = 12;
const MIN_SIZE = 10;
const MAX_SIZE = 30;

export interface Fit {
  /** Доступная площадь в пикселях. */
  availW: number;
  availH: number;
  /** Сколько строк должно помещаться по высоте — `font.rows` из game.yaml. */
  rows: number;
  /**
   * Сколько колонок должно помещаться по ширине. Задаётся только мобильной
   * версией: у телефона высоты вдоволь, а ширины нет, и держать надо длину
   * строки — иначе кегль, выведенный из высоты, оставляет два десятка колонок
   * и текст рассыпается в столбик.
   */
  cols?: number;
  /** Ширина знака и высота строки на единицу кегля. */
  cellRatio: number;
  lineRatio: number;
}

/**
 * Подбор кегля и сетки. Вынесено из хука отдельно, потому что здесь вся суть,
 * а замеры DOM — это только способ получить сюда четыре числа.
 */
export function fit({ availW, availH, rows, cols, cellRatio, lineRatio }: Fit): Metrics {
  // Кегль — целиком следствие того измерения, которое держим: высоты на большом
  // экране, ширины на телефоне. Потолок и пол нужны на краях: в почтовой марке
  // буквы не должны стать нечитаемыми, на телевизоре — плакатными.
  const wanted = Math.max(
    MIN_SIZE,
    Math.min(MAX_SIZE, cols == null ? availH / (rows * lineRatio) : availW / (cols * cellRatio)),
  );

  /*
   * Клетка обязана быть целым числом пикселей — и по ширине, и по высоте.
   *
   * Знак шириной 13,41 px сам по себе рисуется прекрасно, но строка собрана
   * из нескольких <span>: поле, текст, рейка. Ширина каждого округляется до
   * единиц раскладки отдельно, и остатки в разных строках набегают по-разному —
   * вертикальная рейка рамки едет на доли пикселя от строки к строке. Заметно
   * это ровно там, где линии обязаны стыковаться, то есть на рамках.
   *
   * Поэтому кегль подбирается не «какой хочется», а «при котором знак шириной
   * в целое число пикселей»: остаток тогда некуда накапливать. Высота строки
   * по той же причине уезжает в пиксели и задаётся явно, а не множителем.
   */
  const exact = wanted * cellRatio;
  // Из двух целых ширин берём ту, при которой заказанного выходит ближе.
  const candidates = [Math.max(1, Math.floor(exact)), Math.max(1, Math.ceil(exact))];
  const cell = candidates.reduce((best, c) => {
    const err = (w: number) =>
      cols == null
        ? Math.abs(Math.floor(availH / ((w / cellRatio) * lineRatio)) - rows)
        : Math.abs(Math.floor(availW / w) - cols);
    return err(c) < err(best) || (err(c) === err(best) && c > best) ? c : best;
  });

  const size = cell / cellRatio;
  // Высоту строки не округляем: `line: 1` значит «клетки стыкуются», и округление
  // тут открыло бы щель между строками — как раз там, где стыкуются рейки рамки
  // и полублоки портрета.
  const line = size * lineRatio;

  return {
    size,
    line,
    // Пол по колонкам — свойство большого экрана: там сетка обязана собраться
    // хоть как-то. На телефоне колонки и есть заказ, и поднимать их до сорока
    // значило бы врать про ширину, которой нет.
    cols: cols == null ? Math.max(MIN_COLS, Math.floor(availW / cell)) : Math.floor(availW / cell),
    rows: Math.max(MIN_ROWS, Math.floor(availH / line)),
  };
}

/**
 * `lineRatio` приходит из конфига (`font.line`), а не меряется по месту: высоту
 * строки мы сами и выставляем, в пикселях, — измерять её значит читать
 * собственный прошлый ответ и уезжать с каждым замером.
 */
export function useMetrics(
  ref: RefObject<HTMLElement | null>,
  rows: number,
  base: number,
  lineRatio: number,
  cols?: number,
): Metrics {
  const [metrics, setMetrics] = useState<Metrics>({ cols: MIN_COLS, rows, size: base, line: base });

  useEffect(() => {
    function measure() {
      const el = ref.current;
      if (!el || el.clientWidth === 0) return;

      // Меряем при заведомо большом кегле: доли пикселя на знак иначе съедают
      // точность, и на широком окне ошибка набегает в целую колонку.
      const probe = document.createElement('span');
      probe.textContent = 'M'.repeat(100);
      probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font-size:100px;';
      el.appendChild(probe);
      const cellRatio = probe.getBoundingClientRect().width / 100 / 100;
      el.removeChild(probe);
      if (!cellRatio || !Number.isFinite(cellRatio)) return;

      const style = getComputedStyle(el);
      const availW = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const availH = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);

      setMetrics(fit({ availW, availH, rows, cellRatio, lineRatio, ...(cols != null && { cols }) }));
    }

    measure();
    // Шрифт может доехать позже разметки — тогда все замеры до него неверны.
    void document.fonts?.ready.then(measure);

    const observer = new ResizeObserver(measure);
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, rows, base, lineRatio, cols]);

  return metrics;
}
