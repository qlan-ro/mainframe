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
- `packages/core/src/testing/replay-core.ts` — pure batch logic (`createReplayState`, `nextBatch`, `skipToResult`, `isExhausted`).
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
    const text = '{"method":"onInit","args":["s1"],"delayMs":0}\n\n{"method":"onExit","args":[0],"delayMs":5}\n';
    const events: RecordedEvent[] = parseFixture(text);
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ method: 'onInit', args: ['s1'], delayMs: 0 });
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
      { method: 'onInit', args: ['s1'], delayMs: 0 },
      { method: 'onExit', args: [0], delayMs: 120 },
    ]);
  });

  it('reduces an Error arg to a safe shape', () => {
    const recorded: RecordedEvent[] = [];
    const real = { onError: vi.fn() };
    const sink = createRecordingSink(real as never, { write: (e) => recorded.push(e), now: () => 0 });
    (sink as unknown as { onError(e: Error): void }).onError(new Error('boom'));
    expect(recorded[0]).toEqual({ method: 'onError', args: [{ name: 'Error', message: 'boom' }], delayMs: 0 });
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
  now: () => number;
}

/**
 * Wraps a real SessionSink in a Proxy. Every method call is recorded as
 * {method, args, delayMs} and then forwarded to the real sink. Generic: any
 * present or future sink method is captured with no code change.
 */
export function createRecordingSink(real: SessionSink, deps: RecordingSinkDeps): SessionSink {
  const start = deps.now();
  return new Proxy(real, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver) as unknown;
      if (typeof prop === 'string' && typeof orig === 'function') {
        return (...args: unknown[]): unknown => {
          deps.write({ method: prop, args: safeArgs(args), delayMs: deps.now() - start });
          return (orig as (...a: unknown[]) => unknown).apply(target, args);
        };
      }
      return orig;
    },
  });
}
```

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
import { createReplayState, nextBatch, skipToResult, isExhausted } from '../../testing/replay-core.js';

const FIXTURE = [
  '{"method":"onInit","args":["s1"],"delayMs":0}',
  '{"method":"onMessage","args":[[{"type":"text","text":"hi"}]],"delayMs":10}',
  '{"method":"onPermission","args":[{"requestId":"r1"}],"delayMs":20}',
  '{"method":"onToolResult","args":[[]],"delayMs":30}',
  '{"method":"onResult","args":[{}],"delayMs":40}',
  '{"method":"onExit","args":[0],"delayMs":50}',
].join('\n');

describe('replay-core', () => {
  it('first batch drains up to and including the first onPermission', () => {
    const state = createReplayState(FIXTURE);
    const batch = nextBatch(state);
    expect(batch.map((e) => e.method)).toEqual(['onInit', 'onMessage', 'onPermission']);
  });
  it('next batch resumes after the permission, stopping at onResult', () => {
    const state = createReplayState(FIXTURE);
    nextBatch(state);
    const batch = nextBatch(state);
    expect(batch.map((e) => e.method)).toEqual(['onToolResult', 'onResult']);
  });
  it('final batch returns onExit and then reports exhausted', () => {
    const state = createReplayState(FIXTURE);
    nextBatch(state);
    nextBatch(state);
    const last = nextBatch(state);
    expect(last.map((e) => e.method)).toEqual(['onExit']);
    expect(isExhausted(state)).toBe(true);
  });
  it('skipToResult jumps to the next onResult/onExit', () => {
    const state = createReplayState(FIXTURE);
    const batch = skipToResult(state);
    expect(batch[batch.length - 1]?.method).toBe('onResult');
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

/** A recorded interaction ends at one of these sink calls. */
export const BATCH_BOUNDARIES: ReadonlySet<string> = new Set(['onPermission', 'onResult', 'onExit']);

export interface ReplayState {
  events: RecordedEvent[];
  cursor: number;
}

export function createReplayState(text: string): ReplayState {
  return { events: parseFixture(text), cursor: 0 };
}

/** Drain events up to and including the next boundary method (or end of queue). Advances the cursor. */
export function nextBatch(state: ReplayState, boundaries: ReadonlySet<string> = BATCH_BOUNDARIES): RecordedEvent[] {
  const batch: RecordedEvent[] = [];
  while (state.cursor < state.events.length) {
    const ev = state.events[state.cursor];
    state.cursor++;
    if (!ev) break;
    batch.push(ev);
    if (boundaries.has(ev.method)) break;
  }
  return batch;
}

/** Skip forward to (and including) the next onResult/onExit. */
export function skipToResult(state: ReplayState): RecordedEvent[] {
  const batch: RecordedEvent[] = [];
  while (state.cursor < state.events.length) {
    const ev = state.events[state.cursor];
    state.cursor++;
    if (!ev) break;
    batch.push(ev);
    if (ev.method === 'onResult' || ev.method === 'onExit') break;
  }
  return batch;
}

export function isExhausted(state: ReplayState): boolean {
  return state.cursor >= state.events.length;
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
import { appendFileSync, mkdirSync } from 'node:fs';
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
import { fixtureFileName } from './recording-format.js';
import { createChildLogger } from '../logger.js';

const log = createChildLogger('e2e:record');

/**
 * Replaces the registered `claude` adapter with a Proxy that injects a
 * RecordingSink at spawn time, writing one NDJSON fixture per session.
 * Only called when E2E_MODE==='record'. Production never enters this path.
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
          const session = target.createSession(options);
          const index = indexByKey.get(key) ?? 0;
          indexByKey.set(key, index + 1);
          const file = join(dir, fixtureFileName(key, index));
          return wrapSession(session, file);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as Adapter;

  adapters.register(wrapped);
  log.info({ key, dir }, 'Claude adapter wrapped for E2E recording');
}

function wrapSession(session: AdapterSession, file: string): AdapterSession {
  return new Proxy(session, {
    get(target, prop, receiver) {
      if (prop === 'spawn') {
        return (options?: SessionSpawnOptions, sink?: SessionSink): Promise<AdapterProcess> => {
          const recordingSink = sink
            ? createRecordingSink(sink, {
                write: (e) => appendFileSync(file, JSON.stringify(e) + '\n'),
                now: () => Date.now(),
              })
            : sink;
          return target.spawn(options, recordingSink);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  }) as AdapterSession;
}
```

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
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "target": "es2022",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src"]
}
```

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
  method: string;
  args: unknown[];
  delayMs: number;
}

const BOUNDARIES = new Set(['onPermission', 'onResult', 'onExit']);

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

export function nextBatch(state: ReplayState): RecordedEvent[] {
  const batch: RecordedEvent[] = [];
  while (state.cursor < state.events.length) {
    const ev = state.events[state.cursor];
    state.cursor++;
    if (!ev) break;
    batch.push(ev);
    if (BOUNDARIES.has(ev.method)) break;
  }
  return batch;
}

export function skipToResult(state: ReplayState): RecordedEvent[] {
  const batch: RecordedEvent[] = [];
  while (state.cursor < state.events.length) {
    const ev = state.events[state.cursor];
    state.cursor++;
    if (!ev) break;
    batch.push(ev);
    if (ev.method === 'onResult' || ev.method === 'onExit') break;
  }
  return batch;
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
import { createReplayState, nextBatch, skipToResult, type ReplayState, type RecordedEvent } from './fixture';

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
    this.emit(nextBatch(this.state));
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
    this.emit(nextBatch(this.state));
  }
  async respondToPermission(_response: ControlResponse): Promise<void> {
    this.emit(nextBatch(this.state));
  }
  async interrupt(): Promise<void> {
    this.emit(skipToResult(this.state));
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
import { mkdtempSync, rmSync, openSync, closeSync, mkdirSync, symlinkSync } from 'fs';
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
    symlinkSync(MOCK_PLUGIN_DIR, path.join(pluginsDir, 'mock-cli'), 'dir');
  }
```

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

