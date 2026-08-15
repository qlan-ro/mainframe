#!/usr/bin/env bash
# Demo environment for mainframe — feature-recorder skill contract.
#   demo-env.sh up [<target>]  ports -> daemon (mock adapter) -> renderer -> seed -> block until ready
#                              -> print KEY=VALUE facts -> exit 0
#   demo-env.sh down           port-scoped teardown of what `up` started
#
# Sibling of test-env.sh, deliberately separate: a demo films the renderer against a
# DETERMINISTIC agent (the e2e mock adapter replaying recorded NDJSON) on a seeded,
# camera-ready workspace — where the test targets want a real adapter and an empty one.
# Its own ports and data dir, so it can never touch the dev daemon on :31415, the e2e
# harness on :31416, or ~/.mainframe.
set -uo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$PROJECT_ROOT"

DAEMON_PORT="${MF_DEMO_DAEMON_PORT:-31417}"
VITE_PORT="${MF_DEMO_VITE_PORT:-5183}"
PORTS=("$DAEMON_PORT" "$VITE_PORT")
PROTECTED=(31415 31416 5173 4317)      # dev daemon, e2e daemon, dev vite, e2e preview
DATA_DIR="${MF_DEMO_DATA_DIR:-/tmp/mainframe-demo/data}"
WORKSPACE="${MF_DEMO_WORKSPACE:-/tmp/mainframe-demo/acme-web}"
RECORDINGS_DIR="$PROJECT_ROOT/packages/e2e/fixtures/recordings"
# Which recorded conversation the mock adapter replays. `<key>.<n>.ndjson` = the nth
# user message of the session. tool-group: "I'll search for that" -> Read + Grep -> answer.
RECORDING_KEY="${MF_DEMO_RECORDING_KEY:-tool-group}"
DAEMON_LOG="/tmp/mf-demo-daemon-${DAEMON_PORT}.log"
UI_LOG="/tmp/mf-demo-ui-${VITE_PORT}.log"

kill_port() {
  for p in "${PROTECTED[@]}"; do [ "$1" = "$p" ] && { echo "refusing protected port $1" >&2; return 1; }; done
  lsof -ti ":$1" | xargs kill 2>/dev/null || true
}

