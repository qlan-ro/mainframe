#!/usr/bin/env bash
# Test environment for mainframe — test-worktree skill contract. Thin dispatcher over
# the per-target launch scripts (which own build, isolated ports, and readiness waits).
#   test-env.sh up [tauri|electron|browser]   default: tauri
#   test-env.sh down [port ...]               port-scoped; defaults to this checkout's .env ports
# Targets: tauri = native shell via tauri-mcp bridge (max 1); electron = CDP 9222 (max 1);
# browser = renderer+daemon only, cheapest — use when no scenario needs the native shell.
# Project QA knowledge (fixtures, seeding, gotchas): .agents/test-worktree.md, ui-selectors.md
set -uo pipefail
AGENTS="$(cd "$(dirname "$0")" && pwd -P)"
ROOT="$(cd "$AGENTS/.." && pwd -P)"

up() {
  target="${1:-tauri}"
  case "$target" in
    tauri)
      bash "$AGENTS/cleanup-test.sh" || exit 1   # singleton: bridge tracks one dev app
      bash "$AGENTS/launch-test-tauri.sh" || exit 1
      echo "ENGINE=tauri-mcp" ;;
    electron)
      bash "$AGENTS/cleanup-test.sh" || exit 1   # singleton: CDP pinned to 9222
      bash "$AGENTS/launch-test.sh" || exit 1
      echo "ENGINE=playwright-cli" ;;
    browser)
      # No cleanup: ports are isolated per run; parallel browser runs are legal.
      bash "$AGENTS/launch-test-browser.sh" || exit 1
      echo "ENGINE=playwright-cli" ;;
    *) echo "unknown target '$target' (tauri|electron|browser)" >&2; exit 64 ;;
  esac
  # Normalize facts for the skill (launch scripts already printed the detailed set).
  # shellcheck disable=SC1091
  [ -f "$ROOT/.env" ] && . "$ROOT/.env"
  echo "PORTS=${DAEMON_PORT:-} ${VITE_PORT:-}"
  echo "LOG=/tmp/mf-daemon-${DAEMON_PORT:-unknown}.log"
}

case "${1:-}" in
  up) shift; up "$@" ;;
  down) shift; exec bash "$AGENTS/stop-test.sh" "$@" ;;
  *) echo "usage: $0 up [tauri|electron|browser] | down [port ...]" >&2; exit 64 ;;
esac
