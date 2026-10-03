---
id: 00-dorm-room
type: room
persistent: tu.dorm-room
stage: "00"
available: true
items: [00-computer, 00-schedule, 00-blister]
# Входной диспетчер выбирает состояние комнаты. Возврат с книгой имеет
# приоритет: книга получена вне комнаты и сразу открывает `00-talk#с-книгой`.
# Завершённый разговор возвращает прямо в `#после-разговора`, чтобы не
# повторять полное описание комнаты.
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
  - if: "has:00-book, !prolog.study-only-case"
→ лечь спать [[scenes/00-night]]
  - if: word:word-only-case
  - advance

## после-разговора
- items: [00-toby]

Тоби смотрит в экран.

→ говорить с тоби [[scenes/00-talk]]
→ изучать учебник [[scenes/00-study]]
  - if: "has:00-book, !prolog.study-only-case"
→ лечь спать [[scenes/00-night]]
  - if: word:word-only-case

## один

Тоби ушёл, дверь оставил открытой, из коридора тянет чужой едой.

→ изучать учебник [[scenes/00-study]]
  - if: "has:00-book, !prolog.study-only-case"
→ лечь спать [[scenes/00-night]]
  - if: word:word-only-case
## начало
- once
- give: 00-card

→ [[#комната]]
