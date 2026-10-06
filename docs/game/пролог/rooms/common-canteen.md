---
id: common-canteen
type: room
log: true
persistent: tu.canteen
available: true
label: столовая
target: в столовую
items: [campus-snack-machine]
exits:
  - persistent: tu.elevator
---

Высокое окно под потолком выходит во двор. Вдоль зала длинные столы с привинченными сиденьями.

У раздачи стопка подносов и табло меню. Рядом с лифтом светится автомат со снеками.

→ [[#зал]]

```options
идти: exits
осмотреть: items
```

## зал
- items: [campus-serving]

## reentry

Автомат со снеками гудит у лифта.
