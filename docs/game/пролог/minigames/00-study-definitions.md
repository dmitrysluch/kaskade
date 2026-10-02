---
id: 00-study-definitions
type: minigame
subtype: untangle
label: запроектная авария
grid: {columns: 24, rows: 18}
seed: 1103
complete: complete
points:
  0: {start: [21, 12], solution: [12, 1]}
  1: {start: [6, 2],   solution: [18, 2]}
  2: {start: [8, 16],  solution: [22, 6]}
  3: {start: [2, 6],   solution: [21, 12]}
  4: {start: [18, 2],  solution: [16, 16]}
  5: {start: [16, 16], solution: [8, 16]}
  6: {start: [22, 6],  solution: [3, 12]}
  7: {start: [12, 9],  solution: [2, 6]}
  8: {start: [12, 1],  solution: [6, 2]}
  9: {start: [3, 12],  solution: [12, 9]}
threads:
  - {id: 0,  points: [0, 1]}
  - {id: 1,  points: [1, 2]}
  - {id: 2,  points: [2, 3]}
  - {id: 3,  points: [3, 4]}
  - {id: 4,  points: [4, 5]}
  - {id: 5,  points: [5, 6]}
  - {id: 6,  points: [6, 7]}
  - {id: 7,  points: [7, 8]}
  - {id: 8,  points: [8, 0]}
  - {id: 9,  points: [9, 0]}
  - {id: 10, points: [9, 3]}
  - {id: 11, points: [9, 6]}
---

### Учебник

Оболочка рассчитана на проектную аварию — аварию, условия которой перечислены в
проекте. Авария, условия которой в проекте не перечислены, называется
запроектной.

## complete
- tag: montage
- set: prolog.study-definitions
- timeLabel: час спустя

Ты закладываешь страницу. За окном начинаются сумерки.

→ [[scenes/00-show-toby]]
