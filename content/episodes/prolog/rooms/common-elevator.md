---
id: common-elevator
type: room
log: true
persistent: tu.elevator
available: true
label: лифт
target: к лифту
exits:
  - persistent: tu.canteen
  - persistent: tu.auditorium-gallery
  - persistent: tu.faculty-corridor
---

Лифт соединяет столовую, аудиторную галерею и кафедральный этаж.

```options
идти: exits
```
