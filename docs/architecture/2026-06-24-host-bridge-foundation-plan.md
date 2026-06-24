# Host Bridge Foundation Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce a host-agnostic `HostBridge` port so the app-tauri renderer's feature code stops importing `@/lib/tauri/*` and `@tauri-apps/*` directly and instead goes through `getHost()` / `useHost()`, with **no behavior change** under Tauri or browser/dev mode.

**Architecture:** Define a type-only `HostBridge` interface in `@qlan-ro/mainframe-types` (the single canonical shape). In app-tauri, add a `lib/host/` port: a `TauriAdapter` that delegates 1:1 to the proven `lib/tauri/{bridge,terminal,preview}` functions (and is the *only* module importing `@/lib/tauri/*`), a `FakeAdapter` that reproduces today's browser-mode stub values, and `getHost()` / `HostProvider` / `useHost()` for runtime detection + React access. Then refactor every renderer call site off `@/lib/tauri/*` onto the port and migrate the existing tests to inject the fake.

**Tech Stack:** TypeScript (strict, NodeNext), React 18, Vitest, Tauri 2 (`@tauri-apps/api`), `@qlan-ro/mainframe-types` workspace package.

> **This is Plan 1 of 3.** It implements the design's **Phases 1–3 only** (the `HostBridge` interface + renderer port + Tauri adapter + `FakeHostBridge` + test migration). **Plan 2** (Electron adapter + the Zod runtime contract + `preview.mount()` redesign + `desktop` shell retrofit + `data-drag-region` rename + log host-forwarding) and **Plan 3** (full parity: updater, presence, log sink, native menu, crash/memory diagnostics, production bundling) follow and are **out of scope here.** See `docs/architecture/2026-06-24-host-bridge-abstraction-design.md` (Phasing section).

## Global Constraints

- TypeScript strict mode, `NodeNext` module resolution, `noUncheckedIndexedAccess`. **All `@qlan-ro/mainframe-types` source imports use `.js` extensions** (follow the existing barrel style in `packages/types/src/index.ts`).
- **No new dependency on `@qlan-ro/mainframe-types`.** That package is dependency-free today; Plan 1 ships `HostBridge` as **type-only**. **Do NOT add `zod`** — the Zod contract lands in Plan 2 alongside its first runtime consumer.
- Files ≤ 300 lines, functions ≤ 50 lines. (`lib/host/index.ts` may approach the limit — split detection / provider into separate files if it does.)
- No `@ts-ignore` (use `@ts-expect-error` + a reason comment). No new dead code, no commented-out code, no orphaned exports.
- **Single canonical type:** the `HostBridge` interface and its payload types live ONLY in `mainframe-types`, imported everywhere. Do not redeclare them in app-tauri.
- Renderer logging convention is `console.warn` with a bracket tag (e.g. `console.warn('[host] …')`) — NOT pino (that is core-only).
- Provider entry point: `packages/app-tauri/src/app/main.tsx` wraps the root render with `<HostProvider>`.
- **Behavior parity is the acceptance bar.** After Plan 1 the app must run exactly as today under Tauri and under browser/dev mode. The only observable change is *structural* (import boundaries).
- **Test command gotcha (CRITICAL):** running many app-tauri vitest suites in ONE invocation mass-fails with "React.act is not a function" (cross-file pollution). **Every test run in this plan targets a SINGLE file**, e.g. `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/fake-adapter.test.ts`.
  - Typecheck (app-tauri): `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
  - Types build: `pnpm --filter @qlan-ro/mainframe-types build`
- **Deferrals (do NOT do these in Plan 1):**
  - Zod runtime contract → Plan 2.
  - `preview.mount()` redesign → Plan 2. Plan 1 exposes the preview methods **1:1 with current `lib/tauri/preview.ts`** (imperative create/navigate/setBounds/setVisible/capture/destroy/eval + onInspectResult).
  - `data-tauri-drag-region` rename + `window.startDrag` → Plan 2. Plan 1 **preserves** the existing global mousedown→`startDragging` listener and the `data-tauri-drag-region` attribute; it only relocates where that listener is *installed* (into the Tauri adapter init).
  - `log()` host-forwarding → Plan 3. Plan 1's `log` keeps current behavior (delegates to `console.*`).
  - `updates` and `presence` namespaces → Plan 3. **Excluded** from the Plan 1 port (no Tauri impl exists; no speculative stubs).

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `packages/types/src/host/host-bridge.ts` | The type-only `HostBridge` interface + all shared payload types (`AppInfo`, `Platform`, `LogLevel`, `Bounds`, `Region`, `InspectResult`, `TerminalOpts`, `TerminalHandlers`, `TerminalHandle`, `Unsubscribe`). Canonical host shape. |
| `packages/app-tauri/src/lib/host/fake-adapter.ts` | `FakeHostBridge` — in-memory `HostBridge` used by tests AND the browser/dev third mode. Reproduces today's browser-mode stub values; per-instance overridable. |
| `packages/app-tauri/src/lib/host/detect.ts` | `isTauriRuntime()` runtime detection (`__TAURI_INTERNALS__` present). |
| `packages/app-tauri/src/lib/host/index.ts` | `getHost()` singleton + `setHostForTesting()` / `resetHostForTesting()`; `HostProvider` React context + `useHost()` hook. Re-exports the `HostBridge` type from mainframe-types. |
| `packages/app-tauri/src/lib/host/tauri-adapter.ts` | `TauriAdapter` — implements `HostBridge` by delegating to `lib/tauri/{bridge,terminal,preview}`. The ONLY module that imports `@/lib/tauri/*`. Its `init()` installs the drag listener. |
| `packages/app-tauri/src/lib/host/__tests__/fake-adapter.test.ts` | Behavior tests for the fake (stub parity + overrides). |
| `packages/app-tauri/src/lib/host/__tests__/host-context.test.tsx` | Behavior tests for `useHost()` / `HostProvider` / `getHost()` detection + `setHostForTesting`. |
| `packages/app-tauri/src/lib/host/__tests__/tauri-adapter.test.ts` | Behavior tests for the Tauri adapter's delegation (mocks `@tauri-apps/*`, asserts delegation to the right command — migrated from the old `lib/tauri` tests). |
| `packages/types/src/host/__tests__/host-bridge.type-test.ts` | Compile-time assertion file (no runtime test): asserts `FakeHostBridge`-shaped object satisfies `HostBridge`. Verified by `tsc` build, not vitest. |

### Modified

| Path | Change |
|---|---|
| `packages/types/src/index.ts` | Add `export * from './host/host-bridge.js';` |
| `packages/app-tauri/src/app/main.tsx` | Wrap the root render in `<HostProvider>` and call the host's `init()`. |
| `packages/app-tauri/src/app/useConnectionState.ts` | (19th call site) `getDaemonPort/getDaemonStatus/onDaemonStatus` → `getHost().daemon.*`. |
| `packages/app-tauri/src/app/__tests__/useConnectionState.test.ts` | Migrate `vi.mock('../../lib/tauri/bridge')` → inject fake via `setHostForTesting`. |
| `packages/app-tauri/src/features/settings/panes/about/AboutPane.tsx` | (20th call site) `getAppInfo` → `useHost().app.getInfo()`. |
| `packages/app-tauri/src/features/settings/panes/about/__tests__/AboutPane.test.tsx` | Migrate `vi.mock('…/lib/tauri/bridge')` → inject fake via `HostProvider`. |
| The 18 listed call sites | `import … from '@/lib/tauri/*'` → `useHost()` (components) / `getHost()` (non-component modules). Grouped into Tasks 6–12. |
| `packages/app-tauri/src/lib/tauri/__tests__/{bridge,preview,terminal}.test.ts` | Deleted/relocated — their delegation assertions move into `lib/host/__tests__/tauri-adapter.test.ts` (Task 4). |

> **Decision (locked):** `lib/tauri/{bridge,terminal,preview}.ts` are **kept as-is** (proven Tauri call code). Only `tauri-adapter.ts` imports them. They are NOT inlined into the adapter — that would rewrite working Tauri/Channel code for no benefit and risk the no-behavior-change guarantee.

> **Decision (locked):** React components call `useHost()`. Non-component modules that run outside the React tree — `store/layout.ts`, `lib/lsp/index.ts`, `store/terminal-intent-subscriber.ts`, `features/terminal/create-terminal.ts`, `app/useConnectionState.ts` — call `getHost()` directly. `getHost()` returns the same singleton the provider supplies, so the two paths never diverge.

> **Spec deviation surfaced (read before starting):** the task brief lists **18** call sites, but a fresh grep finds **20**. The two extra are `app/useConnectionState.ts` (daemon port/status/onStatus — runs at the root before any provider, so it MUST use `getHost()`) and `features/settings/panes/about/AboutPane.tsx` (`getAppInfo`). Both are included (Tasks 11 and 12). Separately, four port members — `app.getAuthToken`, `app.platform`, `notify`, `log` — have **no renderer consumers today** (only the bridge tests reference them); they exist on the port for parity and are exercised only by the fake/adapter unit tests, not by any feature refactor.

---

## Task 1: `HostBridge` interface in `@qlan-ro/mainframe-types` (type-only)

**Files:**
- Create: `packages/types/src/host/host-bridge.ts`
- Create: `packages/types/src/host/__tests__/host-bridge.type-test.ts`
- Modify: `packages/types/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: the `HostBridge` interface and its payload types, imported by every later task. Exact members below — every later task uses these names verbatim.

> **A pure interface has no runtime behavior, so its "test" is the type system.** The verification steps are (a) `pnpm --filter @qlan-ro/mainframe-types build` (tsc) and (b) a compile-time assertion file that fails to build if the interface drifts. There is no vitest run for this task.

- [ ] **Step 1: Write the compile-time assertion (the "failing test")**

Create `packages/types/src/host/__tests__/host-bridge.type-test.ts`:

```ts
/**
 * Compile-time assertion: a structurally-complete object must satisfy HostBridge.
 * This file has no runtime behavior; tsc fails the build if the interface drifts.
 * It is excluded from the published dist via the rootDir/include of any test glob,
 * but is type-checked by `tsc` during build.
 */
