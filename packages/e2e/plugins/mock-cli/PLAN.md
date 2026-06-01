# E2E Mock CLI Plugin — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record real Claude CLI sessions once and replay them deterministically in CI, so AI-coupled E2E specs run with no Claude API calls — proven end-to-end on the `06-permissions` interactive flow.

**Architecture:** A generic `Proxy`-based `RecordingSink` (in core) tees every `SessionSink` call to an NDJSON fixture when `E2E_MODE=record`. An external `mock-cli` plugin (loaded from the isolated test data dir) registers a `MockCliAdapter` whose `ReplaySession` drains those fixtures back through the sink when `E2E_MODE=mock`. Fixtures are keyed by a stable `E2E_RECORDING_KEY` + per-key session index (project paths are random temp dirs, so they can't be the key).

**Tech Stack:** TypeScript (strict, NodeNext in core), Vitest (core unit tests), esbuild (bundles the plugin to a single CJS `index.js`), Playwright (the integration proof).

**Branch:** `feat/e2e-mock-cli-plugin` (already created, off the e2e-fixtures work).

**Env contract** (read inside the daemon process):
- `E2E_MODE`: `record` | `mock` | unset.
- `E2E_RECORDINGS_DIR`: absolute path to fixtures (`packages/e2e/fixtures/recordings`). Required when `E2E_MODE` set.
- `E2E_RECORDING_KEY`: stable per-describe key for fixture filenames. Defaults to `session` if unset.

---

## File Structure

**New (core — canonical, unit-tested):**
- `packages/core/src/testing/recording-format.ts` — `RecordedEvent` type, `safeArgs`, `sanitizeKey`, `fixtureFileName`, `parseFixture`.
- `packages/core/src/testing/recording-sink.ts` — `createRecordingSink(real, deps)` generic Proxy sink.
- `packages/core/src/testing/replay-core.ts` — pure split logic (`createReplayState`, `consumeInput`, `drainOutputs`, `isExhausted`).
- `packages/core/src/testing/record-wrapper.ts` — `wrapClaudeForRecording(adapters)` daemon hook.
- `packages/core/src/__tests__/testing/recording-format.test.ts`, `recording-sink.test.ts`, `replay-core.test.ts`.

**New (plugin — self-contained bundle):**
- `packages/e2e/plugins/mock-cli/manifest.json`
- `packages/e2e/plugins/mock-cli/package.json`
- `packages/e2e/plugins/mock-cli/tsconfig.json`
- `packages/e2e/plugins/mock-cli/src/index.ts` — `activate(ctx)`.
- `packages/e2e/plugins/mock-cli/src/adapter.ts` — `MockCliAdapter`.
- `packages/e2e/plugins/mock-cli/src/session.ts` — `ReplaySession`.
- `packages/e2e/plugins/mock-cli/src/fixture.ts` — standalone mirror of replay-core (keeps the bundle free of workspace-internal imports; reference impl for 3rd-party plugins).
- `packages/e2e/fixtures/recordings/permissions-interactive.0.ndjson` — committed fixture (recorded).

**Modified:**
- `packages/core/src/index.ts` — plugins dir → `getDataDir()`; add `E2E_MODE==='record'` block.
- `packages/e2e/fixtures/app.ts` — build+symlink plugin and pass E2E env in mock/record mode; `launchApp({recordingKey})`.
- `packages/e2e/fixtures/chat.ts` — adapter id defaults to `mock-cli` when `E2E_MODE==='mock'`.
- `packages/e2e/tests/06-permissions.spec.ts` — Interactive `beforeAll` passes `recordingKey`.
- `packages/e2e/package.json` — `build:mock`, `test:record`, `test:mock` scripts.
- `.gitignore` — ignore the built `packages/e2e/plugins/mock-cli/index.js`.
- `.changeset/*.md` — core patch (plugin discovery now honors `MAINFRAME_DATA_DIR`).

---

## Task 1: Fixture format module (core)

**Files:**
- Create: `packages/core/src/testing/recording-format.ts`
- Test: `packages/core/src/__tests__/testing/recording-format.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/__tests__/testing/recording-format.test.ts
import { describe, it, expect } from 'vitest';
import { safeArgs, sanitizeKey, fixtureFileName, parseFixture, type RecordedEvent } from '../../testing/recording-format.js';

describe('recording-format', () => {
  it('safeArgs reduces an Error to {name,message}', () => {
    expect(safeArgs([new Error('boom')])).toEqual([{ name: 'Error', message: 'boom' }]);
  });
  it('safeArgs round-trips plain JSON values', () => {
    expect(safeArgs(['s', { a: 1 }, [2, 3]])).toEqual(['s', { a: 1 }, [2, 3]]);
  });
  it('safeArgs falls back to String() on non-serializable values', () => {
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(typeof safeArgs([circular])[0]).toBe('string');
  });
  it('sanitizeKey makes a filename-safe segment', () => {
    expect(sanitizeKey('permissions / Interactive!!')).toBe('permissions-Interactive');
  });
  it('fixtureFileName combines key + index', () => {
    expect(fixtureFileName('permissions-interactive', 0)).toBe('permissions-interactive.0.ndjson');
  });
  it('parseFixture parses NDJSON, ignoring blank lines', () => {
    const text =
      '{"dir":"in","method":"sendMessage","args":["hi"],"delayMs":0}\n\n{"dir":"out","method":"onExit","args":[0],"delayMs":5}\n';
    const events: RecordedEvent[] = parseFixture(text);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ dir: 'in', method: 'sendMessage', args: ['hi'], delayMs: 0 });
    expect(events[1]?.dir).toBe('out');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/testing/recording-format.test.ts`
Expected: FAIL — `Cannot find module '../../testing/recording-format.js'`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/testing/recording-format.ts
export interface RecordedEvent {
  /** 'in' = daemon called the session (sendMessage/respondToPermission/interrupt); 'out' = session called the sink. */
  dir: 'in' | 'out';
  method: string;
  args: unknown[];
  /** Milliseconds since session start when this call happened. */
  delayMs: number;
}

function safeValue(v: unknown): unknown {
  if (v instanceof Error) return { name: v.name, message: v.message };
  try {
    return JSON.parse(JSON.stringify(v)) as unknown;
  } catch {
    return String(v);
  }
}

/** Reduce sink-call args to JSON-safe values so the fixture stays valid NDJSON. */
export function safeArgs(args: unknown[]): unknown[] {
  return args.map(safeValue);
}

/** Filename-safe segment from a recording key. */
export function sanitizeKey(key: string): string {
  return key
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function fixtureFileName(key: string, index: number): string {
  return `${sanitizeKey(key)}.${index}.ndjson`;
}

export function parseFixture(text: string): RecordedEvent[] {
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RecordedEvent);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/testing/recording-format.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/testing/recording-format.ts packages/core/src/__tests__/testing/recording-format.test.ts
git commit -m "feat(core): fixture format helpers for E2E recording"
```

---

## Task 2: RecordingSink (core)

**Files:**
- Create: `packages/core/src/testing/recording-sink.ts`
- Test: `packages/core/src/__tests__/testing/recording-sink.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/__tests__/testing/recording-sink.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createRecordingSink } from '../../testing/recording-sink.js';
import type { RecordedEvent } from '../../testing/recording-format.js';

describe('createRecordingSink', () => {
  it('records each call and forwards to the real sink', () => {
    const recorded: RecordedEvent[] = [];
    let clock = 0;
    const real = { onInit: vi.fn(), onExit: vi.fn() };
    const sink = createRecordingSink(real as never, {
      write: (e) => recorded.push(e),
      now: () => clock,
    });

    clock = 0;
    (sink as unknown as { onInit(id: string): void }).onInit('s1');
    clock = 120;
    (sink as unknown as { onExit(code: number): void }).onExit(0);

    expect(real.onInit).toHaveBeenCalledWith('s1');
    expect(real.onExit).toHaveBeenCalledWith(0);
    expect(recorded).toEqual([
      { dir: 'out', method: 'onInit', args: ['s1'], delayMs: 0 },
      { dir: 'out', method: 'onExit', args: [0], delayMs: 120 },
    ]);
  });

  it('reduces an Error arg to a safe shape', () => {
    const recorded: RecordedEvent[] = [];
    const real = { onError: vi.fn() };
    const sink = createRecordingSink(real as never, { write: (e) => recorded.push(e), now: () => 0 });
    (sink as unknown as { onError(e: Error): void }).onError(new Error('boom'));
    expect(recorded[0]).toEqual({ dir: 'out', method: 'onError', args: [{ name: 'Error', message: 'boom' }], delayMs: 0 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/testing/recording-sink.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/testing/recording-sink.ts
import type { SessionSink } from '@qlan-ro/mainframe-types';
import { safeArgs, type RecordedEvent } from './recording-format.js';

export interface RecordingSinkDeps {
  write: (event: RecordedEvent) => void;
  /** Returns ms elapsed since session start. Shared with the `in`-marker writer so all events
   *  sit on one timeline (lets replay base each output's delay off the preceding `in` marker). */
  now: () => number;
}

/**
 * Wraps a real SessionSink in a Proxy. Every method call is recorded as
 * {dir:'out', method, args, delayMs} and then forwarded to the real sink. Generic: any
 * present or future sink method is captured with no code change.
 */
export function createRecordingSink(real: SessionSink, deps: RecordingSinkDeps): SessionSink {
  return new Proxy(real, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop === 'string' && typeof orig === 'function') {
        return (...args: unknown[]): unknown => {
          deps.write({ dir: 'out', method: prop, args: safeArgs(args), delayMs: deps.now() });
          return (orig as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return orig;
    },
  });
}
```

(The Task 2 test already passes `now: () => clock` with `clock` set to the elapsed value at each call — `0` then `120` — so dropping the internal `start` subtraction yields the same `delayMs` and keeps the test green.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/testing/recording-sink.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/testing/recording-sink.ts packages/core/src/__tests__/testing/recording-sink.test.ts
git commit -m "feat(core): generic proxy RecordingSink for E2E recording"
```

---

## Task 3: Replay batch logic (core)

**Files:**
- Create: `packages/core/src/testing/replay-core.ts`
- Test: `packages/core/src/__tests__/testing/replay-core.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/__tests__/testing/replay-core.test.ts
import { describe, it, expect } from 'vitest';
import { createReplayState, drainOutputs, consumeInput, isExhausted } from '../../testing/replay-core.js';

// Mirrors the real cadence: spawn emits nothing (onInit arrives after the first message), then each
// `in` marker is followed by its run of `out` events.
const FIXTURE = [
  '{"dir":"in","method":"sendMessage","args":["create"],"delayMs":0}',
  '{"dir":"out","method":"onInit","args":["s1"],"delayMs":40}',
  '{"dir":"out","method":"onMessage","args":[[{"type":"text","text":"ok"}]],"delayMs":50}',
  '{"dir":"out","method":"onPermission","args":[{"requestId":"r1"}],"delayMs":60}',
  '{"dir":"in","method":"respondToPermission","args":[{"requestId":"r1"}],"delayMs":100}',
  '{"dir":"out","method":"onResult","args":[{}],"delayMs":120}',
].join('\n');

describe('replay-core', () => {
  it('spawn drains zero leading outputs (first event is an in-marker)', () => {
    const state = createReplayState(FIXTURE);
    expect(drainOutputs(state).map((e) => e.method)).toEqual([]);
    expect(state.cursor).toBe(0);
  });
  it('consumeInput skips one in-marker, then drainOutputs returns that turn', () => {
    const state = createReplayState(FIXTURE);
    drainOutputs(state); // spawn (no-op)
    expect(consumeInput(state)?.method).toBe('sendMessage');
    expect(drainOutputs(state).map((e) => e.method)).toEqual(['onInit', 'onMessage', 'onPermission']);
  });
  it('next interaction consumes its in-marker and drains to the end', () => {
    const state = createReplayState(FIXTURE);
    drainOutputs(state);
    consumeInput(state);
    drainOutputs(state);
    expect(consumeInput(state)?.method).toBe('respondToPermission');
    expect(drainOutputs(state).map((e) => e.method)).toEqual(['onResult']);
    expect(isExhausted(state)).toBe(true);
  });
  it('consumeInput returns null when the cursor is on an out event', () => {
    const state = createReplayState(FIXTURE);
    consumeInput(state); // skip the leading sendMessage marker
    expect(consumeInput(state)).toBeNull(); // now on onInit (out)
    expect(state.cursor).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/testing/replay-core.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/testing/replay-core.ts
import { parseFixture, type RecordedEvent } from './recording-format.js';

export interface ReplayState {
  events: RecordedEvent[];
  cursor: number;
}

export function createReplayState(text: string): ReplayState {
  return { events: parseFixture(text), cursor: 0 };
}

export function isExhausted(state: ReplayState): boolean {
  return state.cursor >= state.events.length;
}

/** If the cursor is on an `in` marker, consume it (advance) and return it; otherwise return null. */
export function consumeInput(state: ReplayState): RecordedEvent | null {
  const ev = state.events[state.cursor];
  if (ev && ev.dir === 'in') {
    state.cursor++;
    return ev;
  }
  return null;
}

/** Drain the run of consecutive `out` events from the cursor (stops at the next `in` marker or end). */
export function drainOutputs(state: ReplayState): RecordedEvent[] {
  const out: RecordedEvent[] = [];
  while (state.cursor < state.events.length) {
    const ev = state.events[state.cursor];
    if (!ev || ev.dir !== 'out') break;
    out.push(ev);
    state.cursor++;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/__tests__/testing/replay-core.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/testing/replay-core.ts packages/core/src/__tests__/testing/replay-core.test.ts
git commit -m "feat(core): replay batch logic for E2E fixtures"
```

---

## Task 4: Daemon record hook + plugin-dir alignment (core)

**Files:**
- Create: `packages/core/src/testing/record-wrapper.ts`
- Modify: `packages/core/src/index.ts:99` (plugins dir) and after line 115 (E2E block)

No unit test — this is bootstrap wiring, verified by `pnpm build` (typecheck) and the Task 9 integration proof.

- [ ] **Step 1: Create the record wrapper**

```ts
// packages/core/src/testing/record-wrapper.ts
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  Adapter,
  AdapterProcess,
  AdapterSession,
  SessionOptions,
  SessionSink,
  SessionSpawnOptions,
} from '@qlan-ro/mainframe-types';
import type { AdapterRegistry } from '../adapters/index.js';
import { createRecordingSink } from './recording-sink.js';
import { fixtureFileName, safeArgs, type RecordedEvent } from './recording-format.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('e2e:record');

/** Per-session writer shared by the output sink and the input markers (one timeline via `elapsed`). */
interface Recorder {
  write: (event: RecordedEvent) => void;
  writeIn: (method: string, args: unknown[]) => void;
  elapsed: () => number;
}

// Daemon→session calls we record as `in` markers, so replay can split on the exact interaction cadence.
const INPUT_METHODS = new Set(['sendMessage', 'respondToPermission', 'interrupt']);

/**
 * Replaces the registered `claude` adapter with a Proxy that, per session,
 * (a) tees every sink output to an NDJSON fixture and (b) records an `in` marker
 * before each sendMessage/respondToPermission/interrupt. The fixture file is
 * truncated at session creation so re-recording (index resets to 0 each daemon
 * run) overwrites cleanly. Only called when E2E_MODE==='record' — production
 * never enters this path.
 */
export function wrapClaudeForRecording(adapters: AdapterRegistry): void {
  const real = adapters.get('claude');
  if (!real) {
    log.warn('No claude adapter registered — nothing to wrap for recording');
    return;
  }
  const dir = process.env['E2E_RECORDINGS_DIR'];
  if (!dir) throw new Error('E2E_MODE=record requires E2E_RECORDINGS_DIR');
  mkdirSync(dir, { recursive: true });

  const key = process.env['E2E_RECORDING_KEY'] ?? 'session';
  const indexByKey = new Map<string, number>();

  const wrapped = new Proxy(real, {
    get(target, prop, receiver) {
      if (prop === 'createSession') {
        return (options: SessionOptions): AdapterSession => {
          const index = indexByKey.get(key) ?? 0;
          indexByKey.set(key, index + 1);
          const file = join(dir, fixtureFileName(key, index));
          writeFileSync(file, ''); // truncate any fixture from a previous record run
          const start = Date.now();
          const elapsed = () => Date.now() - start;
          const write = (e: RecordedEvent) => appendFileSync(file, JSON.stringify(e) + '\n');
          const recorder: Recorder = {
            write,
            elapsed,
            writeIn: (method, args) => write({ dir: 'in', method, args: safeArgs(args), delayMs: elapsed() }),
          };
          return wrapSession(target.createSession(options), recorder);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Adapter;

  adapters.register(wrapped);
  log.info({ key, dir }, 'Claude adapter wrapped for E2E recording');
}

function wrapSession(session: AdapterSession, rec: Recorder): AdapterSession {
  return new Proxy(session, {
    get(target, prop, receiver) {
      if (prop === 'spawn') {
        return (options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess> => {
          const recordingSink = sink ? createRecordingSink(sink, { write: rec.write, now: rec.elapsed }) : sink;
          return target.spawn(options, recordingSink);
        };
      }
      if (typeof prop === 'string' && INPUT_METHODS.has(prop)) {
        const orig = Reflect.get(target, prop, receiver) as (...a: unknown[]) => Promise<unknown>;
        return (...args: unknown[]): Promise<unknown> => {
          rec.writeIn(prop, args);
          return orig.apply(target, args);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as AdapterSession;
}
```

> Note: `in` markers and `out` events share one timeline (`elapsed()` = ms since session creation,
> passed to both the marker writer and `createRecordingSink`'s `now`). Replay bases each turn's first
> output delay off the consumed `in` marker, so recorded test/user think-time is not replayed.

- [ ] **Step 2: Align the user-plugins dir to the data dir**

In `packages/core/src/index.ts`, change line 99 inside the `new PluginManager({...})` call:

```ts
// BEFORE
    pluginsDirs: [join(homedir(), '.mainframe', 'plugins')],
// AFTER
    pluginsDirs: [join(getDataDir(), 'plugins')],
```

(`getDataDir()` is already imported on line 7. In production `getDataDir()` returns `~/.mainframe`, so this is behavior-neutral; under `MAINFRAME_DATA_DIR` it now correctly follows the override — matching the todos builtin on line 110.)

- [ ] **Step 3: Add the E2E record block**

In `packages/core/src/index.ts`, add the import near the other imports:

```ts
import { wrapClaudeForRecording } from './testing/record-wrapper.js';
```

Then immediately AFTER the `await pluginManager.loadAll();` line (currently line 115):

```ts
  if (process.env['E2E_MODE'] === 'record') {
    wrapClaudeForRecording(adapters);
  }
```

- [ ] **Step 4: Typecheck/build core**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: builds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/testing/record-wrapper.ts packages/core/src/index.ts
git commit -m "feat(core): E2E record hook + honor MAINFRAME_DATA_DIR for plugin discovery"
```

---

## Task 5: Mock-cli plugin scaffolding + activate

**Files:**
- Create: `packages/e2e/plugins/mock-cli/{manifest.json,package.json,tsconfig.json,src/index.ts}`

- [ ] **Step 1: manifest.json**

```json
{
  "id": "mock-cli",
  "name": "Mock CLI Adapter",
  "version": "0.1.0",
  "description": "Replays recorded CLI sessions for E2E testing",
  "capabilities": ["adapters"],
  "adapter": {
    "binaryName": "mock-cli",
    "displayName": "Mock CLI"
  }
}
```

- [ ] **Step 2: package.json** (`type: commonjs` so the bundled `index.js` loads via `createRequire`)

```json
{
  "name": "mock-cli",
  "version": "0.1.0",
  "private": true,
  "type": "commonjs"
}
```

- [ ] **Step 3: tsconfig.json** (editor/CI typecheck only; the build is esbuild)

```json
{
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "target": "es2022",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

> `moduleResolution: "bundler"` (not `nodenext`) is required: the plugin uses extensionless relative
> imports so esbuild bundles them, and bundler resolution is the matching type-check mode. Also add
> `"exclude": ["dist", "node_modules", "plugins/mock-cli"]` to **`packages/e2e/tsconfig.json`** so the
> e2e package's NodeNext program doesn't try (and fail) to resolve the plugin's extensionless imports.

- [ ] **Step 4: src/index.ts** (extensionless relative imports — esbuild resolves `.ts`)

```ts
import type { PluginContext } from '@qlan-ro/mainframe-types';
import { MockCliAdapter } from './adapter';

export function activate(ctx: PluginContext): void {
  ctx.adapters!.register(new MockCliAdapter());
  ctx.logger.info('Mock CLI adapter registered (E2E replay)');
}
```

- [ ] **Step 5: Commit** (adapter/session land in the next tasks; this compiles only after Task 7)

```bash
git add packages/e2e/plugins/mock-cli/manifest.json packages/e2e/plugins/mock-cli/package.json packages/e2e/plugins/mock-cli/tsconfig.json packages/e2e/plugins/mock-cli/src/index.ts
git commit -m "feat(e2e): mock-cli plugin manifest + activate entry"
```

---

## Task 6: Plugin fixture helper (standalone mirror)

**Files:**
- Create: `packages/e2e/plugins/mock-cli/src/fixture.ts`

This is a deliberate small mirror of `packages/core/src/testing/replay-core.ts` + `recording-format.ts`, kept standalone so the plugin bundles with **zero workspace-internal imports** (it is also the reference impl a third-party adapter plugin would ship). The canonical logic is unit-tested in core (Tasks 1 & 3); this copy is exercised by the Task 9 integration proof.

- [ ] **Step 1: Write the file**

```ts
// packages/e2e/plugins/mock-cli/src/fixture.ts
// Mirror of packages/core/src/testing/{recording-format,replay-core}.ts — kept standalone so this
// plugin bundles without importing workspace internals (reference impl for 3rd-party adapters).

export interface RecordedEvent {
  dir: 'in' | 'out';
  method: string;
  args: unknown[];
  delayMs: number;
}

export interface ReplayState {
  events: RecordedEvent[];
  cursor: number;
}

export function createReplayState(text: string): ReplayState {
  const events = text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RecordedEvent);
  return { events, cursor: 0 };
}

export function isExhausted(state: ReplayState): boolean {
  return state.cursor >= state.events.length;
}

/** If the cursor is on an `in` marker, consume it and return it; otherwise return null. */
export function consumeInput(state: ReplayState): RecordedEvent | null {
  const ev = state.events[state.cursor];
  if (ev && ev.dir === 'in') {
    state.cursor++;
    return ev;
  }
  return null;
}

/** Drain the run of consecutive `out` events from the cursor (stops at the next `in` marker or end). */
export function drainOutputs(state: ReplayState): RecordedEvent[] {
  const out: RecordedEvent[] = [];
  while (state.cursor < state.events.length) {
    const ev = state.events[state.cursor];
    if (!ev || ev.dir !== 'out') break;
    out.push(ev);
    state.cursor++;
  }
  return out;
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/e2e/plugins/mock-cli/src/fixture.ts
git commit -m "feat(e2e): mock-cli standalone fixture/replay helper"
```

---

## Task 7: MockCliAdapter + ReplaySession

**Files:**
- Create: `packages/e2e/plugins/mock-cli/src/adapter.ts`, `packages/e2e/plugins/mock-cli/src/session.ts`

- [ ] **Step 1: adapter.ts**

```ts
// packages/e2e/plugins/mock-cli/src/adapter.ts
import type { Adapter, AdapterModel, AdapterSession, SessionOptions } from '@qlan-ro/mainframe-types';
import { ReplaySession } from './session';

export class MockCliAdapter implements Adapter {
  id = 'mock-cli';
  name = 'Mock CLI';
  readonly capabilities = { planMode: true };
  private readonly indexByKey = new Map<string, number>();

  async isInstalled(): Promise<boolean> {
    return true;
  }
  async getVersion(): Promise<string | null> {
    return '0.1.0';
  }
  async listModels(): Promise<AdapterModel[]> {
    return [{ id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', isDefault: true }];
  }
  killAll(): void {}

  createSession(options: SessionOptions): AdapterSession {
    const dir = process.env['E2E_RECORDINGS_DIR'];
    if (!dir) throw new Error('mock-cli requires E2E_RECORDINGS_DIR');
    const key = process.env['E2E_RECORDING_KEY'] ?? 'session';
    const index = this.indexByKey.get(key) ?? 0;
    this.indexByKey.set(key, index + 1);
    return new ReplaySession(options, dir, key, index);
  }
}
```

- [ ] **Step 2: session.ts**

```ts
// packages/e2e/plugins/mock-cli/src/session.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AdapterProcess,
  AdapterSession,
  ChatMessage,
  ContextFile,
  ControlResponse,
  SessionOptions,
  SessionSink,
  SessionSpawnOptions,
  SkillFileEntry,
} from '@qlan-ro/mainframe-types';
import { createReplayState, drainOutputs, consumeInput, isExhausted, type ReplayState, type RecordedEvent } from './fixture';

function sanitizeKey(key: string): string {
  return key.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

export class ReplaySession implements AdapterSession {
  readonly id: string;
  readonly adapterId = 'mock-cli';
  readonly projectPath: string;
  private sink: SessionSink | undefined;
  private spawned = false;
  private readonly state: ReplayState;
  private lastDelay = 0;

  constructor(options: SessionOptions, dir: string, key: string, index: number) {
    this.id = options.mainframeChatId;
    this.projectPath = options.projectPath;
    const file = join(dir, `${sanitizeKey(key)}.${index}.ndjson`);
    if (!existsSync(file)) {
      throw new Error(`mock-cli: fixture not found: ${file} — record it with E2E_MODE=record`);
    }
    this.state = createReplayState(readFileSync(file, 'utf-8'));
  }

  get isSpawned(): boolean {
    return this.spawned;
  }

  async spawn(_options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess> {
    this.spawned = true;
    this.sink = sink;
    // Leading outputs only (usually none — onInit arrives after the first message).
    this.emit(drainOutputs(this.state));
    return {
      id: this.id,
      adapterId: this.adapterId,
      chatId: this.id,
      pid: -1,
      status: 'ready',
      projectPath: this.projectPath,
    };
  }

  async sendMessage(): Promise<void> {
    this.advance('sendMessage');
  }
  async respondToPermission(_response: ControlResponse): Promise<void> {
    this.advance('respondToPermission');
  }
  async interrupt(): Promise<void> {
    this.advance('interrupt');
  }

  /**
   * Consume this interaction's `in` marker (which must match `expected` — markers are the
   * synchronization contract) and emit the run of outputs that followed it. The first output's
   * delay is based off the marker, so recorded think-time between turns is not replayed.
   */
  private advance(expected: string): void {
    const marker = isExhausted(this.state) ? null : consumeInput(this.state);
    if (!marker || marker.method !== expected) {
      this.sink?.onError(
        new Error(
          `mock-cli: expected an '${expected}' marker but the fixture had '${marker?.method ?? 'nothing (exhausted)'}' — ` +
            `the test drives a different interaction order than was recorded. Re-record.`,
        ),
      );
      return;
    }
    this.lastDelay = marker.delayMs;
    this.emit(drainOutputs(this.state));
  }

  private emit(batch: RecordedEvent[]): void {
    if (!this.sink || batch.length === 0) return;
    const sink = this.sink as unknown as Record<string, (...args: unknown[]) => void>;
    const base = this.lastDelay;
    for (const ev of batch) {
      const offset = Math.max(0, ev.delayMs - base);
      const fire = () => sink[ev.method]?.(...ev.args);
      if (offset > 0) setTimeout(fire, offset);
      else fire();
    }
    const last = batch[batch.length - 1];
    if (last) this.lastDelay = last.delayMs;
  }

  // ── Interface no-ops (irrelevant to replay) ───────────────────────────────
  async kill(): Promise<void> {
    this.spawned = false;
  }
  getProcessInfo(): AdapterProcess | null {
    return this.spawned
      ? { id: this.id, adapterId: this.adapterId, chatId: this.id, pid: -1, status: 'ready', projectPath: this.projectPath }
      : null;
  }
  async cancelQueuedMessage(): Promise<boolean> {
    return false;
  }
  async setModel(): Promise<void> {}
  async setPermissionMode(): Promise<void> {}
  async setPlanMode(): Promise<void> {}
  async sendCommand(): Promise<void> {}
  getContextFiles(): { global: ContextFile[]; project: ContextFile[] } {
    return { global: [], project: [] };
  }
  async loadHistory(): Promise<ChatMessage[]> {
    return [];
  }
  async extractPlanFiles(): Promise<string[]> {
    return [];
  }
  async extractSkillFiles(): Promise<SkillFileEntry[]> {
    return [];
  }
  async stopBackgroundTask(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: 'unsupported' };
  }
}
```

- [ ] **Step 3: Build the plugin to verify it bundles**

Run:
```bash
cd packages/e2e && node ../../node_modules/.bin/esbuild plugins/mock-cli/src/index.ts --bundle --platform=node --format=cjs --outfile=plugins/mock-cli/index.js
```
Expected: writes `plugins/mock-cli/index.js` with no errors. Sanity-check it loads:
```bash
node -e "const m=require('./plugins/mock-cli/index.js'); if(typeof m.activate!=='function') throw new Error('no activate export'); console.log('ok: activate exported')"
```
Expected: `ok: activate exported`.

- [ ] **Step 4: Typecheck the plugin**

Run: `cd packages/e2e && node ../../node_modules/.bin/tsc --noEmit -p plugins/mock-cli/tsconfig.json`
Expected: no type errors. (If `@qlan-ro/mainframe-types` doesn't resolve, build core first: `pnpm --filter @qlan-ro/mainframe-core build`.)

- [ ] **Step 5: Commit**

```bash
git add packages/e2e/plugins/mock-cli/src/adapter.ts packages/e2e/plugins/mock-cli/src/session.ts
git commit -m "feat(e2e): MockCliAdapter + ReplaySession (positional replay)"
```

---

## Task 8: E2E harness wiring (app.ts, chat.ts, scripts, gitignore)

**Files:**
- Modify: `packages/e2e/fixtures/app.ts`, `packages/e2e/fixtures/chat.ts`, `packages/e2e/package.json`, `.gitignore`

- [ ] **Step 1: app.ts — imports & constants**

Add to the imports at the top of `packages/e2e/fixtures/app.ts`:

```ts
import { mkdtempSync, rmSync, openSync, closeSync, mkdirSync, cpSync } from 'fs';
import { spawn, execFileSync } from 'child_process';
```
(extend the existing `fs`/`child_process` import lines — do not duplicate them).

Add constants after `DAEMON_BASE`:

```ts
const E2E_MODE = process.env['E2E_MODE'];
const RECORDINGS_DIR = path.resolve(__dirname, '../fixtures/recordings');
const MOCK_PLUGIN_DIR = path.resolve(__dirname, '../plugins/mock-cli');
const ESBUILD_BIN = path.resolve(__dirname, '../../../node_modules/.bin/esbuild');

function buildMockPlugin(): void {
  execFileSync(
    ESBUILD_BIN,
    ['plugins/mock-cli/src/index.ts', '--bundle', '--platform=node', '--format=cjs', '--outfile=plugins/mock-cli/index.js'],
    { cwd: path.resolve(__dirname, '..'), stdio: 'inherit' },
  );
}
```

- [ ] **Step 2: app.ts — launchApp signature + E2E env + plugin symlink**

Change the signature:

```ts
export async function launchApp(opts?: { recordingKey?: string }): Promise<AppFixture> {
```

After `const testDataDir = mkdtempSync(...)`, add:

```ts
  // E2E record/replay wiring. In mock mode, build + symlink the external plugin into the isolated
  // data dir's plugins/ (the daemon scans getDataDir()/plugins). In record mode, the real claude
  // adapter is wrapped in-daemon. Both modes get the recordings dir + optional stable key.
  const e2eEnv: Record<string, string> = {};
  if (E2E_MODE) {
    e2eEnv['E2E_MODE'] = E2E_MODE;
    e2eEnv['E2E_RECORDINGS_DIR'] = RECORDINGS_DIR;
    if (opts?.recordingKey) e2eEnv['E2E_RECORDING_KEY'] = opts.recordingKey;
  }
  if (E2E_MODE === 'mock') {
    buildMockPlugin();
    const pluginsDir = path.join(testDataDir, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    // Copy, not symlink: the daemon's loadAll() skips symlinked entries (readdirSync withFileTypes
    // reports a symlinked dir as isDirectory()===false), so a symlinked plugin is never discovered.
    cpSync(MOCK_PLUGIN_DIR, path.join(pluginsDir, 'mock-cli'), { recursive: true });
  }
```

(Import `cpSync` from `fs`, not `symlinkSync`.)

Then merge `e2eEnv` into the daemon spawn env:

```ts
    env: { ...process.env, MAINFRAME_DATA_DIR: testDataDir, DAEMON_PORT, ...e2eEnv },
```

- [ ] **Step 3: chat.ts — default adapter by mode**

In `packages/e2e/fixtures/chat.ts`, change the `adapterId` default:

```ts
// BEFORE
  adapterId = 'claude',
// AFTER
  adapterId = process.env['E2E_MODE'] === 'mock' ? 'mock-cli' : 'claude',
```

- [ ] **Step 4: package.json scripts**

Add to `packages/e2e/package.json` `scripts`. `test:record`/`test:mock` are **driver prefixes** — always
pass the enrolled spec/grep so they never blanket-run the suite (an un-enrolled AI spec in mock mode
fails fast: `ReplaySession` throws "fixture not found"; a non-AI spec that never sends a message would
spawn a mock session with no fixture and also throw). Example: `pnpm --filter @qlan-ro/mainframe-e2e test:mock 06-permissions.spec.ts -g Interactive`.

```json
    "build:mock": "node ../../node_modules/.bin/esbuild plugins/mock-cli/src/index.ts --bundle --platform=node --format=cjs --outfile=plugins/mock-cli/index.js",
    "test:record": "E2E_MODE=record playwright test",
    "test:mock": "E2E_MODE=mock playwright test"
```

- [ ] **Step 5: .gitignore the built bundle**

Add to the repo-root `.gitignore`:

```
packages/e2e/plugins/mock-cli/index.js
```

- [ ] **Step 6: Typecheck e2e + commit**

Run: `pnpm --filter @qlan-ro/mainframe-e2e exec tsc --noEmit` (or the package's typecheck script if present)
Expected: no type errors.

```bash
git add packages/e2e/fixtures/app.ts packages/e2e/fixtures/chat.ts packages/e2e/package.json .gitignore
git commit -m "feat(e2e): harness wiring for record/mock modes"
```

---

## Task 9: Record the proof, replay it green

**Files:**
- Modify: `packages/e2e/tests/06-permissions.spec.ts` (Interactive `beforeAll` only)
- Create: `packages/e2e/fixtures/recordings/permissions-interactive.0.ndjson` (recorded artifact)

- [ ] **Step 1: Give the Interactive describe a stable recording key**

In `packages/e2e/tests/06-permissions.spec.ts`, in the FIRST describe (`§6 Permission system — Interactive`), change its `beforeAll`:

```ts
// BEFORE
    fixture = await launchApp();
// AFTER
    fixture = await launchApp({ recordingKey: 'permissions-interactive' });
```

(Leave the Auto-Edits and Yolo describes unchanged — they are not part of this milestone.)

- [ ] **Step 2: Build app + plugin for the test port**

Run:
```bash
pnpm --filter @qlan-ro/mainframe-e2e build:app
pnpm --filter @qlan-ro/mainframe-e2e build:mock
```
Expected: both succeed. (`build:app` rebuilds core — which now contains the record hook — and the renderer for port 31416.)

- [ ] **Step 3: Record against real Claude** (needs Claude login; makes real API calls — one time)

Run:
```bash
cd packages/e2e && E2E_MODE=record ./node_modules/.bin/playwright test 06-permissions.spec.ts -g "Interactive" --reporter=line
```
Expected: the 3 Interactive tests pass against the real CLI; `fixtures/recordings/permissions-interactive.0.ndjson` now exists and is non-empty. Then free the port:
```bash
lsof -ti :31416 | xargs kill 2>/dev/null || true
```

- [ ] **Step 4: Inspect the fixture**

Run:
```bash
head -5 packages/e2e/fixtures/recordings/permissions-interactive.0.ndjson
grep -c '"dir":"in","method":"sendMessage"' packages/e2e/fixtures/recordings/permissions-interactive.0.ndjson
grep -c '"dir":"out","method":"onPermission"' packages/e2e/fixtures/recordings/permissions-interactive.0.ndjson
```
Expected: the first line is an `in` marker (`{"dir":"in","method":"sendMessage",...}`); there is at least one `dir:"in"` `sendMessage` and at least one `dir:"out"` `onPermission`. If the file is empty or has no `onPermission`, re-record (Step 3).

- [ ] **Step 5: Replay in mock mode — the proof**

Run:
```bash
cd packages/e2e && E2E_MODE=mock ./node_modules/.bin/playwright test 06-permissions.spec.ts -g "Interactive" --reporter=line
```
Expected: the 3 Interactive tests PASS with no Claude API call. Then:
```bash
lsof -ti :31416 | xargs kill 2>/dev/null || true
```
If a test fails on a desync, the fixture's interaction order didn't match the test's drive order — re-record (Step 3) and retry. (Replay is deterministic, so a passing run stays passing.)

- [ ] **Step 6: Commit the proof**

```bash
git add packages/e2e/tests/06-permissions.spec.ts packages/e2e/fixtures/recordings/permissions-interactive.0.ndjson
git commit -m "test(e2e): record + replay 06-permissions interactive flow in mock mode"
```

---

## Task 10: Changeset, docs, final build

**Files:**
- Create: `.changeset/<name>.md`
- Modify: `packages/e2e/COVERAGE-GAPS.md` (note the mechanism now exists)

- [ ] **Step 1: Changeset** (core behavior change: plugin discovery honors `MAINFRAME_DATA_DIR`)

Create `.changeset/mock-cli-plugin.md`:

```md
---
"@qlan-ro/mainframe-core": patch
---

Plugin discovery now honors `MAINFRAME_DATA_DIR` (scans `<dataDir>/plugins` instead of a hardcoded `~/.mainframe/plugins`), aligning user-plugin loading with the rest of the data-dir convention. No change in the default install.
```

- [ ] **Step 2: Note the mechanism in COVERAGE-GAPS.md**

Under the "Blocked — AI-coupled" section of `packages/e2e/COVERAGE-GAPS.md`, prepend:

```md
> **Update:** the mock-cli record/replay plugin (`plugins/mock-cli/`, see its DESIGN.md/PLAN.md) now
> lets these specs run in CI without the API. Enroll a spec by giving its `beforeAll` a
> `launchApp({ recordingKey })`, recording once with `E2E_MODE=record`, and committing the fixture.
> `06-permissions` (Interactive) is the proven reference.
```

- [ ] **Step 3: Full build + core tests green**

Run:
```bash
pnpm --filter @qlan-ro/mainframe-core test
pnpm build
```
Expected: core unit tests (including the 3 new test files) pass; full build succeeds.

- [ ] **Step 4: Commit**

```bash
git add .changeset/mock-cli-plugin.md packages/e2e/COVERAGE-GAPS.md
git commit -m "chore(e2e): changeset + document mock-cli unblock path"
```

---

## Self-Review

**Spec coverage:**
- Three modes (unset/record/mock) → Tasks 4 (record hook), 8 (harness env/adapter switch). ✓
- Generic proxy fixture format with `dir` in/out markers → Tasks 1–2 (RecordingSink), 3/6 (replay). ✓
- **Input markers** (record `in` for sendMessage/respondToPermission/interrupt; split replay on them) → record-wrapper (Task 4), replay-core `consumeInput`/`drainOutputs` (Task 3), session `advance()` (Task 7). ✓
- mock-cli external plugin (manifest, adapter, session, build) → Tasks 5–7. ✓
- Production hooks → Task 4 (E2E_MODE record block + `getDataDir()` plugin-dir alignment; changeset in Task 10). ✓
- Per-session-index keying by `E2E_RECORDING_KEY` → `indexByKey` in record-wrapper (Task 4) and MockCliAdapter (Task 7). ✓
- Fixture truncated on re-record → `writeFileSync(file,'')` at createSession (Task 4). ✓
- delayMs honored → `ReplaySession.emit` (Task 7). ✓
- Missing fixture → clear throw; **exhaustion → `onError`** (fail-fast, not silent) → `advance()` (Task 7). ✓
- Mock runs scoped to enrolled specs (no blanket suite run) → Task 8 scripts note. ✓
- First milestone = 06-permissions Interactive → Task 9. ✓
- Unit tests for recording + replay → Tasks 1–3. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. ✓

**Type consistency:** `RecordedEvent {dir,method,args,delayMs}` identical in core (`recording-format.ts`) and plugin (`fixture.ts`). `createRecordingSink(real, {write, now})` matches its test and the record-wrapper call. `createReplayState`/`consumeInput`/`drainOutputs`/`isExhausted` names match between core `replay-core.ts`, its tests, the plugin `fixture.ts`, and `session.ts`. `wrapClaudeForRecording(adapters)` matches the index.ts call. `launchApp({recordingKey})` matches the 06-permissions call. ✓

**Codex review (iteration 1) fixes applied:** (1) input markers replace output-type boundaries — `spawn` no longer consumes the first turn's response; (2) fixture truncated at session creation so re-recording doesn't concatenate; (3) exhaustion emits `onError` instead of returning silently; (4) `test:mock` is a driver prefix scoped to enrolled specs.

**Codex review (iteration 2) fixes applied:** (5) unified `in`/`out` timeline (`createRecordingSink.now` = elapsed-since-start, shared with the marker writer) and `advance()` bases the turn's first output delay off the consumed marker — recorded think-time is no longer replayed; (6) `advance(expected)` validates the marker method and emits `onError` on mismatch (markers are the sync contract); (7) Task 9 fixture-inspection updated for the `dir:"in"/"out"` format.

**Known deviation from the design doc:** each *recorded* spec needs a one-line `recordingKey` in its `beforeAll` (random temp project paths can't key a cross-run fixture). Non-recorded specs are untouched. Documented in Task 9 and COVERAGE-GAPS (Task 10).
