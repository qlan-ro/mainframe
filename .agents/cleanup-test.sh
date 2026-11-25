#!/usr/bin/env bash
# Kill stale live-qa processes of this checkout: the ports of its .env, the tauri target's fixed Vite port and CDP.
# Reached only via `test-env.sh reset`. It used to sweep the whole daemon port range, which stopped other sessions'
# runs; a stale run of another checkout is now that checkout's to reset (`--worktree <path>`).
set -uo pipefail

AGENTS="$(cd "$(dirname "$0")" && pwd -P)"
PROJECT_ROOT="${MF_TARGET:-$(cd "$AGENTS/.." && pwd -P)}"
PORTS="5174 9222"
if [ -f "$PROJECT_ROOT/.env" ]; then
  # shellcheck disable=SC1091
  . "$PROJECT_ROOT/.env"
  PORTS="${DAEMON_PORT:-} ${VITE_PORT:-} $PORTS"
fi
exec bash "$AGENTS/stop-test.sh" $PORTS
