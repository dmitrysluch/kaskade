import { useEffect, useMemo, useState } from 'react';
import { movesFrom, shortestPath, storyMap, walkSteps, type PathStep } from '../../shared/graph.ts';
import { edgePath, place, type BoxSize } from './layout.ts';
import { SceneMap } from './Scene.tsx';
import { StartDialog } from './Start.tsx';
import type { GameContent } from '../../shared/types.ts';

/**
 * Служебный просмотр графа (`/adm`).
 *
 * Инструмент автора, а не режим игры: отдельный адрес, обычная типографика,
 * ничего от терминала. Притворяться игрой ему незачем — как и обучающему слою,
 * притворство тут хуже прямоты.
 *
 * Две вещи, которых не хватало при письме:
 *
 *   1. **Карта заметок.** Видно форму главы: где ветка, где длинная кишка,
 *      что до чего не дотягивается. Узлы в коробку не помещаются — их две
 *      сотни, — поэтому коробка это заметка, а внутрь смотрят по клику.
 *   2. **Путь между двумя узлами.** Не «есть ли связь», а прочитать её подряд:
 *      текст узлов и команды между ними. Так вычитывается ветка, которую
 *      в игре пришлось бы отыгрывать заново.
 *
 * Условия при обходе не проверяются (`shared/graph.ts`): это карта написанного,
 * а не то, что увидит игрок с конкретными флагами.
 *
 * Стиль подключает `main.tsx`, а не этот файл: компонент тогда грузится
 * и в тестах, где `.css` импортировать нечем.
 */

type Bundle = { ok: true; content: GameContent } | { ok: false; errors: string[] };

/** Размер коробки заметки; сама раскладка — в `layout.ts`, она общая. */
const BOX: BoxSize = { w: 210, h: 62, gapX: 34, gapY: 46 };

function nodeName(addr: string): string {
  const hash = addr.indexOf('#');
  const id = addr.slice(hash + 1);
  return `${addr.slice(0, hash).split('/').pop()}#${id}`;
}

/**
 * Данные отдельно от вида: вид — чистая функция от контента, и его можно
 * отрисовать в тесте, не поднимая ни сервера, ни браузера.
 */
