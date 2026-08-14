import { loadContent } from '../app/server/content/load.ts';
import { formatFinding, validate } from '../app/server/validate/index.ts';
import { ContentError } from '../app/server/content/markdown.ts';

/**
 * `npm run lint` — тот же валидатор, что и в рантайме. Правила дизайна должны
 * падать в консоли, а не только во вкладке: иначе они не автотесты, а подсказки.
 */

try {
  const content = loadContent();
  const findings = validate(content);

  if (findings.length === 0) {
    const nodes = Object.keys(content.nodes).length;
    const docs = Object.keys(content.docs).length;
    console.log(`контент в порядке: ${docs} заметок, ${nodes} узлов, ${content.episodes.length} эпизод(а)`);
    process.exit(0);
  }

  for (const f of findings) console.error(formatFinding(f));
  const errors = findings.filter((f) => f.severity === 'error').length;
  console.error(`\nвсего: ${errors} ошибок, ${findings.length - errors} предупреждений`);
  process.exit(errors > 0 ? 1 : 0);
} catch (e) {
  if (e instanceof ContentError) {
    console.error(`ОШИБКА  ${e.message}`);
    process.exit(1);
  }
  throw e;
}
