# Test Worktree (Mainframe)

Config consumed by the `test-worktree` skill. Edit before running tests.

## App Type

`electron-desktop` — two-process app:
- **Daemon** (`@qlan-ro/mainframe-core`): Node.js, exposes HTTP + WebSocket on `DAEMON_PORT`
- **Renderer** (`@qlan-ro/mainframe-desktop`): Electron + React + Vite dev server on `VITE_PORT`

The mobile package is a git submodule with its own Expo runtime; not exercised by this skill.

## Port & data-dir isolation

This worktree runs on **non-default ports** so it never collides with the user's production Mainframe install:

- Production defaults: `DAEMON_PORT=31415`, `VITE_PORT=5173`, data dir `~/.mainframe`
- Worktree dev ports: random in `DAEMON_PORT=31416-32416`, `VITE_PORT=5174-6174`, data dir `~/.mainframe_dev`

Ports + data dir are written to `<worktree>/.env` by `scripts/setup-ports.sh`. Run it once per worktree (or whenever ports need to refresh):

```bash
./scripts/setup-ports.sh
```

The script also installs deps + builds types/core/desktop. Safe to re-run.

The runtime `pnpm dev` script auto-loads `.env` (via the daemon and Vite dotenv hooks).

## Protected Ports

**Never kill processes holding these:**

- `31415` — production daemon
- `5173` — production Vite dev server
- Anything outside the dev ranges above

The cleanup commands below filter on PID / command pattern, NOT a broad `pkill -f mainframe` (which would hit the user's main app).

## Required env (load before launch / cleanup / wait-for-ready)

```bash
# From the worktree root:
[ -f .env ] || ./scripts/setup-ports.sh
set -a; . ./.env; set +a
# Now $DAEMON_PORT, $VITE_PORT, $MAINFRAME_DATA_DIR are exported.
```

## Cleanup

Kill any stale dev processes from a prior run on THIS worktree's ports. Re-loads `.env` first to know which ports to target.

```bash
[ -f .env ] && set -a && . ./.env && set +a

# Kill anything listening on the dev ports — guarded by the protected-port check
for port in "$DAEMON_PORT" "$VITE_PORT"; do
  case "$port" in
    31415|5173) echo "REFUSING to kill production port $port"; continue ;;
  esac
  pids=$(lsof -ti:"$port" 2>/dev/null || true)
  [ -n "$pids" ] && echo "Killing PIDs on :$port: $pids" && kill $pids 2>/dev/null || true
done

# Belt-and-suspenders: kill dev processes by command pattern, but only ones
# rooted in THIS worktree path (so production install is unaffected)
WORKTREE_PATH=$(pwd)
pgrep -fl "$WORKTREE_PATH" 2>/dev/null | grep -E "(vite|tsx|electron|Mainframe Helper)" | awk '{print $1}' | xargs -r kill 2>/dev/null || true

sleep 1
```

## Launch

Sourcing `.env` first is critical — `pnpm dev` reads ports from env.

```bash
[ -f .env ] || ./scripts/setup-ports.sh
set -a; . ./.env; set +a
nohup pnpm dev > /tmp/mainframe-dev-${DAEMON_PORT}.log 2>&1 &
echo "PID: $!"
```

Each process launches **once**. If readiness checks below time out, read `/tmp/mainframe-dev-${DAEMON_PORT}.log` — do NOT re-launch.

## Wait for Ready

```bash
set -a; . ./.env; set +a

# 1. Daemon HTTP health
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${DAEMON_PORT}/api/health" >/dev/null 2>&1; then
    echo "daemon up on :$DAEMON_PORT"; break
  fi
  [ "$i" = "30" ] && { echo "daemon timeout"; tail -50 "/tmp/mainframe-dev-${DAEMON_PORT}.log"; exit 1; }
  sleep 1
done

# 2. Vite dev server
for i in $(seq 1 30); do
  if curl -sf "http://localhost:${VITE_PORT}/" >/dev/null 2>&1; then
    echo "vite up on :$VITE_PORT"; break
  fi
  [ "$i" = "30" ] && { echo "vite timeout"; tail -50 "/tmp/mainframe-dev-${DAEMON_PORT}.log"; exit 1; }
  sleep 1
done

# 3. Electron window — verified via electron-mcp (mcp__electron-mcp-server__get_electron_window_info)
#    or by checking for "Mainframe" in the macOS dock. Skip in headless contexts.
```

## Test Engines

| Mode | Engine | Notes |
|---|---|---|
| **UI (preferred)** | `electron-mcp` (MCP tools `mcp__electron-mcp-server__*`) | Already available in the session. Use `take_screenshot`, `send_command_to_electron`, `read_electron_logs`. |
| UI (fallback) | `playwright` with CDP attach | Electron exposes a debug port; playwright can attach via CDP. Tests written ad-hoc to `/tmp/`, not committed. |
| **API** | `curl` against `http://localhost:${DAEMON_PORT}` | Endpoints under `/api/*`. The daemon serves the same routes the renderer uses. |
| **DB** | `sqlite3 ${MAINFRAME_DATA_DIR}/mainframe.db` | Inspect chats/projects metadata. Plugin DBs at `${MAINFRAME_DATA_DIR}/plugins/*/data.db`. |

## Stop / Restart

When code changes mid-session:

```bash
# Stop both dev processes
[ -f .env ] && set -a && . ./.env && set +a
for port in "$DAEMON_PORT" "$VITE_PORT"; do
  case "$port" in 31415|5173) continue ;; esac
  lsof -ti:"$port" 2>/dev/null | xargs -r kill 2>/dev/null || true
done
sleep 1

# Re-launch (same as Launch section)
nohup pnpm dev > /tmp/mainframe-dev-${DAEMON_PORT}.log 2>&1 &
```

Never kill just one of (daemon, renderer) — leaves the other holding state.

## Project-Specific Gotchas

- **Daemon must start before renderer.** `pnpm dev` handles this with `sleep 2`. If you launch them separately, start core first.
- **Electron window may not appear if renderer typecheck fails.** Always tail the log if a launch seems silent.
- **Two production paths to protect:** ports `31415` / `5173` AND data dir `~/.mainframe`. Never touch these. Worktree uses `~/.mainframe_dev`.
- **Codex CLI must be installed and authenticated** to exercise Codex tool cards live (the manual-test items 12–16 in the latest test plan). Without Codex, those tests are skipped — Claude card tests still cover the unified design surface.
- **Mobile is a git submodule** (`packages/mobile`). It runs separately via Expo. This config does NOT launch it.
- **The current worktree branch `feat/tool-cards`** depends on the mobile submodule PR (`mainframe-mobile#7`). For testing, that submodule should be checked out at the branch HEAD (already done if `git submodule status` shows the SHA from the parent branch).
