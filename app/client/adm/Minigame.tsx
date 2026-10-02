import { useState } from 'react';
import { analyze, isSolved, shifted, THREADS, type Cell } from '../../shared/untangle.ts';
import type { GameContent, MinigameDef } from '../../shared/types.ts';

/**
 * Поля мини-игр в служебном просмотре ([[07a-мини-игра]], «Валидация контента»).
 *
 * Здесь показывается то, чего в игре не видно и видеть нельзя: авторское
 * решение. Автору оно нужно, чтобы проверить раскладку руками, а игроку —
 * нет, поэтому клиентская сборка его не получает вовсе. Если `solution` не
 * приехала, значит открыт прод-адрес без `ADM`, и карточка честно об этом
 * говорит, а не рисует пустую сетку.
 */

const SIZE = 150;

export function Minigames({ content, episode }: { content: GameContent; episode: string | null }) {
  const fields = Object.values(content.minigames).filter((def) => def.docId.startsWith(`episodes/${episode}/`));
  if (fields.length === 0) return null;

  return (
    <section className="adm-mini">
      <h2>Мини-игры</h2>
      {fields.map((def) => (
        <Field key={def.docId} def={def} />
      ))}
    </section>
  );
}

function layout(def: MinigameDef, which: 'start' | 'solution'): Record<number, Cell> {
  return Object.fromEntries(
    Object.entries(def.points).flatMap(([id, p]) => {
      const cell = which === 'start' ? p.start : p.solution;
      return cell == null ? [] : [[Number(id), cell] as const];
    }),
  );
}

function Field({ def }: { def: MinigameDef }) {
  const [checked, setChecked] = useState<string | null>(null);
  const start = analyze(layout(def, 'start'), def.threads);
  const solution = layout(def, 'solution');
  const known = Object.keys(solution).length === Object.keys(def.points).length;
  const moved = shifted(def.id, def.seed, def.documents, start.crossings);

  return (
    <div className="adm-field">
      <h3>
        {def.label} <span className="adm-sub">{def.docId}</span>
      </h3>
      <p className="adm-sub">
        {Object.keys(def.points).length} точек · {def.threads.length} нитей · сетка {def.grid.columns}×
        {def.grid.rows} · семя {def.seed} · завершение «{def.complete}»
      </p>
      <p className="adm-sub">
        стартовых пересечений {start.crossings.length} · сдвинуто позиций {moved} из {THREADS} ·{' '}
        документы: {def.documents.map((d) => `${d.label} (${d.paragraphs.length} абз.)`).join(', ')}
      </p>

      <div className="adm-pair">
        <Layout def={def} points={layout(def, 'start')} caption="start" />
        {known ?
          <Layout def={def} points={solution} caption="solution" />
        : <p className="adm-none">
            Авторское решение в этой сборке не приехало: оно остаётся на сервере и отдаётся только
            там, где включён <code>ADM</code>.
          </p>
        }
      </div>

      <ul className="adm-threads">
        {[...def.threads]
          .sort((a, b) => a.id - b.id)
          .map((t) => (
            <li key={t.id}>
              {String(t.id).padStart(2, '0')}: {t.points[0]} — {t.points[1]}
            </li>
          ))}
      </ul>

      {known && (
        <button
          type="button"
          onClick={() => {
            const a = analyze(solution, def.threads);
            setChecked(
              isSolved(a) ? 'решение распутано: пересечений нет, точки разведены'
              : [
                  a.crossings.length > 0 ? `пересечений ${a.crossings.length}` : '',
                  a.overlaps.length > 0 ? `наложений ${a.overlaps.length}` : '',
                  a.onThread.length > 0 ? `точек на чужой нити ${a.onThread.length}` : '',
                  a.collisions.length > 0 ? `совпавших точек ${a.collisions.length}` : '',
                ]
                  .filter(Boolean)
                  .join(' · '),
            );
          }}
        >
          проверить решение
        </button>
      )}
      {checked && <p className="adm-note">{checked}</p>}
    </div>
  );
}

/** Раскладка целыми клетками: тот же SVG, что в игре, только маленький. */
function Layout({ def, points, caption }: { def: MinigameDef; points: Record<number, Cell>; caption: string }) {
  const unit = SIZE / Math.max(def.grid.columns, def.grid.rows, 1);
  const center = (cell: Cell): [number, number] => [(cell[0] + 0.5) * unit, (cell[1] + 0.5) * unit];

  return (
    <figure className="adm-layout">
      <svg width={def.grid.columns * unit} height={def.grid.rows * unit}>
        {def.threads.map((t) => {
          const a = points[t.points[0]];
          const b = points[t.points[1]];
          if (!a || !b) return null;
          const [p, q] = [center(a), center(b)];
          return <line key={t.id} className="adm-thread" x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} />;
        })}
        {Object.entries(points).map(([id, cell]) => {
          const [x, y] = center(cell);
          return <circle key={id} className="adm-point" cx={x} cy={y} r={unit * 0.4} />;
        })}
      </svg>
      <figcaption className="adm-sub">{caption}</figcaption>
    </figure>
  );
}
