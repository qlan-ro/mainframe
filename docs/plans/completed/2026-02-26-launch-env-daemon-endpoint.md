# Launch env vars + configurable daemon endpoint

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let `launch.json` configurations declare env vars for spawned processes, and let the Desktop App renderer read daemon host/port from `VITE_*` env vars instead of hardcoded constants.

**Architecture:** Three changes in sequence — extend the shared type, thread it through the core launch stack (Zod + spawn), then update the two renderer constants and the live `launch.json`. No new abstractions needed.

**Tech Stack:** TypeScript strict + NodeNext, Zod, Vite `import.meta.env`, pnpm workspaces

---

### Task 1: Add `env` field to `LaunchConfiguration` type

**Files:**
- Modify: `packages/types/src/launch.ts`

**Step 1: Write the failing test**

In `packages/core/src/__tests__/launch-config.test.ts`, add inside `describe('parseLaunchConfig')`:

```ts
it('accepts a config with env vars', () => {
  const result = parseLaunchConfig({
    ...VALID_CONFIG,
    configurations: [
      { ...VALID_CONFIG.configurations[0]!, env: { NODE_ENV: 'test', PORT: '4001' } },
    ],
  });
  expect(result.success).toBe(true);
});

it('rejects env with non-uppercase key', () => {
  const result = parseLaunchConfig({
    ...VALID_CONFIG,
    configurations: [
      { ...VALID_CONFIG.configurations[0]!, env: { 'bad-key': 'value' } },
    ],
  });
  expect(result.success).toBe(false);
});
```

**Step 2: Run to verify failure**

```bash
pnpm --filter @mainframe/core test -- --reporter=verbose src/__tests__/launch-config.test.ts
```
Expected: both new tests FAIL (env field unknown to Zod / type error).

**Step 3: Add `env` to the type**

In `packages/types/src/launch.ts`:

```ts
export interface LaunchConfiguration {
  name: string;
  runtimeExecutable: string;
  runtimeArgs: string[];
  port: number | null;
  url: string | null;
  preview?: boolean;
  env?: Record<string, string>;   // NEW
}
```

**Step 4: Run to verify still failing (Zod not updated yet)**

Same command — `accepts env vars` test should fail at the Zod parse step.

**Step 5: Commit type**

```bash
git add packages/types/src/launch.ts
git commit -m "feat(types): add env field to LaunchConfiguration"
```

---

### Task 2: Validate `env` in the Zod schema

**Files:**
- Modify: `packages/core/src/launch/launch-config.ts`

**Step 1: Add env to `LaunchConfigurationSchema`**

After the `preview` line, add:

```ts
env: z
  .record(
    z.string().regex(/^[A-Z_][A-Z0-9_]*$/, 'env key must be uppercase letters, digits, or underscores'),
    z.string(),
  )
  .optional(),
```

**Step 2: Run tests**

```bash
pnpm --filter @mainframe/core test -- --reporter=verbose src/__tests__/launch-config.test.ts
```
Expected: all tests pass.

**Step 3: Commit**

```bash
git add packages/core/src/launch/launch-config.ts
git commit -m "feat(core): validate env field in launch config Zod schema"
```

---

### Task 3: Pass `env` to spawned process in `LaunchManager`

**Files:**
- Modify: `packages/core/src/launch/launch-manager.ts`
- Test: `packages/core/src/__tests__/launch-manager.test.ts`

**Step 1: Write the failing test**

Add to `describe('LaunchManager')` in `launch-manager.test.ts`:

```ts
it('passes env vars to the spawned process', async () => {
  const config = {
    name: 'env-test',
    runtimeExecutable: 'node',
    runtimeArgs: ['-e', 'process.stdout.write(process.env.MY_VAR ?? "missing");process.exit(0);'],
    port: null,
    url: null,
    preview: false,
    env: { MY_VAR: 'hello-from-env' },
  };
  await manager.start(config);
  await new Promise((r) => setTimeout(r, 200));
  const outputEvents = events.filter((e) => e.type === 'launch.output') as Array<{
    type: 'launch.output';
    data: string;
    stream: string;
  }>;
  expect(outputEvents.some((e) => e.data.includes('hello-from-env'))).toBe(true);
});
```

**Step 2: Run to verify failure**

```bash
pnpm --filter @mainframe/core test -- --reporter=verbose src/__tests__/launch-manager.test.ts
```
Expected: new test FAIL — output contains "missing", not "hello-from-env".

