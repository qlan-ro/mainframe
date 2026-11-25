#!/usr/bin/env bash
# Port-scoped teardown of ONE test run (parallel-safe). A listener this checkout did not
# start is named and left running (own-ports.sh).
# Usage: stop-test.sh [port ...]   — defaults to this checkout's .env ports + CDP 9222.
# Tauri note: killing $DAEMON_PORT also takes the app connected to it — at
# teardown that is exactly what we want; never use this mid-run for a "daemon-only" restart.
#
# POSIX-clean: no bash arrays / BASH_SOURCE, so it runs identically under bash,
# zsh, or sh regardless of how it's invoked.
set -uo pipefail

PROJECT_ROOT="${MF_TARGET:-$(cd "$(dirname "$0")/.." && pwd -P)}"
. "$(cd "$(dirname "$0")" && pwd -P)/own-ports.sh"

if [ "$#" -gt 0 ]; then
  PORTS="$*"
elif [ -f "$PROJECT_ROOT/.env" ]; then
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  PORTS="${DAEMON_PORT} ${VITE_PORT} 9222"
else
  echo "STOP_SKIPPED: no $PROJECT_ROOT/.env — nothing was launched from this checkout" >&2
  exit 0
fi

for port in $PORTS; do
  check_port "$port" || exit 2
done

failed=""
for port in $PORTS; do
  stop_port "$port" "$PROJECT_ROOT" || failed="$failed $port"
done
if [ -n "$failed" ]; then
  echo "STOP_FAILED: still held:$failed" >&2
  exit 1
fi
echo "STOP_OK: ports $PORTS clear"
