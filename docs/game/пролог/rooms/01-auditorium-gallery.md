---
id: 01-auditorium-gallery
type: room
persistent: tu.auditorium-gallery
stage: "01"
available: true
items: [01-notice]
exits:
  - persistent: tu.yard
  - persistent: tu.library
  - persistent: tu.h1012
  - persistent: tu.elevator
---

Аудиторная галерея факультета, пусто, впереди лестница на выход.
Автомат с кофе не работает с весны, на нём записка «[[ref-kaputt|kaputt]]» и смайлик.
Из двадцати ламп горит половина: об экономии висит отдельная бумага.
Доска объявлений во всю стену.

```options
идти: exits
осмотреть: items
```

→ уйти [[transitions/02-club-entry]]
  - advance
