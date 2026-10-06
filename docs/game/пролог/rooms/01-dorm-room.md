---
id: 01-dorm-room
type: room
persistent: tu.dorm-room
stage: "01"
available: true
items: [campus-speaker, campus-dorm-window]
---

На твоей кровати скомкан свитер. Между подушкой и стеной зажат провод зарядки.
На соседней кровати одеяло сбилось к изножью.

→ [[#комната]]

## комната

→ лечь спать [[transitions/02-club-entry]]
  - if: prolog.after-lecture-done
  - advance

## reentry

Свитер всё ещё на кровати.
