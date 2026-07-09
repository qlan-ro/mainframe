#!/usr/bin/env bash
# Port-scoped teardown of ONE test run (parallel-safe; never touches siblings).
# Usage: stop-test.sh [port ...]   — defaults to this checkout's .env ports + CDP 9222.
# Tauri note: killing $DAEMON_PORT also takes the parent app (shared socket) — at
# teardown that is exactly what we want; never use this mid-run for a "daemon-only" restart.
#
# POSIX-clean: no bash arrays / BASH_SOURCE, so it runs identically under bash,
# zsh, or sh regardless of how it's invoked.
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
PROTECTED_PORT=31415

if [ "$#" -gt 0 ]; then
  PORTS="$*"
else
  # shellcheck disable=SC1091
  [ -f "$PROJECT_ROOT/.env" ] && . "$PROJECT_ROOT/.env"
  PORTS="${DAEMON_PORT:-31500} ${VITE_PORT:-5174} 9222"
fi

for port in $PORTS; do
  if [ "$port" = "$PROTECTED_PORT" ]; then
    echo "REFUSED: $PROTECTED_PORT is protected" >&2
    exit 2
  fi
done

for port in $PORTS; do
  lsof -ti ":$port" 2>/dev/null | xargs kill -9 2>/dev/null
done
sleep 2

leftover=0
for port in $PORTS; do
  if lsof -ti ":$port" >/dev/null 2>&1; then
    lsof -ti ":$port" | xargs kill -9 2>/dev/null
    leftover=1
  fi
done
[ "$leftover" = 1 ] && sleep 1

for port in $PORTS; do
  if lsof -ti ":$port" >/dev/null 2>&1; then
    echo "STOP_FAILED: port $port still held" >&2
    exit 1
  fi
done
echo "STOP_OK: ports $PORTS clear"