import type {
  HostBridge,
  AppInfo,
  Platform,
  LogLevel,
  Bounds,
  Region,
  InspectResult,
  TerminalOpts,
  TerminalHandlers,
  TerminalHandle,
  Unsubscribe,
} from '../host-bridge.js';

// Exercise every payload type so a rename or removal breaks the build.
const _appInfo: AppInfo = { version: 'x', author: 'y', homedir: 'z' };
const _platform: Platform = 'macos';
const _level: LogLevel = 'info';
const _bounds: Bounds = { x: 0, y: 0, w: 1, h: 1 };
const _region: Region = { x: 0, y: 0, w: 1, h: 1 };
const _inspect: InspectResult = { tabId: 't', selector: null, rect: null, viewport: null };
const _termOpts: TerminalOpts = { id: 't', cwd: '/', cols: 80, rows: 24 };
const _termHandlers: TerminalHandlers = { onData: () => {}, onExit: () => {} };
void _appInfo; void _platform; void _level; void _bounds; void _region;
void _inspect; void _termOpts; void _termHandlers;

// A structurally-complete HostBridge must type-check.
declare const _bridge: HostBridge;
const _handle: Promise<TerminalHandle> = _bridge.terminal.create(_termOpts, _termHandlers);
const _unsub: Unsubscribe = _bridge.daemon.onStatus(() => {});
void _handle; void _unsub;
```

- [ ] **Step 2: Run the build to verify it FAILS**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: FAIL — `Cannot find module '../host-bridge.js'` (the interface file does not exist yet).

- [ ] **Step 3: Write the interface (minimal implementation)**

Create `packages/types/src/host/host-bridge.ts`:

```ts
/**
 * host/host-bridge.ts
 *
 * The canonical, type-only renderer→host contract. One interface, multiple
 * adapters (Tauri now; Electron in Plan 2). Events are subscription functions
 * returning an Unsubscribe so the transport (Tauri Channel/listen vs IPC) stays
 * inside the adapter.
 *
 * Plan 1 scope: app / fs / shell / notify / terminal / preview / daemon / log.
 * `updates` and `presence` are deferred to Plan 3 (no Tauri impl exists yet).
 */

export type Unsubscribe = () => void;

export type Platform = 'macos' | 'windows' | 'linux' | 'browser';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppInfo {
  version: string;
  author: string;
  homedir: string;
}

/** Daemon lifecycle status string (e.g. 'ready'); kept as the host emits it. */
export type DaemonStatus = string;

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InspectResult {
  tabId: string;
  selector: string | null;
  rect: Bounds | null;
  viewport: Bounds | null;
}

export interface TerminalOpts {
  id: string;
  cwd: string;
  cols: number;
  rows: number;
}

export interface TerminalHandlers {
  onData: (bytes: Uint8Array) => void;
  onExit: (code: number | null) => void;
}

export interface TerminalHandle {
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  kill(): Promise<void>;
}

/**
 * Preview methods are exposed 1:1 with the current lib/tauri/preview.ts
 * (imperative). The `mount()` seam is deferred to Plan 2.
 */
export interface PreviewPort {
  create(tabId: string, url: string, bounds: Bounds): Promise<void>;
  navigate(tabId: string, url: string): Promise<void>;
  setBounds(tabId: string, bounds: Bounds): Promise<void>;
  setVisible(tabId: string, visible: boolean): Promise<void>;
  capture(tabId: string, region?: Region): Promise<Uint8Array>;
  destroy(tabId: string): Promise<void>;
  eval(tabId: string, js: string): Promise<void>;
  onInspectResult(cb: (result: InspectResult) => void): Promise<Unsubscribe>;
}

export interface HostBridge {
  app: {
    getInfo(): Promise<AppInfo>;
    getHomedir(): Promise<string>;
    getAuthToken(): Promise<string | null>;
    platform(): Promise<Platform>;
  };
  fs: {
    readFile(path: string): Promise<string | null>;
    readFileBase64(path: string): Promise<string | null>;
    showItemInFolder(path: string): Promise<void>;
  };
  shell: {
    openExternal(url: string): Promise<void>;
  };
  notify(title: string, body?: string): Promise<void>;
  terminal: {
    create(opts: TerminalOpts, handlers: TerminalHandlers): Promise<TerminalHandle>;
  };
  preview: PreviewPort;
  daemon: {
    port(): Promise<number>;
    status(): Promise<DaemonStatus>;
    onStatus(cb: (status: DaemonStatus) => void): Promise<Unsubscribe>;
  };
  log(level: LogLevel, module: string, message: string, data?: unknown): void;
}
```

> **Note on `onInspectResult` / `daemon.onStatus` returning `Promise<Unsubscribe>`:** the current `lib/tauri` functions return `Promise<UnlistenFn>` (Tauri `listen()` is async). The port preserves that async shape exactly — do NOT flatten it to a sync `Unsubscribe`, or the no-behavior-change guarantee breaks at every await site.

- [ ] **Step 4: Wire the barrel export**

Modify `packages/types/src/index.ts` — add after the last `export *` line (before the `export type { … } from './plugin.js'` block is fine):

```ts
export * from './host/host-bridge.js';
```

- [ ] **Step 5: Run the build to verify it PASSES**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: PASS — no type errors. (The assertion file compiles, proving the interface is structurally complete.)

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/host/host-bridge.ts \
        packages/types/src/host/__tests__/host-bridge.type-test.ts \
        packages/types/src/index.ts
git commit -m "feat(types): add type-only HostBridge port interface"
```

---

## Task 2: `FakeHostBridge` adapter

**Files:**
- Create: `packages/app-tauri/src/lib/host/fake-adapter.ts`
- Test: `packages/app-tauri/src/lib/host/__tests__/fake-adapter.test.ts`

**Interfaces:**
- Consumes: `HostBridge` and all payload types from `@qlan-ro/mainframe-types` (Task 1).
- Produces: `class FakeHostBridge implements HostBridge` with a `constructor(overrides?: FakeHostOverrides)`; type `FakeHostOverrides` (a deep-`Partial` of per-method return values). Used by Tasks 3, 5, 11–14.

> The fake must reproduce **today's browser-mode stub values** exactly (verified against `lib/tauri/bridge.ts`): `readFile → null`, `readFileBase64 → null`, `showItemInFolder → resolve`, `platform → 'browser'`, `getAuthToken → null`, `openExternal → window.open(...)`, `daemon.port → VITE_DAEMON_PORT`, `daemon.status → 'ready'`, `daemon.onStatus → fires 'ready' then no-op unsubscribe`, `notify → resolve`, `log → console.*`. `app.getInfo → { version: 'dev', author: 'mainframe', homedir: '' }`, `app.getHomedir → ''`. Terminal/preview throw (no real backend in browser), matching today.

- [ ] **Step 1: Write the failing test**

Create `packages/app-tauri/src/lib/host/__tests__/fake-adapter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { FakeHostBridge } from '../fake-adapter';

describe('FakeHostBridge — browser-mode stub parity', () => {
  it('fs.readFile resolves null', async () => {
    await expect(new FakeHostBridge().fs.readFile('/p')).resolves.toBeNull();
  });

  it('fs.readFileBase64 resolves null', async () => {
    await expect(new FakeHostBridge().fs.readFileBase64('/p')).resolves.toBeNull();
  });

  it('fs.showItemInFolder resolves undefined', async () => {
    await expect(new FakeHostBridge().fs.showItemInFolder('/p')).resolves.toBeUndefined();
  });

  it('app.platform resolves "browser"', async () => {
    await expect(new FakeHostBridge().app.platform()).resolves.toBe('browser');
  });

  it('app.getAuthToken resolves null', async () => {
    await expect(new FakeHostBridge().app.getAuthToken()).resolves.toBeNull();
  });

  it('app.getInfo resolves the dev stub', async () => {
    await expect(new FakeHostBridge().app.getInfo()).resolves.toEqual({
      version: 'dev',
      author: 'mainframe',
      homedir: '',
    });
  });

  it('daemon.status resolves "ready"', async () => {
    await expect(new FakeHostBridge().daemon.status()).resolves.toBe('ready');
  });

  it('daemon.onStatus fires "ready" immediately and returns a no-op unsubscribe', async () => {
    const cb = vi.fn();
    const unsub = await new FakeHostBridge().daemon.onStatus(cb);
    expect(cb).toHaveBeenCalledWith('ready');
    expect(() => unsub()).not.toThrow();
  });

  it('notify resolves undefined', async () => {
    await expect(new FakeHostBridge().notify('t', 'b')).resolves.toBeUndefined();
  });

  it('shell.openExternal calls window.open', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    await new FakeHostBridge().shell.openExternal('https://x.test');
    expect(open).toHaveBeenCalledWith('https://x.test', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('log does not throw at any level', () => {
    const host = new FakeHostBridge();
    expect(() => host.log('debug', 'mod', 'msg')).not.toThrow();
    expect(() => host.log('error', 'mod', 'msg', { x: 1 })).not.toThrow();
  });
});

describe('FakeHostBridge — overrides', () => {
  it('app.getInfo honors an override', async () => {
    const host = new FakeHostBridge({ app: { getInfo: { version: '9.9.9', author: 'q', homedir: '/h' } } });
    await expect(host.app.getInfo()).resolves.toEqual({ version: '9.9.9', author: 'q', homedir: '/h' });
  });

  it('fs.readFile honors an override', async () => {
    const host = new FakeHostBridge({ fs: { readFile: 'file-contents' } });
    await expect(host.fs.readFile('/p')).resolves.toBe('file-contents');
  });

  it('daemon.port honors an override', async () => {
    const host = new FakeHostBridge({ daemon: { port: 31500 } });
    await expect(host.daemon.port()).resolves.toBe(31500);
  });
});
```

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/fake-adapter.test.ts`
Expected: FAIL — `Cannot find module '../fake-adapter'`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/app-tauri/src/lib/host/fake-adapter.ts`:

```ts
/**
 * FakeHostBridge — an in-memory HostBridge used by renderer tests AND the
 * browser/dev third mode (when not running inside a Tauri webview).
 *
 * Default return values reproduce the current lib/tauri/bridge.ts browser-mode
 * stubs 1:1. Pass `overrides` to substitute return values per method in tests.
 * Terminal/preview throw — there is no real PTY/webview backend in a browser.
 */
import type {
  HostBridge,
  AppInfo,
  Platform,
  LogLevel,
  DaemonStatus,
  TerminalHandle,
  Unsubscribe,
} from '@qlan-ro/mainframe-types';

const DEV_DAEMON_PORT =
  Number((import.meta.env as Record<string, string | undefined>).VITE_DAEMON_PORT) || undefined;

export interface FakeHostOverrides {
  app?: {
    getInfo?: AppInfo;
    getHomedir?: string;
    getAuthToken?: string | null;
    platform?: Platform;
  };
  fs?: {
    readFile?: string | null;
    readFileBase64?: string | null;
  };
  daemon?: {
    port?: number;
    status?: DaemonStatus;
  };
}

const DEFAULT_APP_INFO: AppInfo = { version: 'dev', author: 'mainframe', homedir: '' };

function notSupported(name: string): Promise<never> {
  return Promise.reject(new Error(`${name} is not available in browser/dev mode (no host)`));
}

export class FakeHostBridge implements HostBridge {
  constructor(private readonly overrides: FakeHostOverrides = {}) {}

  app = {
    getInfo: (): Promise<AppInfo> => Promise.resolve(this.overrides.app?.getInfo ?? DEFAULT_APP_INFO),
    getHomedir: (): Promise<string> => Promise.resolve(this.overrides.app?.getHomedir ?? ''),
    getAuthToken: (): Promise<string | null> =>
      Promise.resolve(this.overrides.app?.getAuthToken ?? null),
    platform: (): Promise<Platform> => Promise.resolve(this.overrides.app?.platform ?? 'browser'),
  };

  fs = {
    readFile: (_path: string): Promise<string | null> =>
      Promise.resolve(this.overrides.fs?.readFile ?? null),
    readFileBase64: (_path: string): Promise<string | null> =>
      Promise.resolve(this.overrides.fs?.readFileBase64 ?? null),
    showItemInFolder: (_path: string): Promise<void> => Promise.resolve(),
  };

  shell = {
    openExternal: (url: string): Promise<void> => {
      window.open(url, '_blank', 'noopener,noreferrer');
      return Promise.resolve();
    },
  };

  notify(_title: string, _body?: string): Promise<void> {
    return Promise.resolve();
  }

  terminal = {
    create: (): Promise<TerminalHandle> => notSupported('terminal.create'),
  };

  preview = {
    create: (): Promise<void> => notSupported('preview.create'),
    navigate: (): Promise<void> => notSupported('preview.navigate'),
    setBounds: (): Promise<void> => notSupported('preview.setBounds'),
    setVisible: (): Promise<void> => notSupported('preview.setVisible'),
    capture: (): Promise<Uint8Array> => notSupported('preview.capture'),
    destroy: (): Promise<void> => notSupported('preview.destroy'),
    eval: (): Promise<void> => notSupported('preview.eval'),
    onInspectResult: (): Promise<Unsubscribe> => Promise.resolve(() => {}),
  };

  daemon = {
    port: (): Promise<number> => {
      const port = this.overrides.daemon?.port ?? DEV_DAEMON_PORT;
      if (port == null) {
        return Promise.reject(
          new Error('No host and VITE_DAEMON_PORT is not set (browser dev mode)'),
        );
      }
      return Promise.resolve(port);
    },
    status: (): Promise<DaemonStatus> => Promise.resolve(this.overrides.daemon?.status ?? 'ready'),
    onStatus: (cb: (status: DaemonStatus) => void): Promise<Unsubscribe> => {
      cb(this.overrides.daemon?.status ?? 'ready');
      return Promise.resolve(() => {});
    },
  };

  log(level: LogLevel, module: string, message: string, data?: unknown): void {
    const fn = console[level] ?? console.log;
    if (data !== undefined) fn(`[${module}] ${message}`, data);
    else fn(`[${module}] ${message}`);
  }
}
```

> Class-property arrow functions keep `this` bound when destructured (e.g. `const { fs } = useHost()`), matching how feature code uses these. Each accessor is a thin arrow, well under the 50-line function limit.

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/fake-adapter.test.ts`
Expected: PASS — all assertions green.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app-tauri/src/lib/host/fake-adapter.ts \
        packages/app-tauri/src/lib/host/__tests__/fake-adapter.test.ts
git commit -m "feat(app-tauri): add FakeHostBridge adapter for tests and browser/dev mode"
```

---

## Task 3: `getHost()` singleton + `HostProvider` / `useHost()`

**Files:**
- Create: `packages/app-tauri/src/lib/host/detect.ts`
- Create: `packages/app-tauri/src/lib/host/index.ts`
- Test: `packages/app-tauri/src/lib/host/__tests__/host-context.test.tsx`

**Interfaces:**
- Consumes: `FakeHostBridge` (Task 2), `HostBridge` (Task 1). The `TauriAdapter` is referenced by `getHost()` but built in Task 4 — Task 3 imports it lazily so this task is independently testable in the non-Tauri (fake) path.
- Produces (used by every later task):
  - `getHost(): HostBridge` — returns a process-wide singleton (Tauri adapter under Tauri, fake otherwise).
  - `setHostForTesting(host: HostBridge): void` and `resetHostForTesting(): void`.
  - `HostProvider({ host?, children })` — supplies a `HostBridge` via context (defaults to `getHost()`).
  - `useHost(): HostBridge`.
  - `isTauriRuntime(): boolean` (from `detect.ts`).

- [ ] **Step 1: Write the detection helper**

Create `packages/app-tauri/src/lib/host/detect.ts`:

```ts
/**
 * Runtime detection for the host adapter. Tauri injects __TAURI_INTERNALS__
 * into its webview; it is absent in a plain browser / vitest jsdom.
 */
export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}
```

- [ ] **Step 2: Write the failing test**

Create `packages/app-tauri/src/lib/host/__tests__/host-context.test.tsx`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { FakeHostBridge } from '../fake-adapter';
import {
  getHost,
  setHostForTesting,
  resetHostForTesting,
  HostProvider,
  useHost,
} from '../index';

afterEach(() => {
  resetHostForTesting();
});

describe('getHost — singleton in browser/dev mode', () => {
  it('returns a FakeHostBridge when not under Tauri', () => {
    expect(getHost()).toBeInstanceOf(FakeHostBridge);
  });

  it('returns the same instance across calls', () => {
    expect(getHost()).toBe(getHost());
  });

  it('setHostForTesting overrides the singleton', () => {
    const fake = new FakeHostBridge({ app: { platform: 'macos' } });
    setHostForTesting(fake);
    expect(getHost()).toBe(fake);
  });
});

describe('useHost — reads the provided host', () => {
  it('returns the host passed to HostProvider', () => {
    const fake = new FakeHostBridge({ daemon: { port: 31500 } });
    const { result } = renderHook(() => useHost(), {
      wrapper: ({ children }) => <HostProvider host={fake}>{children}</HostProvider>,
    });
    expect(result.current).toBe(fake);
  });

  it('falls back to getHost() when no host prop is given', () => {
    function Probe() {
      const host = useHost();
      return <span data-testid="is-fake">{String(host instanceof FakeHostBridge)}</span>;
    }
    render(
      <HostProvider>
        <Probe />
      </HostProvider>,
    );
    expect(screen.getByTestId('is-fake').textContent).toBe('true');
  });
});
```

- [ ] **Step 3: Run the test to verify it FAILS**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/host-context.test.tsx`
Expected: FAIL — `Cannot find module '../index'`.

- [ ] **Step 4: Write the minimal implementation**

