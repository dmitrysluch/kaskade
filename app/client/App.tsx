import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildCatalog, SYSTEM_COMMANDS, type CatalogOption } from './engine/catalog.ts';
import { commonPrefix, exact, matches } from './engine/completion.ts';
import {
  begin,
  dateAt,
  enter,
  freshSave,
  pagesOf,
  previewOf,
  sceneOf,
  terms,
  waitRoute,
  type Session,
  type StreamEntry,
  type SystemCommand,
} from './engine/state.ts';
import { clearSave, loadSave, persistSave } from './engine/save.ts';
import { rendererFor } from './renderers/registry.ts';
import { useMetrics } from './ui/metrics.ts';
import {
  DETAIL_ROWS,
  ErrorScreen,
  frameGlyphs,
  GameScreen,
  LIST_ROWS,
  LOWER_ROWS,
  MontageScreen,
  OverlayScreen,
  ruleGlyph,
  STATUS_ROWS,
} from './ui/Screen.tsx';
import {
  commandLines,
  detailLines,
  inputLine,
  overlayLines,
  overlayTitle,
  portraitLines,
  statusLine,
  statusText,
  streamLines,
  systemLine,
  viewport,
} from './ui/lines.ts';
import { Manual, Hint } from './ui/Manual.tsx';
import { MobileScreen } from './ui/Mobile.tsx';
import { isMobilePath, MOBILE_COLS, TAP_HINT } from './ui/mode.ts';
import { ADVANCE_HINT, useAdvance } from './ui/advance.ts';
import { useWaitClock } from './ui/wait.ts';
import { Menu } from './ui/Menu.tsx';
import { Splash } from './ui/Splash.tsx';
import { Transition } from './ui/Transition.tsx';
import { Ambience, keystroke } from './audio/index.ts';
import { CLOSE, EXAMINE } from '../shared/pages.ts';
import { MARGIN } from './ui/text.ts';
import type { GameContent } from '../shared/types.ts';

type Bundle = { ok: true; content: GameContent } | { ok: false; errors: string[] };

/*
 * Хоткеи — цифровой ряд (07-оболочка-тз, «Клавиши»).
 *
 * Функциональные клавиши не сработали в жизни: на маке F3 — Mission Control,
 * F4 — Launchpad, и до игры они не доходят вовсе. Цифры одинаковы на обеих
 * платформах, ничего не перехватывают и не требуют аккордов; `Ctrl`/`Cmd`
 * отпадают по той же причине, что и раньше, — они расходятся между системами
 * и спорят с браузером.
 *
 * Цена ровно одна: цифра — обычный знак команды. Поэтому хоткеем она работает
 * только на пустой строке, и `спросить о 4380-B` набирается как ни в чём
 * не бывало.
 */

/** Хоткей — быстрый путь к той же команде, отдельной ветки поведения у него нет. */
const HOTKEYS: Record<string, SystemCommand> = {
  '1': 'справочник',
  '2': 'дело',
};

/*
 * Клавиши слоёв оболочки. Отдельно от `HOTKEYS`, потому что работают они шире:
 * экран, который клавиша открывает, обязан показываться в любой момент, в том
 * числе поверх полноэкранного кадра. Иначе игрок жмёт `0` на сплэше и не видит
 * ничего.
 *
 * Справочник и дело так не умеют и не должны: терминал в этот момент не терминал.
 */
const MENU_KEY = '0';
const MANUAL_KEY = '3';

/**
 * Прокрутка потока. `PgUp`/`PgDn` по ТЗ, но на ноутбуке без цифрового блока это
 * `Fn` со стрелкой, то есть аккорд, — поэтому то же есть на цифрах.
 *
 * `+1` — вверх, к тому, что было раньше.
 */
const SCROLL_KEYS: Record<string, number> = {
  PageUp: 1,
  '4': 1,
  PageDown: -1,
  '5': -1,
};

/** Цифра работает хоткеем только на пустой строке — дальше она знак команды. */
const DIGIT = /^[0-9]$/;

const ambience = new Ambience();

/**
 * Мобильная версия — отдельный адрес `/m`, а не ширина окна (`ui/mode.ts`).
 * Считаем один раз: внутри игры навигации нет, адрес под ногами не меняется.
 */
const TOUCH = typeof location === 'undefined' ? false : isMobilePath(location.pathname);

