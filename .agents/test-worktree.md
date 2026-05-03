# Test Worktree Config: Mainframe

Project-specific configuration for the `test-worktree` skill. See `~/.agents/skills/test-worktree/SKILL.md` for the general workflow.

## App Type

`electron-desktop`

The app is an Electron shell hosting a Vite-built renderer, backed by a local Node daemon.

## Protected Ports

Ports the skill MUST NEVER kill, even when cleaning up stale dev processes.

- `31415` — production daemon (installed app at `/Applications/`)

Verify any candidate PID does not hold `31415` before sending SIGKILL.

## Environment

Read ports and data dir from `.env` at the worktree root:

```bash
source .env
export MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"
```

| Variable | Used by | Source | Default |
|---|---|---|---|
| `DAEMON_PORT` | Core daemon | `.env` | 31415 |
| `VITE_PORT` | Vite dev server | `.env` | 5173 |
| `MAINFRAME_DATA_DIR` | Core + Desktop | `.env` | `~/.mainframe_dev` |
| `VITE_DAEMON_HTTP_PORT` | Desktop renderer HTTP | Pass explicitly | `$DAEMON_PORT` |
| `VITE_DAEMON_WS_PORT` | Desktop renderer WS | Pass explicitly | `$DAEMON_PORT` |
| `LOG_LEVEL` | Core daemon | Optional | info |

## Cleanup (Kill Stale Dev Processes)

Previous sessions leave orphaned pnpm wrappers, daemons, Vite servers, and Electron instances across worktrees. Kill them — but respect the Protected Ports above.

```bash
# 1. Kill all mainframe-core dev wrappers (skip anything on port 31415)
pids=$(ps ax -o pid,command | grep 'mainframe-core run dev' | grep -v grep | awk '{print $1}')
for pid in $pids; do
  if ! lsof -iTCP:31415 -sTCP:LISTEN -a -p $pid 2>/dev/null | grep -q LISTEN; then
    pkill -9 -P $pid 2>/dev/null
    kill -9 $pid 2>/dev/null
  fi
done

# 2. Kill mainframe-desktop dev wrappers (Vite + Electron dev instances)
pids=$(ps ax -o pid,command | grep 'mainframe-desktop run dev' | grep -v grep | awk '{print $1}')
for pid in $pids; do
  pkill -9 -P $pid 2>/dev/null
  kill -9 $pid 2>/dev/null
done

# 3. Kill CDP port 9222 (dev Electron)
lsof -ti :9222 2>/dev/null | xargs kill -9 2>/dev/null

sleep 2

# 4. Retry if anything survived
remaining=$(ps ax -o pid,command | grep 'mainframe-\(core\|desktop\) run dev' | grep -v grep | awk '{print $1}')
if [ -n "$remaining" ]; then
  echo "WARNING: processes still alive after kill: $remaining — retrying"
  echo "$remaining" | xargs kill -9 2>/dev/null
  sleep 2
fi

if lsof -ti :9222 2>/dev/null; then
  echo "WARNING: port 9222 still held — force killing"
  lsof -ti :9222 | xargs kill -9 2>/dev/null
  sleep 1
fi

# Final check — fail loudly if still occupied
if ps ax -o pid,command | grep 'mainframe-\(core\|desktop\) run dev' | grep -v grep | grep -q .; then
  echo "ERROR: could not kill all dev processes — manual intervention needed"
fi
```

**Never use `pkill -f "mainframe"` unfiltered** — it can hit the production app. The commands above specifically target `run dev` processes and skip anything on port 31415.

## Launch

Launch each process EXACTLY ONCE. On readiness-poll timeout, read the log file — do not re-launch.

### Daemon

```bash
DAEMON_PORT=$DAEMON_PORT MAINFRAME_DATA_DIR=$MAINFRAME_DATA_DIR LOG_LEVEL=debug \
  pnpm --filter @qlan-ro/mainframe-core run dev > /tmp/mf-daemon-$DAEMON_PORT.log 2>&1 &
```

