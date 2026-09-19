import { useMemo, useState } from 'react';
import { allFlags, type FlagInfo } from './flags.ts';
import { playFrom } from './play.ts';
import type { GameContent } from '../../shared/types.ts';

/**
 * Окно отладочного входа (`/adm`): с какого узла начать и что считать уже
 * сделанным.
 *
 * Нужно затем, что узел в середине пролога почти никогда не проверяется
 * «чистым»: протокол требует прочитанной бумаги, коробка — услышанной реплики,
 * половина сцены третьего дня — знания про день рождения. Без этого окна автор
 * либо проходит полчаса руками, либо смотрит на узел в состоянии, в котором
 * игрок его не увидит никогда.
 *
 * Отмечать — руками и осознанно: движок не догадывается, что «должно быть»
 * к этому месту. Догадка здесь была бы выдуманным прохождением, а проверять
 * надо написанное.
 */

/** Флаги показываются группами по первой части имени: `prolog.`, `margo.`. */
function groupOf(name: string): string {
  const dot = name.indexOf('.');
  return dot === -1 ? 'без группы' : name.slice(0, dot);
}

function Box({
  checked,
  onToggle,
  label,
  hint,
}: {
  checked: boolean;
  onToggle: () => void;
  label: string;
  hint?: string | undefined;
}) {
  return (
    <label className={checked ? 'adm-box-on' : undefined}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      {label}
      {hint != null && <span className="adm-sub"> {hint}</span>}
    </label>
  );
}

export function StartDialog({
  content,
  addr,
  onClose,
}: {
  content: GameContent;
  addr: string;
  onClose: () => void;
}) {
  const flags = useMemo(() => allFlags(content), [content]);
  const words = useMemo(() => Object.values(content.words), [content]);
  const items = useMemo(
    () => Object.values(content.docs).filter((d) => d.type === 'item' && d.fm.portable === true),
    [content],
  );

  const [on, setOn] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOn((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const groups = useMemo(() => {
    const out = new Map<string, FlagInfo[]>();
    for (const flag of flags) {
      const group = groupOf(flag.name);
      out.set(group, [...(out.get(group) ?? []), flag]);
    }
    return [...out.entries()];
  }, [flags]);

  const start = () => {
    playFrom(content, addr, {
      flags: flags.filter((f) => on.has(f.name)),
      words: words.filter((w) => on.has(w.id)).map((w) => w.id),
      inventory: items.filter((d) => on.has(d.id)).map((d) => d.id),
    });
  };

  return (
    <div className="adm-modal" onClick={onClose}>
      <div className="adm-modal-box" onClick={(e) => e.stopPropagation()}>
        <h2>
          Играть с «{addr}»{' '}
          <span className="adm-sub">состояние собирается с нуля; отметьте, что уже сделано</span>
        </h2>

        {groups.map(([group, list]) => (
          <section key={group}>
            <h3>
              {group}
              <button type="button" onClick={() => setOn((p) => new Set([...p, ...list.map((f) => f.name)]))}>
                все
              </button>
              <button
                type="button"
                onClick={() =>
                  setOn((p) => new Set([...p].filter((id) => !list.some((f) => f.name === id))))
                }
              >
                никакие
              </button>
            </h3>
            <div className="adm-checks">
              {list.map((flag) => (
                <Box
                  key={flag.name}
                  checked={on.has(flag.name)}
                  onToggle={() => toggle(flag.name)}
                  label={flag.name.slice(group.length + 1)}
                  hint={flag.where ?? undefined}
                />
              ))}
            </div>
          </section>
        ))}

        {words.length > 0 && (
          <section>
            <h3>слова «Дела»</h3>
            <div className="adm-checks">
              {words.map((word) => (
                <Box
                  key={word.id}
                  checked={on.has(word.id)}
                  onToggle={() => toggle(word.id)}
                  label={word.label}
                  hint={word.id}
                />
              ))}
            </div>
          </section>
        )}

        {items.length > 0 && (
          <section>
            <h3>
              на руках <span className="adm-sub">переносимые вещи</span>
            </h3>
            <div className="adm-checks">
              {items.map((item) => (
                <Box
                  key={item.id}
                  checked={on.has(item.id)}
                  onToggle={() => toggle(item.id)}
                  label={item.label}
                  hint={item.id}
                />
              ))}
            </div>
          </section>
        )}

        <p className="adm-modal-bar">
          <span className="adm-sub">отмечено: {on.size}</span>
          <button type="button" className="adm-play" onClick={start}>
            ▶ начать
          </button>
          <button type="button" onClick={onClose}>
            отмена
          </button>
        </p>
      </div>
    </div>
  );
}
