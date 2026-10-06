---
id: 01-auditorium-gallery
type: room
persistent: tu.auditorium-gallery
stage: "01"
available: true
items: [01-board-notices, 01-coffee-machine]
exits:
  - persistent: tu.yard
  - persistent: tu.library
  - persistent: tu.h1012
  - persistent: tu.elevator
---

Вдоль окон во двор тянется широкий подоконник. У стены кофейный автомат и доска объявлений.

→ [[#полусвет]]

## свет
- items: [campus-switch-on]

Горят все двадцать ламп.

→ переключить свет [[#полусвет]]

## полусвет
- items: [campus-switch-off]

Горит десять ламп. Ряд у окон тёмный.

→ переключить свет [[#свет]]
