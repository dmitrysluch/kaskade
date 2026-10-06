---
id: common-elevator
type: room
log: true
persistent: tu.elevator
available: true
label: лифт
target: в лифт
items: [campus-elevator-panel]
exits:
  - persistent: tu.canteen
    target: на этаж EG
  - persistent: tu.auditorium-gallery
    target: на этаж 1
  - persistent: tu.faculty-corridor
    target: на этаж 2
---

Стальные стенки кабины, зеркало над поручнем. У двери панель этажей.

В углу зеркала наклейка техобслуживания с загнутым краем.

→ [[#кабина]]

```options
ехать: exits
осмотреть: items
```

## кабина

## reentry

Двери кабины сходятся с коротким скрежетом.
