# Launch Variable Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Support `${VAR:-default}` variable expansion in launch.json so each worktree can use different ports via environment variables, and add wrapper scripts for Mainframe's own multi-worktree dev setup.

**Architecture:** A single `expandVariables()` function walks the raw parsed JSON and replaces all `${VAR}` / `${VAR:-default}` patterns from `process.env` before Zod validation. The `port` field accepts strings in raw JSON, coerced to numbers after expansion. Separately, two shell scripts handle free-port discovery for Mainframe's own dev workflow.

**Tech Stack:** TypeScript, Zod, Vitest, Bash

---

## File Structure

| File | Responsibility |
|------|---------------|
| `packages/core/src/launch/expand-variables.ts` | New. `expandVariables()` function — recursive JSON walker, env var + tilde expansion. |
| `packages/core/src/launch/__tests__/expand-variables.test.ts` | New. Tests for `expandVariables()`. |
| `packages/core/src/launch/launch-config.ts` | Modified. Call `expandVariables()` before Zod. Update `port` schema to accept strings, coerce to number. |
| `packages/core/src/launch/launch-manager.ts` | Modified. Remove `expandEnvValues()` and its usage in `start()`. |
| `scripts/dev-daemon.sh` | New. Finds free daemon port, writes port file, execs pnpm dev. |
| `scripts/dev-desktop.sh` | New. Waits for daemon port file, finds free Vite port, execs pnpm dev. |
| `.mainframe/launch.json` | Modified. Uses wrapper scripts instead of hardcoded ports. |
| `.gitignore` | Modified. Add `.mainframe_dev/`. |

---

## Task 1: `expandVariables()` function + tests

**Files:**
- Create: `packages/core/src/launch/expand-variables.ts`
- Create: `packages/core/src/launch/__tests__/expand-variables.test.ts`

- [ ] **Step 1: Write tests for expandVariables**

Create `packages/core/src/launch/__tests__/expand-variables.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { expandVariables } from '../expand-variables.js';

describe('expandVariables', () => {
  it('replaces ${VAR} from env', () => {
    const result = expandVariables({ port: '${PORT}' }, { PORT: '3000' });
    expect(result).toEqual({ port: '3000' });
  });

  it('replaces ${VAR:-default} with env value when set', () => {
    const result = expandVariables({ port: '${PORT:-8080}' }, { PORT: '3000' });
    expect(result).toEqual({ port: '3000' });
  });

  it('uses default when env var is unset', () => {
    const result = expandVariables({ port: '${PORT:-8080}' }, {});
    expect(result).toEqual({ port: '8080' });
  });

  it('throws on unresolved variable without default', () => {
    expect(() => expandVariables({ port: '${PORT}' }, {})).toThrow(
      "Unresolved variable 'PORT' in launch.json",
    );
  });

  it('handles multiple expansions in one string', () => {
    const result = expandVariables(
      { url: 'http://${HOST:-localhost}:${PORT:-3000}/api' },
      {},
    );
    expect(result).toEqual({ url: 'http://localhost:3000/api' });
  });

  it('expands variables in arrays', () => {
    const result = expandVariables(
      { args: ['--port', '${PORT:-3000}'] },
      {},
    );
    expect(result).toEqual({ args: ['--port', '3000'] });
  });

  it('recurses into nested objects', () => {
    const result = expandVariables(
      { env: { DAEMON_PORT: '${PORT:-31416}' } },
      {},
    );
    expect(result).toEqual({ env: { DAEMON_PORT: '31416' } });
  });

  it('passes through numbers, booleans, and null unchanged', () => {
    const result = expandVariables(
      { port: 3000, preview: true, url: null },
      {},
    );
    expect(result).toEqual({ port: 3000, preview: true, url: null });
  });

  it('expands tilde in values', () => {
    const result = expandVariables({ dir: '~/data' }, {});
    expect((result as { dir: string }).dir).toMatch(/^\/.*\/data$/);
  });

  it('expands tilde combined with variable expansion', () => {
    const result = expandVariables(
      { dir: '~/${SUBDIR:-mainframe}' },
      {},
    );
    expect((result as { dir: string }).dir).toMatch(/^\/.*\/mainframe$/);
  });

  it('handles empty default', () => {
    const result = expandVariables({ val: '${EMPTY:-}' }, {});
    expect(result).toEqual({ val: '' });
  });

  it('leaves strings without patterns unchanged', () => {
    const result = expandVariables({ name: 'Core Daemon' }, {});
    expect(result).toEqual({ name: 'Core Daemon' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run packages/core/src/launch/__tests__/expand-variables.test.ts`
