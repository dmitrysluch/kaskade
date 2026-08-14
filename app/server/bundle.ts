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
