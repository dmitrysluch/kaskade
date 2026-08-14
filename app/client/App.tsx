import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildCatalog, SYSTEM_COMMANDS, type CatalogOption } from './engine/catalog.ts';
import { commonPrefix, exact, matches } from './engine/completion.ts';
import {
  dateAt,
  enter,
  freshSave,
  pagesOf,
  previewOf,
  sceneOf,
  terms,
  type Session,
  type StreamEntry,
  type SystemCommand,
} from './engine/state.ts';
import { loadSave, persistSave } from './engine/save.ts';
import { rendererFor } from './renderers/registry.ts';
import { useMetrics } from './ui/metrics.ts';
import {
  DETAIL_ROWS,
  ErrorScreen,
  frameGlyphs,
  GameScreen,
  LIST_ROWS,
  LOWER_ROWS,
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
import { Splash } from './ui/Splash.tsx';
import { Transition } from './ui/Transition.tsx';
import { Ambience, keystroke } from './audio/index.ts';
import { CLOSE, EXAMINE } from '../shared/pages.ts';
import { MARGIN } from './ui/text.ts';
import type { GameContent } from '../shared/types.ts';

type Bundle = { ok: true; content: GameContent } | { ok: false; errors: string[] };

/**
 * Хоткей — быстрый путь к той же команде, отдельной ветки поведения у него нет.
 * F3 в этот список не входит: экран управления принадлежит оболочке, а не
 * терминалу, и команды `управление` не существует.
 */
const HOTKEYS: Record<string, SystemCommand> = {
  F1: 'справочник',
  F2: 'дело',
};

/**
 * Прокрутка потока. `PgUp`/`PgDn` по ТЗ, но на ноутбуке без цифрового блока это
 * `Fn` со стрелкой — поэтому те же действия продублированы функциональными
 * клавишами, как и всё остальное в этом интерфейсе.
 *
 * `+1` — вверх, к тому, что было раньше.
 */
const SCROLL_KEYS: Record<string, number> = {
  PageUp: 1,
  F4: 1,
  PageDown: -1,
  F5: -1,
};

const ambience = new Ambience();

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
        const started = { ...freshSave(content), started: true };
        const r = enter(content, started, started.episodeState.at);
        return { save: r.save, stream: r.entries, overlay: null, reading: null, history: [] };
      }

      const save = loadSave(content);
      if (!save.started) {
        const r = enter(content, { ...save, started: true }, save.episodeState.at);
        return { save: r.save, stream: r.entries, overlay: null, reading: null, history: [] };
      }
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
  );

  const node = content && session ? content.nodes[session.save.episodeState.at] : undefined;
  const isCard = node?.attrs.tag.includes('titlecard') ?? false;

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
   * Последний термин справочника, который был на экране. F1 открывает справочник
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

  const layout = useMemo(() => {
    // Текст идёт во всю сетку, от поля до поля: поля — это те самые два-четыре
    // пробела, а не колонка посреди пустого экрана.
    const text = Math.max(1, cols - MARGIN.text - MARGIN.right);

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
        option.verb === EXAMINE && option.object && pagesOf(content, option.object).length > 1;
      const reading =
        option.verb === CLOSE ? null
        : opens ? option.object
        : session.reading;

      if (option.system) {
        setSession({
          ...session,
          save: counted,
          overlay: option.system,
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
      setInput('');
      setPick(null);
    },
    [content, session, episode],
  );

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

  // Пока идёт сплэш или обучение, ввод не принимается: терминал в этот момент
  // не терминал.
  const accepting = Boolean(session) && !isCard && !splash && !manual && !session?.overlay;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!session) return;
      const key = event.key;
      const page = Math.max(1, layout.streamRows - 1);

      // Обучающий слой закрывается любой клавишей — это не «нажмите любую
      // клавишу», а «понял, дальше сам».
      if (manual) {
        event.preventDefault();
        manualDone();
        return;
      }

      // F3 принадлежит оболочке: открывает обучающий слой напрямую, не подставляет
      // текст в строку, не эхается и не оставляет записи в истории.
      if (key === 'F3') {
        event.preventDefault();
        setReopened(true);
        return;
      }

      // Хоткей — быстрый путь к той же самой команде, отдельной ветки у него нет.
      const hotkey = HOTKEYS[key];
      if (hotkey) {
        event.preventDefault();
        // F1 открывает справочник на последнем термине, который был на экране:
        // иначе игрок, не понявший слова, получает вместо ответа стену терминов.
        const arg = hotkey === 'справочник' ? lastTerm : null;
        const option =
          catalog.find((o) => o.system?.kind === hotkey && o.system.arg === arg) ??
          catalog.find((o) => o.system?.kind === hotkey && o.system.arg === null);
        if (option) run(option);
        return;
      }

      const scrollBy = SCROLL_KEYS[key];

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

      if (scrollBy) {
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
    // Лицо и запись на одном узле — личное дело: лицо, под ним рамка. Держится
    // столько же, сколько сплэш: разглядеть надо и то, и другое.
    if (splash && isCard) {
      return (
        <Splash
          lines={portraitLines(splash)}
          card={node?.text ?? ''}
          glyphs={frameGlyphs(renderer.frame)}
          onDone={splashCardDone}
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
        />
      );
    }
    if (splash) {
      return (
        <Splash lines={portraitLines(splash)} onDone={splashDone} />
      );
    }
    // Обучающий слой поверх всего: инструкция к игре, а не игра.
    if (manual) return <Manual first={!session.save.taught} />;
    if (session.overlay) {
      return (
        <OverlayScreen
          cols={cols}
          rows={rows}
          title={overlayTitle(session.overlay)}
          lines={overlayLines(session.overlay, bundle.content, session.save, cols - 3)}
          scroll={scroll}
          glyphs={frameGlyphs(renderer.frame)}
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
    session && episode?.tutorial.hint && !manual && !session.save.hinted &&
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
