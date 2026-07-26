#!/usr/bin/env bash
# Kill stale test-worktree dev processes. Protected: production daemon on 31415.
# Run ONCE per fleet (orchestrator) or once before a single-branch launch.
#
# Targets are found by PORT, not by process name: name matching stopped matching
# anything when the Node daemon was retired, so this script kept reporting
# CLEANUP_OK while leaving every stale process running.
#
# The daemon range is swept wholesale — setup-ports.sh allocates from it and
# nothing else on the machine uses it. Vite ports are NOT swept by range: 5174-
# 6174 is crowded with unrelated software (ActivityWatch's aw-server sits on
# 5600), so they're read back from the `.env` our own scripts generated in each
# worktree, plus the tauri target's fixed default.
set -uo pipefail

PROTECTED_PORT=31415
DAEMON_RANGE=31416-32416
TAURI_VITE_PORT=5174
CDP_PORT=9222

listeners() {
  lsof -tiTCP:"$1" -sTCP:LISTEN 2>/dev/null | sort -u
}

protected_pids=$(listeners "$PROTECTED_PORT")

is_protected() {
  [ -n "$protected_pids" ] && echo "$protected_pids" | grep -qx "$1"
}

# Every checkout's generated .env — the browser target writes its isolated ports
# there, so this finds runs in worktrees this script isn't sitting in.
vite_ports() {
  echo "$TAURI_VITE_PORT"
  git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print $2"/.env"}' | while read -r env_file; do
    [ -f "$env_file" ] && sed -n 's/^VITE_PORT=\([0-9]\{1,\}\)$/\1/p' "$env_file"
  done
}

targets=$(
  {
    listeners "$DAEMON_RANGE"
    listeners "$CDP_PORT"
    for port in $(vite_ports | sort -u); do listeners "$port"; done
  } | sort -u
)

for pid in $targets; do
  if is_protected "$pid"; then
    echo "SKIP $pid (production daemon on $PROTECTED_PORT)"
    continue
  fi
  # A pnpm/vite listener is a child of a shell wrapper; -P is pid-scoped, so it
  # can't reach anything but this process's own children.
  pkill -9 -P "$pid" 2>/dev/null
  kill -9 "$pid" 2>/dev/null
done

sleep 2

remaining=""
for pid in $targets; do
  is_protected "$pid" && continue
  kill -0 "$pid" 2>/dev/null && remaining="$remaining $pid"
done

if [ -n "${remaining# }" ]; then
  echo "CLEANUP_FAILED: survived SIGKILL:$remaining" >&2
  exit 1
fi

if [ -n "$protected_pids" ]; then
  echo "CLEANUP_OK (production daemon on $PROTECTED_PORT untouched)"
else
  echo "CLEANUP_OK (nothing on $PROTECTED_PORT — production app not running)"
fi
