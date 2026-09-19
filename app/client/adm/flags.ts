import type { GameContent } from '../../shared/types.ts';

/**
 * Какие флаги вообще есть в игре — для отладочного входа (`/adm`).
 *
 * Реестра флагов в контенте нет и заводить его незачем: флаг появляется тем,
 * что узел его ставит, и это правильно — иначе автор вёл бы список руками
 * и однажды забыл. Поэтому список собирается по заметкам: всё, что кто-то
 * ставит, снимает или проверяет условием.
 *
 * Условия дают то, чего не даёт `set:`, — флаги, которые ставит **другая**
 * глава или которых ещё нет: узел их ждёт, а взвести их в этой сцене нечем.
 * Для отладки это как раз важные флаги.
 */

export interface FlagInfo {
  name: string;
  /** Дата сцены, где флаг ставят: ею штампуется взведённый флаг в сейве. */
  at: string | null;
  /** Где ставится — по одной заметке достаточно, чтобы понять, о чём флаг. */
  where: string | null;
  /** Флаг только проверяют, а ставить его в контенте нечем. */
  orphan: boolean;
}

/** Термы условий, которые флагами не являются: у них своя механика. */
const NOT_A_FLAG = /^(has:|word:|date:|wait\.)/;

function terms(cond: string | null): string[] {
  if (!cond) return [];
  return cond
    .split(',')
    .map((t) => t.trim().replace(/^!/, '').trim())
    .filter((t) => t !== '' && !NOT_A_FLAG.test(t));
}

export function allFlags(content: GameContent): FlagInfo[] {
  const set = new Map<string, { at: string | null; where: string }>();
  const seen = new Set<string>();

  for (const node of Object.values(content.nodes)) {
    const doc = node.addr.slice(0, node.addr.indexOf('#'));
    for (const flag of [...node.attrs.set, ...node.attrs.unset]) {
      if (!set.has(flag)) set.set(flag, { at: node.date ?? content.docs[doc]?.date ?? null, where: doc });
      seen.add(flag);
    }
    for (const cond of [node.attrs.if, ...node.options.map((o) => o.attrs.if)]) {
      for (const flag of terms(cond)) seen.add(flag);
    }
  }

  return [...seen].sort().map((name) => {
    const source = set.get(name);
    return {
      name,
      at: source?.at ?? null,
      where: source?.where.split('/').slice(-1)[0] ?? null,
      orphan: source == null,
    };
  });
}
