import { verbOf } from '../content/options.ts';
import { parseDate } from '../../shared/dates.ts';
import type { Doc, GameContent, Node, Option } from '../../shared/types.ts';

/**
 * Правила дизайна как автотесты (07-оболочка-тз, «Валидатор»).
 *
 * Это главная причина держать контент в файлах. Часть правил проверяет целостность
 * (битые ссылки, узлы без входа), но интереснее те, что руками не находятся:
 * эпизод-декорация, который не отдал ни одного своего слова, или серое слово,
 * к которому нет ни одного легального пути побеления.
 */

export interface Finding {
  rule: string;
  severity: 'error' | 'warn';
  file: string;
  line?: number;
  message: string;
}

export interface Rule {
  id: string;
  title: string;
  run(content: GameContent): Finding[];
}

function episodeOf(docId: string): string | null {
  const m = /^episodes\/([^/]+)\//.exec(docId);
  return m ? m[1]! : null;
}

function docOfNode(content: GameContent, node: Node): Doc {
  return content.docs[node.addr.slice(0, node.addr.lastIndexOf('#'))]!;
}

function allNodes(content: GameContent): Node[] {
  return Object.values(content.nodes);
}

/** Узел ведёт куда-то, если у него есть опции или безусловный `goto`. */
function hasExit(node: Node): boolean {
  return node.options.length > 0 || node.pending.length > 0 || node.attrs.goto != null;
}

const brokenGraph: Rule = {
  id: 'graph',
  title: 'узлы без входа и без выхода',
  run(content) {
    const found: Finding[] = [];
    const reached = new Set<string>(content.episodes.map((e) => e.entry));
    for (const node of allNodes(content)) {
      for (const o of node.options) if (o.target) reached.add(o.target);
      if (node.attrs.goto) reached.add(node.attrs.goto);
    }

    for (const node of allNodes(content)) {
      const doc = docOfNode(content, node);
      // Вступление слова, документа и предмета — не узел графа, а карточка:
      // на него никто не «переходит», его показывают.
      if (doc.type !== 'scene' && doc.type !== 'room') continue;

      if (!reached.has(node.addr)) {
        found.push({
          rule: 'graph',
          severity: 'error',
          file: doc.path,
          line: node.line,
          message: `в узел "${node.id || '(вступление)'}" нет ни одного входа`,
        });
      }
      if (!hasExit(node) && node.id !== 'конец') {
        found.push({
          rule: 'graph',
          severity: 'error',
          file: doc.path,
          line: node.line,
          message: `из узла "${node.id || '(вступление)'}" некуда идти — нужен переход, генератор или узел "конец"`,
        });
      }
    }
    return found;
  },
};

const missingWordCard: Rule = {
  id: 'word-card',
  title: 'слово упомянуто, а карточки нет',
  run(content) {
    const found: Finding[] = [];
    const known = new Set([...Object.keys(content.words), ...Object.values(content.docs).filter((d) => d.type === 'item').map((d) => d.id)]);

    for (const node of allNodes(content)) {
      const doc = docOfNode(content, node);
      for (const name of [...node.attrs.give, ...node.attrs.take]) {
        if (!known.has(name)) {
          found.push({
            rule: 'word-card',
            severity: 'error',
            file: doc.path,
            line: node.line,
            message: `упомянуто "${name}", но нет ни карточки words/${name}.md, ни предмета с таким id`,
          });
        }
      }
    }
    return found;
  },
};

const documentBudget: Rule = {
  id: 'doc-budget',
  title: 'документ длиннее бюджета',
  run(content) {
    // ~200 знаков ([[05-тексты-и-документы]]): длиннее — и бумага перестаёт быть
    // бумагой, начинается скролл внутри рамки.
    const LIMIT = 200;
    return Object.values(content.docs)
      .filter((d) => d.type === 'doc')
      .flatMap((doc) => {
        const text = doc.nodes[0]?.text ?? '';
        if (text.length <= LIMIT) return [];
        return [
          {
            rule: 'doc-budget',
            severity: 'error' as const,
            file: doc.path,
            message: `документ ${text.length} знаков при бюджете ${LIMIT} — вынести объяснение в реплику живого человека`,
          },
        ];
      });
  },
};

