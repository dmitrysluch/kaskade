---
id: 00-program
type: item
label: стенд программ
target: стенд программ
# Стенд общий для всех версий кафедрального коридора. Поиск доступен только в
# `00`: переход дальше требует уже полученного `word-containment`.
---

Стенд с учебными программами трёх факультетов.

## осмотреть

Десятки листов: курсы, коллоквиумы, замены аудиторий.

## искать
- if: "word:word-ahlers, !word:word-containment"
- once
- label: искать Алерса
- set: prolog.ahlers-program
- give: word-containment

Лист факультета III.

`Sicherheitsbehälter II` · понедельник, 9:00 · `H 1012` · Prof. F. Ahlers.

Основная литература: K. Schmidt, F. Ahlers, `Sicherheitsbehälter: Auslegung und Nachweis`.

`Sicherheitsbehälter` — защитная оболочка реактора, контейнмент.
