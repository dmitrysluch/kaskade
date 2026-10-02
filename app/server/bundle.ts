import { loadContent } from './content/load.ts';
import { ContentError } from './content/markdown.ts';
import { formatFinding, validate } from './validate/index.ts';
import type { GameContent } from '../shared/types.ts';

/**
 * Контент как одна величина: либо игра, либо список претензий.
 *
 * Валидатор гоняется при каждой загрузке и падает громко (07-оболочка-тз): ошибки
 * не глотаются и не чинятся молча — они приезжают во вкладку поверх игры, чтобы
 * автор увидел их там же, где правит текст.
 */
export type Bundle = { ok: true; content: GameContent } | { ok: false; errors: string[] };

export function buildBundle(): Bundle {
  try {
    const content = loadContent();
    const findings = validate(content);
    const errors = findings.filter((f) => f.severity === 'error');
    if (errors.length > 0) return { ok: false, errors: findings.map(formatFinding) };
    return { ok: true, content };
  } catch (e) {
    if (e instanceof ContentError) return { ok: false, errors: [e.message] };
    return { ok: false, errors: [(e as Error).message] };
  }
}

/**
 * Сборка для игрока: авторские решения мини-игр остаются на сервере
 * ([[07a-мини-игра]], «Авторский формат»).
 *
 * `solution` нужна валидатору и `/adm`, а победу проверяет геометрия, поэтому
 * клиенту она не нужна вовсе. Прятать её от того, кто откроет консоль, этим
 * не получится — граф эпизода и так уезжает целиком, — но подсмотреть готовую
 * раскладку в сетевой вкладке у игрока не выйдет.
 */
export function withoutSolutions(bundle: Bundle): Bundle {
  if (!bundle.ok) return bundle;
  const minigames = Object.fromEntries(
    Object.entries(bundle.content.minigames).map(([docId, def]) => [
      docId,
      {
        ...def,
        points: Object.fromEntries(Object.entries(def.points).map(([id, p]) => [id, { start: p.start }])),
      },
    ]),
  );
  return { ok: true, content: { ...bundle.content, minigames } };
}