Add to `packages/e2e/package.json` `scripts`:

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

Run: `head -5 packages/e2e/fixtures/recordings/permissions-interactive.0.ndjson`
Expected: NDJSON lines beginning with `{"method":"onInit"...` and including at least one `{"method":"onPermission"...`. If it's empty or has no `onPermission`, re-record (Step 3).

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
- Generic proxy fixture format → Tasks 1–2 (RecordingSink), 3/6 (replay). ✓
- mock-cli external plugin (manifest, adapter, session, build) → Tasks 5–7. ✓
- Single production hook → Task 4 (E2E_MODE block); plus the documented `getDataDir()` alignment (changeset in Task 10). ✓
- Per-session-index keying → `indexByKey` in record-wrapper (Task 4) and MockCliAdapter (Task 7), keyed by `E2E_RECORDING_KEY` (the random-temp-path fix). ✓
- delayMs honored → `ReplaySession.emit` (Task 7). ✓
- Missing fixture → clear throw; exhaustion handled by empty batches → Task 7. ✓
- First milestone = 06-permissions Interactive → Task 9. ✓
- Unit tests for recording + replay → Tasks 1–3. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code. ✓

**Type consistency:** `RecordedEvent {method,args,delayMs}` identical in core (`recording-format.ts`) and plugin (`fixture.ts`). `createRecordingSink(real, {write, now})` signature matches its test and the record-wrapper call. `nextBatch`/`skipToResult` names match between core `replay-core.ts`, its tests, and the plugin `fixture.ts` + `session.ts`. `wrapClaudeForRecording(adapters)` matches the index.ts call. `launchApp({recordingKey})` matches the 06-permissions call. ✓

**Known deviation from the design doc:** the design said "spec files unchanged"; in practice each *recorded* spec needs a one-line `recordingKey` in its `beforeAll` (random temp project paths can't be the fixture key). Non-recorded specs are untouched. Documented in Task 9 and COVERAGE-GAPS (Task 10).