const verbsDeclared: Rule = {
  id: 'verbs',
  title: 'глагол используется, но не объявлен',
  run(content) {
    const found: Finding[] = [];
    const byEpisode = new Map(content.episodes.map((e) => [e.id, e]));

    for (const doc of Object.values(content.docs)) {
      const episodeId = episodeOf(doc.docId);
      const episode = episodeId ? byEpisode.get(episodeId) : undefined;
      if (!episode) continue;

      for (const node of doc.nodes) {
        // Проверяем генераторы, а не только выданные опции: глагол, на который ни один
        // предмет не отвечает, не выдаёт ничего и потому прошёл бы незамеченным.
        const used = new Set<string>([
          ...node.generators.map((g) => g.verb),
          ...node.pending.map((p) => verbOf(p.verb)),
          ...node.options.flatMap((o) => (o.verb ? [o.verb] : [])),
        ]);

        for (const verb of used) {
          if (verb === '*' || episode.verbs.includes(verb)) continue;
          found.push({
            rule: 'verbs',
            severity: 'error',
            file: doc.path,
            line: node.line,
            message: `глагол "${verb}" не объявлен в verbs эпизода "${episode.id}"`,
          });
        }
      }

      // Глаголы предмета живут отдельным списком: в строку подсказок они не попадают,
      // но объявлены быть обязаны — иначе опечатка в заголовке станет тихим глаголом.
      if (doc.type === 'item') {
        // Узлы, на которые предмет ссылается сам, — его внутренняя развилка,
        // а не глаголы: `осмотреть` может расходиться на два ответа, и требовать
        // объявления от каждого значило бы заводить глаголы, которых нет.
        const inner = new Set(
          doc.nodes.flatMap((n) =>
            n.options.flatMap((o) =>
              o.target?.startsWith(`${doc.docId}#`) ? [o.target.slice(doc.docId.length + 1)] : [],
            ),
          ),
        );

        for (const node of doc.nodes) {
          if (node.id === '' || inner.has(node.id)) continue;
          const declared = episode.verbs.includes(node.id) || episode.itemVerbs.includes(node.id);
          if (!declared) {
            found.push({
              rule: 'verbs',
              severity: 'error',
              file: doc.path,
              line: node.line,
              message: `глагол предмета "${node.id}" не объявлен ни в verbs, ни в itemVerbs эпизода "${episode.id}"`,
            });
          }
        }
        for (const verb of doc.inHand) {
          if (!doc.nodes.some((n) => n.id === verb)) {
            found.push({
              rule: 'verbs',
              severity: 'error',
              file: doc.path,
              message: `в inHand указан "${verb}", но узла с таким именем в предмете нет`,
            });
          }
        }
      }
    }
    return found;
  },
};

const deadGenerators: Rule = {
  id: 'generators',
  title: 'генератор ссылается на пустой источник',
  run(content) {
    const found: Finding[] = [];
    for (const doc of Object.values(content.docs)) {
      if (doc.type === 'room' && doc.exits.length === 0 && doc.items.length === 0) {
        found.push({
          rule: 'generators',
          severity: 'error',
          file: doc.path,
          message: 'у комнаты нет ни exits, ни items — из неё нечего делать и некуда идти',
        });
      }

      for (const node of doc.nodes) {
        for (const gen of node.generators) {
          const empty =
            (gen.source === 'exits' && doc.exits.length === 0) ||
            (gen.source === 'items' && doc.items.length === 0);
          if (!empty) continue;
          found.push({
            rule: 'generators',
            severity: 'error',
            file: doc.path,
            line: node.line,
            message: `генератор "${gen.phrase}: ${gen.source}" ссылается на пустой источник`,
          });
        }
      }
      if (doc.type === 'item' && doc.nodes.every((n) => n.id === '')) {
        found.push({
          rule: 'generators',
          severity: 'error',
          file: doc.path,
          message: 'предмет без единого узла-глагола: с ним нельзя сделать ничего, даже осмотреть',
        });
      }
    }
    return found;
  },
};

