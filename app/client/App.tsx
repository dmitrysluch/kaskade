import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildCatalog, itemActions, SYSTEM_COMMANDS, type CatalogOption } from './engine/catalog.ts';
import { commonPrefix, exact, matches } from './engine/completion.ts';
import { collapse, crowded, familyPrefix, optionOf, type Row } from './engine/families.ts';
import {
  appendLog,
  begin,
  confirmTransition,
  dateAt,
  enter,
  freshSave,
  openScreen,
  pagesOf,
  placeLabel,
  previewOf,
  sceneOf,
  sessionEntities,
  streamOf,
  terms,
  textEntry,
  waitRoute,
  type Session,
  type StreamEntry,
  type SystemCommand,
} from './engine/state.ts';
import { completeMinigame, fieldHere, fieldOf, moveMinigame } from './engine/minigame.ts';
import { pressureClock, roundHere, silenceRoute, tickPressure } from './engine/pressure.ts';
import { setUntimed, untimed } from './engine/settings.ts';
import { clearSave, loadSave, persistSave } from './engine/save.ts';
import { UntangleScreen } from './ui/Untangle.tsx';
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
  contextLines,
  inventoryLines,
  detailLines,
  inputLine,
  overlayLines,
  overlayTitle,
  portraitLines,
  statusLine,
  statusText,
  timerGlyphs,
  timerSegs,
  streamLines,
  systemLine,
  transitionCard,
  viewport,
  type StoragePick,
} from './ui/lines.ts';
import { Manual, Hint } from './ui/Manual.tsx';
import { MobileScreen } from './ui/Mobile.tsx';
import { isMobilePath, MOBILE_COLS, TAP_HINT } from './ui/mode.ts';
import { ADVANCE_HINT, useAdvance } from './ui/advance.ts';
import { useWaitClock } from './ui/wait.ts';
import { Menu } from './ui/Menu.tsx';
import { Splash } from './ui/Splash.tsx';
import { Stale } from './ui/Stale.tsx';
import { Transition } from './ui/Transition.tsx';
import { Ambience, keystroke } from './audio/index.ts';
import { CLOSE, EXAMINE } from '../shared/pages.ts';
import type { EntityKind, EntityMention } from '../shared/entities.ts';
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

/**
 * Что показывает нижняя панель. Знание и вещи — разные вопросы: у знания есть
 * место в потоке, где оно прозвучало, а у вещи в кармане — нет. Поэтому
 * `1` и `2` ходят по сессионной истории, а `3` — по инвентарю.
 */
type PanelKind = EntityKind | 'inventory';

/**
 * Цифра открывает **панель**, а не одноимённую команду
 * (07-оболочка-тз, «Контекстная панель по `1`, `2`, `3`»).
 *
 * Разница содержательная. Команда отвечает на вопрос «что вообще бывает»,
 * и хранилище для этого и нужно. Клавишу же жмут с другим вопросом — «что это
 * было сейчас», — и вываливать в ответ двадцать аббревиатур значит отвечать
 * не на тот вопрос. Панель показывает одну сущность и возвращает в то место
 * потока, где она встретилась.
 */
const PANEL_KEYS: Record<string, PanelKind> = {
  '1': 'reference',
  '2': 'word',
  '3': 'inventory',
};

/*
 * Клавиши слоёв оболочки. Отдельно от `PANEL_KEYS`, потому что работают они шире:
 * экран, который клавиша открывает, обязан показываться в любой момент, в том
 * числе поверх полноэкранного кадра. Иначе игрок жмёт `0` на сплэше и не видит
 * ничего.
 *
 * Справочник и дело так не умеют и не должны: терминал в этот момент не терминал.
 */
const MENU_KEY = '0';
/*
 * Экран управления — не команда и не сущность мира, поэтому и клавиша у него
 * не из цифрового ряда: цифры заняты панелями, а `?` читается как «объясни»
 * на любой раскладке и ни с чем в игре не спорит.
 */
