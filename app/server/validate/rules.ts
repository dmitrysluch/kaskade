import { verbOf } from '../content/options.ts';
import { kindOf, parseEntities } from '../../shared/entities.ts';
import { parseDate } from '../../shared/dates.ts';
import { closeLabel, EXAMINE } from '../../shared/pages.ts';
import { speakerOf } from '../../shared/speech.ts';
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

/**
 * Вспомогательная заметка: её узлы не место, куда переходят, а фрагменты,
 * которые выдаёт кто-то другой. Так написано застолье в `03-talk`: комната
 * отдаёт по куску беседы после каждого действия игрока, и разговор идёт мимо
 * Марго — в этом и механика.
 *
 * Механики выдачи в движке пока нет, и правила графа о таких узлах судить
 * не могут: у фрагмента нет ни входа, ни выхода **по замыслу**. Пока помета
 * значит для валидатора одно — «не суди», а для автора остаётся напоминанием
 * в виде предупреждения.
 */
function auxiliary(doc: Doc): boolean {
  const tag = doc.fm.tag;
  return tag === 'auxiliary' || (Array.isArray(tag) && tag.includes('auxiliary'));
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
      if (auxiliary(doc)) continue;

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
    for (const doc of Object.values(content.docs)) {
      if (!auxiliary(doc)) continue;
      found.push({
        rule: 'graph',
        severity: 'warn',
        file: doc.path,
        message:
          'заметка помечена `tag: auxiliary`: её узлы правилами графа не проверяются, ' +
          'а механики выдачи фрагментов в движке пока нет — сцена в игре не звучит',
      });
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
            severity: 'warn',
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
          // Секция со страницей — состояние предмета, а не глагол: объявлять
          // «вклейку» в itemVerbs незачем, командой она не становится.
          if (node.id === '' || inner.has(node.id) || node.attrs.page != null) continue;
          const declared = episode.verbs.includes(node.id) || episode.itemVerbs.includes(node.id);
          if (!declared) {
            found.push({
              rule: 'verbs',
              severity: 'warn',
              file: doc.path,
              line: node.line,
              message: `глагол предмета "${node.id}" не объявлен ни в verbs, ни в itemVerbs эпизода "${episode.id}"`,
            });
          }
        }
        /*
         * `inHand` больше ни на что не влияет ([[99-открытые-вопросы]], «Глаголы
         * и состояния предметов»). Действия предмета — это его именованные
         * секции, и список во frontmatter говорил то же самое вторым голосом:
         * он умел молча разойтись с содержимым файла и ничего при этом не решал.
         */
        if (doc.inHand.length > 0) {
          found.push({
            rule: 'verbs',
            severity: 'warn',
            file: doc.path,
            message: `inHand больше не читается: действиями предмета стали его секции (${doc.inHand.join(', ')} — можно удалить)`,
          });
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
      /*
       * Предметы и выходы объявляются там, где игрок стоит: во frontmatter то,
       * что в комнате всегда, на узле — то, что принадлежит состоянию
       * (07-оболочка-тз, «Комната — не одно место»). Блок `options` при этом
       * один на комнату, поэтому пустой источник — это свойство заметки целиком,
       * а не узла: на проходной развилке предметов нет и быть не должно.
       */
      const items = [...doc.items, ...doc.nodes.flatMap((n) => n.attrs.items)];
      const exits = [...doc.exits, ...doc.nodes.flatMap((n) => n.attrs.exits)];

      if (doc.type === 'room' && exits.length === 0 && items.length === 0) {
        found.push({
          rule: 'generators',
          severity: 'error',
          file: doc.path,
          message: 'у комнаты нет ни exits, ни items — из неё нечего делать и некуда идти',
        });
      }

      // Генераторы после раскрытия одинаковы во всех узлах комнаты — жалуемся
      // один раз на заметку, а не по разу на каждое её состояние.
      const declared = new Map(doc.nodes.flatMap((n) => n.generators.map((g) => [`${g.phrase}: ${g.source}`, g])));
      for (const [what, gen] of declared) {
        const empty = (gen.source === 'exits' && exits.length === 0) || (gen.source === 'items' && items.length === 0);
        if (!empty) continue;
        found.push({
          rule: 'generators',
          severity: 'error',
          file: doc.path,
          line: doc.nodes[0]?.line ?? 1,
          message: `генератор "${what}" ссылается на пустой источник`,
        });
      }
      // Страницы сами значат «этот предмет можно осмотреть», глагол ему не нужен.
      if (doc.type === 'item' && doc.pages.length === 0 && doc.nodes.every((n) => n.id === '')) {
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
 * и метка обязана помещаться целиком.
 *
 * Отсчёт от экрана в 56 колонок: минус поля слева и справа остаётся ровно
 * столько. Уже — игру и так не показать, а мерить по сорока колонкам значит
 * запретить нормальные реплики ради размера, в котором никто не играет.
 */
const LABEL_MAX = 48;

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

      /*
       * Условие, которое этот же узел и выполняет, условием не является.
       * `#записи` ставит `prolog.lecture-done` и тут же предлагает уйти в узел,
       * который его требует: к моменту выбора флаг взведён, и «встанет намертво»
       * тут неправда. Проверяем буквально: все термы — флаги из `set:` узла.
       */
      const met = (cond: string | null | undefined): boolean =>
        cond != null &&
        cond.trim() !== '' &&
        cond
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          // Вещь, которую узел сам и дал в руки, — тоже выполненное условие:
          // `give: 02-protocol` и `if: has:02-protocol` на одном узле спорить
          // не могут.
          .every((t) => node.attrs.set.includes(t) || (t.startsWith('has:') && node.attrs.give.includes(t.slice(4).trim())));

      // Маршрут условен, если условие стоит на нём самом или на его цели:
      // скрыта цель — маршрут проваливается на следующий.
      const guarded = (o: Option): boolean => {
        const target = targetOf(o);
        if (target?.attrs.once) return true;
        const cond = o.attrs.if ?? target?.attrs.if ?? null;
        return cond != null && !met(cond);
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

      /*
       * Ни одной опции без условия: при неудачном раскладе флагов игроку нечего
       * сказать и некуда деться — список пуст, и это читается как сломанная игра.
       *
       * Считаются и маршруты, и вводимые опции: узел, где есть только `→ [[#туда]]
       * - if: флаг`, выглядит для игрока так же пусто, как узел вовсе без выходов.
       * Именно так сломался протокол в отделении, когда действия предмета уехали
       * в инвентарь: единственный маршрут ждал флага, который ставит вещь.
       *
       * Исключение — когда условия друг друга покрывают: `x` и `!x` это одна
       * опция, у которой от флага меняется формулировка, и мимо неё не пройти.
       */
      const ambient = node.options.some((o) => o.verb !== null) || node.pending.length > 0;
      const conds = own.map((o) => (o.attrs.if ?? targetOf(o)?.attrs.if ?? '').replace(/\s+/g, ' ').trim());
      const total = conds.some((c) => c !== '' && conds.includes(c.startsWith('!') ? c.slice(1).trim() : `!${c}`));

      if (!ambient && !total && own.length > 0 && own.every(guarded)) {
        found.push({
          rule: 'routes',
          severity: 'error',
          ...where,
          message:
            paths.length === 0 ?
              `${at} все опции под условиями и нет ни одного маршрута — при неудачных флагах игрок встанет намертво`
            : `${at} под условием и опции, и маршруты — пока условие не выполнено, список пуст`,
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

/**
 * Страницы предмета (07-оболочка-тз, «Страницы предмета — состояния»).
 *
 * Ошибка здесь молчаливая вдвойне: секция, случайно ставшая глаголом, добавляет
 * команду, которой автор не писал, а страница-двойник по номеру просто теряется
 * в перелистывании.
 */
const pages: Rule = {
  id: 'pages',
  title: 'страницы предмета: состояние, а не действие',
  run(content) {
    const found: Finding[] = [];

    for (const doc of Object.values(content.docs)) {
      const paged = doc.nodes.filter((n) => n.attrs.page != null);
      const at = (node: Node): Omit<Finding, 'rule' | 'severity' | 'message'> => ({
        file: doc.path,
        line: node.line,
      });

      for (const node of paged) {
        if (doc.type !== 'item') {
          found.push({
            rule: 'pages',
            severity: 'error',
            ...at(node),
            message: `page стоит в заметке типа "${doc.type}" — страницы бывают только у предметов`,
          });
        }
        if (node.id === '') {
          found.push({
            rule: 'pages',
            severity: 'error',
            ...at(node),
            message: 'page стоит на вступлении файла — оно карточка предмета, а не первая страница',
          });
        }
        const page = node.attrs.page!;
        if (!Number.isInteger(page) || page <= 0) {
          found.push({
            rule: 'pages',
            severity: 'error',
            ...at(node),
            message: `page: ${page} — номер страницы это целое положительное число`,
          });
        }
        if (paged.filter((n) => n.attrs.page === page).length > 1) {
          found.push({
            rule: 'pages',
            severity: 'error',
            ...at(node),
            message: `page: ${page} встречается в предмете дважды — порядок страниц неопределён`,
          });
        }

        // Состояние, ставшее действием: команда появится там, где автор её не писал.
        const asVerb =
          doc.inHand.includes(node.id) ||
          Object.values(content.nodes).some((n) =>
            n.options.some((o) => o.verb === node.id && o.object === doc.docId),
          );
        if (asVerb) {
          found.push({
            rule: 'pages',
            severity: 'error',
            ...at(node),
            message: `секция "${node.id}" со страницей объявлена глаголом — состояние стало действием`,
          });
        }
      }

      if (paged.length === 0) continue;

      // Страницы уже значат «можно осмотреть»: второй ответ на ту же команду.
      const examine = doc.nodes.find((n) => n.id === EXAMINE);
      if (examine) {
        found.push({
          rule: 'pages',
          severity: 'error',
          ...at(examine),
          message: `у предмета есть страницы и узел "${EXAMINE}" — два ответа на одну команду`,
        });
      }

      // Выход из чтения строит движок, и вылезти за строку списка он может так же,
      // как авторская метка. Листание меряет себя само: `вперёд` и `назад` короче
      // любого предела.
      const close = closeLabel(doc.label);
      if (close.length > LABEL_MAX) {
        found.push({
          rule: 'pages',
          severity: 'error',
          file: doc.path,
          message: `"${close}" длиннее ${LABEL_MAX} знаков — в строку списка команда не влезет`,
        });
      }
    }

    return found;
  },
};

/**
 * Формы дополнения (07-оболочка-тз, «Генераторы опций»).
 *
 * Проверяем типы и то, что точечная форма адресована существующему глаголу:
 * опечатка в ключе `targets` иначе не видна вовсе — команда молча соберётся
 * с общей формой, и `подойти к доске` однажды станет `подойти доску`.
 */
const targetForms: Rule = {
  id: 'targets',
  title: 'форма дополнения написана неверно',
  run(content) {
    const found: Finding[] = [];
    const byEpisode = new Map(content.episodes.map((e) => [e.id, e]));

    for (const doc of Object.values(content.docs)) {
      const complain = (message: string, severity: 'error' | 'warn' = 'error') =>
        found.push({ rule: 'targets', severity, file: doc.path, message });

      const target = doc.fm.target;
      if (target != null && (typeof target !== 'string' || target.trim() === '')) {
        complain('target — это готовое дополнение к команде одной строкой: `в аудиторию`');
      }

      const targets = doc.fm.targets;
      if (targets == null) continue;
      if (typeof targets !== 'object' || Array.isArray(targets)) {
        complain('targets — это словарь «глагол: форма», например `подойти: к доске`');
        continue;
      }

      const episodeId = episodeOf(doc.docId);
      const episode = episodeId ? byEpisode.get(episodeId) : undefined;

      for (const [verb, form] of Object.entries(targets as Record<string, unknown>)) {
        if (typeof form !== 'string' || form.trim() === '') {
          complain(`targets.${verb} — это строка: форма, которая встанет после глагола`);
        }
        // Глагол, которого нет, — опечатка: форма не сработает никогда.
        if (episode && !episode.verbs.includes(verb) && !episode.itemVerbs.includes(verb)) {
          // Реестр глаголов — подсказка автору, а не источник доступности:
          // команду создаёт переход, комната или секция предмета.
          complain(`targets.${verb}: глагол "${verb}" не объявлен ни в verbs, ни в itemVerbs эпизода "${episode.id}"`, 'warn');
        }
      }
    }

    return found;
  },
};

/**
 * Метки говорящих (07-оболочка-тз, «Когда собеседников больше одного»).
 *
 * Метка — служебное имя, а не реплика: пишется строчными, живёт между `> `
 * и первым тире. Правило ловит ровно те три случая, которые руками не видно:
 * потерянную метку, ремарку, притворившуюся меткой, и одиночный голос.
 */
const speakers: Rule = {
  id: 'speakers',
  title: 'метки говорящих',
  run(content) {
    const found: Finding[] = [];

    for (const doc of Object.values(content.docs)) {
      const names = new Map<string, { count: number; line: number }>();
      let bare: number | null = null;

      for (const node of doc.nodes) {
        for (const line of node.text.split('\n')) {
          const said = speakerOf(line);
          if (said.voice !== 'speech') continue;

          if (said.name == null) {
            bare ??= node.line;
            continue;
          }

          const seen = names.get(said.name);
          if (seen) seen.count += 1;
          else names.set(said.name, { count: 1, line: node.line });

          // Ремарка, у которой съели перевод строки, выглядит ровно так:
          // длинная фраза, точка на конце — и всё это встало именем.
          const words = said.name.split(/\s+/).length;
          if (words > 3 || said.name.endsWith('.')) {
            found.push({
              rule: 'speakers',
              severity: 'error',
              file: doc.path,
              line: node.line,
              message: `метка «${said.name}» — это ремарка, а не имя: метка до трёх слов и без точки`,
            });
          }
        }
      }

      // Имён несколько, а где-то реплика без метки: скорее всего, её потеряли.
      if (names.size > 1 && bare != null) {
        found.push({
          rule: 'speakers',
          severity: 'warn',
          file: doc.path,
          line: bare,
          message: `в сцене ${names.size} названных собеседника и реплика без метки — кто её говорит?`,
        });
      }

      // Одна реплика на голос — это и потерянная метка, и законный прохожий.
      // Решает автор, поэтому предупреждение, а не ошибка.
      for (const [name, { count, line }] of names) {
        if (count > 1 || names.size < 2) continue;
        found.push({
          rule: 'speakers',
          severity: 'warn',
          file: doc.path,
          line,
          message: `метка «${name}» встречается один раз — проходной голос или потерянная метка?`,
        });
      }
    }

    return found;
  },
};

/**
 * Монтажный кадр (07-оболочка-тз, «Монтажный кадр»).
 *
 * Короткое событие, где Марго действует, а руля игроку не дают. Отсюда оба
 * ограничения: помеченная опция на таком узле — это команда, которой игрок
 * не увидит, а соседство с титром или сплэшем значит, что автор просит от
 * одного узла две несовместимые композиции.
 */
const montage: Rule = {
  id: 'montage',
  title: 'монтажный кадр',
  run(content) {
    const found: Finding[] = [];

    for (const node of allNodes(content)) {
      if (!node.attrs.tag.includes('montage')) continue;
      const doc = docOfNode(content, node);
      const where = { file: doc.path, line: node.line };

      const labelled = node.options.filter((o) => o.label !== '');
      if (labelled.length > 0) {
        found.push({
          rule: 'montage',
          severity: 'error',
          ...where,
          message:
            `у монтажного кадра помеченные опции (${labelled.map((o) => `"${o.label}"`).join(', ')}) — ` +
            'кадр не принимает ввод, продолжает его только безымянный маршрут',
        });
      }

      // Композиции разные: титр предъявляет запись, сплэш показывает лицо,
      // монолог держит один голос. На одном узле они спорят за экран.
      const clash = node.attrs.tag.filter((t) => t === 'titlecard' || t === 'monolog' || t.startsWith('splash:'));
      if (clash.length > 0) {
        found.push({
          rule: 'montage',
          severity: 'error',
          ...where,
          message: `montage несовместим с ${clash.join(', ')}: у этих режимов разные семантика и композиция`,
        });
      }
    }

    return found;
  },
};

/**
 * Физическое ожидание (07-оболочка-тз, «Физическое ожидание»).
 *
 * Механика редкая и хрупкая: узел на полторы минуты удерживает игрока, и всё,
 * что в ней может быть написано не так, читается одинаково — «игра зависла».
 * Поэтому проверяем не стиль, а работоспособность: есть ли чем занять руки,
 * есть ли куда выйти, и там ли вообще стоит ожидание.
 */
/**
 * Размеченные сущности (07-оболочка-тз, «Явно размеченные сущности»).
 *
 * Ссылка, которая никуда не ведёт, — ошибка, а не пустяк: подсветки у неё
 * не будет, но текст всё равно напечатается формой из разметки, и автор
 * увидит ровно то, что хотел. То есть молча сломанной она выглядит как
 * работающая, и заметит это не он, а игрок, который зря попробует набрать
 * неподсвеченное слово.
 */
const mentions: Rule = {
  id: 'mentions',
  title: 'размеченные сущности',
  run(content) {
    const found: Finding[] = [];

    for (const node of allNodes(content)) {
      const doc = docOfNode(content, node);
      for (const mention of parseEntities(node.text).mentions) {
        if (kindOf(content, mention.id) != null) continue;
        found.push({
          rule: 'mentions',
          severity: 'error',
          file: doc.path,
          line: node.line,
          message: `упоминание [[${mention.id}]] не разрешается ни в слово «Дела», ни в предмет, ни в термин справочника`,
        });
      }
    }

    return found;
  },
};

/**
 * `portable: true` — утверждение автора, а не механика ([[99-открытые-вопросы]],
 * «Глаголы и состояния предметов»). Движок на него не смотрит: вещь оказывается
 * на руках потому, что узел сказал `give`, и никакой второй разрешающей системы
 * заводить не нужно.
 *
 * Смысл атрибута ровно один — поймать `give` доски или окна: предмет, который
 * автор не собирался делать переносимым, попадает в инвентарь и остаётся там
 * навсегда. Поэтому это предупреждение, а не ошибка: пока в контенте нет ни
 * одного `portable`, требовать его значило бы остановить игру ради разметки.
 */
const portable: Rule = {
  id: 'portable',
  title: 'переносимые предметы',
  run(content) {
    const found: Finding[] = [];

    for (const node of allNodes(content)) {
      for (const id of node.attrs.give) {
        const item = Object.values(content.docs).find((d) => d.id === id);
        if (!item || item.type !== 'item' || item.fm.portable === true) continue;
        found.push({
          rule: 'portable',
          severity: 'warn',
          file: docOfNode(content, node).path,
          line: node.line,
          message: `"${id}" выдаётся в руки, но не объявлен переносимым: добавьте \`portable: true\` в его frontmatter`,
        });
      }
    }

    return found;
  },
};

const waits: Rule = {
  id: 'wait',
  title: 'физическое ожидание',
  run(content) {
    const found: Finding[] = [];
    const waiting = allNodes(content).filter((n) => n.attrs.wait != null);

    for (const node of waiting) {
      const doc = docOfNode(content, node);
      const where = { file: doc.path, line: node.line };
      const say = (message: string) => found.push({ rule: 'wait', severity: 'error' as const, ...where, message });

      // Ждут в сцене. В комнате стоят, предмет отвечает, слово объясняет —
      // удерживать игрока им нечем и незачем.
      if (doc.type !== 'scene') {
        say(`ожидание в заметке типа "${doc.type}": оно бывает только в сцене`);
      }

      const full = node.attrs.tag.filter((t) => t === 'titlecard' || t === 'montage' || t.startsWith('splash:'));
      if (full.length > 0) {
        say(`ожидание на полноэкранном узле (${full.join(', ')}): ввод там не принимается, а ждать без действий нечем`);
      }

      // Полторы минуты без единой команды — это зависшая игра, а не ожидание.
      // Занятие рук («посмотреть на часы») и есть содержание механики.
      if (!node.options.some((o) => o.label !== '')) {
        say('ожидание без единой опции: игроку полторы минуты нечего делать, и он решит, что игра сломалась');
      }

      const routes = node.options.filter((o) => o.verb === null && o.label === '');
      if (routes.length !== 1) {
        say(
          routes.length === 0
            ? 'ожидание без безымянного маршрута: время выйдет, а вести игрока некуда'
            : `у ожидания ${routes.length} безымянных маршрута, а завершает его ровно один`,
        );
      }

      // Второе незавершённое ожидание — ошибка: активное всегда одно, и вход
      // в соседнее молча стёр бы первое вместе с прожитым временем.
      for (const option of node.options) {
        const target = option.target ? content.nodes[option.target] : undefined;
        if (target && target.attrs.wait != null && target.addr !== node.addr) {
          say(`из ожидания "${node.attrs.wait!.id}" ведёт "${option.label || 'маршрут'}" в другое ожидание — активное бывает одно`);
        }
      }
    }

    // Условия читают ожидание по имени. Опечатка в нём не ломает сборку и не
    // видна в тексте: вариант просто никогда не выпадает.
    const declared = new Set(waiting.map((n) => n.attrs.wait!.id));
    const term = /\bwait\.([a-z0-9-]+)/gi;
    for (const node of allNodes(content)) {
      const conditions = [node.attrs.if, ...node.options.map((o) => o.attrs.if)].filter(Boolean) as string[];
      for (const cond of conditions) {
        for (const m of cond.matchAll(term)) {
          if (!declared.has(m[1]!)) {
            found.push({
              rule: 'wait',
              severity: 'error',
              file: docOfNode(content, node).path,
              line: node.line,
              message: `условие ссылается на ожидание "${m[1]!}", а такого ожидания нет ни в одной сцене`,
            });
          }
        }
      }
    }

    return found;
  },
};

export const RULES: Rule[] = [
  brokenGraph,
  mentions,
  portable,
  pages,
  speakers,
  montage,
  waits,
  targetForms,
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