const episodeGivesWord: Rule = {
  id: 'episode-contract',
  title: 'эпизод не отдаёт ни одного уникального белого слова',
  run(content) {
    // Контракт между хабом и эпизодом ([[02-механики-эпизоды]]): эпизод, не отдавший
    // своего слова, — декорация. Пролог словами не торгует, поэтому пока правило молчит:
    // проверяем только эпизоды, в которых слова вообще раздаются.
    const givenBy = new Map<string, Set<string>>();
    for (const doc of Object.values(content.docs)) {
      const episodeId = episodeOf(doc.docId);
      if (!episodeId) continue;
      for (const node of doc.nodes) {
        for (const word of node.attrs.give) {
          if (!content.words[word]) continue;
          givenBy.set(word, (givenBy.get(word) ?? new Set()).add(episodeId));
        }
      }
    }
    if (givenBy.size === 0) return [];

    const found: Finding[] = [];
    for (const episode of content.episodes) {
      const own = [...givenBy.entries()].filter(([, eps]) => eps.size === 1 && eps.has(episode.id));
      const gives = [...givenBy.values()].some((eps) => eps.has(episode.id));
      if (gives && own.length === 0) {
        found.push({
          rule: 'episode-contract',
          severity: 'error',
          file: `content/episodes/${episode.id}/episode.yaml`,
          message: `эпизод "${episode.id}" не отдаёт ни одного слова, которого нет больше нигде — перепроектировать или выбросить`,
        });
      }
    }
    return found;
  },
};

const roomScopedOptions: Rule = {
  id: 'options-scope',
  title: 'блок options продублирован по узлам',
  run(content) {
    const found: Finding[] = [];
    for (const doc of Object.values(content.docs)) {
      // Генераторы — свойство комнаты, а не узла: объявляются один раз и действуют
      // везде. Два блока в одной заметке — это два места для одной правки.
      if (doc.optionBlocks.length <= 1) continue;

      found.push({
        rule: 'options-scope',
        severity: 'error',
        file: doc.path,
        line: doc.optionBlocks[1]!,
        message: `блок options объявлен ${doc.optionBlocks.length} раза; он свойство комнаты — достаточно одного на заметку`,
      });
    }
    return found;
  },
};

const interpolationResolves: Rule = {
  id: 'interpolation',
  title: 'подстановка ссылается на несуществующий флаг',
  run(content) {
    const set = new Set(Object.values(content.nodes).flatMap((n) => n.attrs.set));
    const found: Finding[] = [];

    for (const doc of Object.values(content.docs)) {
      for (const node of doc.nodes) {
        for (const match of node.text.matchAll(/\{\{\s*([^}\s]+)\.at\s*\}\}/g)) {
          const flag = match[1]!;
          if (set.has(flag)) continue;
          found.push({
            rule: 'interpolation',
            severity: 'error',
            file: doc.path,
            line: node.line,
            message: `подстановка {{${flag}.at}}: флаг "${flag}" нигде не ставится, дате взяться неоткуда`,
          });
        }
      }
    }
    return found;
  },
};