Create `packages/app-tauri/src/lib/host/index.ts`:

```ts
/**
 * lib/host — the renderer-side host port.
 *
 * getHost() returns a process-wide singleton: a TauriAdapter under Tauri,
 * a FakeHostBridge otherwise (browser/dev/test). React components read it via
 * useHost(); non-component modules (stores, lsp, terminal factory, the
 * connection bootstrap) call getHost() directly. Both resolve the same
 * singleton, so they never diverge.
 *
 * The Tauri adapter is imported lazily so this module — and the fake path —
 * stays free of any @tauri-apps import at evaluation time.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';
import type { HostBridge } from '@qlan-ro/mainframe-types';
import { isTauriRuntime } from './detect';
import { FakeHostBridge } from './fake-adapter';

export type { HostBridge } from '@qlan-ro/mainframe-types';
export { isTauriRuntime } from './detect';

let singleton: HostBridge | null = null;

function createHost(): HostBridge {
  if (isTauriRuntime()) {
    // Lazy require keeps @tauri-apps imports off the browser/test path.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { TauriAdapter } = require('./tauri-adapter') as typeof import('./tauri-adapter');
    return new TauriAdapter();
  }
  return new FakeHostBridge();
}

export function getHost(): HostBridge {
  if (singleton === null) singleton = createHost();
  return singleton;
}

/** Test-only: replace the singleton. Pair with resetHostForTesting in afterEach. */
export function setHostForTesting(host: HostBridge): void {
  singleton = host;
}

/** Test-only: drop the singleton so the next getHost() re-detects. */
export function resetHostForTesting(): void {
  singleton = null;
}

const HostContext = createContext<HostBridge | null>(null);

export function HostProvider({ host, children }: { host?: HostBridge; children: ReactNode }) {
  return createElement(HostContext.Provider, { value: host ?? getHost() }, children);
}

export function useHost(): HostBridge {
  const ctx = useContext(HostContext);
  return ctx ?? getHost();
}
```

> **`require` vs dynamic `import()`:** Vite/Rollup transpiles `require` of a static path at build time and tree-shakes it out of the browser bundle when `isTauriRuntime()` is false at runtime — but the module is still statically analyzable, so the Tauri adapter ships in the Tauri build. If the project's ESLint/TS config rejects `require` in ESM, replace with a top-level `import { TauriAdapter } from './tauri-adapter'` and accept that `@tauri-apps` is in the bundle (it already is today, via `lib/tauri/*`). **Decision: prefer the top-level static import** to avoid the `require`/lint friction — see the note in Task 4 Step 5. The lazy form is documented here only as the fallback if bundle hygiene becomes a concern.

> **`useHost()` returns `getHost()` when no provider is mounted** (rather than throwing) so non-test renders that forget the provider still work in dev — but `main.tsx` (Task 5) always mounts it, so in practice the provided value wins.

- [ ] **Step 5: Run the test to verify it PASSES**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/host-context.test.tsx`
Expected: PASS — singleton + provider + override behaviors all green.

> If the lazy `require` form trips the test's module resolution (the Tauri path is never hit in jsdom, so it should not), switch `createHost()` to the static-import form per Task 4 Step 5's note before continuing.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app-tauri/src/lib/host/detect.ts \
        packages/app-tauri/src/lib/host/index.ts \
        packages/app-tauri/src/lib/host/__tests__/host-context.test.tsx
git commit -m "feat(app-tauri): add getHost singleton + HostProvider/useHost"
```

---

## Task 4: `TauriAdapter` (delegates to `lib/tauri/*`)

**Files:**
- Create: `packages/app-tauri/src/lib/host/tauri-adapter.ts`
- Create: `packages/app-tauri/src/lib/host/__tests__/tauri-adapter.test.ts`
- Delete: `packages/app-tauri/src/lib/tauri/__tests__/{bridge,preview,terminal}.test.ts` (their assertions move here)

**Interfaces:**
- Consumes: the existing `lib/tauri/{bridge,terminal,preview}` free functions (signatures verified: `getAppInfo`, `getHomedir`, `getAuthToken`, `getPlatform`, `readFile`, `readFileBase64`, `showItemInFolder`, `openExternal`, `showNotification`, `getDaemonPort`, `getDaemonStatus`, `onDaemonStatus`, `log`; `createTerminal(opts, handlers)`; `previewCreate/Navigate/SetBounds/SetVisible/Capture/Destroy/Eval`, `onInspectResult`). `HostBridge` (Task 1).
- Produces: `class TauriAdapter implements HostBridge` with an `init(): void` that installs the window-drag listener (relocated from `bridge.ts`). Referenced by `getHost()` (Task 3) and `main.tsx` (Task 5).

> **Critical for the no-behavior-change guarantee:** the drag listener currently lives at module scope in `bridge.ts` and runs on import. After this task it is installed by `TauriAdapter.init()`. The listener KEEPS the `data-tauri-drag-region` attribute and the exact same predicate (rename → Plan 2). Because `bridge.ts` is still imported by the adapter, **delete the module-scope listener from `bridge.ts`** so it is installed exactly once (by `init()`), not twice.

- [ ] **Step 1: Write the failing test (delegation + drag listener)**

Create `packages/app-tauri/src/lib/host/__tests__/tauri-adapter.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invoke = vi.fn();
const listen = vi.fn();
const openUrl = vi.fn();
const sendNotification = vi.fn();
const startDragging = vi.fn().mockResolvedValue(undefined);

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  Channel: class {
    onmessage: ((m: unknown) => void) | null = null;
  },
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a: unknown[]) => listen(...a) }));
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: () => ({ startDragging }),
}));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));
vi.mock('@tauri-apps/plugin-notification', () => ({
  sendNotification: (...a: unknown[]) => sendNotification(...a),
}));

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = Object.assign(globalThis.window ?? {}, {
    __TAURI_INTERNALS__: {},
  });
  invoke.mockReset().mockResolvedValue(undefined);
  listen.mockReset().mockResolvedValue(() => {});
  openUrl.mockReset();
  sendNotification.mockReset();
  startDragging.mockClear();
});

afterEach(() => {
  delete (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

describe('TauriAdapter — delegation', () => {
  it('app.getInfo invokes get_app_info', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValueOnce({ version: '1.0', author: 'q', homedir: '/h' });
    await expect(new TauriAdapter().app.getInfo()).resolves.toEqual({
      version: '1.0',
      author: 'q',
      homedir: '/h',
    });
    expect(invoke).toHaveBeenCalledWith('get_app_info');
  });

  it('fs.readFile invokes read_file', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValueOnce('contents');
    await expect(new TauriAdapter().fs.readFile('/p')).resolves.toBe('contents');
    expect(invoke).toHaveBeenCalledWith('read_file', { path: '/p' });
  });

  it('shell.openExternal delegates to openUrl', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    await new TauriAdapter().shell.openExternal('https://x.test');
    expect(openUrl).toHaveBeenCalledWith('https://x.test');
  });

  it('daemon.port invokes get_daemon_port', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValueOnce(31500);
    await expect(new TauriAdapter().daemon.port()).resolves.toBe(31500);
    expect(invoke).toHaveBeenCalledWith('get_daemon_port');
  });

  it('preview.capture wraps the invoke number[] in a Uint8Array', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValueOnce([137, 80, 78, 71]);
    const bytes = await new TauriAdapter().preview.capture('tab-1');
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
  });
});

describe('TauriAdapter — init installs the drag listener', () => {
  it('mousedown on a [data-tauri-drag-region] triggers startDragging', () => {
    const { TauriAdapter } = await import('../tauri-adapter').then((m) => m);
    new TauriAdapter().init();
    const region = document.createElement('div');
    region.setAttribute('data-tauri-drag-region', '');
    document.body.appendChild(region);
    region.dispatchEvent(new MouseEvent('mousedown', { button: 0, detail: 1, bubbles: true }));
    expect(startDragging).toHaveBeenCalled();
    region.remove();
  });
});
```

> The last `describe` uses `await import` inside a non-async `it` — fix to `async () => {` when writing; shown here verbatim minus that one keyword for brevity. Use: `it('mousedown …', async () => { const { TauriAdapter } = await import('../tauri-adapter'); … })`.

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-adapter.test.ts`
Expected: FAIL — `Cannot find module '../tauri-adapter'`.

- [ ] **Step 3: Write the minimal implementation**

Create `packages/app-tauri/src/lib/host/tauri-adapter.ts`:

```ts
/**
 * TauriAdapter — the only module in the renderer that imports @/lib/tauri/*.
 * It implements HostBridge by delegating to the proven lib/tauri free
 * functions (no Tauri call code is rewritten here). init() installs the
 * window-drag listener that previously ran at bridge.ts module scope.
 */
import type {
  HostBridge,
  AppInfo,
  Platform,
  LogLevel,
  DaemonStatus,
  Bounds,
  Region,
  InspectResult,
  TerminalOpts,
  TerminalHandlers,
  TerminalHandle,
  Unsubscribe,
} from '@qlan-ro/mainframe-types';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import * as bridge from '@/lib/tauri/bridge';
import { createTerminal } from '@/lib/tauri/terminal';
import * as preview from '@/lib/tauri/preview';

