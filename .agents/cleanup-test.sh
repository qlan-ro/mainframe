#!/usr/bin/env bash
# Kill stale test-worktree dev processes. Protected: production daemon on 31415.
# Run ONCE per fleet (orchestrator) or once before a single-branch launch.
set -uo pipefail

PROTECTED_PORT=31415

pids=$(ps ax -o pid,command | grep 'mainframe-core run dev' | grep -v grep | awk '{print $1}')
for pid in $pids; do
  if ! lsof -iTCP:$PROTECTED_PORT -sTCP:LISTEN -a -p "$pid" 2>/dev/null | grep -q LISTEN; then
    pkill -9 -P "$pid" 2>/dev/null
    kill -9 "$pid" 2>/dev/null
  fi
done

pids=$(ps ax -o pid,command | grep 'mainframe-desktop run dev' | grep -v grep | awk '{print $1}')
for pid in $pids; do
  pkill -9 -P "$pid" 2>/dev/null
  kill -9 "$pid" 2>/dev/null
done

lsof -ti :9222 2>/dev/null | xargs kill -9 2>/dev/null

sleep 2

remaining=$(ps ax -o pid,command | grep 'mainframe-\(core\|desktop\) run dev' | grep -v grep | awk '{print $1}')
if [ -n "$remaining" ]; then
  echo "$remaining" | xargs kill -9 2>/dev/null
  sleep 2
fi

if ps ax -o pid,command | grep 'mainframe-\(core\|desktop\) run dev' | grep -v grep | grep -q .; then
  echo "CLEANUP_FAILED: dev processes survived" >&2
  exit 1
fi

if lsof -iTCP:$PROTECTED_PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "CLEANUP_OK (production daemon on $PROTECTED_PORT untouched)"
else
  echo "CLEANUP_OK (nothing on $PROTECTED_PORT — production app not running)"
fi