const dialogueTurns: Rule = {
  id: 'dialogue',
  title: 'собеседник говорит больше двух реплик подряд',
  run(content) {
    // Диалог никогда не вываливается целиком (07-оболочка-тз, «Диалог»). Механически
    // это цепочка узлов, которую движок проходит сам, не спрашивая игрока.
    const LIMIT = 2;
    const found: Finding[] = [];

    for (const doc of Object.values(content.docs)) {
      if (doc.type !== 'scene') continue;

      for (const node of doc.nodes) {
        let steps = 0;
        let current: (typeof node) | undefined = node;
        const seen = new Set<string>();

        while (current && !seen.has(current.addr)) {
          seen.add(current.addr);
          const auto: string | null = current.options.find((o) => o.label === '')?.target ?? current.attrs.goto;
          const choices = current.options.filter((o) => o.label !== '');
          if (choices.length > 0 || !auto) break;
          if (current.text.trim() !== '') steps += 1;
          current = content.nodes[auto];
        }

        if (steps > LIMIT) {
          found.push({
            rule: 'dialogue',
            severity: 'warn',
            file: doc.path,
            line: node.line,
            message: `${steps} узла подряд без хода игрока — диалог вываливается блоком`,
          });
        }
      }
    }
    return found;
  },
};

/**
 * Сплэш стоит по центру пустого экрана, поэтому его потолок — не рамка, а сам
 * экран. Ширину экрана теперь не задаёт никто: сетка заполняет окно, и на узком
 * окне колонок может остаться всего сорок — это пол, ниже которого подбор кегля
 * не опускается (MIN_COLS в metrics.ts). Считаем от него, иначе картинка,
 * влезающая на мониторе автора, обрежется у игрока.
 *
 * Высота — 20 строк клеток, то есть 40 пиксельных рядов на полублоках.
 */
const SPLASH_COLS = 40;
const SPLASH_ROWS = 40;

const splashes: Rule = {
  id: 'splash',
  title: 'сплэши: один человек — один раз, и картинка обязана влезать в кадр',
  run(content) {
    const found: Finding[] = [];

    // Один человек — один сплэш за игру. Исключение прописано только для Марго:
    // первый экран пролога и последний экран игры.
    const seen = new Map<string, { doc: Doc; line: number }[]>();

    for (const doc of Object.values(content.docs)) {
      for (const node of doc.nodes) {
        const tag = node.attrs.tag.find((t) => t.startsWith('splash:'));
        if (!tag) continue;

        const who = tag.slice('splash:'.length);
        seen.set(who, [...(seen.get(who) ?? []), { doc, line: node.line }]);

        // Ненарисованное лицо — предупреждение, а не ошибка: текст пишется раньше
        // арта, и сцена без портрета должна оставаться играбельной. В игре такой
        // сплэш просто пропускается.
        const character = content.characters[who];
        if (!character || Object.keys(character.portraits).length === 0) {
          found.push({
            rule: 'splash',
            severity: 'warn',
            file: doc.path,
            line: node.line,
            message: character
              ? `у "${who}" нет portrait.txt — сплэш будет пропущен`
              : `сплэш ссылается на "${who}", которого нет в characters/ — будет пропущен`,
          });
          continue;
        }

        for (const portrait of Object.values(character.portraits)) {
          if (portrait.width > SPLASH_COLS || portrait.height > SPLASH_ROWS) {
            found.push({
              rule: 'splash',
              severity: 'error',
              file: doc.path,
              line: node.line,
              message:
                `сплэш "${who}" ${portrait.width}×${portrait.height} не влезает в кадр ` +
                `(потолок ${SPLASH_COLS}×${SPLASH_ROWS} пикселей)`,
            });
            break;
          }
        }
      }
    }

    for (const [who, places] of seen) {
      if (who === 'margo' || places.length <= 1) continue;
      const at = places[1]!;
      found.push({
        rule: 'splash',
        severity: 'error',
        file: at.doc.path,
        line: at.line,
        message: `сплэш "${who}" встречается ${places.length} раза — один человек показывается один раз`,
      });
    }

    return found;
  },
};

/**
 * Сколько знаков команде отведено. Список вертикальный, по команде на строку,
 * и метка обязана помещаться целиком: на узком экране (сорок колонок минус поля
 * и колонка маркера) остаётся примерно столько.
 */
const LABEL_MAX = 32;

/**
 * Маршруты (07-оболочка-тз, «Опция и маршрут»). Проверять их особенно нужно,
 * потому что ошибка здесь молчаливая: игра не падает, она просто идёт не туда
 * или встаёт намертво, и заметить это можно только пройдя ровно тот расклад
 * флагов, при котором расходятся ветки.
 */