const MANUAL_KEY = '?';

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
  /** «Без ограничений по времени» ([[07b-надавить-тз]], «Доступность»). */
  const [noLimit, setNoLimit] = useState(untimed);
  /**
   * Версия найденного сейва, если открыть его нельзя. Экран спрашивает
   * подтверждение, и только оно стирает запись: «наполовину сброшенная игра» —
   * это баг, который находит не автор, а тот, кому передали машину.
   */
  const [stale, setStale] = useState<number | null>(null);
  /**
   * Открытая контекстная панель: какого типа, какая по счёту сущность в истории
   * и куда вернуть поток при закрытии. В сессии её нет и в сейве тем более —
   * это навигация по уже прочитанному, она не переживает даже перезагрузку
   * вкладки, и переживать не должна.
   */
  const [panel, setPanel] = useState<{ kind: PanelKind; index: number; scroll: number } | null>(null);
  /**
   * Последняя вещь, которую получили или применили: с неё открывается панель
   * инвентаря. «Последняя» — потому что о ней и вспоминают: её только что дали
   * в руки или ею только что что-то сделали.
   */
  const [lastItem, setLastItem] = useState<string | null>(null);
  /**
   * Положение курсора в хранилище вещей: какая вещь выбрана, какая открыта
   * и какое её действие подсвечено. Не в сессии: это курсор, а не состояние мира.
   */
  const [storage, setStorage] = useState<StoragePick>({ pick: 0, open: null, act: 0 });
  /**
   * Упоминание, подсвеченное в потоке поверх обычной подсветки. Живёт недолго
   * и само: это указание пальцем «вот оно», а не второе постоянное состояние
   * текста.
   */
  const [focus, setFocus] = useState<EntityMention | null>(null);
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

      const loaded = loadSave(content);
      // Сейв от прежней версии не открываем молча: спрашиваем, а запись
      // оставляем в хранилище до подтверждения.
      if (loaded.kind === 'incompatible') {
        setStale(loaded.from);
        return null;
      }

      const save = loaded.save;
      if (!save.started) return begin(content, save);
      // Продолжение: узел уже отыгран, его атрибуты применять второй раз нельзя —
      // просто показываем, где игрок стоит. На карточке перехода показывать
      // нечего: она и есть экран.
      // Открытый уровень переживает перезагрузку: тот, кто закрыл вкладку
      // на расчёте, должен увидеть расчёт, а не описание комнаты, в которой он
      // всё это время стоит (07-оболочка-тз, «Вложенные предметы»).
      /*
       * Поток приезжает из сейва (07-оболочка-тз, «Лог контекста»): перезагрузка
       * обязана вернуть тот же экран, а не новую реакцию персонажа.
       *
       * Пусто он бывает у мигрированного сейва, в котором лога для активного
       * контекста ещё нет. Тогда показываем то, что сказало бы место сейчас:
       * пустой поток над строкой ввода честнее не делает никого.
       */
      const node = openScreen(content, save) ?? content.nodes[save.episodeState.at];
      const onCard = content.docs[sceneOf(save.episodeState.at)]?.type === 'transition';
      const kept = streamOf(content, save);
      const restored =
        kept.length > 0 ? save
        : !onCard && node?.text ? appendLog(content, save, [textEntry(content, save, node.text)])
        : save;
      return { save: restored, overlay: null, history: [] };
    });
  }, [content]);

  useEffect(() => {
    if (session) persistSave(session.save);
  }, [session]);

  /*
   * Полученная вещь становится последней сама: панель по `3` открывается на том,
   * что игроку только что дали в руки. Считаем по приросту инвентаря, а не по
   * `give` в узле: вещь могла прийти откуда угодно, а смысл один.
   */
  const inventory = session?.save.inventory;
  const known = useRef<string[]>([]);
  useEffect(() => {
    const items = inventory ?? [];
    const added = items.find((id) => !known.current.includes(id));
    known.current = items;
    if (added) setLastItem(added);
    else setLastItem((prev) => (prev != null && items.includes(prev) ? prev : null));
  }, [inventory]);

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
  /**
   * Поток активного контекста (07-оболочка-тз, «Лог контекста и повторный
   * вход»). Он живёт в сейве, а не в сессии: перезагрузка обязана вернуть тот
   * же экран, а возвращение в комнату с `log: true` — то, что в ней уже было.
   */
  const transcript = useMemo(
    () => (content && session ? streamOf(content, session.save) : []),
    [content, session],
  );
  const isCard = node?.attrs.tag.includes('titlecard') ?? false;
  /**
   * Игрок стоит на карточке перехода ([[14-переходы-и-даты-тз]]). Отдельного
   * поля в сейве для этого нет: позиция и есть карточка, поэтому перезагрузка
   * показывает её сама, а эффекты цели до подтверждения не выполнены.
   */
  const transition =
    content && node ? Object.values(content.transitions).find((t) => t.docId === sceneOf(node.addr)) : undefined;
  /**
   * Монтажный кадр (07-оболочка-тз, «Монтажный кадр») — короткое событие, где
   * Марго действует, а руля игроку намеренно не дают. От титра отличается тем,
   * что показывает происходящее, а не предъявляет запись; поэтому текст идёт
   * обычными цветами говорящих и без рамки.
   */
  const isMontage = node?.attrs.tag.includes('montage') ?? false;

  /**
   * Поле мини-игры ([[07a-мини-игра]]). Как и карточка перехода, оно — сама
   * позиция игрока: перезагрузка возвращает то же поле, а эффекты узла
   * завершения ждут победы и нового `Enter`.
   */
  const field = content && session ? fieldHere(content, session.save) : null;
  const untangle = content && session && field ? fieldOf(field, session.save) : null;
  /** Выбранная точка поля — состояние экрана, а не игры: в сейв не уезжает. */
  const [spot, setSpot] = useState<number | null>(null);

  // Лицо показывается сплэшем во весь кадр и ровно один раз за игру: узел,
  // который его уже отыграл, второй раз не показывает ничего.
  const splashTag = node?.attrs.tag.find((t) => t.startsWith('splash:'));
  const splash =
    splashTag && content && episode && session && !session.save.splashes.includes(node!.addr)
      ? content.characters[splashTag.slice('splash:'.length)]?.portraits[episode.id]
      : undefined;

  const catalog = useMemo(
    () => (content && session ? buildCatalog(content, session.save) : []),
    [content, session],
  );

  const shown = useMemo(() => matches(catalog, input), [catalog, input]);
  /**
   * Строки списка: при пустом вводе повторяющиеся действия комнаты сворачиваются
   * в одну строку с префиксом (07-оболочка-тз, «Сворачивание повторяющихся
   * действий комнаты»). Стрелки ходят по строкам, а каталог остаётся полным:
   * спрятанную команду можно набрать и исполнить, не раскрывая семью.
   */
  const choices = useMemo(
    // Сворачивает или нет — свойство места, посчитанное на сборке.
    () => collapse(shown, input, content && session ? crowded(content, session.save) : false),
    [shown, input, content, session],
  );

  // Что выбрано на самом деле: стрелками, Tab или введённым целиком текстом.
  // Именно эта опция раскрывает реплику Марго в области деталей.
  const picked = useMemo(
    () => (pick == null ? exact(catalog, input) : optionOf(choices[pick])),
    [catalog, choices, pick, input],
  );

  /**
   * Раскрыть семью: подставить префикс в строку ввода. Ничего не исполняется,
   * не эхается и в лог не пишется — это ровно тот же непустой ввод, который
   * игрок мог набрать руками.
   */
  const expand = useCallback((row: Row) => {
    if (row.kind !== 'family') return false;
    setInput(familyPrefix(row));
    setPick(null);
    return true;
  }, []);

  /**
   * Строки монтажного кадра. Считаются тем же `streamLines`, что и поток:
   * кадр — это сцена без руля, и цвета говорящих в нём те же самые.
   */
  const montage = useMemo(() => {
    if (!isMontage || !node) return [];
    const width = Math.max(1, cols - MARGIN.text - MARGIN.right);
    const entries: StreamEntry[] = [];
    if (node.attrs.timeLabel) entries.push({ kind: 'time', text: node.attrs.timeLabel });
    if (node.text && content && session) entries.push(textEntry(content, session.save, node.text));
    return streamLines(entries, width, null, episode?.speakers ?? {});
  }, [isMontage, node, cols, content, session, episode]);

  const layout = useMemo(() => {
    // Текст идёт во всю сетку, от поля до поля: поля — это те самые два-четыре
    // пробела, а не колонка посреди пустого экрана.
    const text = Math.max(1, cols - MARGIN.text - MARGIN.right);

    // На телефоне поток прокручивается пальцем и окна в строках не имеет:
    // высота там пляшет вместе с адресной строкой браузера.
    const streamRows = Math.max(3, rows - STATUS_ROWS - LOWER_ROWS);
    const stream = streamLines(transcript, text, focus, episode?.speakers ?? {});
    return { text, streamRows, stream, maxScroll: Math.max(0, stream.length - streamRows) };
  }, [cols, rows, transcript, focus, episode]);

  // Новый текст всегда возвращает к низу: игрок читает то, что только что произошло.
  useEffect(() => setScroll(0), [transcript]);

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
       * книга открыта, список состоит из неё одной.
       *
       * Решает **цель, а не глагол**: открывает книгу всё, что ведёт на её
       * страницу, — и `осмотреть учебник` из комнаты, и авторское `прочитать
       * протокол`, которое сцена объявила сама. Иначе игрок попадает на первую
       * страницу и остаётся без «вперёд»: команда сработала, а книга не открылась.
       *
       * Одностраничный предмет в режим не входит: экран, где единственная
       * команда «закрыть», не стоит того, чтобы из него выходить.
       */
      // Открывает книгу только страница. Обычное действие той же вещи
      // (`вернуть протокол`) в режим чтения не входит — читать после него нечего.
      const target = option.target ? content.nodes[option.target] : undefined;
      const item = option.target ? content.docs[sceneOf(option.target)] : undefined;
      /*
       * Контейнер открывает уровень сам по себе: у компьютера окна, а не
       * страницы, и «осмотреть компьютер» — это уже вход в него.
       *
       * Окно внутри открытого контейнера уровень не подменяет, даже если у него
       * свои страницы: окна переключают, а не вкладывают, иначе список окон
       * исчезал бы ровно в тот момент, когда он нужен.
       */
      const opens =
        item?.type !== 'item' ? null
        : item.parent != null && item.parent === session.save.openItem ? session.save.openItem
        : item.items.length > 0 ? item.docId
        : target?.attrs.page != null && pagesOf(content, item.docId, session.save).length > 1 ? item.docId
        : null;
      const openItem =
        option.verb === CLOSE ? null
        : opens ?? session.save.openItem;

      if (option.system) {
        const call = option.system;
        // Хранилище открывается с начала: курсор — состояние этого открытия,
        // а не память о прошлом.
        if (call.kind === 'инвентарь') setStorage({ pick: 0, open: null, act: 0 });
        // Меню — экран оболочки, а не оверлей содержимого. Командой оно при этом
        // остаётся полноправной: эхо в потоке и запись в истории у него такие же.
        if (call.kind === 'меню') setMenu(true);
        setSession({
          ...session,
          save: appendLog(content, { ...counted, openItem }, [echo]),
          overlay: call.kind === 'меню' ? null : { ...call, kind: call.kind },
          history,
        });
        setScroll(0);
        return;
      }
      if (!option.target) {
        setSession({ ...session, save: appendLog(content, { ...counted, openItem }, [echo]), history });
        return;
      }

      // Применённая вещь становится последней: панель по `3` откроется на ней.
      if (option.object) {
        const used = content.docs[option.object];
        if (used?.type === 'item') setLastItem(used.id);
      }

      /*
       * Эхо дописывается **до** прохода: предъявлено оно было там, где игрок
       * набрал команду, и в логе обязано остаться на той странице. Дальше поток
       * ведёт движок — он же решает, восстановить лог нового места или начать
       * с чистого ([[07-оболочка-тз]], «Лог контекста»).
       */
      const r = enter(content, appendLog(content, counted, [echo]), option.target, option.moves);
      const moved = sceneOf(r.save.episodeState.at) !== sceneOf(session.save.episodeState.at);

      setSession({
        // Уход в другое место закрывает книгу сам: читать её из соседней комнаты
        // нельзя, а специально гасить режим в контенте — лишняя обязанность.
        save: { ...r.save, openItem: moved ? null : openItem },
        overlay: null,
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
      const option = catalog.find((o) => o.system?.kind === kind);
      if (option) run(option);
    },
    [catalog, run],
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

  /**
   * Поток к месту, где сущность встретилась. Прокрутка считается от низа,
   * поэтому нужное место переводится в её единицы здесь же: снаружи об этом
   * знать незачем.
   */
  const scrollTo = useCallback(
    (at: number) => {
      if (!session) return;
      // Между записями поток ставит пустую строку — первая строка записи идёт
      // сразу за ней.
      const before = streamLines(transcript.slice(0, at), layout.text, null, episode?.speakers ?? {}).length;
      const top = before === 0 ? 0 : before + 1;
      setScroll(Math.max(0, Math.min(layout.maxScroll, layout.stream.length - layout.streamRows - top)));
    },
    [session, layout, episode],
  );

  /**
   * Открыть панель. Показывается последняя сущность этого типа: игрок жмёт
   * клавишу сразу после того, как что-то прочитал, и спрашивает именно про это.
   */
  const openPanel = useCallback(
    (kind: PanelKind) => {
      if (!session) return;
      // Место, куда вернуть поток, запоминается один раз: переключение панели
      // не должно терять исходное положение.
      const keep = (index: number) => setPanel((prev) => ({ kind, index, scroll: prev?.scroll ?? scroll }));

      if (kind === 'inventory') {
        // Инвентарь открывается на той вещи, о которой вспомнили последней;
        // поток при этом не двигается — вещь не звучала, её просто носят.
        const items = session.save.inventory;
        const at = lastItem == null ? items.length - 1 : items.indexOf(lastItem);
        keep(Math.max(0, at));
        setFocus(null);
        return;
      }

      const list = sessionEntities(transcript, kind);
      const index = Math.max(0, list.length - 1);
      keep(index);
      const current = list[index];
      if (current) {
        scrollTo(current.at);
        setFocus(current.mention);
      }
    },
    [session, scroll, scrollTo, lastItem],
  );

  /** Соседняя запись панели: знание — по последним упоминаниям, вещи — по инвентарю. */
  const movePanel = useCallback(
    (step: number) => {
      if (!panel || !session) return;

      if (panel.kind === 'inventory') {
        const items = session.save.inventory;
        if (items.length === 0) return;
        const index = (panel.index + step + items.length) % items.length;
        setPanel({ ...panel, index });
        setLastItem(items[index]!);
        return;
      }

      const list = sessionEntities(transcript, panel.kind);
      if (list.length === 0) return;
      const index = (panel.index + step + list.length) % list.length;
      setPanel({ ...panel, index });
      const current = list[index]!;
      scrollTo(current.at);
      setFocus(current.mention);
    },
    [panel, session, scrollTo],
  );

  /** Закрыть панель: поток возвращается туда, где игрок его оставил. */
  const closePanel = useCallback(() => {
    if (!panel) return;
    setScroll(panel.scroll);
    setPanel(null);
    setFocus(null);
  }, [panel]);

  /*
   * Фокус гаснет сам. Он показывает место, а не помечает его навсегда: висящая
   * подложка через минуту начнёт читаться как свойство текста.
   */
  useEffect(() => {
    if (!focus) return;
    const id = setTimeout(() => setFocus(null), 2000);
    return () => clearTimeout(id);
  }, [focus]);

  /**
   * Клавиши хранилища вещей. Возвращает `true`, если клавиша здесь и осталась.
   *
   * Два уровня: список вещей и действия открытой. `Esc` на верхнем уровне
   * закрывает хранилище общим путём — отдельного «выхода из выхода» тут не надо.
   */
  const runStorage = useCallback(
    (key: string): boolean => {
      if (!content || !session || session.overlay?.kind !== 'инвентарь') return false;
      const items = session.save.inventory;
      if (items.length === 0) return false;

      if (storage.open == null) {
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          const step = key === 'ArrowDown' ? 1 : items.length - 1;
          setStorage((s) => ({ ...s, pick: (s.pick + step) % items.length }));
          return true;
        }
        if (key === 'Enter') {
          const id = items[Math.min(storage.pick, items.length - 1)]!;
          const doc = Object.values(content.docs).find((d) => d.id === id);
          if (doc) setStorage((s) => ({ ...s, open: doc.docId, act: 0 }));
          return true;
        }
        return false;
      }

      const actions = itemActions(content, session.save, storage.open);
      if (key === 'Escape') {
        setStorage((s) => ({ ...s, open: null, act: 0 }));
        return true;
      }
      if (actions.length === 0) return false;
      if (key === 'ArrowUp' || key === 'ArrowDown') {
        const step = key === 'ArrowDown' ? 1 : actions.length - 1;
        setStorage((s) => ({ ...s, act: (s.act + step) % actions.length }));
        return true;
      }
      if (key === 'Enter') {
        // Действие исполняется обычным путём: эхо в потоке, атрибуты, режим
        // чтения — всё как у команды, набранной руками. Хранилище при этом
        // закрывается само, потому что игрок уже не в нём.
        const action = actions[Math.min(storage.act, actions.length - 1)]!;
        run(action);
        return true;
      }
      return false;
    },
    [content, session, storage, run],
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
    setSession({ ...session, save: r.save });
  }, [content, session, node]);

  /**
   * Карточка подтверждена: одной операцией устанавливается контекст и играется
   * цель. Пока этого не произошло, ни дата, ни срез, ни цель не тронуты.
   */
  const transitionDone = useCallback(() => {
    if (!content || !session || !transition) return;
    const r = confirmTransition(content, session.save, transition.docId);
    setSession({ save: r.save, overlay: null, history: session.history });
    setScroll(0);
  }, [content, session, transition]);

  /**
   * Шаг по полю. Решает движок: отклонённый ход (за сетку, в занятую клетку,
   * по решённому полю) сюда не возвращается и ничего не меняет.
   */
  const minigameMove = useCallback(
    (dx: number, dy: number) => {
      if (!content || !session || !field || spot == null) return;
      const next = moveMinigame(field, session.save, spot, dx, dy);
      if (next) setSession({ ...session, save: next });
    },
    [content, session, field, spot],
  );

  /**
   * `Enter` на распутанном поле: одной операцией ставится `completionApplied`,
   * применяются атрибуты узла завершения и игра входит в него. До этого игрок
   * сидит на решённой странице и читает — эффекты не выдаются вместе с
   * последним движением точки.
   */
  const minigameDone = useCallback(() => {
    if (!content || !session || !field) return;
    const r = completeMinigame(content, session.save, field);
    setSpot(null);
    setSession({ save: r.save, overlay: null, history: session.history });
    setScroll(0);
  }, [content, session, field]);

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
  const teaching = Boolean(session) && !session!.save.taught && !isCard && !transition && !splash && !field;
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
    Boolean(session) &&
    !isCard &&
    !isMontage &&
    !field &&
    !transition &&
    !splash &&
    !manual &&
    !menu &&
    !session?.overlay;

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
   * Раунд «надавить» ([[07b-надавить-тз]]): время считают те же часы, что
   * физическое ожидание, и по той же причине — активное время игры. Справочник,
   * «Дело», меню и свёрнутая вкладка его останавливают: игра проверяет, как
   * игрок связывает услышанное, а не память на id карточек.
   *
   * Частично набранная команда таймер **не** останавливает: иначе первая буква
   * превращалась бы в паузу.
   */
  const round = content && session ? roundHere(content, session.save) : null;
  const clock = content && session ? pressureClock(content, session.save) : null;
  const pressing = accepting && !noLimit && round != null && clock != null && clock.left > 0;

  const livePressure = useCallback((passed: number) => {
    setSession((prev) => (prev ? { ...prev, save: tickPressure(prev.save, passed) } : prev));
  }, []);

  useWaitClock(pressing, livePressure);

  /*
   * Время вышло — исполняется авторская ветка молчания, и без эха команды:
   * игрок ничего не вводил. Незавершённый набор при этом стирается, иначе он
   * останется висеть над чужой сценой.
   */
  useEffect(() => {
    if (!content || !session || !accepting || noLimit) return;
    const next = silenceRoute(content, session.save);
    if (next == null) return;
    setInput('');
    setPick(null);
    const r = enter(content, session.save, next);
    setSession({ ...session, save: r.save });
  }, [content, session, accepting, noLimit]);

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
    setSession({ ...session, save: r.save });
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
       * Пока на экране поле мини-игры, клавиатура принадлежит ему целиком
       * ([[07a-мини-игра]], «Управление»): цифра выбирает точку, а не открывает
       * меню, и стрелки двигают точку, а не листают команды. Оболочке остаётся
       * экран управления — его `?` обязан работать всегда.
       */
      if (field) {
        if (key === MANUAL_KEY) {
          event.preventDefault();
          setReopened(true);
        }
        return;
      }

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

      /*
       * Пока панель открыта, стрелки и `Esc` принадлежат ей (07-оболочка-тз).
       * Остальные клавиши в этот момент не делают ничего: строка ввода никуда
       * не делась и восстановится ровно такой, какой была, — а набирать вслепую
       * под чужой панелью нечестно.
       */
      if (panel) {
        event.preventDefault();
        const other = PANEL_KEYS[key];
        if (key === 'Escape') closePanel();
        else if (key === 'ArrowLeft') movePanel(-1);
        else if (key === 'ArrowRight') movePanel(1);
        // Цифра переключает тип панели, не закрывая её: три ящика рядом,
        // а не три отдельных захода.
        else if (other) openPanel(other);
        return;
      }

      if (session.overlay) {
        event.preventDefault();
        /*
         * Хранилище вещей — единственный оверлей, в котором что-то делают,
         * а не только читают: собственные действия предмета живут здесь
         * ([[99-открытые-вопросы]]). Клавиши те же, что в списке команд,
         * — новых связок ради второго списка не заводим.
         */
        if (runStorage(key)) return;
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

      const panelKey = meta ? PANEL_KEYS[key] : undefined;
      if (panelKey) {
        event.preventDefault();
        openPanel(panelKey);
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
          const row = pick == null ? null : choices[pick];
          // Выбрана семья — раскрываем её, а не исполняем: это не опция игры.
          if (row && expand(row)) return;
          const chosen = exact(catalog, input) ?? optionOf(row ?? undefined);
          // Ввод валидируется до отправки: если совпадения нет, не происходит
          // ничего. Ни одного «не понимаю» за всю игру.
          if (chosen) run(chosen);
          return;
        }
        case 'Tab': {
          event.preventDefault();
          if (choices.length === 0) return;
          // На выбранной семье Tab раскрывает её — тем же префиксом, что Enter.
          const row = pick == null ? null : choices[pick];
          if (row && expand(row)) return;

          const prefix = commonPrefix(shown);
          // Tab сначала дописывает общее, а дальше листает — и это уже осознанный
          // выбор, после которого показывается реплика.
          if (prefix.length > input.length && pick == null) setInput(prefix);
          else setPick((p) => (p == null ? 0 : (p + 1) % choices.length));
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
          if (choices.length === 0) return;
          setPick((p) =>
            p == null
              ? key === 'ArrowDown' ? 0 : choices.length - 1
              : (p + (key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length,
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
    // Сейв от прежней версии: до подтверждения ни игры, ни стирания записи.
    if (stale != null) {
      return (
        <Stale
          from={stale}
          to={bundle.content.saveVersion}
          touch={TOUCH}
          onRestart={() => {
            setStale(null);
            restart();
          }}
        />
      );
    }
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
        <Menu
          onClose={() => setMenu(false)}
          onManual={menuManual}
          onRestart={restart}
          untimed={noLimit}
          onUntimed={(value) => {
            setUntimed(value);
            setNoLimit(value);
          }}
          touch={TOUCH}
        />
      );
    }
    if (manual) return <Manual first={!session.save.taught} touch={TOUCH} onDone={manualDone} />;
    // Поле занимает место потока и ввода целиком; статус с местом и датой
    // остаётся сверху ([[07a-мини-игра]], «Рендерер»).
    if (field && untangle) {
      return (
        <UntangleScreen
          def={field}
          points={untangle.points}
          analysis={untangle.analysis}
          selected={spot}
          cols={cols}
          status={statusLine(
            placeLabel(bundle.content, session.save),
            statusText(dateAt(bundle.content, session.save), terms(bundle.content, session.save)),
            cols,
          )}
          touch={TOUCH}
          onSelect={setSpot}
          onMove={minigameMove}
          onMenu={() => setMenu(true)}
          onDone={minigameDone}
        />
      );
    }
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
    if (transition) {
      return (
        <Transition
          card={transitionCard(transition)}
          bios={[]}
          cols={cols}
          rows={rows}
          glyphs={frameGlyphs(renderer.frame)}
          onDone={transitionDone}
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
          lines={overlayLines(session.overlay, bundle.content, session.save, cols - 3, storage)}
          scroll={scroll}
          glyphs={frameGlyphs(renderer.frame)}
          {...(TOUCH ? { close: `${TAP_HINT} — закрыть`, onClose: closeOverlay }
          : session.overlay.kind === 'инвентарь' && session.save.inventory.length > 0 ?
            {
              close:
                storage.open == null ?
                  '↑ ↓ — выбрать · Enter — открыть · Esc — закрыть'
                : '↑ ↓ — выбрать · Enter — выполнить · Esc — назад',
            }
          : {})}
        />
      );
    }

    if (TOUCH) {
      return (
        <MobileScreen
          cols={cols}
          status={statusLine(
            placeLabel(bundle.content, session.save),
            statusText(dateAt(bundle.content, session.save), terms(bundle.content, session.save)),
            cols,
          )}
          stream={layout.stream}
          // Аргументы служебных команд (`справочник контейнмент`) в список не
          // идут: они существуют ради набора, а пальцем до статьи добираются
          // через сам справочник. Иначе полсотни строк поверх трёх нужных.
          options={choices.filter((row) => row.kind === 'family' || !row.option.system)}
          onPick={(row) => {
            // Семью трогают, чтобы раскрыть: на телефоне это тот же непустой
            // ввод, просто набирать его нечем.
            const option = optionOf(row);
            if (option && !expand(row)) run(option);
          }}
          {...(input === '' ? {} : { onBack: () => setInput('') })}
          system={systemTaps}
          rule={ruleGlyph(renderer.rule)}
          {...(clock && !noLimit ?
            { timer: [{ text: ' '.repeat(MARGIN.text) }, ...timerSegs(clock.left, clock.total, timerGlyphs(renderer.timer))] }
          : {})}
        />
      );
    }

    return (
      <GameScreen
        cols={cols}
        streamRows={layout.streamRows}
        status={statusLine(
          placeLabel(bundle.content, session.save),
          statusText(dateAt(bundle.content, session.save), terms(bundle.content, session.save)),
          cols,
        )}
        stream={viewport(layout.stream, layout.streamRows, scroll)}
        input={inputLine(input)}
        list={commandLines(choices, pick, input, layout.text, LIST_ROWS)}
        details={detailLines(
          picked ? previewOf(bundle.content, session.save, picked) : null,
          picked?.attrs.advance ?? false,
          picked?.needs ?? null,
          // Шкала времени раунда «надавить». Без ограничений по времени её нет
          // вовсе: показывать убывающую полосу, которая ничего не решает, —
          // обман ([[07b-надавить-тз]], «Доступность»).
          clock && !noLimit ? { ...clock, glyphs: timerGlyphs(renderer.timer) } : null,
          layout.text,
          DETAIL_ROWS,
        )}
        system={systemLine(SYSTEM_COMMANDS, layout.text)}
        panel={
          !panel || !session ? null
          : panel.kind === 'inventory' ?
            inventoryLines(bundle.content, session.save, panel.index, cols, LOWER_ROWS - 1)
          : contextLines(
              panel.kind,
              sessionEntities(transcript, panel.kind),
              panel.index,
              bundle.content,
              session.save,
              cols,
              LOWER_ROWS - 1,
            )
        }
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
  //
  // Адрес обучения — логический (`rooms-virt/tu.dorm-room:00`, 07-оболочка-тз,
  // «episode.yaml»), и он без якоря: подсказка принадлежит комнате, а не
  // конкретному её состоянию. Иначе она пропадала бы при первом же входе через
  // `entry` или сохранённое состояние — там адрес узла уже другой.
  const hint = (() => {
    const at = episode?.tutorial.at;
    if (!session || !episode?.tutorial.hint || manual || menu || session.save.hinted || at == null) return null;
    const here = session.save.episodeState.at;
    const inRoom = at.endsWith('#') ? sceneOf(here) === sceneOf(at) : here === at;
    return inRoom ? episode.tutorial.hint : null;
  })();

  const announce =
    clock == null || noLimit ? ''
    : clock.left <= clock.total / 4 ? 'время кончается'
    : clock.left <= clock.total / 2 ? 'половина времени'
    : 'ответ ограничен по времени';

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
      {/*
        Раунд «надавить» для screen reader ([[07b-надавить-тз]], «Доступность»):
        один раз объявляется, что ответ ограничен по времени, и дальше ровно два
        предупреждения — на половине и на последней четверти. Читать секунды
        непрерывно запрещено: это не часы, а разговор.
      */}
      <div className="sr" aria-live="polite">{announce}</div>
    </div>
  );

  if (!renderer || !episode) return screen;
  const Renderer = rendererFor(episode.renderer);
  return <Renderer def={renderer}>{screen}</Renderer>;
}
