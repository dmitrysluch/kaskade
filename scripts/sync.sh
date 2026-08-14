#!/usr/bin/env bash
#
# Зеркалит из Obsidian в репозиторий — вместе с удалениями.
#
#   пролог/scenes  →  content/episodes/prolog/scenes
#   пролог/rooms   →  content/episodes/prolog/rooms
#   пролог/items   →  content/episodes/prolog/items
#   пролог/words   →  content/words          общие на всю игру
#   пролог/docs    →  content/docs           общие на всю игру
#   game/*.md      →  docs/game              ТЗ и замысел, чтобы код и ТЗ не разъехались
#
# Соответствие задано в `пролог/00-карта.md` — если оно там меняется, менять надо здесь.
#
# Зеркало, а не копирование: удалил заметку в Obsidian — она уходит и здесь, и это
# видно в diff'е. Поэтому --delete идёт по каждой паре папок отдельно, а не по
# content/ целиком: game.yaml, episode.yaml, characters/ и reference.yaml в Obsidian
# не живут, и снести их синхронизацией нельзя.
#
# Направление одностороннее: Obsidian → репозиторий. Править надо в Obsidian.
#
# Перенацеливается: VAULT=/путь ./scripts/sync.sh

set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VAULT="${VAULT:-$HOME/Library/CloudStorage/OneDrive-Personal/Apps/Obsidian/personal/Интерактив на ДР}"
GAME="$VAULT/game"

if [ ! -d "$GAME" ]; then
  echo "нет папки с заметками: $GAME" >&2
  echo "укажи другую через VAULT=... или проверь, что OneDrive синхронизирован" >&2
  exit 1
fi

PAIRS=(
  "$GAME/пролог/scenes|$REPO/content/episodes/prolog/scenes"
  "$GAME/пролог/rooms|$REPO/content/episodes/prolog/rooms"
  "$GAME/пролог/items|$REPO/content/episodes/prolog/items"
  "$GAME/пролог/words|$REPO/content/words"
  "$GAME/пролог/docs|$REPO/content/docs"
  "$GAME|$REPO/docs/game"
)

total=0

for pair in "${PAIRS[@]}"; do
  src="${pair%%|*}"
  dst="${pair##*|}"

  if [ ! -d "$src" ]; then
    echo "  пропущено ${src#"$VAULT"/} — нет такой папки"
    continue
  fi
  mkdir -p "$dst"

  changes="$(
    rsync -a --delete --out-format='%i %n' \
      --exclude '.obsidian/' \
      --exclude '.trash/' \
      --exclude '.DS_Store' \
      "$src/" "$dst/"
  )"

  # Разбор через bash, а не sed: имена файлов кириллические, и sed в системной
  # локали спотыкается о них раньше, чем успевает что-то напечатать.
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    flags="${line%% *}"
    name="${line#* }"
    case "$flags" in
      '*deleting') label='  удалено  ' ;;
      '.'*) continue ;;
      'cd'*) continue ;;
      *'+++++++++') label='  добавлено' ;;
      *) label='  обновлено' ;;
    esac
    echo "$label ${dst#"$REPO"/}/$name"
    total=$((total + 1))
  done <<< "$changes"
done

echo
if [ "$total" -eq 0 ]; then
  echo "уже синхронно"
else
  echo "$total изменений. Дальше: npm run lint"
fi