const routes: Rule = {
  id: 'routes',
  title: 'маршруты: порядок, тупики и условия, сказанные дважды',
  run(content) {
    const found: Finding[] = [];

    /** Куда ведёт маршрут: адрес нужен и для условия цели, и для сообщения. */
    const targetOf = (o: Option): Node | undefined => (o.target ? content.nodes[o.target] : undefined);
    const name = (o: Option): string => o.target ?? '?';

    for (const node of allNodes(content)) {
      const doc = docOfNode(content, node);
      const where = { file: doc.path, line: node.line };
      const at = `в узле "${node.id || '(вступление)'}"`;

      // Опции комнаты (`осмотреть доску`) приходят из блока `options` и стоят
      // в ней всегда — они мебель, а не выбор узла. Считаем только переходы.
      const own = node.options.filter((o) => o.verb === null);
      const paths = own.filter((o) => o.label === '');
      const choices = own.filter((o) => o.label !== '');

      // Маршрут условен, если условие стоит на нём самом или на его цели:
      // скрыта цель — маршрут проваливается на следующий.
      const guarded = (o: Option): boolean => {
        const target = targetOf(o);
        return Boolean(o.attrs.if ?? target?.attrs.if ?? target?.attrs.once);
      };

      paths.forEach((route, i) => {
        if (i === paths.length - 1 || guarded(route)) return;
        found.push({
          rule: 'routes',
          severity: 'error',
          ...where,
          message: `${at} маршрут в "${name(route)}" стоит без условия и не последним — всё, что ниже, недостижимо`,
        });
      });

      // Все опции под условиями и ни одного маршрута-запаски: при неудачном
      // раскладе флагов игроку нечего сказать и некуда деться. Кроме случая,
      // когда условия друг друга покрывают: `x` и `!x` — это одна опция, у которой
      // от флага меняется формулировка, и мимо неё не пройти.
      const ambient = node.options.some((o) => o.verb !== null) || node.pending.length > 0;
      const conds = choices.map((o) => (o.attrs.if ?? targetOf(o)?.attrs.if ?? '').replace(/\s+/g, ' ').trim());
      const total = conds.some((c) => c !== '' && conds.includes(c.startsWith('!') ? c.slice(1).trim() : `!${c}`));

      if (!ambient && !total && paths.length === 0 && choices.length > 0 && choices.every(guarded)) {
        found.push({
          rule: 'routes',
          severity: 'error',
          ...where,
          message: `${at} все опции под условиями и нет ни одного маршрута — при неудачных флагах игрок встанет намертво`,
        });
      }

      // Одинаковое условие у двух маршрутов: второй недостижим. Пара `x` / `!x`
      // — законная развилка и здесь не ловится, она разводит ветки, а не дублирует.
      const seen = new Map<string, Option>();
      for (const route of paths) {
        const cond = (route.attrs.if ?? targetOf(route)?.attrs.if ?? '').replace(/\s+/g, ' ').trim();
        if (cond === '') continue;
        const first = seen.get(cond);
        if (first) {
          found.push({
            rule: 'routes',
            severity: 'error',
            ...where,
            message:
              `${at} у маршрутов в "${name(first)}" и "${name(route)}" одно и то же условие ` +
              `"${cond}" — второй недостижим`,
          });
        } else {
          seen.set(cond, route);
        }
      }

      // `advance` принадлежит только вводимой сюжетной опции. На маршруте без
      // метки, на действии с предметом и на служебной команде он изображал бы
      // невозврат там, где его нет.
      for (const o of node.options) {
        if (!o.attrs.advance) continue;
        if (o.label === '') {
          found.push({
            rule: 'routes',
            severity: 'error',
            ...where,
            message: `${at} advance стоит на маршруте без метки — игрок его не выбирает, и помечать нечего`,
          });
        } else if (o.kind !== 'story') {
          found.push({
            rule: 'routes',
            severity: 'error',
            ...where,
            message: `${at} advance стоит на опции категории "${o.kind}" — сюжетный невозврат бывает только у story`,
          });
        }
      }

      // Список вертикальный и вариантов не переносит: слишком длинная метка
      // не «свернётся в абзац», а обрежется, и игрок увидит огрызок команды.
      // Считаем от узкого экрана — там, где список тесней всего.
      for (const o of node.options) {
        if (o.label === '') continue;
        const width = o.label.length + (o.attrs.advance ? 2 : 0);
        if (width <= LABEL_MAX) continue;
        found.push({
          rule: 'routes',
          severity: 'error',
          ...where,
          message: `метка "${o.label}" длиннее ${LABEL_MAX} знаков — в строку списка она не влезет`,
        });
      }

      // Категорию ставит сборщик опций; клиент её не угадывает по тексту.
      for (const o of node.options) {
        if (o.kind === 'environment' || o.kind === 'story' || o.kind === 'system') continue;
        found.push({
          rule: 'routes',
          severity: 'error',
          ...where,
          message: `${at} опция "${o.label}" пришла без категории — это ошибка сборки, а не контента`,
        });
      }

      // `advance` — помета на переходе. На самом узле она не значит ничего
      // и потому опаснее опечатки: автор уверен, что пометил, а игрок не увидит.
      if (node.attrs.advance) {
        found.push({
          rule: 'routes',
          severity: 'error',
          ...where,
          message: `${at} advance стоит на узле, а не на переходе — так он не работает`,
        });
      }

      for (const o of own) {
        const target = targetOf(o);
        if (o.attrs.if && target?.attrs.if) {
          found.push({
            rule: 'routes',
            severity: 'error',
            ...where,
            message:
              `${at} условие стоит и на переходе в "${name(o)}" ("${o.attrs.if}"), ` +
              `и на его цели ("${target.attrs.if}") — сказано дважды`,
          });
        }
      }
    }

    return found;
  },
};