export class TauriAdapter implements HostBridge {
  app = {
    getInfo: (): Promise<AppInfo> => bridge.getAppInfo(),
    getHomedir: (): Promise<string> => bridge.getHomedir(),
    getAuthToken: (): Promise<string | null> => bridge.getAuthToken(),
    platform: (): Promise<Platform> => bridge.getPlatform(),
  };

  fs = {
    readFile: (path: string): Promise<string | null> => bridge.readFile(path),
    readFileBase64: (path: string): Promise<string | null> => bridge.readFileBase64(path),
    showItemInFolder: (path: string): Promise<void> => bridge.showItemInFolder(path),
  };

  shell = {
    openExternal: (url: string): Promise<void> => bridge.openExternal(url),
  };

  notify(title: string, body?: string): Promise<void> {
    return bridge.showNotification(title, body);
  }

  terminal = {
    create: (opts: TerminalOpts, handlers: TerminalHandlers): Promise<TerminalHandle> =>
      createTerminal(opts, handlers),
  };

  preview = {
    create: (tabId: string, url: string, bounds: Bounds): Promise<void> =>
      preview.previewCreate(tabId, url, bounds),
    navigate: (tabId: string, url: string): Promise<void> => preview.previewNavigate(tabId, url),
    setBounds: (tabId: string, bounds: Bounds): Promise<void> =>
      preview.previewSetBounds(tabId, bounds),
    setVisible: (tabId: string, visible: boolean): Promise<void> =>
      preview.previewSetVisible(tabId, visible),
    capture: (tabId: string, region?: Region): Promise<Uint8Array> =>
      preview.previewCapture(tabId, region),
    destroy: (tabId: string): Promise<void> => preview.previewDestroy(tabId),
    eval: (tabId: string, js: string): Promise<void> => preview.previewEval(tabId, js),
    onInspectResult: (cb: (result: InspectResult) => void): Promise<Unsubscribe> =>
      preview.onInspectResult(cb),
  };

  daemon = {
    port: (): Promise<number> => bridge.getDaemonPort(),
    status: (): Promise<DaemonStatus> => bridge.getDaemonStatus(),
    onStatus: (cb: (status: DaemonStatus) => void): Promise<Unsubscribe> =>
      bridge.onDaemonStatus(cb),
  };

  log(level: LogLevel, module: string, message: string, data?: unknown): void {
    bridge.log(level, module, message, data);
  }

