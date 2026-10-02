import { virtDocId } from '../../shared/rooms.ts';
import type { RawDoc, RawGenerator, RawNode } from './markdown.ts';

/**
 * Сборка виртуальных комнат ([[13-навигация-и-комнаты-тз]], «Объединение»).
 *
 * У помещения два слоя источников: **общая часть** — то, что не меняется никогда
 * (окно, планировка, постоянные выходы), — и **версия среза**, где меняется
 * обстановка и люди. Движок сливает их в памяти; ни папки `rooms-virt/`, ни
 * сгенерированных файлов на диске нет.
 *
 * Слияние ровно двухуровневое и без вычитания. «Ближайшего предыдущего среза»
 * не существует: если вещь должна исчезнуть в другом дне, её сначала убирают
 * из общей части в версии, где она есть. Это дороже в написании, зато читая
 * файл, видно всё, что в нём есть, — а не то, что осталось после трёх
 * наследований.
 */

/** Источник: разобранный файл комнаты плюс то, что загрузчик уже из него достал. */
export interface RoomPart {
  docId: string;
  raw: RawDoc;
  /** Постоянный адрес помещения: `tu.dorm-room`. */
  persistent: string;
  /** Срез версии; `null` — общая часть. */
  stage: string | null;
  label: string | null;
  target: string | null;
  targets: Record<string, string>;
  entry: string | null;
  available: boolean | null;
  log: boolean | null;
  /** `undefined` — список не объявлен: значимо, потому что `[]` значит «выходов нет». */
  exits: string[] | undefined;
  items: string[] | undefined;
}

/** Узел собранной комнаты помнит, из какого файла и какого слоя он пришёл. */
export interface MergedNode {
  raw: RawNode;
  file: string;
  /** Для относительных ссылок: `[[items/01-board]]` ищется от своего файла. */
  baseDocId: string;
  part: 'common' | 'version';
}

export interface MergedRoom {
  episode: string;
  persistent: string;
  stage: string;
  /** docId собранного представления: он же уезжает в сейв, в граф и в `/adm`. */
  docId: string;
  label: string | null;
  target: string | null;
  targets: Record<string, string>;
  entry: string | null;
  available: boolean;
  /** Хранит ли собранная комната свой поток после ухода. */
  log: boolean;
  exits: string[];
  items: string[];
  nodes: MergedNode[];
  /**
   * Генераторы опций комнаты: блок версии заменяет общий целиком.
   *
   * Отдельным полем, а не поиском по собранным узлам: блок — свойство **файла**,
   * а висит он на узле. Если версия перепишет вступление, блок общей части
   * уехал бы вместе с ним — и комната молча потеряла бы все выходы.
   */
  generators: RawGenerator[];
  /** Где объявлены блоки `options`: у собранной комнаты их законно два. */
  optionBlocks: { file: string; line: number }[];
}

function generatorsIn(part: RoomPart | null): RawGenerator[] {
  return (part?.raw.nodes ?? []).flatMap((n) => n.generators);
}

function blocksOf(part: RoomPart): { file: string; line: number }[] {
  return part.raw.nodes
    .filter((n) => n.generators.length > 0)
    .map((n) => ({ file: part.raw.path, line: n.generators[0]!.line }));
}

/**
 * Слить общую часть с версией среза.
 *
 * Правила по таблице ТЗ, и каждое отвечает на вопрос «что значит, что автор
 * этого не написал»:
 *
 * - `label`, `target`, `entry`, `available` — версия заменяет, отсутствие наследует;
 * - `targets` — объединение по глаголам: у версии своя форма только там, где она есть;
 * - `items` — общие плюс версии, без повторов: постоянное остаётся постоянным;
 * - `exits` — список версии заменяет общий **целиком**, и `[]` значит «выходов нет»
 *   (поэтому сравнение с `undefined`, а не с пустотой);
 * - блок `options` — то же самое: версия заменяет, а не дописывает;
 * - нода с тем же id — замена целиком и **на месте** общей: порядок чтения файла
 *   не должен зависеть от того, что переопределили;
 * - новая нода — в конец, в порядке источника.
 */
export function mergeRoom(episode: string, persistent: string, stage: string, common: RoomPart | null, version: RoomPart | null): MergedRoom {
  const pick = <T>(from: RoomPart | null, take: (p: RoomPart) => T | null | undefined): T | null => {
    const value = from == null ? null : take(from);
    return value == null ? null : value;
  };

  const nodes: MergedNode[] = (common?.raw.nodes ?? []).map((raw) => ({
    raw,
    file: common!.raw.path,
    baseDocId: common!.docId,
    part: 'common' as const,
  }));

  for (const raw of version?.raw.nodes ?? []) {
    const replacement: MergedNode = {
      raw,
      file: version!.raw.path,
      baseDocId: version!.docId,
      part: 'version',
    };
    const at = nodes.findIndex((n) => n.raw.id === raw.id);
    if (at === -1) nodes.push(replacement);
    else nodes[at] = replacement;
  }

  return {
    episode,
    persistent,
    stage,
    docId: virtDocId(episode, persistent, stage),
    label: pick(version, (p) => p.label) ?? pick(common, (p) => p.label),
    target: pick(version, (p) => p.target) ?? pick(common, (p) => p.target),
    targets: { ...common?.targets, ...version?.targets },
    entry: pick(version, (p) => p.entry) ?? pick(common, (p) => p.entry),
    available: version?.available ?? common?.available ?? true,
    // `log` общей комнаты наследуется всеми срезами, значение версии его
    // перекрывает ([[13-навигация-и-комнаты-тз]], «Объединение»).
    log: version?.log ?? common?.log ?? false,
    exits: version?.exits ?? common?.exits ?? [],
    items: [...new Set([...(common?.items ?? []), ...(version?.items ?? [])])],
    nodes,
    generators: generatorsIn(version).length > 0 ? generatorsIn(version) : generatorsIn(common),
    optionBlocks: [...(common ? blocksOf(common) : []), ...(version ? blocksOf(version) : [])],
  };
}