/**
 * Даты (07-оболочка-тз, «Как показано, что прошло время»).
 *
 * Дата в этой игре — единственный способ сказать, что прошло время, и берётся
 * она из `date:` той заметки, где игрок стоит. Значит, у каждой сцены и каждой
 * комнаты она обязана быть записана явно: заметка без даты не «наследует
 * предыдущую», она молча показывает игроку чужое время.
 */
const dates: Rule = {
  id: 'dates',
  title: 'даты: записаны явно, разбираются и не идут назад',
  run(content) {
    const found: Finding[] = [];

    /** Номер сцены из имени файла: `01-hall` принадлежит первой сцене. */
    const sceneNo = (docId: string): number | null => {
      const m = /\/(\d+)-[^/]*$/.exec(docId);
      return m ? Number(m[1]) : null;
    };

    const declared = new Map(content.episodes.map((e) => [e.id, new Set(Object.keys(e.dates))]));
    const ordered: { doc: Doc; no: number; at: number; raw: string }[] = [];

    for (const doc of Object.values(content.docs)) {
      const place = doc.type === 'scene' || doc.type === 'room';

      if (place && !doc.date) {
        found.push({
          rule: 'dates',
          severity: 'error',
          file: doc.path,
          message: 'нет date: — статусу нечего показать, а брать дату из предыдущей заметки нельзя',
        });
      }

      if (doc.date) {
        const at = parseDate(doc.date);
        if (at == null) {
          found.push({
            rule: 'dates',
            severity: 'error',
            file: doc.path,
            message: `date: "${doc.date}" не разбирается; формат один на всю игру — 12.05.2026`,
          });
        } else {
          const no = sceneNo(doc.docId);
          if (place && no != null) ordered.push({ doc, no, at, raw: doc.date });
        }
      }

      // Срок можно двигать только объявленный: имя, которого нет в episode.yaml,
      // не покажется в статусе никогда, и заметить это в игре нечем.
      const known = declared.get(episodeOf(doc.docId) ?? '') ?? new Set<string>();
      for (const node of doc.nodes) {
        for (const [name, at] of Object.entries(node.attrs.dates)) {
          if (!known.has(name)) {
            found.push({
              rule: 'dates',
              severity: 'error',
              file: doc.path,
              line: node.line,
              message: `срок "${name}" не объявлен в dates эпизода`,
            });
          }
          if (parseDate(at) == null) {
            found.push({
              rule: 'dates',
              severity: 'error',
              file: doc.path,
              line: node.line,
              message: `срок "${name}": "${at}" не разбирается как дата`,
            });
          }
        }
      }
    }

    // Сцены выстроены в фиксированном порядке, и дата, уехавшая в прошлое, —
    // опечатка. Сравниваем по номеру сцены: комната принадлежит своей сцене,
    // внутри одного номера порядок между заметками не определён.
    ordered.sort((a, b) => a.no - b.no);
    let seen: { no: number; at: number; raw: string } | null = null;
    for (const item of ordered) {
      if (seen && item.no > seen.no && item.at < seen.at) {
        found.push({
          rule: 'dates',
          severity: 'error',
          file: item.doc.path,
          message: `date: ${item.raw} раньше, чем ${seen.raw} у сцены ${String(seen.no).padStart(2, '0')} — дата поехала назад`,
        });
      }
      if (!seen || item.at > seen.at) seen = { no: item.no, at: item.at, raw: item.raw };
    }

    return found;
  },
};