export function Adm() {
  const [bundle, setBundle] = useState<Bundle | null>(null);

  // Тот же источник и тот же ws, что у игры: правишь заметку — карта
  // перерисовывается, не теряя выбранного пути.
  useEffect(() => {
    void fetch('/api/content')
      .then((r) => r.json() as Promise<Bundle>)
      .then(setBundle)
      .catch((e: Error) => setBundle({ ok: false, errors: [`сервер не отвечает: ${e.message}`] }));

    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data as string) as { type: string; bundle: Bundle };
      if (message.type === 'content') setBundle(message.bundle);
    };
    return () => ws.close();
  }, []);

  if (!bundle) return <div className="adm-wait">…</div>;
  if (!bundle.ok) {
    return (
      <div className="adm">
        <h1>Контент не собран</h1>
        <ul className="adm-errors">
          {bundle.errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }
  return <AdmView content={bundle.content} />;
}

export function AdmView({ content }: { content: GameContent }) {
  const [episodeId, setEpisodeId] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  /** Выбранный узел внутри раскрытой заметки. */
  const [node, setNode] = useState<string | null>(null);
  /**
   * Путь, собранный руками: адреса узлов подряд. Граф не дерево, и парой
   * «откуда/куда» ветка не задаётся — её приходится называть по узлам.
   */
  const [walk, setWalk] = useState<string[]>([]);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  /** Узел, с которого собираются играть: открыто окно отладочного входа. */
  const [play, setPlay] = useState<string | null>(null);

  const episode = episodeId ?? content.episodes[0]?.id ?? null;
  const map = useMemo(
    () => (episode ? storyMap(content, episode) : { boxes: [], edges: [], columns: [] }),
    [content, episode],
  );
  const { boxes, width, height } = useMemo(() => place(map.columns, BOX), [map]);
  const at = useMemo(() => new Map(boxes.map((b) => [b.docId, b])), [boxes]);

  const path = useMemo(() => (from && to ? shortestPath(content, from, to) : null), [content, from, to]);

  const last = walk.at(-1) ?? null;
  const candidates = useMemo(
    () => new Set(last ? movesFrom(content, last).map((m) => m.target) : []),
    [content, last],
  );
  const steps = useMemo(() => walkSteps(content, walk), [content, walk]);

  /**
   * Клик по узлу. Следующий шаг — добавляет, любой другой узел — только
   * выбирает: терять руками собранный путь от промаха нельзя, а начать заново
   * предлагает кнопка в карточке.
   */
  const pickNode = (addr: string) => {
    setNode(addr);
    if (walk.length === 0) setWalk([addr]);
    else if (candidates.has(addr)) setWalk([...walk, addr]);
  };

  /** Шаг наружу заметки: путь продолжается, и открывается соседняя заметка. */
  const follow = (addr: string) => {
    setWalk([...walk, addr]);
    setOpen(addr.slice(0, addr.indexOf('#')));
    setNode(addr);
  };

  const doc = open ? content.docs[open] : null;
  const closed = doc != null && (content.episodes.find((e) => e.id === episode)?.closed.includes(doc.docId) ?? false);
  const entry = content.episodes.find((e) => e.id === episode)?.entry ?? '';

  return (
    <div className="adm">
      <header className="adm-head">
        <h1>Карта</h1>
        {content.episodes.length > 1 && (
          <select value={episode ?? ''} onChange={(e) => setEpisodeId(e.target.value)}>
            {content.episodes.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        )}
        <span className="adm-counts">
          {map.boxes.length} заметок · {Object.keys(content.nodes).length} узлов ·{' '}
          {map.edges.length} связей
        </span>
      </header>

      <svg className="adm-map" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {map.edges.map((edge) => {
          const a = at.get(edge.from);
          const b = at.get(edge.to);
          if (!a || !b) return null;
          return (
            <path
              key={`${edge.from}→${edge.to}`}
              className={edge.back ? 'adm-edge adm-edge-back' : 'adm-edge'}
              d={edgePath(a, b, edge.back, BOX)}
              strokeWidth={Math.min(3, edge.count)}
            />
          );
        })}

        {boxes.map((box) => (
          <g
            key={box.docId}
            className={[
              'adm-box',
              box.type === 'room' ? 'adm-room' : 'adm-scene',
              box.closed ? 'adm-closed' : '',
              box.layer === -1 ? 'adm-lost' : '',
              open === box.docId ? 'adm-open' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => {
              setOpen(open === box.docId ? null : box.docId);
              // Узел принадлежал прошлой заметке: в новой его нет.
              setNode(null);
            }}
          >
            <rect x={box.x} y={box.y} width={BOX.w} height={BOX.h} rx={3} />
            <text x={box.x + 12} y={box.y + 24}>
              {box.label}
            </text>
            <text className="adm-sub" x={box.x + 12} y={box.y + 42}>
              {box.id} · {box.nodes} узл. {box.items.length > 0 ? `· ${box.items.length} предм.` : ''}
            </text>
            {entry.startsWith(`${box.docId}#`) && (
              <text className="adm-tag" x={box.x + BOX.w - 12} y={box.y + 24}>
                вход
              </text>
            )}
            {box.closed && (
              <text className="adm-tag" x={box.x + BOX.w - 12} y={box.y + 42}>
                закрыта
              </text>
            )}
          </g>
        ))}
      </svg>

      {map.columns.at(-1)?.some((b) => b.layer === -1) && (
        <p className="adm-note">
          Нижний ряд из входа не достигается: закрытая заметка, черновик или отвалившаяся ветка.
        </p>
      )}

      {doc && (
        <section className="adm-doc">
          <h2>
            {doc.label}{' '}
            <span className="adm-sub">
              {doc.docId} · {doc.nodes.length} узлов
            </span>
            {doc.nodes[0] && (
              <button type="button" className="adm-play" onClick={() => setPlay(doc.nodes[0]!.addr)}>
                ▶ играть с этой заметки
              </button>
            )}
          </h2>
          {closed && (
            <p className="adm-note adm-none">
              Заметка закрыта демо-срезом (`closed` в episode.yaml): играть с неё можно,
              но переходы в неё в самой игре не появятся.
            </p>
          )}
          <p className="adm-note">
            Коробка — узел, подпись под именем — команда, которой в него приходят.
            Пометы: <span className="adm-advance">▶</span> необратимо, ⚑ ставит флаг, + выдаёт
            слово или вещь, 1× только раз.
          </p>
          <SceneMap
            content={content}
            docId={doc.docId}
            selected={node}
            onSelect={pickNode}
            walk={walk}
            candidates={candidates}
            onFollow={follow}
          />

          <div className="adm-walk-bar">
            {walk.length === 0 ?
              <span className="adm-sub">Кликните узел — с него начнётся путь.</span>
            : <>
                <span className="adm-sub">
                  путь: {walk.length} узл., {Math.max(0, walk.length - 1)} переход(ов)
                </span>
                <button type="button" onClick={() => setWalk(walk.slice(0, -1))}>
                  шаг назад
                </button>
                <button type="button" onClick={() => setWalk([])}>
                  сбросить
                </button>
              </>
            }
          </div>

          {node && (
            <NodeCard
              content={content}
              addr={node}
              onFrom={setFrom}
              onTo={setTo}
              onStart={() => setWalk([node])}
              onPlay={setPlay}
              inWalk={walk.includes(node)}
            />
          )}

          {walk.length > 1 && (
            <>
              <h2>Собранный путь</h2>
              <PathSteps content={content} path={steps} />
            </>
          )}
        </section>
      )}

      {play && <StartDialog content={content} addr={play} onClose={() => setPlay(null)} />}

      <section className="adm-path">
        <h2>Путь</h2>
        <div className="adm-pair">
          <Picker content={content} value={from} onChange={setFrom} label="откуда" />
          <Picker content={content} value={to} onChange={setTo} label="куда" />
        </div>

        {from && to && !path && <p className="adm-none">Пути нет: из «{nodeName(from)}» в «{nodeName(to)}» не дойти.</p>}

        {path && (
          <>
            <p className="adm-note">
              {path.length - 1} переход(ов), кратчайший. Граф не дерево: если веток
              несколько, нужную соберите руками на графе заметки.
            </p>
            <PathSteps content={content} path={path} />
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Карточка выбранного узла: текст, что из него ведёт и куда. Отсюда же узел
 * берут в путь — иначе его пришлось бы искать в списке на две сотни строк.
 */
function NodeCard({
  content,
  addr,
  onFrom,
  onTo,
  onStart,
  onPlay,
  inWalk,
}: {
  content: GameContent;
  addr: string;
  /** Отладочный вход: открывает окно, где отмечают уже сделанное. */
  onPlay: (addr: string) => void;
  onFrom: (addr: string) => void;
  onTo: (addr: string) => void;
  onStart: () => void;
  /** Узел уже в пути: предлагать «начать отсюда» значило бы предложить сброс. */
  inWalk: boolean;
}) {
  const node = content.nodes[addr];
  if (!node) return null;

  return (
    <div className="adm-card">
      <div className="adm-via">
        <span className="adm-sub">{nodeName(addr)}</span>
        {node.attrs.set.map((f) => (
          <span key={f}>⚑ {f}</span>
        ))}
        {node.attrs.give.map((g) => (
          <span key={g}>+ {g}</span>
        ))}
        {node.attrs.if && <span className="adm-route">if: {node.attrs.if}</span>}
        <span className="adm-pick">
          {/* Отладочный вход: игра открывается прямо на этом узле, с чистым
              состоянием. Что узлу нужно из флагов — написано тут же, слева. */}
          <button type="button" className="adm-play" onClick={() => onPlay(addr)}>
            ▶ играть отсюда
          </button>
          {!inWalk && (
            <button type="button" onClick={onStart}>
              начать путь отсюда
            </button>
          )}
          <button type="button" onClick={() => onFrom(addr)}>
            откуда
          </button>
          <button type="button" onClick={() => onTo(addr)}>
            куда
          </button>
        </span>
      </div>

      <pre className="adm-body">{node.text}</pre>

      <ul className="adm-outs">
        {node.options.map((option, i) => (
          <li key={`${option.target ?? ''}-${i}`}>
            <span className={option.label === '' ? 'adm-route' : ''}>
              {option.label === '' ? 'маршрут' : `› ${option.label}`}
            </span>
            {option.attrs.advance && <span className="adm-advance"> ▶</span>}
            <span className="adm-sub"> → {option.target ? nodeName(option.target) : '—'}</span>
          </li>
        ))}
        {node.options.length === 0 && <li className="adm-sub">выходов нет</li>}
      </ul>
    </div>
  );
}

/** Выбор узла: сгруппирован по заметкам, потому что иначе это две сотни строк. */
function Picker({
  content,
  value,
  onChange,
  label,
}: {
  content: GameContent;
  value: string;
  onChange: (addr: string) => void;
  label: string;
}) {
  return (
    <label className="adm-picker">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {Object.values(content.docs).map((doc) => (
          <optgroup key={doc.docId} label={`${doc.label} · ${doc.docId}`}>
            {doc.nodes.map((node) => (
              <option key={node.addr} value={node.addr}>
                {node.id || '(вступление)'}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/** Чтение пути: одинаковое и для кратчайшего, и для собранного руками. */
function PathSteps({ content, path }: { content: GameContent; path: PathStep[] }) {
  return (
    <ol className="adm-steps">
      {path.map((step, i) => (
        <Step key={`${step.addr}-${i}`} step={step} content={content} />
      ))}
    </ol>
  );
}

function Step({ step, content }: { step: PathStep; content: GameContent }) {
  const node = content.nodes[step.addr];
  return (
    <li className="adm-step">
      <div className="adm-via">
        {step.via == null ? <span className="adm-route">маршрут</span> : <span>› {step.via}</span>}
        {step.advance && <span className="adm-advance">▶ необратимо</span>}
        {/* Заметку правили после того, как путь собрали: шага больше нет. */}
        {step.broken && <span className="adm-broken">связь пропала</span>}
        <span className="adm-sub">{nodeName(step.addr)}</span>
      </div>
      {/* Текст целиком: путь для того и читают, чтобы вычитать написанное. */}
      <pre className="adm-body">{node?.text ?? ''}</pre>
    </li>
  );
}