export function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [input, setInput] = useState('');
  /**
   * Что выбрано в списке. `null` — не выбрано ничего: пустая нетронутая строка
   * ничего не раскрывает, и предпросмотр не появляется, пока игрок не выбрал
   * стрелками, не нажал Tab или не ввёл команду целиком.
   */
  const [pick, setPick] = useState<number | null>(null);
  const [scroll, setScroll] = useState(0);
  /**
   * Открыто ли меню оболочки. Не в `Session` и не в оверлее: оверлей показывает
   * содержимое игры, а меню говорит о самой игре — и переживать перезагрузку
   * ему незачем.
   */
  const [menu, setMenu] = useState(false);
  const screenRef = useRef<HTMLDivElement | null>(null);

  const content = bundle?.ok ? bundle.content : null;

  // Контент приезжает по /api/content и обновляется по ws: правишь заметку
  // в Obsidian — вкладка перерисовывается, не теряя позицию.
  useEffect(() => {
    void fetch('/api/content')
      .then((r) => r.json() as Promise<Bundle>)
      .then(setBundle)
      .catch((e: Error) => setBundle({ ok: false, errors: [`сервер не отвечает: ${e.message}`] }));

    // Протокол берём от страницы: на HTTPS `ws://` браузер режет как mixed content,
    // и hot reload молча умирает — а игра при этом работает, поэтому не заметно.
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as { type: string; bundle: Bundle };
      if (message.type === 'content') setBundle(message.bundle);
    };
    return () => ws.close();
  }, []);

  useEffect(() => {
    if (!content) return;
    setSession((prev) => {
      if (prev) {
        // Узел мог исчезнуть, пока автор правил заметки: тогда начинаем эпизод
        // заново, а не показываем пустой экран.
        if (content.nodes[prev.save.episodeState.at]) return prev;
        return begin(content, freshSave(content));
      }

      const save = loadSave(content);
      if (!save.started) return begin(content, save);
      // Продолжение: узел уже отыгран, его атрибуты применять второй раз нельзя —
      // просто показываем, где игрок стоит.
      const node = content.nodes[save.episodeState.at];
      const stream: StreamEntry[] = node?.text ? [{ kind: 'text', text: node.text }] : [];
      return { save, stream, overlay: null, reading: null, history: [] };
    });
  }, [content]);

  useEffect(() => {
    if (session) persistSave(session.save);
  }, [session]);

  const episode = useMemo(
    () => content?.episodes.find((e) => e.id === session?.save.episodeState.episode) ?? content?.episodes[0],
    [content, session],
  );
  const renderer = episode ? content?.renderers[episode.renderer] : undefined;

  useEffect(() => {
    ambience.play(episode?.ambience ?? renderer?.ambience ?? null);
  }, [episode, renderer]);

  const { cols, rows, size, line } = useMetrics(
    screenRef,
    renderer?.font.rows ?? 34,
    renderer?.font.size ?? 16,
    renderer?.font.line ?? 1,
    TOUCH ? MOBILE_COLS : undefined,
  );

  const node = content && session ? content.nodes[session.save.episodeState.at] : undefined;
  const isCard = node?.attrs.tag.includes('titlecard') ?? false;
  /**
   * Монтажный кадр (07-оболочка-тз, «Монтажный кадр») — короткое событие, где
   * Марго действует, а руля игроку намеренно не дают. От титра отличается тем,
   * что показывает происходящее, а не предъявляет запись; поэтому текст идёт
   * обычными цветами говорящих и без рамки.
   */
  const isMontage = node?.attrs.tag.includes('montage') ?? false;

  // Лицо показывается сплэшем во весь кадр и ровно один раз за игру: узел,
  // который его уже отыграл, второй раз не показывает ничего.
  const splashTag = node?.attrs.tag.find((t) => t.startsWith('splash:'));
  const splash =
    splashTag && content && episode && session && !session.save.splashes.includes(node!.addr)
      ? content.characters[splashTag.slice('splash:'.length)]?.portraits[episode.id]
      : undefined;

  const catalog = useMemo(
    () => (content && session ? buildCatalog(content, session.save, session.reading) : []),
    [content, session],
  );

  /**
   * Последний термин справочника, который был на экране. `1` открывает справочник
   * на нём, а не на алфавитном списке: игрок, не понявший слова, должен получить
   * ответ, а не стену терминов.
   */
  const lastTerm = useMemo(() => {
    if (!content || !session) return null;
    const text = session.stream.map((e) => e.text).join('\n').toLowerCase();
    let found: { term: string; at: number } | null = null;
    for (const term of Object.keys(content.reference)) {
      const at = text.lastIndexOf(term.toLowerCase());
      if (at !== -1 && (!found || at > found.at)) found = { term, at };
    }
    return found?.term ?? null;
  }, [content, session]);
  const shown = useMemo(() => matches(catalog, input), [catalog, input]);

  // Что выбрано на самом деле: стрелками, Tab или введённым целиком текстом.
  // Именно эта опция раскрывает реплику Марго в области деталей.
  const picked = useMemo(
    () => (pick == null ? exact(catalog, input) : (shown[pick] ?? null)),
    [catalog, shown, pick, input],
  );

  /**
   * Строки монтажного кадра. Считаются тем же `streamLines`, что и поток:
   * кадр — это сцена без руля, и цвета говорящих в нём те же самые.
   */
  const montage = useMemo(() => {
    if (!isMontage || !node) return [];
    const width = Math.max(1, cols - MARGIN.text - MARGIN.right);
    const entries: StreamEntry[] = [];
    if (node.attrs.timeLabel) entries.push({ kind: 'time', text: node.attrs.timeLabel });
    if (node.text) entries.push({ kind: 'text', text: node.text });
    return streamLines(entries, width);
  }, [isMontage, node, cols]);

  const layout = useMemo(() => {
    // Текст идёт во всю сетку, от поля до поля: поля — это те самые два-четыре
    // пробела, а не колонка посреди пустого экрана.
    const text = Math.max(1, cols - MARGIN.text - MARGIN.right);

    // На телефоне поток прокручивается пальцем и окна в строках не имеет:
    // высота там пляшет вместе с адресной строкой браузера.
    const streamRows = Math.max(3, rows - STATUS_ROWS - LOWER_ROWS);
    // Слова дела подсвечиваются в любом тексте: прогресс виден и в старом.
    const words = session && content ? Object.keys(session.save.words).map((id) => content.words[id]?.label ?? id) : [];
    const stream = session ? streamLines(session.stream, text, words) : [];
    return { text, streamRows, stream, maxScroll: Math.max(0, stream.length - streamRows) };
  }, [cols, rows, session, content]);

  // Новый текст всегда возвращает к низу: игрок читает то, что только что произошло.
  useEffect(() => setScroll(0), [session?.stream]);

  const run = useCallback(
    (option: CatalogOption) => {
      if (!content || !session) return;
      // Серое слово не коммитится: курсор встаёт, выбор не проходит.
      if (option.locked) return;

      /*
       * Строка ввода тратится на команду в любом случае. Раньше её чистила
       * только ветка перехода, и после `дело` в строке оставалось слово `дело`;
       * с цифровыми хоткеями это стало ещё и небезопасно — непустая строка
       * выключает цифры. Хоткей приходит сюда только с пустой строки, так что
       * терять нечего.
       */
      setInput('');
      setPick(null);

      // Промпт рисует поток: здесь только сама команда.
      const echo: StreamEntry = { kind: 'echo', text: option.label };
      const history = [option.label, ...session.history].slice(0, 50);
      // Подсказка-пример уходит, когда игрок сделал ровно то, что она предлагала:
      // по делу, а не по таймеру. Помним это в сейве — перезагрузка не должна
      // возвращать обучение тому, кто уже понял.
      const counted =
        option.label === episode?.tutorial.hint ? { ...session.save, hinted: true } : session.save;

      /*
       * Чтение — отдельный уровень (07-оболочка-тз, «Страницы предмета»): пока
       * книга открыта, список состоит из неё одной. Новых полей у опции для
       * этого не нужно, глагол уже несёт смысл.
       *
       * Одностраничный предмет в режим не входит: экран, где единственная
       * команда «закрыть», не стоит того, чтобы из него выходить.
       */
      const opens =
        option.verb === EXAMINE && option.object && pagesOf(content, option.object, session.save).length > 1;
      const reading =
        option.verb === CLOSE ? null
        : opens ? option.object
        : session.reading;

      if (option.system) {
        const call = option.system;
        // Меню — экран оболочки, а не оверлей содержимого. Командой оно при этом
        // остаётся полноправной: эхо в потоке и запись в истории у него такие же.
        if (call.kind === 'меню') setMenu(true);
        setSession({
          ...session,
          save: counted,
          overlay: call.kind === 'меню' ? null : { ...call, kind: call.kind },
          stream: [...session.stream, echo],
          reading,
          history,
        });
        setScroll(0);
        return;
      }
      if (!option.target) {
        setSession({ ...session, save: counted, stream: [...session.stream, echo], reading, history });
        return;
      }

      const r = enter(content, counted, option.target, option.moves);

      // Смена места начинает страницу заново: прокрутка листает текущую сцену,
      // а не всю игру. Эхо команды при этом остаётся на прошлой странице — то,
      // что произошло, и так видно по новому экрану.
      const moved = sceneOf(r.save.episodeState.at) !== sceneOf(session.save.episodeState.at);

      setSession({
        save: r.save,
        stream: moved ? r.entries : [...session.stream, echo, ...r.entries],
        overlay: null,
        // Уход в другое место закрывает книгу сам: читать её из соседней комнаты
        // нельзя, а специально гасить режим в контенте — лишняя обязанность.
        reading: moved ? null : reading,
        history,
      });
    },
    [content, session, episode],
  );

  /**
   * Исполнить служебную команду от лица хоткея. Отдельной ветки поведения у него
   * нет: он находит ту же опцию каталога и отправляет её в общий обработчик —
   * иначе клавиша и команда однажды разъедутся.
   */
  const runSystem = useCallback(
    (kind: SystemCommand) => {
      // `1` открывает справочник на последнем термине, который был на экране:
      // иначе игрок, не понявший слова, получает вместо ответа стену терминов.
      const arg = kind === 'справочник' ? lastTerm : null;
      const option =
        catalog.find((o) => o.system?.kind === kind && o.system.arg === arg) ??
        catalog.find((o) => o.system?.kind === kind && o.system.arg === null);
      if (option) run(option);
    },
    [catalog, lastTerm, run],
  );

  /**
   * Служебная полоса телефона: те же команды и тот же порядок, что в полосе
   * большого экрана, — только их трогают, а не вызывают клавишей. `управление`
   * командой по-прежнему не является и живёт отдельным пунктом.
   */
  const systemTaps = useMemo(
    () => [
      ...SYSTEM_COMMANDS.map((kind) => ({ label: kind, run: () => runSystem(kind) })),
      { label: 'управление', run: () => setReopened(true) },
    ],
    [runSystem],
  );

  /** Закрыть оверлей: `Esc` на большом экране, касание на телефоне. */
  const closeOverlay = useCallback(() => {
    setSession((prev) => (prev ? { ...prev, overlay: null } : prev));
    setScroll(0);
  }, []);

  /**
   * Кадр доиграл: уводит безымянный маршрут. Один и тот же ход у титра
   * и у монтажа — они по-разному выглядят, но одинаково ждут нажатия.
   */
  const cardDone = useCallback(() => {
    if (!content || !session || !node) return;
    const next = node.options.find((o) => o.label === '')?.target;
    if (!next) return;
    const r = enter(content, session.save, next);
    // После титров всегда новое место — карточка для того и стоит.
    setSession({ ...session, save: r.save, stream: r.entries });
  }, [content, session, node]);

  const splashDone = useCallback(() => {
    setSession((prev) =>
      prev && node
        ? { ...prev, save: { ...prev.save, splashes: [...prev.save.splashes, node.addr] } }
        : prev,
    );
  }, [node]);

  // `splash:` и `titlecard` на одном узле — лицо, под ним запись: это личное дело,
  // и ровно так открывается игра. Лицо отыграно — дальше уводит маршрут карточки.
  const splashCardDone = useCallback(() => {
    splashDone();
    cardDone();
  }, [splashDone, cardDone]);

  /**
   * Экран управления показывается один раз, перед первой комнатой: название
   * и личное дело — одна сцена, разрывать её инструкцией хуже, а перед комнатой
   * у инструкции максимальная свежесть.
   */
  const teaching = Boolean(session) && !session!.save.taught && !isCard && !splash;
  const [reopened, setReopened] = useState(false);
  const manual = teaching || reopened;

  const manualDone = useCallback(() => {
    setReopened(false);
    setSession((prev) => (prev ? { ...prev, save: { ...prev.save, taught: true } } : prev));
  }, []);

  /*
   * Обучающий экран закрывается `Enter`, как и полноэкранный кадр: клавиша,
   * означающая «дальше», в игре одна. «Любая клавиша» была отдельным правилом
   * ровно для одного экрана — и первым же, что игрок пробовал, оказывалась
   * стрелка или цифра, то есть тот самый интерфейс, который экран объясняет.
   *
   * Тот же `useAdvance`, что у кадров, и по той же причине: экран открывается
   * после кадра, и `Enter`, которым игрок его домотал, не должен закрыть
   * инструкцию, которую он ещё не увидел.
   */
  useAdvance(manual ? manualDone : null);

  /*
   * Монтажный кадр ждёт нового `Enter` тем же способом, что и титр: клавиша,
   * которой игрок исполнил последнюю команду, кадр не закрывает, а удерживаемая
   * не проматывает последовательность.
   */
  useAdvance(isMontage && !menu && !manual ? cardDone : null);

  // Управление из меню: тот же экран, что по `3`, — второй копии инструкции нет.
  const menuManual = useCallback(() => {
    setMenu(false);
    setReopened(true);
  }, []);

  /**
   * Начать заново. Сейв стирается, а не переписывается: состояние обязано быть
   * неотличимо от первого запуска с чистой машины — с кадрами вступления и
   * экраном управления. Иначе «заново» означало бы «почти заново», а разницу
   * нашёл бы не автор, а следующий игрок.
   */
  const restart = useCallback(() => {
    if (!content) return;
    clearSave();
    setSession(begin(content, freshSave(content)));
    setMenu(false);
    setReopened(false);
    setInput('');
    setPick(null);
    setScroll(0);
  }, [content]);

  // Пока идёт сплэш или обучение, ввод не принимается: терминал в этот момент
  // не терминал.
  const accepting =
    Boolean(session) && !isCard && !isMontage && !splash && !manual && !menu && !session?.overlay;

  /*
   * Физическое ожидание (07-оболочка-тз, «Физическое ожидание»): узел держит
   * свой маршрут, пока не пройдёт девяносто секунд, и всё это время игрок ждёт
   * вместе с Марго.
   *
   * Считается только активное время; часы живут в `ui/wait.ts`. Здесь решают
   * единственное, чего они знать не могут: идёт ли сейчас игра. `accepting`
   * это и есть — оверлей, меню, обучение и полноэкранный кадр её останавливают.
   */
  const waiting = session?.save.wait ?? null;
  const counting = accepting && waiting != null && waiting.elapsed < waiting.ms;

  const liveWait = useCallback((passed: number) => {
    setSession((prev) => {
      const w = prev?.save.wait;
      if (!prev || !w || w.elapsed >= w.ms) return prev;
      return { ...prev, save: { ...prev.save, wait: { ...w, elapsed: Math.min(w.ms, w.elapsed + passed) } } };
    });
  }, []);

  useWaitClock(counting, liveWait);

  /*
   * Время вышло — уводит безымянный маршрут.
   *
   * Ввод при этом не отнимают: набранную команду игрок дописывает и исполняет,
   * маршрут ждёт пустой строки. Из дочернего узла действия («посмотреть на
   * часы») он тоже не перебивает печать — `waitRoute` отдаёт маршрут только
   * тому, кто стоит в самом узле ожидания.
   */
  useEffect(() => {
    if (!content || !session || !accepting || input !== '') return;
    const next = waitRoute(content, session.save);
    if (!next) return;
    // Ожидание закончено и из сейва уходит: его условия за пределами этого
    // узла не читаются, а второго активного ожидания быть не должно.
    const r = enter(content, { ...session.save, wait: null }, next);
    const moved = sceneOf(r.save.episodeState.at) !== sceneOf(session.save.episodeState.at);
    setSession({
      ...session,
      save: r.save,
      stream: moved ? r.entries : [...session.stream, ...r.entries],
    });
  }, [content, session, accepting, input]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!session) return;
      /*
       * На телефоне терминал клавиш не слушает: строки ввода там нет, и набранное
       * ушло бы в состояние, которого игрок не видит. Всё, что делает клавиша
       * на большом экране, там делает касание, — а кадры, меню и управление
       * слушают свои клавиши сами и продолжают работать с внешней клавиатурой.
       */
      if (TOUCH) return;
      const key = event.key;
      const page = Math.max(1, layout.streamRows - 1);

      // Пока открыт слой со своим управлением, клавиши принадлежат ему одному.
      // У меню свои стрелки, свой Enter и свой Esc; обучающий экран закрывается
      // тем же новым Enter, что и полноэкранный кадр (useAdvance выше).
      if (menu || manual) return;

      /*
       * Цифра работает хоткеем только на пустой строке. После первого знака она
       * снова обычный символ команды, иначе `спросить о 4380-B` было бы нечем
       * набрать, а случайная цифра открывала бы справочник посреди ввода.
       */
      const meta = !DIGIT.test(key) || input === '';
      const scrollBy = SCROLL_KEYS[key];

      // Слои оболочки открываются в любой момент, включая кадр и сплэш.
      if (meta && (key === MANUAL_KEY || key === MENU_KEY)) {
        event.preventDefault();
        if (key === MANUAL_KEY) setReopened(true);
        else runSystem('меню');
        return;
      }

      if (session.overlay) {
        event.preventDefault();
        if (key === 'Escape') {
          setSession({ ...session, overlay: null });
          setScroll(0);
        } else if (scrollBy) {
          // В оверлее прокрутка считается сверху: это список, а не разговор.
          setScroll((s) => Math.max(0, s - scrollBy * page));
        }
        return;
      }
      if (!accepting) return;

      const hotkey = meta ? HOTKEYS[key] : undefined;
      if (hotkey) {
        event.preventDefault();
        runSystem(hotkey);
        return;
      }

      if (scrollBy && meta) {
        event.preventDefault();
        setScroll((s) => Math.max(0, Math.min(layout.maxScroll, s + scrollBy * page)));
        return;
      }

      switch (key) {
        case 'Enter': {
          event.preventDefault();
          // Enter исполняет выбранное или введённое целиком; неполный набор
          // без выбора не исполняет ничего.
          const chosen = exact(catalog, input) ?? (pick == null ? null : shown[pick]) ?? null;
          // Ввод валидируется до отправки: если совпадения нет, не происходит
          // ничего. Ни одного «не понимаю» за всю игру.
          if (chosen) run(chosen);
          return;
        }
        case 'Tab': {
          event.preventDefault();
          if (shown.length === 0) return;
          const prefix = commonPrefix(shown);
          // Tab сначала дописывает общее, а дальше листает — и это уже осознанный
          // выбор, после которого показывается реплика.
          if (prefix.length > input.length && pick == null) setInput(prefix);
          else setPick((p) => (p == null ? 0 : (p + 1) % shown.length));
          return;
        }
        case 'Escape':
          event.preventDefault();
          setInput('');
          setPick(null);
          return;
        case 'Backspace':
          event.preventDefault();
          setInput(input.slice(0, -1));
          setPick(null);
          return;
        case 'ArrowUp':
        case 'ArrowDown': {
          // Стрелки листают команды, а не историю ввода: список под строкой — это
          // и есть то, что игрок сейчас может сказать, и выбирать надо в нём.
          event.preventDefault();
          if (shown.length === 0) return;
          setPick((p) =>
            p == null
              ? key === 'ArrowDown' ? 0 : shown.length - 1
              : (p + (key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length,
          );
          return;
        }
        default:
          if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            setInput(input + key);
            setPick(null);
            keystroke(renderer?.keyboard ?? null);
          }
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const body = (() => {
    if (!bundle) return <div className="dim">…</div>;
    if (!bundle.ok) return <ErrorScreen cols={cols} rows={rows} errors={bundle.errors} />;
    if (!session || !episode || !renderer) return <div className="dim">…</div>;
    /*
     * Слои оболочки идут поверх всего, включая кадры: `0` и `3` обязаны работать
     * в любой момент. Иначе игрок, открывший меню на сплэше, нажимает клавишу
     * и не видит ничего — экран открыт, а показан кадр.
     *
     * Сам собой обучающий слой поверх кадра не встанет: `teaching` требует, чтобы
     * кадра не было. Сюда попадает только открытое руками.
     */
    if (menu) {
      return (
        <Menu onClose={() => setMenu(false)} onManual={menuManual} onRestart={restart} touch={TOUCH} />
      );
    }
    if (manual) return <Manual first={!session.save.taught} touch={TOUCH} onDone={manualDone} />;
    // Лицо и запись на одном узле — личное дело: лицо, под ним рамка. Держится
    // столько же, сколько сплэш: разглядеть надо и то, и другое.
    if (splash && isCard) {
      return (
        <Splash
          lines={portraitLines(splash)}
          card={node?.text ?? ''}
          glyphs={frameGlyphs(renderer.frame)}
          onDone={splashCardDone}
          touch={TOUCH}
        />
      );
    }
    if (isCard) {
      return (
        <Transition
          card={node?.text ?? ''}
          bios={[]}
          cols={cols}
          rows={rows}
          glyphs={frameGlyphs(renderer.frame)}
          onDone={cardDone}
          touch={TOUCH}
        />
      );
    }
    if (splash) {
      return (
        <Splash lines={portraitLines(splash)} onDone={splashDone} touch={TOUCH} />
      );
    }
    // Монтаж уводит тот же безымянный маршрут, что и титр: для прохода это
    // один и тот же кадр, разное у них — что на нём написано.
    if (isMontage) {
      const frame = (
        <MontageScreen cols={cols} rows={rows} lines={montage} hint={TOUCH ? TAP_HINT : ADVANCE_HINT} />
      );
      return TOUCH ? <div onClick={cardDone}>{frame}</div> : frame;
    }
    if (session.overlay) {
      return (
        <OverlayScreen
          cols={cols}
          rows={rows}
          title={overlayTitle(session.overlay)}
          lines={overlayLines(session.overlay, bundle.content, session.save, cols - 3)}
          scroll={scroll}
          glyphs={frameGlyphs(renderer.frame)}
          {...(TOUCH ? { close: `${TAP_HINT} — закрыть`, onClose: closeOverlay } : {})}
        />
      );
    }

    if (TOUCH) {
      return (
        <MobileScreen
          cols={cols}
          status={statusLine(
            statusText(dateAt(bundle.content, session.save), terms(bundle.content, session.save)),
            cols,
          )}
          stream={layout.stream}
          // Аргументы служебных команд (`справочник контейнмент`) в список не
          // идут: они существуют ради набора, а пальцем до статьи добираются
          // через сам справочник. Иначе полсотни строк поверх трёх нужных.
          options={catalog.filter((o) => !o.system)}
          onPick={run}
          system={systemTaps}
          rule={ruleGlyph(renderer.rule)}
        />
      );
    }

    return (
      <GameScreen
        cols={cols}
        streamRows={layout.streamRows}
        status={statusLine(
          statusText(dateAt(bundle.content, session.save), terms(bundle.content, session.save)),
          cols,
        )}
        stream={viewport(layout.stream, layout.streamRows, scroll)}
        input={inputLine(input)}
        list={commandLines(shown, pick, input, layout.text, LIST_ROWS)}
        details={detailLines(
          picked ? previewOf(bundle.content, picked) : null,
          picked?.attrs.advance ?? false,
          layout.text,
          DETAIL_ROWS,
        )}
        system={systemLine(SYSTEM_COMMANDS, layout.text)}
        more={{
          up: Math.min(scroll, layout.maxScroll) < layout.maxScroll,
          down: Math.min(scroll, layout.maxScroll) > 0,
        }}
        rule={ruleGlyph(renderer.rule)}
      />
    );
  })();

  // Подсказка-пример висит поверх терминала в первой комнате и уходит после
  // третьей команды. Строка подсказок самого терминала при этом не меняется:
  // обучение живёт в обучающем слое, а терминал с первой секунды выглядит так,
  // как будет выглядеть всегда.
  const hint =
    session && episode?.tutorial.hint && !manual && !menu && !session.save.hinted &&
    session.save.episodeState.at === episode.tutorial.at
      ? episode.tutorial.hint
      : null;

  const screen = (
    <div
      className="screen"
      ref={screenRef}
      // Высота строки в целых пикселях, а не множителем: клетка обязана ложиться
      // на пиксели, иначе рейки рамки едут от строки к строке (metrics.ts).
      style={{ fontSize: `${size}px`, ['--line' as string]: `${line}px` }}
    >
      {body}
      {hint && <Hint text={hint} />}
    </div>
  );

  if (!renderer || !episode) return screen;
  const Renderer = rendererFor(episode.renderer);
  return <Renderer def={renderer}>{screen}</Renderer>;
}
