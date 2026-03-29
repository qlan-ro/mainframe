# Launch Variable Expansion & Multi-Worktree Dev Scripts

## Problem

Running multiple worktrees of the same project through Mainframe causes port collisions. Every worktree reads the same `launch.json` with hardcoded ports. There is no override mechanism.

This affects both Mainframe's own development and any project launched through Mainframe.

## Solution

Two changes:

1. **Variable expansion in launch.json** — Mainframe's launch config loader resolves `${VAR:-default}` patterns from `process.env` before Zod validation. Any project can use environment-driven ports.
2. **Wrapper scripts for Mainframe dev** — Shell scripts that find free ports, write a port file, and exec the daemon/Vite. Solves the immediate multi-worktree problem for Mainframe itself.

---

## Part 1: Variable Expansion in launch.json

### Syntax

```
${VAR_NAME}              — resolve from process.env; hard error if unset
${VAR_NAME:-default}     — resolve from process.env; fall back to default
```

Pattern: `\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}`

A string may contain multiple expansions and surrounding text:

```
"http://localhost:${DAEMON_PORT:-31416}/api"
```

### Where it applies

All string values in the parsed JSON, recursively: `runtimeExecutable`, `runtimeArgs` entries, `env` values, `url`, `name`, and `port` (when written as a string).

### Expansion function

A single function `expandVariables(raw: unknown, env: Record<string, string | undefined>): unknown`:

1. Walks the parsed JSON recursively (objects, arrays, strings). Non-string primitives pass through unchanged.
2. Replaces all `${...}` patterns in each string.
3. Throws if a variable is unset and has no default: `"Unresolved variable 'DAEMON_PORT' in launch.json. Set it in your environment or provide a default: \${DAEMON_PORT:-31416}"`.
4. Handles tilde expansion (`~/` → `homedir()`), replacing the existing `expandEnvValues()` in `launch-manager.ts`.

### Integration point

In `parseLaunchConfig()` inside `launch-config.ts`, before Zod validation:

```
raw JSON → JSON.parse → expandVariables(parsed, process.env) → Zod validate
```

Zod sees fully resolved values. Downstream code is unchanged.

### Port field change

The raw JSON schema for `port` becomes `z.union([z.number(), z.string(), z.null()])`. After expansion, string values are coerced to numbers via `parseInt`. `NaN` results fail Zod validation.

This coercion runs in a Zod `.transform()` step after `expandVariables`.

### Tilde expansion consolidation

The existing `expandEnvValues()` function in `launch-manager.ts` handles only `~/` replacement on `env` values. This logic moves into `expandVariables()`, which handles both variable substitution and tilde expansion on all string fields. `expandEnvValues()` is removed; `LaunchManager.start()` no longer calls it.

### Error reporting

Errors name the missing variable and suggest the fix:

```
Unresolved variable 'DAEMON_PORT' in launch.json. Set it in your environment or provide a default: ${DAEMON_PORT:-31416}
```

### What doesn't change

- `LaunchManager.start()` — receives fully resolved configs.
- `cleanEnv()` — unchanged.
- `useLaunchConfig.ts` (renderer) — reads raw JSON for display. No expansion needed.
- Route handler flow — still re-reads from disk. `parseLaunchConfig` now expands before validating.

### Example launch.json with variables

```json
{
  "version": "0.1.0",
  "configurations": [
    {
      "name": "Core Daemon",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@qlan-ro/mainframe-core", "dev"],
      "port": "${DAEMON_PORT:-31416}",
      "env": {
        "DAEMON_PORT": "${DAEMON_PORT:-31416}",
        "MAINFRAME_DATA_DIR": "${MAINFRAME_DATA_DIR:-~/.mainframe_dev}"
      }
    },
    {
      "name": "Desktop App",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@qlan-ro/mainframe-desktop", "dev"],
      "port": "${VITE_PORT:-5174}",
      "env": {
        "VITE_PORT": "${VITE_PORT:-5174}",
        "VITE_DAEMON_HTTP_PORT": "${DAEMON_PORT:-31416}",
        "VITE_DAEMON_WS_PORT": "${DAEMON_PORT:-31416}"
      }
    }
  ]
}
```

---

## Part 2: Mainframe Dev Wrapper Scripts

Solve the immediate multi-worktree problem for Mainframe's own development. These scripts replace direct `pnpm dev` invocations in `.mainframe/launch.json`.

### `scripts/dev-daemon.sh`

1. Check if `DAEMON_PORT` is already set in the environment. If so, use it.
2. Otherwise, find a free port starting from 31416 (increment until one is available).
3. Write the chosen port to `.mainframe_dev/daemon.port` (relative to project root).
4. Export `DAEMON_PORT` and `MAINFRAME_DATA_DIR` (defaulting to `~/.mainframe_dev`).
5. Exec `pnpm --filter @qlan-ro/mainframe-core dev`.

### `scripts/dev-desktop.sh`

1. Wait for `.mainframe_dev/daemon.port` to appear (poll every 500ms, timeout after 30s).
2. Read the daemon port from the file.
3. Check if `VITE_PORT` is already set. If not, find a free port starting from 5174.
4. Export `VITE_PORT`, `VITE_DAEMON_HTTP_PORT`, and `VITE_DAEMON_WS_PORT`.
5. Exec `pnpm --filter @qlan-ro/mainframe-desktop dev`.

### Updated `.mainframe/launch.json`

```json
{
  "version": "0.1.0",
  "configurations": [
    {
      "name": "Core Daemon",
      "runtimeExecutable": "./scripts/dev-daemon.sh",
      "runtimeArgs": [],
      "port": null
    },
    {
      "name": "Desktop App",
      "runtimeExecutable": "./scripts/dev-desktop.sh",
      "runtimeArgs": [],
      "port": null,
      "preview": true
    }
  ]
}
```

`port` is `null` because the scripts handle port detection themselves. The launch system still polls the process for readiness via stdout output.

### Port file cleanup

`dev-daemon.sh` removes `.mainframe_dev/daemon.port` on exit via a `trap` handler.

### .gitignore

Add `.mainframe_dev/` to `.gitignore` (the port file is ephemeral).

---

## Files Changed

### Part 1 (variable expansion)

| File | Change |
|------|--------|
| `packages/core/src/launch/launch-config.ts` | Add `expandVariables()`, call it in `parseLaunchConfig()` before Zod. Update `port` schema to accept strings. |
| `packages/core/src/launch/launch-manager.ts` | Remove `expandEnvValues()` and its call in `start()`. |
| `packages/types/src/launch.ts` | No change — TypeScript types stay `number \| null` for `port` since expansion resolves strings to numbers before they reach typed code. |
| `packages/core/src/launch/__tests__/expand-variables.test.ts` | New test file for `expandVariables()`. |

### Part 2 (wrapper scripts)

| File | Change |
|------|--------|
| `scripts/dev-daemon.sh` | New file. |
| `scripts/dev-desktop.sh` | New file. |
| `.mainframe/launch.json` | Updated to use wrapper scripts. |
| `.gitignore` | Add `.mainframe_dev/`. |
