---
id: common-elevator
type: room
log: true
persistent: tu.elevator
available: true
label: лифт
target: в лифт
exits:
  - persistent: tu.canteen
    target: на этаж EG
  - persistent: tu.auditorium-gallery
    target: на этаж 1
  - persistent: tu.faculty-corridor
    target: на этаж 2
---

Лифт соединяет столовую, аудиторную галерею и кафедральный этаж.

```options
ехать: exits
```