Expected: FAIL — module `../expand-variables.js` not found.

- [ ] **Step 3: Implement expandVariables**

Create `packages/core/src/launch/expand-variables.ts`:

```typescript
import { homedir } from 'node:os';

const VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-(.*?))?\}/g;

function expandString(value: string, env: Record<string, string | undefined>): string {
  const expanded = value.replace(VAR_PATTERN, (_match, name: string, defaultValue: string | undefined) => {
    const envValue = env[name];
    if (envValue != null) return envValue;
    if (defaultValue != null) return defaultValue;
    throw new Error(
      `Unresolved variable '${name}' in launch.json. Set it in your environment or provide a default: \${${name}:-<value>}`,
    );
  });

  // Tilde expansion: ~/path or standalone ~
  const home = homedir();
  if (expanded === '~') return home;
  if (expanded.startsWith('~/')) return home + expanded.slice(1);
  return expanded;
}

export function expandVariables(raw: unknown, env: Record<string, string | undefined>): unknown {
  if (typeof raw === 'string') return expandString(raw, env);
  if (raw === null || raw === undefined) return raw;
  if (typeof raw !== 'object') return raw;
  if (Array.isArray(raw)) return raw.map((item) => expandVariables(item, env));
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    result[key] = expandVariables(value, env);
  }
  return result;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run packages/core/src/launch/__tests__/expand-variables.test.ts`
Expected: All 12 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/launch/expand-variables.ts packages/core/src/launch/__tests__/expand-variables.test.ts
git commit -m "feat(launch): add expandVariables for launch.json variable expansion"
```

---

## Task 2: Integrate into parseLaunchConfig + update port schema

**Files:**
- Modify: `packages/core/src/launch/launch-config.ts`
- Create: `packages/core/src/launch/__tests__/launch-config.test.ts`

- [ ] **Step 1: Write tests for parseLaunchConfig with variable expansion**

Create `packages/core/src/launch/__tests__/launch-config.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseLaunchConfig } from '../launch-config.js';

