#!/usr/bin/env bash
# Test environment for mainframe — test-worktree skill contract. Thin dispatcher over
# the per-target launch scripts (which own build, isolated ports, and readiness waits).
#   test-env.sh prepare [tauri|browser]  install + types + sidecar + ports, no launch
#   test-env.sh up [tauri|browser]       prepare (idempotent) then launch; default: tauri
#   test-env.sh down [port ...]          port-scoped; defaults to the target's .env ports
#   test-env.sh reset                    fleet-wide sweep of the test port ranges
# Every verb accepts `--worktree <path>` to act on another checkout.
# Targets: tauri = native shell via tauri-mcp bridge (max 1);
# tauri-qa = packaged build via tauri-mcp bridge, isolated port/data dir (max 1);
# browser = renderer+daemon only, cheapest — use when no scenario needs the native shell.
# Project QA knowledge (fixtures, seeding, gotchas): .agents/test-worktree.md
set -uo pipefail

AGENTS="$(cd "$(dirname "$0")" && pwd -P)"

verb="${1:-}"
[ "$#" -gt 0 ] && shift
target=""
worktree=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --worktree) worktree="${2:-}"; shift 2 ;;
    *) target="${target:+$target }$1"; shift ;;
  esac
done

# The checkout under test. Defaults to the one holding this script.
TARGET="$(cd "${worktree:-$AGENTS/..}" && pwd -P)" || exit 1

# The scripts themselves come from the PRIMARY checkout, never from the branch
# under test. A worktree is created off origin/main at lane start and then frozen,
# so a harness fix committed today never reaches a worktree branched yesterday —
# which is how a fixed provisioning bug kept failing QA runs for days.
common_dir="$(git -C "$TARGET" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"
if [ -n "$common_dir" ]; then
  primary="$(cd "$common_dir/.." && pwd -P)"
  if [ "$primary/.agents" != "$AGENTS" ] && [ -x "$primary/.agents/test-env.sh" ]; then
    echo "HARNESS=$primary/.agents (target: $TARGET)"
    exec bash "$primary/.agents/test-env.sh" "$verb" $target --worktree "$TARGET"
  fi
fi

export MF_TARGET="$TARGET"

launcher() {
  case "${1:-tauri}" in
    tauri) echo "$AGENTS/launch-test-tauri.sh tauri-mcp" ;;
    tauri-qa) echo "$AGENTS/launch-test-tauri-qa.sh tauri-mcp" ;;
    browser) echo "$AGENTS/launch-test-browser.sh playwright-cli" ;;
    *) echo "unknown target '$1' (tauri|tauri-qa|browser)" >&2; return 64 ;;
  esac
}

run() {
  mode="$1"
  resolved="$(launcher "${2:-tauri}")" || exit 64
  script="${resolved% *}"; engine="${resolved##* }"
  MF_MODE="$mode" bash "$script" || exit 1
  [ "$mode" = up ] && echo "ENGINE=$engine"
  return 0
}

case "$verb" in
  prepare) run prepare "${target:-tauri}" ;;
  up) run up "${target:-tauri}" ;;
  down) exec bash "$AGENTS/stop-test.sh" $target ;;
  reset) exec bash "$AGENTS/cleanup-test.sh" ;;
  *) echo "usage: $0 prepare|up [tauri|tauri-qa|browser] | down [port ...] | reset [--worktree <path>]" >&2; exit 64 ;;
esac
