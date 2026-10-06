---
id: common-faculty-corridor
type: room
log: true
persistent: tu.faculty-corridor
available: true
label: кафедральный коридор
target: в кафедральный коридор
items: [00-program, 03-door-202, 03-door-209, 03-door-217]
exits:
  - persistent: tu.elevator
  - persistent: tu.secretariat
  - persistent: tu.project-admin
  - persistent: tu.neighbour-group
  - persistent: tu.ahlers-office
  - persistent: tu.doctoral-office
---

Двенадцать закрытых дверей вдоль коридора. Рядом с лифтом стенд программ.

У лестницы служебный телефон и список внутренних номеров под стеклом.

В торцевом окне видна парковка.

→ [[#коридор]]

```options
идти: exits
осмотреть: items
```

## коридор
- items: [00-door-214, 00-numbers]

## reentry

Под стеклом списка номеров отражается окно на парковку.