seed() {
  # A stocked, plausible workspace. Rebuilt from scratch every `up`, so take 2 of a
  # recording sees exactly what take 1 saw.
  rm -rf "$WORKSPACE"
  mkdir -p "$WORKSPACE/src"
  cat > "$WORKSPACE/README.md" <<'MD'
# Acme Web

The customer-facing storefront. Vite + React, deployed on every merge to main.
MD
  cat > "$WORKSPACE/src/index.ts" <<'TS'
export const greeting = 'hello';
TS
  cat > "$WORKSPACE/src/cart.ts" <<'TS'
import { greeting } from './index';

export function summarize(items: string[]): string {
  return `${greeting}: ${items.length} items in the cart`;
}
TS
  cat > "$WORKSPACE/CLAUDE.md" <<'MD'
# Acme Web

Storefront app. Keep components small and typed.
MD
  git -C "$WORKSPACE" init -q -b main
  git -C "$WORKSPACE" -c user.email=demo@mainframe.dev -c user.name="Acme Demo" \
    -c commit.gpgsign=false add -A
  git -C "$WORKSPACE" -c user.email=demo@mainframe.dev -c user.name="Acme Demo" \
    -c commit.gpgsign=false commit -qm "Initial storefront"

  # Leave real uncommitted work so the diff/review surfaces have something to show.
  # An empty "no changes" panel is the single most common way a demo beat dies.
  cat > "$WORKSPACE/src/cart.ts" <<'TS'
import { greeting } from './index';

export interface CartItem {
  sku: string;
  quantity: number;
}

export function summarize(items: CartItem[]): string {
  const total = items.reduce((sum, item) => sum + item.quantity, 0);
  return `${greeting}: ${total} items in the cart`;
}
TS

  project_id=$(curl -sf -X POST "http://127.0.0.1:${DAEMON_PORT}/api/projects" \
    -H 'Content-Type: application/json' \
    -d "{\"path\":\"$WORKSPACE\",\"name\":\"acme-web\"}" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["id"])') \
    || { echo "seed: POST /api/projects failed" >&2; return 1; }

  # A board with cards. An empty Kanban is the most common dead demo beat.
  todo() {
    curl -sf -X POST "http://127.0.0.1:${DAEMON_PORT}/api/plugins/todos/todos" \
      -H 'Content-Type: application/json' \
      -d "{\"projectId\":\"$project_id\",\"title\":$1,\"status\":\"$2\",\"type\":\"$3\",\"priority\":\"$4\"}" >/dev/null
  }
  todo '"Cart totals ignore quantity"' in_progress bug high
  todo '"Add checkout summary step"' open feature medium
  todo '"Type the cart module"' open enhancement medium
  todo '"Persist the cart between visits"' open feature high
  todo '"Storefront hero copy pass"' done documentation low

  # Automations, so the surface isn't an empty state either.
  automation() {
    curl -sf -X POST "http://127.0.0.1:${DAEMON_PORT}/api/automations" \
      -H 'Content-Type: application/json' \
      -d "{\"name\":$1,\"description\":$2,\"scope\":\"project\",\"projectId\":\"$project_id\",
           \"definition\":{\"triggers\":[$3],
           \"steps\":[{\"id\":\"s1\",\"kind\":\"ask_agent\",\"prompt\":[$4]},
                      {\"id\":\"s2\",\"kind\":\"notify\",\"message\":[$5]}]}}" >/dev/null
  }
  automation '"Nightly dependency check"' '"Reviews outdated packages every weekday morning"' \
    '{"id":"t1","kind":"schedule","schedule":{"type":"weekdays","at":"09:00"},"onMissed":"skip"}' \
    '"List outdated dependencies and open a task for anything major."' '"Dependency report ready"'
  automation '"Triage new issues"' '"Runs when a session finishes"' \
    '{"id":"t1","kind":"event","event":"session.finished"}' \
    '"Summarise what changed and file follow-up tasks."' '"Triage complete"'
}

up() {
  for p in "${PORTS[@]}"; do kill_port "$p"; done
  rm -rf "$DATA_DIR"; mkdir -p "$DATA_DIR"

  cargo build --release --manifest-path packages/core-rs/Cargo.toml -p mainframe-daemon >/dev/null 2>&1 \
    || { echo "cargo build failed for mainframe-daemon" >&2; exit 1; }

  # E2E_MODE=mock registers the `mock-cli` adapter, which replays RECORDINGS_DIR instead
  # of spawning a real CLI: no API spend, no non-determinism, identical every take.
  DAEMON_PORT="$DAEMON_PORT" \
  MAINFRAME_DATA_DIR="$DATA_DIR" \
  E2E_MODE=mock \
  E2E_RECORDINGS_DIR="$RECORDINGS_DIR" \
  E2E_RECORDING_KEY="$RECORDING_KEY" \
    packages/core-rs/target/release/mainframe-daemon > "$DAEMON_LOG" 2>&1 &

  VITE_PORT="$VITE_PORT" \
  VITE_DAEMON_PORT="$DAEMON_PORT" \
  VITE_DAEMON_HTTP_PORT="$DAEMON_PORT" \
  VITE_DAEMON_WS_PORT="$DAEMON_PORT" \
  MAINFRAME_DATA_DIR="$DATA_DIR" \
    pnpm --filter @qlan-ro/mainframe-ui run dev > "$UI_LOG" 2>&1 &

  deadline=$((SECONDS + 180))
  until curl -sf "http://127.0.0.1:${DAEMON_PORT}/api/projects" >/dev/null 2>&1; do
    [ $SECONDS -ge $deadline ] && { echo "daemon not ready on :${DAEMON_PORT}" >&2; tail -40 "$DAEMON_LOG" >&2; exit 1; }
    sleep 2
  done
  # localhost, not 127.0.0.1 — Vite 6 binds ::1
  deadline=$((SECONDS + 120))
  until curl -sf "http://localhost:${VITE_PORT}" >/dev/null 2>&1; do
    [ $SECONDS -ge $deadline ] && { echo "vite not ready on :${VITE_PORT}" >&2; tail -40 "$UI_LOG" >&2; exit 1; }
    sleep 2
  done
  until curl -sf "http://127.0.0.1:${DAEMON_PORT}/api/adapters" | grep -q '"mock-cli"'; do
    [ $SECONDS -ge $((deadline + 30)) ] && { echo "mock adapter never registered" >&2; exit 1; }
    sleep 1
  done

  seed || exit 1

  echo "APP_URL=http://localhost:${VITE_PORT}"
  echo "DAEMON_URL=http://127.0.0.1:${DAEMON_PORT}"
  echo "PORTS=${PORTS[*]}"
  echo "WORKSPACE=$WORKSPACE"
  echo "DATA_DIR=$DATA_DIR"
  echo "RECORDING_KEY=$RECORDING_KEY"
  echo "LOG=$DAEMON_LOG"
  echo "UI_LOG=$UI_LOG"
  # The first-run tour arms ~1.5s after boot on a workspace with no sessions and would
  # cover the app mid-take. Seed this before the first paint (addInitScript / localstorage-set).
  echo 'LOCALSTORAGE_MF_TUTORIAL={"state":{"completed":true,"step":4},"version":0}'
}

down() {
  for p in "${PORTS[@]}"; do kill_port "$p"; done
  rm -rf "$DATA_DIR" "$WORKSPACE"
}

case "${1:-}" in
  up) up "${2:-}" ;;
  down) down ;;
  *) echo "usage: $0 up [<target>] | down" >&2; exit 64 ;;
esac
