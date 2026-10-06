---
id: 02-dorm-room
type: room
persistent: tu.dorm-room
stage: "02"
available: true
items: [campus-speaker, campus-dorm-window]
---

Между шторами полоска солнца. Тоби лежит лицом к стене, всё ещё в джинсах.
Один кроссовок под кроватью, второй посреди комнаты.

→ [[#комната]]

## комната

→ лечь спать [[transitions/03-tu-entry]]
  - if: prolog.police-done
  - advance

## reentry

Тоби спит. Кроссовок всё ещё посреди комнаты.
