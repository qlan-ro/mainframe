#!/usr/bin/env bash
set -euo pipefail
# Usage: scripts/testid-scan.sh coverage|dupes [path]
ROOT="packages/desktop/src"
mode="${1:-coverage}"
scope="${2:-$ROOT}"

if [ "$mode" = "coverage" ]; then
  miss=0
  while IFS= read -r f; do
    case "$f" in *__tests__*) continue;; esac
    n=$(grep -oE '<(button|input|select|textarea)\b' "$f" | wc -l | tr -d ' ')
    t=$(grep -oE 'data-testid=' "$f" | wc -l | tr -d ' ')
    if [ "$n" -gt "$t" ]; then echo "UNTAGGED ($((n-t))): $f"; miss=$((miss+1)); fi
  done < <(grep -rlE '<(button|input|select|textarea)\b' "$scope" --include='*.tsx')
  echo "files still untagged: $miss"
  [ "$miss" -eq 0 ] && echo "COVERAGE OK" || echo "COVERAGE INCOMPLETE"
elif [ "$mode" = "dupes" ]; then
  bad=0
  while IFS= read -r f; do
    case "$f" in *__tests__*) continue;; esac
    dups=$(grep -oE 'data-testid="[^"$]+"' "$f" | sort | uniq -d || true)
    if [ -n "$dups" ]; then echo "DUPES in $f:"; echo "$dups"; bad=$((bad+1)); fi
  done < <(grep -rlE 'data-testid=' "$scope" --include='*.tsx')
  echo "files with duplicate static testids: $bad"
  [ "$bad" -eq 0 ] && echo "UNIQUE OK" || echo "DUPES FOUND"
fi