### Desktop App

```bash
VITE_DAEMON_HTTP_PORT=$DAEMON_PORT \
VITE_DAEMON_WS_PORT=$DAEMON_PORT \
VITE_PORT=$VITE_PORT \
MAINFRAME_DATA_DIR=$MAINFRAME_DATA_DIR \
  pnpm --filter @qlan-ro/mainframe-desktop run dev > /tmp/mf-desktop-$DAEMON_PORT.log 2>&1 &
```

## Wait for Ready

```bash
# Daemon
for i in $(seq 1 20); do
  curl -s http://127.0.0.1:$DAEMON_PORT/api/projects > /dev/null 2>&1 && break
  sleep 0.5
done

# Electron CDP
for i in $(seq 1 30); do
  curl -s http://localhost:9222/json/version > /dev/null 2>&1 && break
  sleep 0.5
done
curl -s http://localhost:9222/json/version
```

Daemon ready when `/api/projects` responds. App ready when `/json/version` returns JSON containing `webSocketDebuggerUrl`.

## Test Engines

CDP endpoint: `http://localhost:9222`

| Engine | Best for |
|---|---|
| `playwright-cli` (default) | Interactive step-by-step verification |
| `playwright-test` | Repeatable test suites |
| `electron-mcp` | Quick one-off checks via MCP |

### playwright-test config

- Ad-hoc test path: `packages/e2e/tests/99-adhoc-<branch>.spec.ts`
- Run command: `cd packages/e2e && npx playwright test tests/99-adhoc-*.spec.ts --workers=1 --reporter=list`
- Throwaway — delete the file after reporting results, never commit.

## Stop / Restart

Kill by port. **Never kill just Electron** — that leaves the daemon and Vite dangling.

```bash
source .env
lsof -ti :$DAEMON_PORT :$VITE_PORT :9222 2>/dev/null | xargs kill -9 2>/dev/null

sleep 2
for port in $DAEMON_PORT $VITE_PORT 9222; do
  if lsof -ti :$port 2>/dev/null; then
    echo "Port $port still held — retrying kill"
    lsof -ti :$port | xargs kill -9 2>/dev/null
  fi
done
sleep 1
```

Then re-run the **Launch** section.

## Project-Specific Gotchas

### Tooltip verification (Radix)

Radix tooltips portal to `<body>`. Checking `[role="tooltip"]` after hover can match tooltips from adjacent elements or stale tooltips that haven't dismissed. Always verify tooltip **content**, not just existence.

Past incident: `overflow: hidden` inside `@container` clipped a tooltip, but the Playwright test passed because it matched a tooltip from an adjacent element.

### `data-active` across zones

`button[data-active="true"]` exists in multiple zones (sidebar, tab bars, panels). Scope to the relevant container or filter by text:

```typescript
// Scope to a specific zone
const rightPanel = page.locator('[data-zone="right-top"]');
const tab = rightPanel.locator('button[data-active="false"]').first();

// Or narrow by visible text
const filesTab = page.locator('button[data-active="true"]', { hasText: /Files/ });
```

### Single-tab zones don't render tab bars

If a zone has only one tab, the tab bar isn't rendered at all. Don't assert tab presence to prove a tab is active — use a screenshot.

### Electron MCP WebSocket caching

After killing and relaunching the app, the `electron-mcp-server` caches the old CDP websocket URL. `take_screenshot` and other tools time out with:

```
browserType.connectOverCDP: Timeout 30000ms exceeded
```

Verify the new app is up via `curl http://localhost:9222/json/version`. The MCP server usually picks up the new URL on the next tool call; if not, restart it.

### `querySelectorAll` in Electron MCP `eval`

`eval` silently returns `false` for `querySelectorAll`. Use `getElementsByClassName` or `get_page_structure` instead. See `~/.agents/skills/test-worktree/engine-electron-mcp.md` for the full eval-gotchas list.
