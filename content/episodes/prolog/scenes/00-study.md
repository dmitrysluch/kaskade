---
id: 00-study
type: scene
label: учебник
---
→ [[minigames/00-study-ines]]
  - if: "prolog.study-derivation, !prolog.study-ines"
→ [[minigames/00-study-derivation]]
  - if: "prolog.study-definitions, !prolog.study-derivation"
→ [[minigames/00-study-definitions]]
  - if: "!prolog.study-definitions"
→ [[rooms-virt/tu.dorm-room]]