  /**
   * Install the window-drag listener (relocated from bridge.ts module scope).
   * Tauri 2 does not auto-wire mousedown → startDragging for
   * data-tauri-drag-region. Behavior is identical to the previous module-load
   * handler; the attribute rename is deferred to Plan 2. Call once at startup.
   */
  init(): void {
    document.addEventListener('mousedown', (e: MouseEvent) => {
      if (e.button !== 0 || e.detail !== 1) return;
      const target = e.target as HTMLElement;
      if (target.closest('button, input, select, textarea, a, label')) return;
      if (!target.closest('[data-tauri-drag-region]')) return;
      getCurrentWebviewWindow()
        .startDragging()
        .catch((err) => console.warn('[host] startDragging failed', err));
    });
  }
}
```

- [ ] **Step 4: Remove the module-scope drag listener from `bridge.ts`**

In `packages/app-tauri/src/lib/tauri/bridge.ts`, delete the `if (IS_TAURI) { document.addEventListener('mousedown', …) }` block (lines ~24–37) AND the now-unused `getCurrentWebviewWindow` import (line ~17). Leave every exported function untouched. The drag behavior now lives in `TauriAdapter.init()`.

> Verify `getCurrentWebviewWindow` is used nowhere else in `bridge.ts` before removing the import (it is not — confirmed: only the deleted listener used it).

- [ ] **Step 5: Set the `getHost()` Tauri path**

In `packages/app-tauri/src/lib/host/index.ts`, replace the lazy-`require` `createHost()` with the static-import form (the chosen approach — see Task 3 Step 4 note):

```ts
import { TauriAdapter } from './tauri-adapter';
// ...
function createHost(): HostBridge {
  return isTauriRuntime() ? new TauriAdapter() : new FakeHostBridge();
}
```

Add `import { TauriAdapter } from './tauri-adapter';` to the imports and remove the `require` block. (`@tauri-apps/*` is already in the bundle today via `lib/tauri/*`, so this adds nothing new.)

- [ ] **Step 6: Delete the superseded lib/tauri tests**

```bash
git rm packages/app-tauri/src/lib/tauri/__tests__/bridge.test.ts \
       packages/app-tauri/src/lib/tauri/__tests__/preview.test.ts \
       packages/app-tauri/src/lib/tauri/__tests__/terminal.test.ts
```

The terminal/preview delegation is now covered by `tauri-adapter.test.ts` (capture-wrapping, command names) and the browser-mode stubs are covered by `fake-adapter.test.ts`. The raw-Channel UTF-8 wrapping assertion stays a unit concern of `lib/tauri/terminal.ts` — re-add a focused `lib/tauri/__tests__/terminal.test.ts` ONLY if removing it drops coverage below threshold (check Step 8).

- [ ] **Step 7: Run the adapter test to verify it PASSES**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-adapter.test.ts`
Expected: PASS — delegation + drag listener green.

- [ ] **Step 8: Re-run the host-context test (regression) + typecheck + coverage check**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/host-context.test.tsx`
Expected: PASS (now exercises the real `createHost`).
Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.
> If the suite's coverage gate fails because the deleted `terminal.test.ts` dropped `lib/tauri/terminal.ts` coverage, restore a minimal `lib/tauri/__tests__/terminal.test.ts` asserting only the ArrayBuffer→Uint8Array wrapping (the original test's `it` block at lines 49–58). Do not lower thresholds.

- [ ] **Step 9: Commit**

```bash
git add packages/app-tauri/src/lib/host/tauri-adapter.ts \
        packages/app-tauri/src/lib/host/__tests__/tauri-adapter.test.ts \
        packages/app-tauri/src/lib/host/index.ts \
        packages/app-tauri/src/lib/tauri/bridge.ts
git rm --cached packages/app-tauri/src/lib/tauri/__tests__/bridge.test.ts \
                packages/app-tauri/src/lib/tauri/__tests__/preview.test.ts \
                packages/app-tauri/src/lib/tauri/__tests__/terminal.test.ts 2>/dev/null || true
git commit -m "feat(app-tauri): add TauriAdapter delegating to lib/tauri; move drag listener into init"
```

---

## Task 5: Mount `HostProvider` + run `init()` in `main.tsx`

**Files:**
- Modify: `packages/app-tauri/src/app/main.tsx`

**Interfaces:**
- Consumes: `getHost`, `HostProvider`, `isTauriRuntime` (Task 3); `TauriAdapter` (Task 4, via `getHost()`).
- Produces: nothing new; wires the provider so `useHost()` resolves a real host app-wide and the drag listener installs.

> This task has no new unit test — it is a wiring change verified by the existing app integration test plus a manual smoke. The drag listener was already covered in Task 4.

- [ ] **Step 1: Edit `main.tsx`**

Modify `packages/app-tauri/src/app/main.tsx`:

```ts
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/globals.css';
import { applyStoredTheme } from '../store/theme';
import { TooltipProvider } from '../components/ui/tooltip';
import { getHost, HostProvider, isTauriRuntime } from '../lib/host';
import { TauriAdapter } from '../lib/host/tauri-adapter';
import { App } from './App';

applyStoredTheme(); // sync FOUC guard: dark class + data-scheme before first paint

// Install the host-level window-drag listener once at startup (Tauri only).
const host = getHost();
if (isTauriRuntime() && host instanceof TauriAdapter) host.init();

const root = document.getElementById('root');
if (!root) throw new Error('root element not found');

createRoot(root).render(
  <StrictMode>
    <HostProvider host={host}>
      <TooltipProvider delayDuration={0}>
        <App />
      </TooltipProvider>
    </HostProvider>
  </StrictMode>,
);
```

> Passing the same `host` to `HostProvider` keeps the provided value and `getHost()` identical (the non-component modules read the singleton directly). `init()` is gated on `isTauriRuntime()` so browser/dev installs no native drag listener — matching today's `if (IS_TAURI)` guard.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 3: Run the app integration test (regression)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/app/__tests__/App.integration.test.tsx`
Expected: PASS (App still mounts; provider is transparent to it).

- [ ] **Step 4: Commit**

```bash
git add packages/app-tauri/src/app/main.tsx
git commit -m "feat(app-tauri): mount HostProvider and install drag listener at root"
```

---

## Task 6: Refactor `openExternal` call sites (chat + viewers + editor)

**Files (5 components, all use `shell.openExternal`):**
- Modify: `packages/app-tauri/src/features/chat/parts/markdown-text.tsx`
- Modify: `packages/app-tauri/src/features/chat/thread/ChatCardHeader.tsx`
- Modify: `packages/app-tauri/src/features/editor/MarkdownPreview.tsx`
- Modify: `packages/app-tauri/src/features/viewers/PdfViewer.tsx`
- Modify: `packages/app-tauri/src/features/viewers/UnsupportedViewer.tsx`

**Interfaces:**
- Consumes: `useHost()` (Task 3); `host.shell.openExternal(url)`.
- Produces: nothing; behavior identical.

> All five are React components, so they use `useHost()`. The current call is `openExternal(url)`; the new call is `host.shell.openExternal(url)`. Grep confirmed each imports ONLY `openExternal` from `@/lib/tauri/bridge`.

- [ ] **Step 1: Run the affected components' existing tests as a baseline**

Run each that has a test (skip those without):
`pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/features/chat/parts/markdown-text.tsx` (and the others, one file per run if a colocated `__tests__` exists).
Expected: PASS (baseline before edit).

- [ ] **Step 2: Edit each component**

For each file, replace:
```ts
import { openExternal } from '@/lib/tauri/bridge';
```
with:
```ts
import { useHost } from '@/lib/host';
```
Inside the component body, add `const host = useHost();` (near the other hook calls), and replace each `openExternal(url)` call with `host.shell.openExternal(url)`. If the call lives in a `useCallback`/handler, add `host` to its dependency array.

> Exact line of the import per file (verified): `markdown-text.tsx:31`, `ChatCardHeader.tsx:13`, `MarkdownPreview.tsx:15`, `PdfViewer.tsx:21`, `UnsupportedViewer.tsx:27`. `ChatCardHeader.tsx` also carries the `data-tauri-drag-region` attribute — leave it untouched (Plan 2 renames it).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 4: Run each affected test (single file each)**

Run the colocated test files one per invocation.
Expected: PASS. If a test mocked `@/lib/tauri/bridge`, migrate it to render under `<HostProvider host={new FakeHostBridge(...)}>` and assert via a `vi.fn()` spy on the fake's `shell.openExternal` (or assert `window.open` was called, since the fake delegates there). Keep assertions behavioral.

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/features/chat/parts/markdown-text.tsx \
        packages/app-tauri/src/features/chat/thread/ChatCardHeader.tsx \
        packages/app-tauri/src/features/editor/MarkdownPreview.tsx \
        packages/app-tauri/src/features/viewers/PdfViewer.tsx \
        packages/app-tauri/src/features/viewers/UnsupportedViewer.tsx
git commit -m "refactor(app-tauri): route openExternal through useHost().shell"
```

---

## Task 7: Refactor `fs` call sites (editor read + viewer-router + file menu)

**Files:**
- Modify: `packages/app-tauri/src/features/editor/EditorTab.tsx` (`readFile`)
- Modify: `packages/app-tauri/src/features/viewers/viewer-router.tsx` (`readFile`, `readFileBase64`)
- Modify: `packages/app-tauri/src/features/files/FileTreeRowMenu.tsx` (`showItemInFolder`)

**Interfaces:**
- Consumes: `useHost()`; `host.fs.readFile(p)`, `host.fs.readFileBase64(p)`, `host.fs.showItemInFolder(p)`.
- Produces: nothing; behavior identical.

- [ ] **Step 1: Baseline the existing tests**

Run any colocated `__tests__` for these three (one file per run).
Expected: PASS.

- [ ] **Step 2: Edit `EditorTab.tsx`**

Replace `import { readFile } from '@/lib/tauri/bridge';` (line 16) with `import { useHost } from '@/lib/host';`. Add `const host = useHost();` in the component; replace `readFile(path)` → `host.fs.readFile(path)`. Add `host` to any handler/effect dependency array that uses it.

- [ ] **Step 3: Edit `viewer-router.tsx`**

Replace `import { readFile, readFileBase64 } from '@/lib/tauri/bridge';` (line 18) with `import { useHost } from '@/lib/host';`. Add `const host = useHost();`; replace `readFile(...)` → `host.fs.readFile(...)` and `readFileBase64(...)` → `host.fs.readFileBase64(...)`; update dependency arrays.

- [ ] **Step 4: Edit `FileTreeRowMenu.tsx`**

Replace `import { showItemInFolder } from '@/lib/tauri/bridge';` (line 18) with `import { useHost } from '@/lib/host';`. Add `const host = useHost();`; replace `showItemInFolder(path)` → `host.fs.showItemInFolder(path)`; update dependency arrays.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 6: Run each affected test (single file each)**

Run the colocated tests one per invocation. Migrate any `vi.mock('@/lib/tauri/bridge')` to `<HostProvider host={new FakeHostBridge({ fs: { readFile: '…' } })}>`.
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app-tauri/src/features/editor/EditorTab.tsx \
        packages/app-tauri/src/features/viewers/viewer-router.tsx \
        packages/app-tauri/src/features/files/FileTreeRowMenu.tsx
git commit -m "refactor(app-tauri): route fs reads/reveal through useHost().fs"
```

---

## Task 8: Refactor `daemon.port` call sites (tool-result expand + LSP)

**Files:**
- Modify: `packages/app-tauri/src/features/chat/tools/ToolResultExpand.tsx` (component → `useHost()`)
- Modify: `packages/app-tauri/src/lib/lsp/index.ts` (non-component → `getHost()`)

**Interfaces:**
- Consumes: `useHost()` (component) / `getHost()` (module); `host.daemon.port()`.
- Produces: nothing; behavior identical.

- [ ] **Step 1: Baseline tests**

Run the colocated test for `ToolResultExpand` (if present) and `lib/lsp/__tests__/*` (one file per run).
Expected: PASS.

- [ ] **Step 2: Edit `ToolResultExpand.tsx`**

Replace `import { getDaemonPort } from '@/lib/tauri/bridge';` (line 17) with `import { useHost } from '@/lib/host';`. Add `const host = useHost();`; replace `getDaemonPort()` (line ~50) with `host.daemon.port()`. Keep the existing `.then/.catch` chain and the `console.warn('[tool-result-expand] …')` log verbatim. Add `host` to the effect dependency array.

- [ ] **Step 3: Edit `lib/lsp/index.ts`**

`lib/lsp/index.ts` is a non-component module (a singleton initialized at startup). Replace `import { getDaemonPort } from '@/lib/tauri/bridge';` (line 16) with `import { getHost } from '@/lib/host';`. Replace `const port = await getDaemonPort();` (line ~45) with `const port = await getHost().daemon.port();`.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 5: Run affected tests (single file each)**

Migrate any `vi.mock('@/lib/tauri/bridge')` in the LSP test to `setHostForTesting(new FakeHostBridge({ daemon: { port: 31415 } }))` (with `resetHostForTesting()` in `afterEach`). For `ToolResultExpand`, render under `<HostProvider host={new FakeHostBridge({ daemon: { port: 31415 } })}>`.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app-tauri/src/features/chat/tools/ToolResultExpand.tsx \
        packages/app-tauri/src/lib/lsp/index.ts
git commit -m "refactor(app-tauri): route daemon.port through the host port"
```

---

## Task 9: Refactor preview call sites (preview hooks + URL bar + layout store)

**Files:**
- Modify: `packages/app-tauri/src/features/preview/PreviewUrlBar.tsx` (`previewNavigate`)
- Modify: `packages/app-tauri/src/features/preview/use-preview-capture.ts` (`previewCapture`, `previewEval`, `onInspectResult`, types `InspectResult`/`Region`)
- Modify: `packages/app-tauri/src/features/preview/use-preview-geometry.ts` (`previewSetBounds`)
- Modify: `packages/app-tauri/src/features/preview/use-preview-lifecycle.ts` (`previewCreate`, `previewDestroy`, `previewNavigate`)
- Modify: `packages/app-tauri/src/features/preview/use-preview-visibility.ts` (`previewSetVisible`)
- Modify: `packages/app-tauri/src/store/layout.ts` (`previewDestroy`, non-component → `getHost()`)

**Interfaces:**
- Consumes: `useHost()` (hooks) / `getHost()` (`store/layout.ts`); `host.preview.{create,navigate,setBounds,setVisible,capture,destroy,eval,onInspectResult}`. Types `InspectResult`, `Region`, `Bounds` now import from `@qlan-ro/mainframe-types`.
- Produces: nothing; behavior identical.

> The hooks (`use-preview-*`) are React hooks → `useHost()`. `store/layout.ts` is a zustand store (non-component) → `getHost()`. The preview type imports (`InspectResult`, `Region`) move from `@/lib/tauri/preview` to `@qlan-ro/mainframe-types`.

- [ ] **Step 1: Baseline tests**

Run any colocated `features/preview/__tests__/*` and `store/__tests__/layout.test.ts` (one file per run).
Expected: PASS.

- [ ] **Step 2: Edit the four hooks**

For `use-preview-capture.ts`: replace
```ts
import { previewCapture, previewEval, onInspectResult } from '@/lib/tauri/preview';
import type { InspectResult, Region } from '@/lib/tauri/preview';
```
with
```ts
import { useHost } from '@/lib/host';
import type { InspectResult, Region } from '@qlan-ro/mainframe-types';
```
Add `const host = useHost();` in the hook body; replace `previewCapture(...)` → `host.preview.capture(...)`, `previewEval(...)` → `host.preview.eval(...)`, `onInspectResult(...)` → `host.preview.onInspectResult(...)`. Add `host` to relevant dependency arrays.

For `use-preview-geometry.ts`: `previewSetBounds` import → `useHost`; calls → `host.preview.setBounds(...)`.
For `use-preview-lifecycle.ts`: `previewCreate/previewDestroy/previewNavigate` → `useHost`; calls → `host.preview.create/destroy/navigate(...)`.
For `use-preview-visibility.ts`: `previewSetVisible` → `useHost`; calls → `host.preview.setVisible(...)`.

- [ ] **Step 3: Edit `PreviewUrlBar.tsx`**

Replace `import { previewNavigate } from '@/lib/tauri/preview';` (line 3) with `import { useHost } from '@/lib/host';`. Add `const host = useHost();`; replace `previewNavigate(...)` → `host.preview.navigate(...)`; update dependency arrays.

- [ ] **Step 4: Edit `store/layout.ts`**

`store/layout.ts` is a zustand store (non-component). Replace `import { previewDestroy } from '@/lib/tauri/preview';` (line 16) with `import { getHost } from '@/lib/host';`. Replace both `previewDestroy(tabId)` (line ~275) and `previewDestroy(tab.id)` (line ~289) with `getHost().preview.destroy(...)`, keeping the existing `.catch((e) => console.warn('[preview] …', e))` chains verbatim.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 6: Run affected tests (single file each)**

For `store/__tests__/layout.test.ts`, inject via `setHostForTesting(new FakeHostBridge())` and spy on `getHost().preview.destroy` (or stub the fake's `preview.destroy`). For preview hook tests, render under `<HostProvider host={…}>`. Note the fake's preview methods reject by default — if a layout test only needs `destroy` to be called and swallowed, assert the spy and keep the rejection (the store already `.catch`es it).
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app-tauri/src/features/preview/PreviewUrlBar.tsx \
        packages/app-tauri/src/features/preview/use-preview-capture.ts \
        packages/app-tauri/src/features/preview/use-preview-geometry.ts \
        packages/app-tauri/src/features/preview/use-preview-lifecycle.ts \
        packages/app-tauri/src/features/preview/use-preview-visibility.ts \
        packages/app-tauri/src/store/layout.ts
git commit -m "refactor(app-tauri): route preview methods through useHost()/getHost()"
```

---

## Task 10: Refactor terminal call sites (terminal factory + homedir subscriber)

**Files:**
- Modify: `packages/app-tauri/src/features/terminal/create-terminal.ts` (`createTerminal` → `host.terminal.create`)
- Modify: `packages/app-tauri/src/store/terminal-intent-subscriber.ts` (`getHomedir` → `host.app.getHomedir`)

**Interfaces:**
- Consumes: `getHost()` (both are non-component modules); `host.terminal.create(opts, handlers)`, `host.app.getHomedir()`.
- Produces: nothing; behavior identical.

> Both are plain modules (not React), so they use `getHost()`. `host.terminal.create` has the exact `(opts, handlers)` shape of the current `createTerminal` (verified) — the call site barely changes.

- [ ] **Step 1: Baseline tests**

Run colocated tests for `features/terminal/*` and `store/terminal-intent-subscriber` (one file per run).
Expected: PASS.

- [ ] **Step 2: Edit `features/terminal/create-terminal.ts`**

Replace `import { createTerminal } from '@/lib/tauri/terminal';` (line 1) with `import { getHost } from '@/lib/host';`. Replace `const handle = await createTerminal({ id, cwd: opts.cwd, cols: opts.cols, rows: opts.rows }, { onData, onExit });` with `const handle = await getHost().terminal.create({ id, cwd: opts.cwd, cols: opts.cols, rows: opts.rows }, { onData: …, onExit: … });` — keep the identical `onData`/`onExit` closures (the per-session `TextDecoder` and exit message). Everything else in the function is unchanged.

- [ ] **Step 3: Edit `store/terminal-intent-subscriber.ts`**

Replace `import { getHomedir } from '@/lib/tauri/bridge';` (line 14) with `import { getHost } from '@/lib/host';`. Replace `if (homedirCache === null) homedirCache = await getHomedir();` (line 23) with `if (homedirCache === null) homedirCache = await getHost().app.getHomedir();`.

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 5: Run affected tests (single file each)**

Migrate any test mocking `@/lib/tauri/terminal` or `@/lib/tauri/bridge` to `setHostForTesting(new FakeHostBridge(...))` + a spy on `getHost().terminal.create` / `getHost().app.getHomedir`. The fake's `terminal.create` rejects by default — for the homedir subscriber use the fake's `app.getHomedir` (returns `''`) or an override.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app-tauri/src/features/terminal/create-terminal.ts \
        packages/app-tauri/src/store/terminal-intent-subscriber.ts
git commit -m "refactor(app-tauri): route terminal.create and getHomedir through getHost()"
```

---

## Task 11: Refactor + migrate `useConnectionState` (19th call site)

**Files:**
- Modify: `packages/app-tauri/src/app/useConnectionState.ts` (`getDaemonPort`, `getDaemonStatus`, `onDaemonStatus`)
- Modify: `packages/app-tauri/src/app/__tests__/useConnectionState.test.ts`

**Interfaces:**
- Consumes: `getHost()`; `host.daemon.port()`, `host.daemon.status()`, `host.daemon.onStatus(cb)`.
- Produces: nothing; behavior identical.

> **This is the spec's "19th" call site (not in the brief's list of 18).** `useConnectionState` is the connection-bootstrap hook; it runs at the root before any provider is mounted, so it MUST use `getHost()` directly (not `useHost()`). The `host.daemon.*` signatures match the current `getDaemonPort/getDaemonStatus/onDaemonStatus` exactly (port→`number`, status→`string`, onStatus→`Promise<Unsubscribe>`).

- [ ] **Step 1: Migrate the test to the fake FIRST (it currently mocks the bridge)**

In `useConnectionState.test.ts`, replace the module mock:
```ts
vi.mock('../../lib/tauri/bridge', () => ({
  getDaemonPort: vi.fn(),
  getDaemonStatus: vi.fn(),
  onDaemonStatus: vi.fn(),
}));
import { getDaemonPort, getDaemonStatus, onDaemonStatus } from '../../lib/tauri/bridge';
const mockGetDaemonPort = vi.mocked(getDaemonPort);
const mockGetDaemonStatus = vi.mocked(getDaemonStatus);
const mockOnDaemonStatus = vi.mocked(onDaemonStatus);
```
with a fake-host approach:
```ts
import { FakeHostBridge } from '../../lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '../../lib/host';

const mockGetDaemonPort = vi.fn();
const mockGetDaemonStatus = vi.fn();
const mockOnDaemonStatus = vi.fn();

beforeEach(() => {
  const fake = new FakeHostBridge();
  fake.daemon.port = mockGetDaemonPort;
  fake.daemon.status = mockGetDaemonStatus;
  fake.daemon.onStatus = mockOnDaemonStatus;
  setHostForTesting(fake);
  mockOnDaemonStatus.mockResolvedValue(() => {});
});

afterEach(() => {
  resetHostForTesting();
});
```
Keep every existing assertion (`mockGetDaemonPort.mockRejectedValue(...)`, the retry case, the happy-path 31415 case) verbatim — only the wiring changed.

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/app/__tests__/useConnectionState.test.ts`
Expected: FAIL — `useConnectionState` still imports the real bridge, so `setHostForTesting` does not intercept it yet.

- [ ] **Step 3: Edit `useConnectionState.ts`**

Replace `import { getDaemonPort, getDaemonStatus, onDaemonStatus } from '../lib/tauri/bridge';` (line 13) with `import { getHost } from '../lib/host';`. Then:
- line ~90: `const p = await getDaemonPort();` → `const p = await getHost().daemon.port();`
- line ~91: `const s = await getDaemonStatus();` → `const s = await getHost().daemon.status();`
- line ~110: `unlisten = await onDaemonStatus((status) => setDaemonStatus(status));` → `unlisten = await getHost().daemon.onStatus((status) => setDaemonStatus(status));`

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/app/__tests__/useConnectionState.test.ts`
Expected: PASS — the fake intercepts via `getHost()`.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app-tauri/src/app/useConnectionState.ts \
        packages/app-tauri/src/app/__tests__/useConnectionState.test.ts
git commit -m "refactor(app-tauri): route useConnectionState daemon access through getHost()"
```

---

## Task 12: Refactor + migrate `AboutPane` (20th call site)

**Files:**
- Modify: `packages/app-tauri/src/features/settings/panes/about/AboutPane.tsx` (`getAppInfo`)
- Modify: `packages/app-tauri/src/features/settings/panes/about/__tests__/AboutPane.test.tsx`

**Interfaces:**
- Consumes: `useHost()`; `host.app.getInfo()`. The `AppInfo` type now imports from `@qlan-ro/mainframe-types`.
- Produces: nothing; behavior identical.

> **This is the spec's "20th" call site (not in the brief's list of 18).** `AboutPane.tsx` imports `getAppInfo` AND the `AppInfo` type from `lib/tauri/bridge`. The type moves to `@qlan-ro/mainframe-types`; the call becomes `host.app.getInfo()`.

- [ ] **Step 1: Migrate the test to the fake FIRST**

In `AboutPane.test.tsx`, replace:
```ts
vi.mock('../../../../../lib/tauri/bridge', () => ({
  getAppInfo: vi.fn().mockResolvedValue({ version: '0.22.2', author: 'qlan.ro', homedir: '/Users/x' }),
}));
```
with rendering under a provider seeded with an override:
```ts
import { FakeHostBridge } from '../../../../../lib/host/fake-adapter';
import { HostProvider } from '../../../../../lib/host';

function renderAbout() {
  const host = new FakeHostBridge({
    app: { getInfo: { version: '0.22.2', author: 'qlan.ro', homedir: '/Users/x' } },
  });
  return render(
    <HostProvider host={host}>
      <AboutPane />
    </HostProvider>,
  );
}
```
Update the existing test body to call `renderAbout()`. Keep the assertion that version `0.22.2` and author `qlan.ro` render.

- [ ] **Step 2: Run the test to verify it FAILS**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/features/settings/panes/about/__tests__/AboutPane.test.tsx`
Expected: FAIL — `AboutPane` still imports the real `getAppInfo`, so the provider override is not consulted.

- [ ] **Step 3: Edit `AboutPane.tsx`**

Replace `import { getAppInfo, type AppInfo } from '../../../../lib/tauri/bridge';` (line 3) with:
```ts
import type { AppInfo } from '@qlan-ro/mainframe-types';
import { useHost } from '@/lib/host';
```
Add `const host = useHost();` in the component; replace `getAppInfo()` (line ~16) with `host.app.getInfo()`. Add `host` to the effect dependency array.

- [ ] **Step 4: Run the test to verify it PASSES**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/features/settings/panes/about/__tests__/AboutPane.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app-tauri/src/features/settings/panes/about/AboutPane.tsx \
        packages/app-tauri/src/features/settings/panes/about/__tests__/AboutPane.test.tsx
git commit -m "refactor(app-tauri): route AboutPane app info through useHost().app"
```

---

## Task 13: Verify no feature code imports `@/lib/tauri/*` or `@tauri-apps/*` (boundary gate)

**Files:**
- No source edits expected. This task is a guard that the refactor is complete.

**Interfaces:**
- Consumes: the full refactored tree.
- Produces: a confirmed import boundary (only `lib/host/tauri-adapter.ts` and `lib/tauri/*` themselves touch `@tauri-apps/*`).

- [ ] **Step 1: Grep for remaining `@/lib/tauri` importers outside the host layer**

Run:
```bash
cd packages/app-tauri && \
grep -rln "@/lib/tauri" src --include="*.ts" --include="*.tsx" \
  | grep -v "src/lib/host/tauri-adapter.ts" \
  | grep -v "src/lib/tauri/" \
  || echo "CLEAN: no feature code imports @/lib/tauri"
```
Expected: `CLEAN: no feature code imports @/lib/tauri`. If any file is listed, it was missed — refactor it per the matching task pattern (component → `useHost()`, module → `getHost()`), then re-run.

- [ ] **Step 2: Grep for `@tauri-apps/*` importers outside `lib/tauri/` and the adapter**

Run:
```bash
cd packages/app-tauri && \
grep -rln "@tauri-apps/" src --include="*.ts" --include="*.tsx" \
  | grep -v "src/lib/tauri/" \
  | grep -v "src/lib/host/tauri-adapter.ts" \
  | grep -v "__tests__" \
  || echo "CLEAN: only lib/tauri and tauri-adapter import @tauri-apps"
```
Expected: `CLEAN: …`. (`tauri-adapter.ts` imports `@tauri-apps/api/webviewWindow` for the drag listener — that is the one allowed adapter-level import; everything else routes through `lib/tauri/*`.)

- [ ] **Step 3: Full typecheck (catches any stale type import)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 4: Commit (only if Step 1/2 required a fix)**

> **Shared worktree — never `git add -A` / `git add .`.** Other sessions may hold unrelated uncommitted files under `packages/app-tauri/src`. Stage ONLY the specific file(s) you edited, by exact path:
```bash
git add <the exact file(s) you refactored in Step 1/2>
git commit -m "refactor(app-tauri): close the @/lib/tauri import boundary"
```
> If Steps 1–2 already reported CLEAN with no edits, skip the commit.

---

## Task 14: Changeset + final verification sweep

**Files:**
- Create: a changeset under `.changeset/` (via `pnpm changeset`).

**Interfaces:**
- Consumes: the whole Plan 1 change.
- Produces: a changeset entry; a green types build + app-tauri typecheck.

> The project requires a changeset per PR (root CLAUDE.md → Git). Plan 1 touches `@qlan-ro/mainframe-types` (new export) and `@qlan-ro/mainframe-app-tauri` (internal refactor).

- [ ] **Step 1: Build the types package (final)**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: PASS.

- [ ] **Step 2: Typecheck app-tauri (final)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 3: Run the host-layer test files (one invocation each)**

Run, separately (never batched — React.act pollution):
```bash
pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/fake-adapter.test.ts
pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/host-context.test.tsx
pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-adapter.test.ts
pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/app/__tests__/useConnectionState.test.ts
pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/features/settings/panes/about/__tests__/AboutPane.test.tsx
```
Expected: each PASS.

- [ ] **Step 4: Create the changeset**

Run: `pnpm changeset`
Select `@qlan-ro/mainframe-types` (patch — additive type export) and `@qlan-ro/mainframe-app-tauri` (patch — internal refactor, no behavior change). Summary: `Add a host-agnostic HostBridge port; route the app-tauri renderer through getHost()/useHost() instead of importing lib/tauri directly. No behavior change.`

- [ ] **Step 5: Manual smoke (no-behavior-change gate)**

Per the migration memory (`app-tauri-browsermode-vite-ipv6`): start the Vite dev server in the background, open `http://localhost:<VITE_PORT>` against a manually-started dev daemon, and confirm the app boots to a session (browser/dev mode uses `FakeHostBridge`). If a Tauri build is available, launch it and confirm: window drag works (the relocated `init()` listener), a preview tab opens/captures, a terminal runs, "Reveal in Finder" works, and About shows the real version. Any regression here violates the Plan 1 guarantee — investigate before merging.

- [ ] **Step 6: Commit the changeset**

```bash
git add .changeset
git commit -m "chore: add changeset for HostBridge foundation"
```

---

## Self-Review

**1. Spec coverage (design Phases 1–3):**

- **Phase 1 — "Land `HostBridge` … in `mainframe-types`; add `getHost()` + provider in app-tauri. No behavior change."** → Task 1 (interface, type-only; Zod deferred to Plan 2 as required), Task 3 (`getHost()` + `HostProvider`/`useHost()`), Task 5 (provider mounted at `main.tsx`). ✅
- **Phase 2 — "Move `lib/tauri/*` behind `tauri-adapter.ts`; refactor the call sites + the preview/drag seams to the port."** → Task 4 (adapter delegates to `lib/tauri/*`, the only `@tauri-apps` importer; drag listener relocated to `init()` preserving `data-tauri-drag-region` — rename deferred to Plan 2 per the brief), Tasks 6–12 (all 20 call sites), Task 9 (preview seam 1:1 imperative — `mount()` redesign deferred to Plan 2 per the brief), Task 13 (boundary gate). ✅
- **Phase 3 — "Add `FakeHostBridge`; migrate feature tests."** → Task 2 (fake), Tasks 4/6–12 (test migration: the 3 `lib/tauri` tests deleted/relocated, `useConnectionState.test.ts` and `AboutPane.test.tsx` migrated to the fake; per-feature tests migrated inline). ✅
- **Excluded per the brief:** `updates`, `presence` namespaces (not in the Task 1 interface ✅); Zod contract (not added — `mainframe-types` stays dependency-free ✅); `preview.mount()` (port is imperative 1:1 ✅); attribute rename + `window.startDrag` (attribute preserved ✅); `log` host-forwarding (`log` delegates to `console.*` ✅).

**2. Placeholder scan:** No "TBD"/"implement later"/"handle edge cases"/"similar to Task N". Every code step shows real TypeScript. The one prose caveat (Task 4 Step 1's `await import` inside a non-async `it`) is called out explicitly with the fix, not left implicit. Conditional steps (coverage restore in Task 4 Step 8; the lazy-`require` fallback in Task 3) state the exact condition and action. ✅

**3. Type / name consistency:** `getHost()`, `useHost()`, `HostProvider`, `setHostForTesting()`, `resetHostForTesting()`, `isTauriRuntime()`, `FakeHostBridge`, `FakeHostOverrides`, `TauriAdapter`, `init()` are used identically across every task. The `HostBridge` member paths (`app.getInfo`, `app.getHomedir`, `app.getAuthToken`, `app.platform`, `fs.readFile`, `fs.readFileBase64`, `fs.showItemInFolder`, `shell.openExternal`, `notify`, `terminal.create`, `preview.{create,navigate,setBounds,setVisible,capture,destroy,eval,onInspectResult}`, `daemon.{port,status,onStatus}`, `log`) match between Task 1's interface, Task 2's fake, Task 4's adapter, and every refactor task. Payload types (`AppInfo`, `Platform`, `LogLevel`, `Bounds`, `Region`, `InspectResult`, `TerminalOpts`, `TerminalHandlers`, `TerminalHandle`, `Unsubscribe`, `DaemonStatus`) are defined once in Task 1 and imported from `@qlan-ro/mainframe-types` everywhere (single canonical type). `daemon.onStatus`/`preview.onInspectResult` return `Promise<Unsubscribe>` consistently (matching today's async `listen()`). ✅

**4. Spec-vs-code deviation (surfaced):** the brief's "18 call sites" undercounts by two — `app/useConnectionState.ts` and `features/settings/panes/about/AboutPane.tsx` also import `@/lib/tauri/bridge`. Both are included (Tasks 11, 12). Four port members (`app.getAuthToken`, `app.platform`, `notify`, `log`) have no feature consumers today and are exercised only by the fake/adapter unit tests — that is expected, not a gap. ✅