**Step 3: Implement — merge env and expand `~`**

Add homedir import at top of `launch-manager.ts`:

```ts
import { homedir } from 'node:os';
```

Add a helper just above the `LaunchManager` class:

```ts
function expandEnvValues(env: Record<string, string>): Record<string, string> {
  const home = homedir();
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    result[k] = v.startsWith('~/') || v === '~' ? home + v.slice(1) : v;
  }
  return result;
}
```

In `start()`, update the spawn env block:

```ts
env: {
  ...process.env,
  ...(config.port != null ? { PORT: String(config.port) } : {}),
  ...(config.env ? expandEnvValues(config.env) : {}),
},
```

**Step 4: Run tests**

```bash
pnpm --filter @mainframe/core test -- --reporter=verbose src/__tests__/launch-manager.test.ts
```
Expected: all pass.

**Step 5: Commit**

```bash
git add packages/core/src/launch/launch-manager.ts packages/core/src/__tests__/launch-manager.test.ts
git commit -m "feat(core): pass env vars from launch config to spawned process"
```

---

### Task 4: Make daemon HTTP base configurable in renderer

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/http.ts`

`import.meta.env` is typed as `ImportMetaEnv`. For unknown `VITE_*` vars you access them via bracket notation on the `ImportMeta['env']` object:

**Step 1: Replace the hardcoded constant**

```ts
const host: string = (import.meta.env as Record<string, string>)['VITE_DAEMON_HOST'] ?? '127.0.0.1';
const port: string = (import.meta.env as Record<string, string>)['VITE_DAEMON_HTTP_PORT'] ?? '31415';
const API_BASE = `http://${host}:${port}`;
```

No test needed — this is a pure config change with no runtime logic to verify beyond the unit using it. Manual verification in Task 6.

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop exec tsc --noEmit 2>&1 | grep -v TS6305
```
Expected: no new errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/lib/api/http.ts
git commit -m "feat(desktop): read daemon HTTP host/port from VITE_* env vars"
```

---

### Task 5: Make daemon WS URL configurable in renderer

**Files:**
- Modify: `packages/desktop/src/renderer/lib/client.ts`

**Step 1: Replace the hardcoded constant**

Change lines 4–5 from:

```ts
const WS_URL = 'ws://127.0.0.1:31415';
```

to:

```ts
const host: string = (import.meta.env as Record<string, string>)['VITE_DAEMON_HOST'] ?? '127.0.0.1';
const wsPort: string = (import.meta.env as Record<string, string>)['VITE_DAEMON_WS_PORT'] ?? '31415';
const WS_URL = `ws://${host}:${wsPort}`;
```

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop exec tsc --noEmit 2>&1 | grep -v TS6305
```
Expected: no new errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/lib/client.ts
git commit -m "feat(desktop): read daemon WS host/port from VITE_* env vars"
```

---

### Task 6: Update `launch.json` for sandbox isolation

**Files:**
- Modify: `.mainframe/launch.json`

**Step 1: Add env to Core Daemon and Desktop App configs**

```json
{
  "version": "1",
  "configurations": [
    {
      "name": "Core Daemon",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@mainframe/core", "run", "dev"],
      "port": 31416,
      "url": null,
      "env": {
        "MAINFRAME_DATA_DIR": "~/.mainframe-sandbox"
      }
    },
    {
      "name": "Desktop App",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@mainframe/desktop", "run", "dev:web"],
      "port": 5174,
      "url": null,
      "preview": true,
      "env": {
        "VITE_DAEMON_HTTP_PORT": "31416",
        "VITE_DAEMON_WS_PORT": "31416"
      }
    },
    {
      "name": "Types Watch",
      "runtimeExecutable": "pnpm",
      "runtimeArgs": ["--filter", "@mainframe/types", "run", "dev"],
      "port": null,
      "url": null
    }
  ]
}
```

Note: `PORT` is not duplicated in Core Daemon's env — `LaunchManager` already injects it from `config.port` (31416).

**Step 2: Verify launch.json parses (smoke test)**

```bash
node -e "const c = require('./.mainframe/launch.json'); console.log('configs:', c.configurations.length)"
```
Expected: `configs: 3`

**Step 3: Commit**

```bash
git add .mainframe/launch.json
git commit -m "feat: configure sandbox isolation via launch.json env vars"
```

---

### Task 7: Run full test suites

```bash
pnpm --filter @mainframe/core test
pnpm --filter @mainframe/desktop test
```

Expected: all tests pass, no regressions.
