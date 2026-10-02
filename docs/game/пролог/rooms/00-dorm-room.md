---
id: 00-dorm-room
type: room
persistent: tu.dorm-room
stage: "00"
available: true
items: [00-computer, 00-schedule, 00-blister]
# Пустое вступление — диспетчер возврата. Книга получена вне
# комнаты, поэтому её появление обязано перебить сохранённое состояние.
---
→ [[scenes/00-talk#с-книгой]]
  - if: "has:00-book, !prolog.book-greeted"
→ [[#один]]
  - if: prolog.toby-left
→ [[#комната]]

```options
идти: exits
осмотреть: items
```

## комната
- items: [00-toby]

Комната на троих, теперь живут двое. На столе ноутбук и блистер, на подоконнике чужая колонка, на стене расписание.

Тоби лежит поперёк своей кровати, ногами на стене, с ноутбуком на животе.

→ говорить с тоби [[scenes/00-talk]]
→ изучать учебник [[scenes/00-study]]
  - if: "has:00-book, !word:word-only-case"
→ лечь спать [[scenes/00-night]]
  - if: word:word-only-case

## один

Тоби ушёл, дверь оставил открытой, из коридора тянет чужой едой.

→ выйти в окно [[#выйти-в-окно]]
  - if: "prolog.toby-left, prolog.stoicism-suicide"
→ изучать учебник [[scenes/00-study]]
  - if: "has:00-book, !word:word-only-case"
→ лечь спать [[scenes/00-night]]
  - if: word:word-only-case

## выйти-в-окно

<!-- TODO: написать текст реплики. -->

→ [[#один]]

## начало
- once
- give: 00-card

→ [[#комната]]
