---
id: 01-corridor
type: room
persistent: tu.auditorium-gallery
stage: "01"
label: коридор
target: в коридор
exits:
  - persistent: tu.h1012
items: [01-notice]
---

Коридор факультета, пусто, впереди лестница на выход.
Автомат с кофе не работает с весны, на нём записка «[[ref-kaputt|kaputt]]» и смайлик.
Из двадцати ламп горит половина: об экономии висит отдельная бумага.
Доска объявлений во всю стену.

```options
идти: exits
осмотреть: items
```

→ уйти [[transitions/02-club-entry]]
  - advance