/**
 * Выход из хаба разговора, который закрывает ещё не сказанные темы, обязан быть
 * помечен `advance`: игрок не видит, что уходит навсегда, и узнаёт об этом,
 * когда возвращаться уже некуда.
 *
 * Предупреждение, а не ошибка: доказать «закрывает» в общем виде нельзя —
 * ловим тот случай, когда из цели назад в хаб дороги нет.
 */
const hubExit: Rule = {
  id: 'hub',
  title: 'выход из хаба закрывает темы, но не помечен advance',
  run(content) {
    const found: Finding[] = [];

    const reaches = (from: string, target: string): boolean => {
      const seen = new Set<string>();
      const queue = [from];
      while (queue.length > 0) {
        const addr = queue.shift()!;
        if (addr === target) return true;
        if (seen.has(addr)) continue;
        seen.add(addr);
        const node = content.nodes[addr];
        if (!node) continue;
        for (const o of node.options) if (o.target) queue.push(o.target);
        if (node.attrs.goto) queue.push(node.attrs.goto);
      }
      return false;
    };

    for (const node of allNodes(content)) {
      // Тема хаба — одноразовая реплика, которая возвращает сюда же. Без возврата
      // это не хаб, а просто узел с переходами, и правило к нему не относится.
      const topics = node.options.filter(
        (o) =>
          o.label !== '' &&
          o.target != null &&
          content.nodes[o.target]?.attrs.once === true &&
          reaches(o.target, node.addr),
      );
      if (topics.length === 0) continue;

      for (const o of node.options) {
        // Уводит только то, что двигает игрока: `осмотреть доску` оставляет его
        // на месте, сколько бы там ни было тем.
        if (o.label === '' || o.attrs.advance || !o.target || !o.moves || o.kind !== 'story') continue;
        if (reaches(o.target, node.addr)) continue;

        const doc = docOfNode(content, node);
        found.push({
          rule: 'hub',
          severity: 'warn',
          file: doc.path,
          line: node.line,
          message:
            `"${o.label}" уводит из хаба без возврата, а тем с once осталось ${topics.length} — ` +
            'стоит пометить advance',
        });
      }
    }
    return found;
  },
};

export const RULES: Rule[] = [
  brokenGraph,
  routes,
  hubExit,
  dates,
  missingWordCard,
  documentBudget,
  verbsDeclared,
  deadGenerators,
  episodeGivesWord,
  roomScopedOptions,
  interpolationResolves,
  dialogueTurns,
  splashes,
];