describe('parseLaunchConfig with variable expansion', () => {
  it('expands variables in env values', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: ['index.js'],
            port: null,
            env: { PORT: '${TEST_PORT:-9999}' },
          },
        ],
      },
      {},
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configurations[0]!.env).toEqual({ PORT: '9999' });
    }
  });

  it('coerces string port to number after expansion', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: [],
            port: '${PORT:-3000}',
          },
        ],
      },
      {},
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configurations[0]!.port).toBe(3000);
    }
  });

  it('fails on non-numeric port after expansion', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: [],
            port: '${PORT:-abc}',
          },
        ],
      },
      {},
    );
    expect(result.success).toBe(false);
  });

  it('resolves env vars from provided env', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: [],
            port: '${MY_PORT}',
          },
        ],
      },
      { MY_PORT: '4000' },
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configurations[0]!.port).toBe(4000);
    }
  });

  it('returns error for unresolved variable', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: [],
            port: '${UNSET_VAR}',
          },
        ],
      },
      {},
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Unresolved variable 'UNSET_VAR'");
    }
  });

  it('still accepts numeric port (backward compat)', () => {
    const result = parseLaunchConfig(
      {
        version: '1',
        configurations: [
          {
            name: 'test',
            runtimeExecutable: 'node',
            runtimeArgs: [],
            port: 8080,
          },
        ],
      },
      {},
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.configurations[0]!.port).toBe(8080);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run packages/core/src/launch/__tests__/launch-config.test.ts`
Expected: FAIL — `parseLaunchConfig` does not accept a second argument, string port fails Zod validation.

- [ ] **Step 3: Update parseLaunchConfig to expand variables and accept string ports**

Modify `packages/core/src/launch/launch-config.ts`:

```typescript
import { z } from 'zod';
import type { LaunchConfig, LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { expandVariables } from './expand-variables.js';

// Allowed executables: common package managers + node. No shell operators.
const SAFE_EXECUTABLE = /^(node|pnpm|npm|yarn|bun|python|python3|[a-zA-Z0-9_\-./]+)$/;

const LaunchConfigurationSchema = z.object({
  name: z.string().min(1),
  runtimeExecutable: z
    .string()
    .min(1)
    .refine((v) => SAFE_EXECUTABLE.test(v) && !v.includes(';') && !v.includes('|') && !v.includes('&'), {
      message: 'runtimeExecutable must be a safe executable name (no shell operators)',
    }),
  runtimeArgs: z.array(z.string()).optional().default([]),
  port: z
    .union([z.number(), z.string(), z.null()])
    .optional()
    .default(null)
    .transform((v) => {
      if (v === null || typeof v === 'number') return v;
      const parsed = parseInt(v, 10);
      if (Number.isNaN(parsed) || parsed <= 0) return undefined;
      return parsed;
    })
    .refine((v) => v !== undefined, { message: 'port must be a positive integer or null' })
    .transform((v) => v as number | null),
  url: z.string().url().nullable().optional().default(null),
  preview: z.boolean().optional(),
  env: z
    .record(
      z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'env key must be letters, digits, or underscores'),
      z.coerce.string(),
    )
    .optional(),
});

const LaunchConfigSchema = z
  .object({
    version: z.string(),
    configurations: z.array(LaunchConfigurationSchema).min(1, 'At least one configuration is required'),
  })
  .refine((v) => v.configurations.filter((c) => c.preview).length <= 1, {
    message: 'At most one configuration may have preview: true',
  });

export function parseLaunchConfig(
  data: unknown,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): { success: true; data: LaunchConfig } | { success: false; error: string } {
  let expanded: unknown;
  try {
    expanded = expandVariables(data, env);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }

  const result = LaunchConfigSchema.safeParse(expanded);
  if (!result.success) {
    return { success: false, error: result.error.issues.map((i) => i.message).join(', ') };
  }
  return { success: true, data: result.data as LaunchConfig };
}

export function getPreviewUrl(configurations: LaunchConfiguration[]): string | null {
  const preview = configurations.find((c) => c.preview);
  if (!preview) return null;
  if (preview.url) return preview.url;
  if (preview.port) return `http://localhost:${preview.port}`;
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run packages/core/src/launch/__tests__/launch-config.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Run expandVariables tests to make sure nothing regressed**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run packages/core/src/launch/__tests__/expand-variables.test.ts`
Expected: All 12 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/launch/launch-config.ts packages/core/src/launch/__tests__/launch-config.test.ts
git commit -m "feat(launch): integrate variable expansion into parseLaunchConfig"
```

---

## Task 3: Remove expandEnvValues from LaunchManager

**Files:**
- Modify: `packages/core/src/launch/launch-manager.ts`

- [ ] **Step 1: Remove expandEnvValues and its usage**

In `packages/core/src/launch/launch-manager.ts`:

Delete the `expandEnvValues` function (lines 14–21) and its import of `homedir` from `node:os`.

Change the env construction in `start()` from:

```typescript
env: {
  ...cleanEnv(),
  ...(config.port != null ? { PORT: String(config.port) } : {}),
  ...(config.env ? expandEnvValues(config.env) : {}),
},
```

to:

```typescript
env: {
  ...cleanEnv(),
  ...(config.port != null ? { PORT: String(config.port) } : {}),
  ...(config.env ?? {}),
},
```

- [ ] **Step 2: Run all launch-related tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run packages/core/src/launch/__tests__/`
Expected: All tests PASS.

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: Clean build, no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/launch/launch-manager.ts
git commit -m "refactor(launch): remove expandEnvValues, tilde expansion now handled by expandVariables"
```

---

## Task 4: Wrapper scripts for Mainframe dev

**Files:**
- Create: `scripts/dev-daemon.sh`
- Create: `scripts/dev-desktop.sh`
- Modify: `.mainframe/launch.json`
- Modify: `.gitignore`

- [ ] **Step 1: Create dev-daemon.sh**

Create `scripts/dev-daemon.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_DIR="$PROJECT_ROOT/.mainframe_dev"
PORT_FILE="$PORT_DIR/daemon.port"

mkdir -p "$PORT_DIR"

# Clean up port file on exit
cleanup() { rm -f "$PORT_FILE"; }
trap cleanup EXIT

# Use DAEMON_PORT if set, otherwise find a free port starting from 31416
if [ -z "${DAEMON_PORT:-}" ]; then
  port=31416
  while lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; do
    port=$((port + 1))
    if [ "$port" -gt 32416 ]; then
      echo "ERROR: No free port found in range 31416-32416" >&2
      exit 1
    fi
  done
  DAEMON_PORT="$port"
fi

echo "$DAEMON_PORT" > "$PORT_FILE"

export DAEMON_PORT
export MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"

echo "Starting daemon on port $DAEMON_PORT (data: $MAINFRAME_DATA_DIR)"
exec pnpm --filter @qlan-ro/mainframe-core run dev
```

- [ ] **Step 2: Create dev-desktop.sh**

Create `scripts/dev-desktop.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT_FILE="$PROJECT_ROOT/.mainframe_dev/daemon.port"

# Wait for daemon port file (max 30s)
elapsed=0
while [ ! -f "$PORT_FILE" ]; do
  if [ "$elapsed" -ge 30 ]; then
    echo "ERROR: Timed out waiting for daemon port file at $PORT_FILE" >&2
    exit 1
  fi
  sleep 0.5
  elapsed=$((elapsed + 1))
done

DAEMON_PORT="$(cat "$PORT_FILE")"

# Use VITE_PORT if set, otherwise find a free port starting from 5174
if [ -z "${VITE_PORT:-}" ]; then
  port=5174
  while lsof -iTCP:"$port" -sTCP:LISTEN -t >/dev/null 2>&1; do
    port=$((port + 1))
    if [ "$port" -gt 6174 ]; then
      echo "ERROR: No free port found in range 5174-6174" >&2
      exit 1
    fi
  done
  VITE_PORT="$port"
fi

export VITE_PORT
export VITE_DAEMON_HTTP_PORT="$DAEMON_PORT"
export VITE_DAEMON_WS_PORT="$DAEMON_PORT"
export MAINFRAME_DATA_DIR="${MAINFRAME_DATA_DIR:-$HOME/.mainframe_dev}"

echo "Starting desktop on port $VITE_PORT (daemon: $DAEMON_PORT)"
exec pnpm --filter @qlan-ro/mainframe-desktop run dev:web
```

- [ ] **Step 3: Make scripts executable**

Run: `chmod +x scripts/dev-daemon.sh scripts/dev-desktop.sh`

- [ ] **Step 4: Update .mainframe/launch.json**

Replace `.mainframe/launch.json` with:

```json
{
  "version": "1",
  "configurations": [
    {
      "name": "Core Daemon",
      "runtimeExecutable": "./scripts/dev-daemon.sh",
      "runtimeArgs": [],
      "port": null,
      "url": null
    },
    {
      "name": "Desktop App",
      "runtimeExecutable": "./scripts/dev-desktop.sh",
      "runtimeArgs": [],
      "port": null,
      "url": null,
      "preview": true
    }
  ]
}
```

- [ ] **Step 5: Add .mainframe_dev/ to .gitignore**

Add `.mainframe_dev/` to `.gitignore` after the `.mainframe/` entry.

- [ ] **Step 6: Commit**

```bash
git add scripts/dev-daemon.sh scripts/dev-desktop.sh .mainframe/launch.json .gitignore
git commit -m "feat(dev): add wrapper scripts for multi-worktree port discovery"
```

---

## Task 5: Final verification + changeset

- [ ] **Step 1: Run all core tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test`
Expected: All tests PASS.

- [ ] **Step 2: Build all packages**

Run: `pnpm build`
Expected: Clean build across all packages.

- [ ] **Step 3: Create changeset**

Run: `pnpm changeset`

Pick `@qlan-ro/mainframe-core` with bump type `minor`. Summary:

```
Support ${VAR:-default} variable expansion in launch.json for environment-driven port configuration
```

- [ ] **Step 4: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for launch variable expansion"
```
