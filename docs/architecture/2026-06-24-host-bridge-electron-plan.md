# Host Bridge Plan 2 — Electron Adapter + `desktop` Retrofit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Plan 2 of 3.** Plan 1 (foundation: `HostBridge` port + `TauriAdapter` + `FakeHostBridge`) is **complete** at commits `1aafe62f..4dccdfcf`. **Plan 3 = full parity** (Tauri updater/presence/log-sink/native-menu/crash-diagnostics/permission-allowlist + Tauri daemon bundling) follows this plan. This plan delivers the Electron adapter, the `desktop` shell retrofit onto the new renderer, and the `preview.mount()` contract reshape.

**Goal:** Build an Electron `HostBridge` adapter and retrofit `packages/desktop` to host the new `app-tauri` renderer, so the identical renderer runs on both Tauri/WebKit and Electron/Chromium — enabling a direct A/B with no UI rewrite.

**Architecture:** The renderer already calls a single host-agnostic port (`getHost()` → `HostBridge`). This plan (1) reshapes the `preview` seam from the imperative `PreviewPort` to a `preview.mount(container, url, opts) → PreviewHandle` so the per-project Electron partition is expressible; (2) lands a Zod `host-contract.ts` in `mainframe-types` and validates the Electron `ipcMain.handle` args against it; (3) extends the Electron preload/main with the missing channels (auth token, base64 read, app info+homedir, daemon status); (4) adds an `ElectronAdapter` over `window.mainframe.*` and an Electron `getHost()` branch; and (5) repoints `desktop`'s window at the app-tauri Vite server (dev) / `dist` (prod) with a runtime CSP for the daemon on 31415. The two native shells (Rust `src-tauri`, TS `desktop/main`) stay separate codebases but conform to the one Zod contract.

**Tech Stack:** TypeScript (strict, NodeNext), React 19, Electron 41, Vite 6 (app-tauri renderer) / electron-vite 5 (desktop shell), Zod 4, Vitest 4, pino 10 (Electron log sink). `node-pty` (terminal), Electron `<webview>` tag (preview).

## Global Constraints

- **TS strict / NodeNext.** `noUncheckedIndexedAccess` on. `@qlan-ro/mainframe-types` imports use the `.js` extension (e.g. `from './host/host-bridge.js'`).
- **`mainframe-types` gains a `zod` dependency in Task 2 — the one allowed new dep.** Pin `zod` to `^4.4.3` (matches `@qlan-ro/mainframe-core`). `pnpm-lock.yaml` is staged ONLY in Task 2.
- **Single canonical type.** `HostBridge`, `PreviewHandle`, `PreviewOpts`, and every payload/event type live ONLY in `@qlan-ro/mainframe-types`. Never duplicate across packages.
- **File ≤300 lines, function ≤50 lines.** No `@ts-ignore` (use `@ts-expect-error` with a reason). No `console.log`/`console.error` in core; renderer logging uses `console.warn` with a `[tag]`; Electron main uses the pino child logger.
- **Zod on every endpoint.** Every new/changed Electron `ipcMain.handle` validates its args with the shared contract schema.
- **Shared worktree.** Other sessions hold uncommitted work. Every commit stages files **by exact path** — never `git add -A` / `git add .`. Never touch `pnpm-lock.yaml` except in Task 2 (the `zod` dep). Confirm `git branch --show-current` is `feat/app-tauri-wt` (NOT `main`) before any commit.
- **Changeset required.** The final task adds one changeset (`pnpm changeset`, pick `@qlan-ro/mainframe-types` minor + `@qlan-ro/mainframe-desktop` minor + `@qlan-ro/mainframe-app-tauri` minor).
- **Test gotcha — run ONE file per test step.** app-tauri vitest batched runs mass-fail with "React.act is not a function" (cross-file pollution); files pass in isolation. Always:
  - app-tauri: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- <file>` / `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
  - desktop: `pnpm --filter @qlan-ro/mainframe-desktop test -- <file>` (vitest config at `packages/desktop/vitest.config.ts`, setup `src/__tests__/setup.ts`) / `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit -p tsconfig.json`
  - types: `pnpm --filter @qlan-ro/mainframe-types build` (runs `tsc`)
- **Known pre-existing red suites — NOT this plan's defects.** `packages/app-tauri/src/app/__tests__/App.integration.test.tsx` and any `design-token-audit.test.ts` fail on an other-session tour-mock / design-token baseline. Steps that touch files those suites import must expect the **unchanged baseline failure**, not green. Do not "fix" them.

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `packages/types/src/host/host-contract.ts` | Zod schemas for every command payload + event; `DaemonStatusSchema`, `PlatformSchema`, and the inferred enums. The single contract source. |
| `packages/types/src/host/__tests__/host-contract.test.ts` | Asserts each schema parses valid fixtures and rejects malformed ones. |
| `packages/desktop/src/main/daemon-status.ts` | Daemon-status tracker: holds the current `DaemonStatus`, broadcasts `daemon:status` IPC, derives `'ready'` from spawn + first `/health`. |
| `packages/desktop/src/main/__tests__/daemon-status.test.ts` | Tests the status transitions + listener fan-out. |
| `packages/desktop/src/main/__tests__/ipc-contract.test.ts` | Feeds contract fixtures to the validating IPC arg parsers (native conformance). |
| `packages/app-tauri/src/lib/host/electron-adapter.ts` | `ElectronAdapter implements HostBridge` over `window.mainframe.*`: terminal demux + byte translation, platform mapping, app/fs/shell/notify/daemon/log, and `preview.mount`. |
| `packages/app-tauri/src/lib/host/electron-preview.ts` | `ElectronPreviewBackend`: injects a `<webview partition>` into a container, drives capture/eval/inspect; backs `ElectronAdapter.preview.mount`. Split out to keep `electron-adapter.ts` ≤300 lines. |
| `packages/app-tauri/src/lib/host/tauri-preview.ts` | `TauriPreviewBackend`: reads `container.getBoundingClientRect()` and drives the existing Rust child-webview commands; backs `TauriAdapter.preview.mount`. |
| `packages/app-tauri/src/lib/host/__tests__/electron-adapter.test.ts` | Unit tests for the Electron adapter (terminal demux, byte→Uint8Array, platform map, daemon, log, fs base64). |
| `packages/app-tauri/src/lib/host/__tests__/electron-preview.test.ts` | Unit tests for the Electron preview backend (webview injection, capture region/DPR, inspect bridge, clearSession). |
| `packages/app-tauri/src/lib/host/__tests__/tauri-preview.test.ts` | Unit tests for the Tauri preview backend (mount reads rect, navigate/setBounds/capture/destroy/onInspect delegate). |
| `.changeset/host-bridge-electron-adapter.md` | Changeset (Task 10). |

### Modified

| Path | Change |
|---|---|
| `packages/types/src/index.ts` | `export * from './host/host-contract.js';` |
| `packages/types/src/host/host-bridge.ts` | Replace `PreviewPort` with `mount()`/`clearSession()`; add `PreviewHandle`, `PreviewOpts`; `DaemonStatus`/`Platform` re-exported from the contract (single source). |
| `packages/types/package.json` | Add `"zod": "^4.4.3"` to dependencies. |
| `packages/desktop/src/preload/index.ts` | Add `getAuthToken`, `readFileBase64`, `getInfo`(+homedir), daemon `port`/`status`/`onStatus`; terminal `onData`/`onExit` carry `Uint8Array`. |
| `packages/desktop/src/main/index.ts` | Add `app:getAuthToken`, `fs:readFileBase64`, fold homedir into `app:getInfo`, wire `daemon-status.ts`, Zod-validate every handler, runtime CSP via `onHeadersReceived`, point `loadURL`/`loadFile` at the app-tauri renderer. |
| `packages/desktop/src/main/terminal-manager.ts` | `terminal:data`/`terminal:exit` send `Buffer` (bytes) not `string`; accept caller-supplied id. |
| `packages/desktop/electron.vite.config.ts` | Renderer dev server points at the app-tauri Vite server (no longer builds `src/renderer`); CSP plugin removed (runtime CSP replaces it). |
| `packages/app-tauri/src/lib/host/tauri-adapter.ts` | `preview` now `{ mount, clearSession }` backed by `TauriPreviewBackend`; drag attribute `data-tauri-drag-region` → `data-drag-region`. |
| `packages/app-tauri/src/lib/host/fake-adapter.ts` | `preview` now `{ mount, clearSession }`; `mount` returns a no-op `PreviewHandle`. |
| `packages/app-tauri/src/lib/host/index.ts` | `getHost()` gains an Electron branch (`isElectronRuntime()` → `ElectronAdapter`). |
| `packages/app-tauri/src/lib/host/detect.ts` | Add `isElectronRuntime()` (`'mainframe' in window`). |
| `packages/app-tauri/src/app/main.tsx` | Generalize `init()` gating: call `host.init?.()` for whichever adapter exposes it. |
| `packages/app-tauri/src/features/preview/PreviewInstance.tsx` | Pass `containerRef` + `projectId` into the hooks; the hooks now own a single `PreviewHandle`. |
| `packages/app-tauri/src/features/preview/use-preview-lifecycle.ts` | `host.preview.create/navigate/destroy` → `host.preview.mount(...)` once; returns/owns the `PreviewHandle`; `navigate`/`destroy` go through the handle. |
| `packages/app-tauri/src/features/preview/use-preview-geometry.ts` | No host call; the handle self-tracks its container rect. Keep the ResizeObserver only as a Tauri reflow nudge via `handle.refit()`. |
| `packages/app-tauri/src/features/preview/use-preview-visibility.ts` | `host.preview.setVisible(tabId, v)` → `handle.setVisible(v)`. |
| `packages/app-tauri/src/features/preview/use-preview-capture.ts` | `host.preview.capture/eval/onInspectResult` → `handle.capture/startInspect/onInspect`. |
| `packages/app-tauri/src/layout/MainToolbar.tsx`, `src/layout/SidebarHeader.tsx`, `src/features/chat/thread/ChatCardHeader.tsx` | `data-tauri-drag-region` → `data-drag-region`. |
| `packages/app-tauri/src/styles/globals.css` | Add `[data-drag-region]{ -webkit-app-region: drag } [data-drag-region] button, …{ -webkit-app-region: no-drag }` for Electron. |
| `packages/app-tauri/src/lib/host/__tests__/tauri-adapter.test.ts` | Update the drag test attribute + the preview-capture test to the `mount()` shape. |
| `packages/app-tauri/src/features/preview/__tests__/*` (existing) | Update mock host `preview` to the `mount()` shape. |

---

## Interfaces defined in this plan (forward reference)

These are the names later tasks consume. Defined in full in Task 1/2, restated where used.

```ts
// packages/types/src/host/host-bridge.ts (Task 1)
export interface PreviewOpts {
  /** Selects the persistent session partition: persist:sandbox-{projectId} (Electron). */
  projectId?: string;
  /** Initial mobile vs desktop frame; the renderer toggles it via handle.setDevice. */
  device?: 'desktop' | 'mobile';
}

export interface PreviewHandle {
  /** Show/hide the backing webview. Tauri: OS-overlay blanking. Electron: DOM display toggle (occlusion no-op-tolerant). */
  setVisible(visible: boolean): void;
  /** Re-point the existing webview at a new URL. */
  navigate(url: string): Promise<void>;
  /**
   * Capture a PNG. `region` is in CSS pixels relative to the webview viewport
   * (origin = top-left of the page content, NOT the container). The BACKEND
   * applies device-pixel-ratio scaling. Returns raw PNG bytes.
   */
  capture(region?: Region): Promise<Uint8Array>;
  /** Begin element-inspect mode (installs the in-page picker). */
  startInspect(): Promise<void>;
  /** Subscribe to inspect picks. Returns synchronously (the subscription is local to the handle). */
  onInspect(cb: (result: InspectResult) => void): Unsubscribe;
  /** Tauri: nudge the native layer to re-read container.getBoundingClientRect(). Electron: no-op. */
  refit(): void;
  /** Optional initial device hint follow-up (mobile frame). */
  setDevice(device: 'desktop' | 'mobile'): void;
  /** Tear down the webview + listeners. */
  destroy(): void;
}

export interface HostBridge {
  // …app/fs/shell/notify/terminal/daemon/log unchanged…
  preview: {
    mount(container: HTMLElement, url: string, opts?: PreviewOpts): PreviewHandle;
    clearSession(projectId: string): Promise<void>;
  };
  init?(): void; // Tauri installs the drag listener; Electron is a no-op (CSS handles drag)
}
```

```ts
// packages/types/src/host/host-contract.ts (Task 2)
export const PlatformSchema: z.ZodEnum<['macos','windows','linux','browser']>;
export type Platform = z.infer<typeof PlatformSchema>;
export const DaemonStatusSchema: z.ZodEnum<['initializing','starting','ready','unavailable','stopped']>;
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;
export const TerminalCreateOptsSchema: z.ZodObject<…>;  // { id, cwd, cols, rows }
export const AppInfoSchema: z.ZodObject<…>;             // { version, author, homedir }
export const FilePathSchema: z.ZodString;               // non-empty
export const OpenExternalSchema: z.ZodString;           // url
export const NotifySchema: z.ZodObject<…>;              // { title, body? }
export const ClearSessionSchema: z.ZodObject<…>;        // { projectId }
export const LogRecordSchema: z.ZodObject<…>;           // { level, module, message, data? }
```

---

## Task 1: Reshape the `HostBridge` preview contract to `mount()` + `PreviewHandle`

**Files:**
- Modify: `packages/types/src/host/host-bridge.ts`
- Test: `packages/types/src/host/__tests__/host-bridge.types.test.ts` (create — a type-level compile assertion)

**Interfaces:**
- Consumes: existing `Unsubscribe`, `Region`, `InspectResult` (already in `host-bridge.ts`).
- Produces: `PreviewOpts`, `PreviewHandle`, the reshaped `HostBridge['preview']` ( `{ mount; clearSession }` ), and optional `HostBridge['init']`. Consumed by Tasks 5, 6, 7, 8 and the renderer hooks.

This is a contract-only change; the adapters break until Tasks 7/8. To keep the repo compiling between tasks, this task ALSO stubs the two existing adapters' `preview` to the new shape (real impl lands in Tasks 7/8).

- [ ] **Step 1: Write the failing type test**

Create `packages/types/src/host/__tests__/host-bridge.types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { HostBridge, PreviewHandle, PreviewOpts } from '../host-bridge.js';

describe('HostBridge preview contract shape', () => {
  it('preview exposes mount + clearSession (compile-time)', () => {
    // Compile-time structural assertions: these fail tsc if the shape drifts.
    const assertShape = (h: HostBridge): void => {
      const handle: PreviewHandle = h.preview.mount(document.createElement('div'), 'http://x', {} as PreviewOpts);
      void handle.setVisible;
      void handle.navigate;
      void handle.capture;
      void handle.startInspect;
      void handle.onInspect;
      void handle.refit;
      void handle.setDevice;
      void handle.destroy;
      void h.preview.clearSession('p');
    };
    void assertShape;
    expect(true).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: FAIL — `Property 'mount' does not exist on type 'PreviewPort'` (and `PreviewHandle`/`PreviewOpts` not exported).

- [ ] **Step 3: Reshape the contract**

In `packages/types/src/host/host-bridge.ts`, delete the `PreviewPort` interface and replace with:

```ts
export interface PreviewOpts {
  /** Selects the persistent session partition: persist:sandbox-{projectId} (Electron). */
  projectId?: string;
  /** Initial frame; the renderer toggles it via handle.setDevice. */
  device?: 'desktop' | 'mobile';
}

/**
 * A mounted preview surface. The renderer reserves a DOM container and hands it to
 * mount(); the handle owns one backing webview.
 *
 * Coordinate space: capture() region is CSS pixels in the WEBVIEW VIEWPORT space
 * (top-left = page content origin). The backend (Tauri WKWebView snapshot / Electron
 * capturePage) applies device-pixel-ratio scaling — the renderer never multiplies by DPR.
 *
 * Visibility/occlusion: Tauri composites the webview ABOVE the DOM, so setVisible(false)
 * blanks the OS layer when a DOM overlay covers the region. Electron stacks the <webview>
 * IN the DOM, so setVisible(false) on occlusion is a near-no-op — both hosts must TOLERATE
 * the renderer emitting it (the renderer keeps the existing occlusion logic unchanged).
 */
export interface PreviewHandle {
  setVisible(visible: boolean): void;
  navigate(url: string): Promise<void>;
  capture(region?: Region): Promise<Uint8Array>;
  startInspect(): Promise<void>;
  onInspect(cb: (result: InspectResult) => void): Unsubscribe;
  /** Tauri: re-read container.getBoundingClientRect() into the native layer. Electron: no-op. */
  refit(): void;
  setDevice(device: 'desktop' | 'mobile'): void;
  destroy(): void;
}
```

Update the `HostBridge` interface `preview` member and add the optional `init`:

```ts
  preview: {
    mount(container: HTMLElement, url: string, opts?: PreviewOpts): PreviewHandle;
    clearSession(projectId: string): Promise<void>;
  };
  log(level: LogLevel, module: string, message: string, data?: unknown): void;
  /** Tauri installs the window-drag listener here; Electron is a CSS no-op. */
  init?(): void;
```

Remove the now-unused `Bounds` interface ONLY if no other contract member references it. (`InspectResult.rect`/`.viewport` use `Bounds` — keep it.) Update the file header comment: replace "The `mount()` seam is deferred to Plan 2" with "Preview is the `mount()` seam (Plan 2)."

- [ ] **Step 4: Stub the two existing adapters to the new shape (keep the repo compiling)**

In `packages/app-tauri/src/lib/host/tauri-adapter.ts`, temporarily replace the `preview = { create, navigate, … }` block with a throwing stub (real backend in Task 7):

```ts
  preview = {
    mount: (): never => {
      throw new Error('TauriAdapter.preview.mount not yet implemented (Task 7)');
    },
    clearSession: (_projectId: string): Promise<void> => Promise.resolve(),
  };
```

Remove the now-unused `import * as preview from '@/lib/tauri/preview';` and the unused `Bounds`/`Region`/`InspectResult` type imports from this file (Task 7 re-adds what it needs). In `packages/app-tauri/src/lib/host/fake-adapter.ts`, replace the `preview = { create, … }` block with:

```ts
  preview = {
    mount: (): import('@qlan-ro/mainframe-types').PreviewHandle => ({
      setVisible: () => {},
      navigate: () => Promise.resolve(),
      capture: () => Promise.reject(new Error('preview.capture is not available in browser/dev mode')),
      startInspect: () => Promise.resolve(),
      onInspect: () => () => {},
      refit: () => {},
      setDevice: () => {},
      destroy: () => {},
    }),
    clearSession: (): Promise<void> => Promise.resolve(),
  };
```

Remove the now-unused `Unsubscribe` import from `fake-adapter.ts` if it is no longer referenced.

Add the export in `packages/types/src/index.ts` is NOT needed (host-bridge is already exported on line 19). Confirm `PreviewHandle`/`PreviewOpts` flow through that existing `export *`.

- [ ] **Step 5: Run the type test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: PASS (build succeeds, types emitted).
Then: `pnpm --filter @qlan-ro/mainframe-types test -- src/host/__tests__/host-bridge.types.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck app-tauri (adapters stubbed)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: FAIL — the renderer hooks (`use-preview-*`) still call the old `host.preview.create/navigate/...`. This is expected; Tasks 7 fixes them. Note the failures are confined to the 5 preview files + their tests. If failures appear OUTSIDE those files, stop and investigate.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/host/host-bridge.ts \
  packages/types/src/host/__tests__/host-bridge.types.test.ts \
  packages/app-tauri/src/lib/host/tauri-adapter.ts \
  packages/app-tauri/src/lib/host/fake-adapter.ts
git commit -m "feat(types): reshape HostBridge preview to mount()/PreviewHandle

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Land the Zod `host-contract.ts` in `mainframe-types`

**Files:**
- Create: `packages/types/src/host/host-contract.ts`
- Create: `packages/types/src/host/__tests__/host-contract.test.ts`
- Modify: `packages/types/src/index.ts`
- Modify: `packages/types/src/host/host-bridge.ts` (re-export `Platform`/`DaemonStatus` from the contract)
- Modify: `packages/types/package.json` (+`zod`)

**Interfaces:**
- Consumes: nothing.
- Produces: `PlatformSchema`/`Platform`, `DaemonStatusSchema`/`DaemonStatus`, `TerminalCreateOptsSchema`, `AppInfoSchema`, `FilePathSchema`, `OpenExternalSchema`, `NotifySchema`, `ClearSessionSchema`, `LogRecordSchema`. Consumed by Tasks 3, 4, 5, 8 and the Electron IPC validators.

- [ ] **Step 1: Add the `zod` dependency**

Edit `packages/types/package.json` — add a `dependencies` block (it currently has none):

```json
  "dependencies": {
    "zod": "^4.4.3"
  },
```

Place it before `"devDependencies"`. Then install:

Run: `pnpm install --filter @qlan-ro/mainframe-types`
Expected: installs `zod`, updates `pnpm-lock.yaml`.

- [ ] **Step 2: Write the failing contract test**

Create `packages/types/src/host/__tests__/host-contract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  PlatformSchema,
  DaemonStatusSchema,
  TerminalCreateOptsSchema,
  AppInfoSchema,
  FilePathSchema,
  NotifySchema,
  ClearSessionSchema,
  LogRecordSchema,
} from '../host-contract.js';

describe('host-contract schemas', () => {
  it('PlatformSchema accepts known platforms and rejects others', () => {
    expect(PlatformSchema.parse('macos')).toBe('macos');
    expect(() => PlatformSchema.parse('freebsd')).toThrow();
  });

  it('DaemonStatusSchema accepts the closed vocabulary', () => {
    expect(DaemonStatusSchema.parse('ready')).toBe('ready');
    expect(DaemonStatusSchema.parse('initializing')).toBe('initializing');
    expect(() => DaemonStatusSchema.parse('green')).toThrow();
  });

  it('TerminalCreateOptsSchema requires id/cwd/cols/rows', () => {
    expect(TerminalCreateOptsSchema.parse({ id: 't1', cwd: '/tmp', cols: 80, rows: 24 })).toEqual({
      id: 't1',
      cwd: '/tmp',
      cols: 80,
      rows: 24,
    });
    expect(() => TerminalCreateOptsSchema.parse({ id: 't1', cwd: '/tmp' })).toThrow();
  });

  it('AppInfoSchema requires version/author/homedir', () => {
    expect(AppInfoSchema.parse({ version: '1.0', author: 'q', homedir: '/h' })).toEqual({
      version: '1.0',
      author: 'q',
      homedir: '/h',
    });
  });

  it('FilePathSchema rejects empty strings', () => {
    expect(FilePathSchema.parse('/x')).toBe('/x');
    expect(() => FilePathSchema.parse('')).toThrow();
  });

  it('NotifySchema makes body optional', () => {
    expect(NotifySchema.parse({ title: 'hi' })).toEqual({ title: 'hi' });
    expect(NotifySchema.parse({ title: 'hi', body: 'there' })).toEqual({ title: 'hi', body: 'there' });
  });

  it('ClearSessionSchema requires projectId', () => {
    expect(ClearSessionSchema.parse({ projectId: 'p1' })).toEqual({ projectId: 'p1' });
    expect(() => ClearSessionSchema.parse({})).toThrow();
  });

  it('LogRecordSchema validates level + module + message', () => {
    expect(LogRecordSchema.parse({ level: 'info', module: 'm', message: 'msg' })).toMatchObject({
      level: 'info',
      module: 'm',
      message: 'msg',
    });
    expect(() => LogRecordSchema.parse({ level: 'verbose', module: 'm', message: 'msg' })).toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- src/host/__tests__/host-contract.test.ts`
Expected: FAIL — cannot resolve `../host-contract.js`.

- [ ] **Step 4: Write the contract**

Create `packages/types/src/host/host-contract.ts`:

```ts
/**
 * host/host-contract.ts
 *
 * Zod schemas for every host command payload + event. The single source of
 * payload shapes: the Electron ipcMain handlers parse args with these; the Rust
 * (Tauri) shell conforms via serde to the same documented contract (no shared
 * code across languages). Platform/DaemonStatus enums are defined HERE and
 * re-exported type-only from host-bridge.ts so there is one source.
 */
import { z } from 'zod';

export const PlatformSchema = z.enum(['macos', 'windows', 'linux', 'browser']);
export type Platform = z.infer<typeof PlatformSchema>;

/**
 * Daemon lifecycle vocabulary. Both hosts emit ONLY these values so the renderer
 * (useConnectionState) sees identical statuses on Tauri and Electron.
 * - initializing: shell starting, daemon not yet forked
 * - starting:     daemon process forked, not yet answering /health
 * - ready:        daemon answered /health (or utilityProcess 'spawn')
 * - unavailable:  daemon port could not be acquired
 * - stopped:      daemon process exited
 */
export const DaemonStatusSchema = z.enum(['initializing', 'starting', 'ready', 'unavailable', 'stopped']);
export type DaemonStatus = z.infer<typeof DaemonStatusSchema>;

export const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export type LogLevel = z.infer<typeof LogLevelSchema>;

export const AppInfoSchema = z.object({
  version: z.string(),
  author: z.string(),
  homedir: z.string(),
});

export const FilePathSchema = z.string().min(1);

export const OpenExternalSchema = z.string().min(1);

export const TerminalCreateOptsSchema = z.object({
  id: z.string().min(1),
  cwd: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const TerminalWriteSchema = z.object({
  id: z.string().min(1),
  data: z.string(),
});

export const TerminalResizeSchema = z.object({
  id: z.string().min(1),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const TerminalIdSchema = z.object({ id: z.string().min(1) });

export const NotifySchema = z.object({
  title: z.string(),
  body: z.string().optional(),
});

export const ClearSessionSchema = z.object({ projectId: z.string().min(1) });

export const RegionSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

export const LogRecordSchema = z.object({
  level: LogLevelSchema,
  module: z.string(),
  message: z.string(),
  data: z.unknown().optional(),
});
```

In `packages/types/src/host/host-bridge.ts`, replace the local `Platform` and `DaemonStatus` and `LogLevel` declarations with re-exports from the contract, so there is one source:

```ts
export type { Platform, DaemonStatus, LogLevel } from './host-contract.js';
```

(Delete the `export type Platform = …`, `export type DaemonStatus = string`, and `export type LogLevel = …` lines. NOTE: `DaemonStatus` was `string`; it is now the closed enum — verify no renderer code passes a status outside the enum. `useConnectionState` sets `'unavailable'`, `'initializing'` locally as React state strings, not as `DaemonStatus`-typed host returns, so this is safe.)

Add to `packages/types/src/index.ts`:

```ts
export * from './host/host-contract.js';
```

- [ ] **Step 5: Run the contract test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- src/host/__tests__/host-contract.test.ts`
Expected: PASS.
Then: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: PASS.

- [ ] **Step 6: Commit (the ONLY task that stages `pnpm-lock.yaml`)**

```bash
git add packages/types/src/host/host-contract.ts \
  packages/types/src/host/__tests__/host-contract.test.ts \
  packages/types/src/host/host-bridge.ts \
  packages/types/src/index.ts \
  packages/types/package.json \
  pnpm-lock.yaml
git commit -m "feat(types): add Zod host-contract with Platform/DaemonStatus enums + zod dep

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

NOTE: `pnpm-lock.yaml` was already `M` at plan start (a separate concern). Before staging it, run `git diff pnpm-lock.yaml` and confirm the ONLY new change is the `zod` addition under `@qlan-ro/mainframe-types`. If the diff contains unrelated changes from another session, stage `pnpm-lock.yaml` with `git add -p` selecting only the zod hunks.

---

## Task 3: Extend the Electron preload + main with the trivial missing channels

**Files:**
- Modify: `packages/desktop/src/preload/index.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Create: `packages/desktop/src/main/__tests__/ipc-contract.test.ts`

**Interfaces:**
- Consumes: `AppInfoSchema`, `FilePathSchema`, `OpenExternalSchema`, `NotifySchema`, `ClearSessionSchema`, `LogRecordSchema` (Task 2).
- Produces (on `window.mainframe`): `getAuthToken(): Promise<string|null>`, `readFileBase64(path): Promise<string|null>`, `getInfo` now returns `{ version, author, homedir }`. Consumed by the `ElectronAdapter` (Task 5).

- [ ] **Step 1: Write the failing IPC-contract test**

Create `packages/desktop/src/main/__tests__/ipc-contract.test.ts`. The handlers register via `setupIPC()`; we test the validating parse helpers directly. First extract a tiny validator helper. Write the test for that helper:

```ts
import { describe, it, expect } from 'vitest';
import { parseIpcArg } from '../ipc-validate.js';
import { FilePathSchema } from '@qlan-ro/mainframe-types';

describe('parseIpcArg', () => {
  it('returns the parsed value for valid input', () => {
    expect(parseIpcArg(FilePathSchema, '/Users/me/.mainframe/config.json', 'fs:readFile')).toBe(
      '/Users/me/.mainframe/config.json',
    );
  });

  it('throws a tagged error for invalid input', () => {
    expect(() => parseIpcArg(FilePathSchema, '', 'fs:readFile')).toThrow(/fs:readFile/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/main/__tests__/ipc-contract.test.ts`
Expected: FAIL — cannot resolve `../ipc-validate.js`.

- [ ] **Step 3: Write the validator helper**

Create `packages/desktop/src/main/ipc-validate.ts`:

```ts
import type { z } from 'zod';
import { createMainLogger } from './logger.js';

const log = createMainLogger('electron:ipc');

/**
 * Parse an IPC argument against the shared host contract. On failure, logs with
 * context and throws — the rejection surfaces to the renderer's invoke() caller
 * rather than passing malformed input into a privileged handler.
 */
export function parseIpcArg<T>(schema: z.ZodType<T>, value: unknown, channel: string): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    log.warn({ channel, issues: result.error.issues }, 'ipc arg validation failed');
    throw new Error(`Invalid argument for ${channel}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Run the helper test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/main/__tests__/ipc-contract.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the new main handlers + validate existing ones**

In `packages/desktop/src/main/index.ts`:

Add imports at top:

```ts
import { AppInfoSchema, FilePathSchema, OpenExternalSchema, NotifySchema, ClearSessionSchema } from '@qlan-ro/mainframe-types';
import { parseIpcArg } from './ipc-validate.js';
```

Replace the `app:getInfo` handler so it includes `homedir`:

```ts
  ipcMain.handle('app:getInfo', () => ({
    version: app.getVersion(),
    author: APP_AUTHOR,
    homedir: homedir(),
  }));
```

Add the auth-token handler (reads `~/.mainframe/config.json` `authSecret`; reuses the existing path allowlist concept):

```ts
  ipcMain.handle('app:getAuthToken', async () => {
    const home = homedir();
    const dataDir = process.env['MAINFRAME_DATA_DIR'] ?? join(home, '.mainframe');
    const configPath = join(dataDir, 'config.json');
    try {
      const raw = await readFile(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as { authSecret?: unknown };
      return typeof parsed.authSecret === 'string' ? parsed.authSecret : null;
    } catch (err) {
      log.warn({ err }, 'app:getAuthToken read failed');
      return null;
    }
  });
```

Add the base64 read handler (same allowlist as `fs:readFile` — extract the shared check to a local `isPathAllowed(normalizedPath)` function to avoid duplication and stay under the 50-line function limit):

```ts
  ipcMain.handle('fs:readFileBase64', async (_event, filePath: string) => {
    const path = parseIpcArg(FilePathSchema, filePath, 'fs:readFileBase64');
    const normalizedPath = resolve(path);
    if (!isPathAllowed(normalizedPath)) {
      log.warn({ path: normalizedPath }, 'ipc blocked base64 read outside allowed paths');
      return null;
    }
    try {
      const buf = await readFile(path);
      return buf.toString('base64');
    } catch (error) {
      log.warn({ err: error }, 'ipc readFileBase64 failed');
      return null;
    }
  });
```

Extract the allowlist into a module-scope helper (used by both read handlers):

```ts
function isPathAllowed(normalizedPath: string): boolean {
  const home = homedir();
  const dataDir = process.env['MAINFRAME_DATA_DIR'] ?? join(home, '.mainframe');
  const allowedPrefixes = [join(home, '.claude'), join(home, '.mainframe'), dataDir];
  return (
    allowedPrefixes.some((prefix) => normalizedPath.startsWith(prefix)) ||
    normalizedPath.includes(`${sep}.mainframe${sep}`)
  );
}
```

Refactor the existing `fs:readFile` handler to call `parseIpcArg(FilePathSchema, filePath, 'fs:readFile')` and `isPathAllowed(...)`. Add `parseIpcArg` validation to `shell:openExternal` (`OpenExternalSchema`), `shell:showItemInFolder` (`FilePathSchema`), `notify:show` (`NotifySchema` over `{title, body}`), and `sandbox:clearSession` (`ClearSessionSchema`). For `notify:show`, change the handler signature to accept `(title, body)` and parse `{ title, body }`.

- [ ] **Step 6: Add the preload surface**

In `packages/desktop/src/preload/index.ts`, update `MainframeAPI`:

```ts
  getAppInfo: () => Promise<{ version: string; author: string; homedir: string }>;
  getAuthToken: () => Promise<string | null>;
  readFileBase64: (filePath: string) => Promise<string | null>;
```

And the `api` object:

```ts
  getAuthToken: () => ipcRenderer.invoke('app:getAuthToken'),
  readFileBase64: (filePath: string) => ipcRenderer.invoke('fs:readFileBase64', filePath),
```

- [ ] **Step 7: Typecheck + run the IPC test**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit -p tsconfig.node.json` (verify the main/preload tsconfig name; desktop uses electron-vite so confirm via `ls packages/desktop/tsconfig*.json`. Use the one that includes `src/main` + `src/preload`.)
Then: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/main/__tests__/ipc-contract.test.ts`
Expected: both PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/main/index.ts \
  packages/desktop/src/main/ipc-validate.ts \
  packages/desktop/src/preload/index.ts \
  packages/desktop/src/main/__tests__/ipc-contract.test.ts
git commit -m "feat(desktop): add getAuthToken/readFileBase64/homedir + Zod-validate IPC

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Add daemon-status IPC to the Electron main + preload

**Files:**
- Create: `packages/desktop/src/main/daemon-status.ts`
- Create: `packages/desktop/src/main/__tests__/daemon-status.test.ts`
- Modify: `packages/desktop/src/main/index.ts`
- Modify: `packages/desktop/src/preload/index.ts`

**Interfaces:**
- Consumes: `DaemonStatus`, `DaemonStatusSchema` (Task 2).
- Produces (on `window.mainframe`): `daemon.port(): Promise<number>`, `daemon.status(): Promise<DaemonStatus>`, `daemon.onStatus(cb): () => void`. Consumed by the `ElectronAdapter` (Task 5).

- [ ] **Step 1: Write the failing tracker test**

Create `packages/desktop/src/main/__tests__/daemon-status.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { DaemonStatusTracker } from '../daemon-status.js';

describe('DaemonStatusTracker', () => {
  it('starts at initializing', () => {
    const t = new DaemonStatusTracker(31415);
    expect(t.get()).toBe('initializing');
    expect(t.port()).toBe(31415);
  });

  it('set() updates status and notifies subscribers', () => {
    const t = new DaemonStatusTracker(31415);
    const cb = vi.fn();
    t.subscribe(cb);
    t.set('ready');
    expect(t.get()).toBe('ready');
    expect(cb).toHaveBeenCalledWith('ready');
  });

  it('subscribe() immediately replays the current status', () => {
    const t = new DaemonStatusTracker(31415);
    t.set('starting');
    const cb = vi.fn();
    t.subscribe(cb);
    expect(cb).toHaveBeenCalledWith('starting');
  });

  it('unsubscribe stops further notifications', () => {
    const t = new DaemonStatusTracker(31415);
    const cb = vi.fn();
    const off = t.subscribe(cb);
    off();
    cb.mockClear();
    t.set('ready');
    expect(cb).not.toHaveBeenCalled();
  });

  it('rejects a status outside the contract vocabulary', () => {
    const t = new DaemonStatusTracker(31415);
    // @ts-expect-error — invalid status guarded at runtime
    expect(() => t.set('green')).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/main/__tests__/daemon-status.test.ts`
Expected: FAIL — cannot resolve `../daemon-status.js`.

- [ ] **Step 3: Write the tracker**

Create `packages/desktop/src/main/daemon-status.ts`:

```ts
import { DaemonStatusSchema, type DaemonStatus } from '@qlan-ro/mainframe-types';
import { createMainLogger } from './logger.js';

const log = createMainLogger('electron:daemon-status');

/**
 * Tracks the daemon lifecycle and fans status changes out to subscribers
 * (the IPC bridge wires one subscriber that sends 'daemon:status' to the
 * renderer). The port is fixed at construction (Electron owns 31415).
 */
export class DaemonStatusTracker {
  private status: DaemonStatus = 'initializing';
  private readonly listeners = new Set<(s: DaemonStatus) => void>();

  constructor(private readonly daemonPort: number) {}

  port(): number {
    return this.daemonPort;
  }

  get(): DaemonStatus {
    return this.status;
  }

  set(next: DaemonStatus): void {
    const validated = DaemonStatusSchema.parse(next);
    this.status = validated;
    log.info({ status: validated }, 'daemon status changed');
    for (const cb of this.listeners) cb(validated);
  }

  subscribe(cb: (s: DaemonStatus) => void): () => void {
    this.listeners.add(cb);
    cb(this.status); // replay current
    return () => {
      this.listeners.delete(cb);
    };
  }
}
```

- [ ] **Step 4: Run the tracker test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/main/__tests__/daemon-status.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the tracker into main + preload**

In `packages/desktop/src/main/index.ts`:

Add `import { DaemonStatusTracker } from './daemon-status.js';` and a module-scope `let daemonStatus: DaemonStatusTracker | null = null;`.

Define the daemon port once (Electron's fixed 31415, overridable by env to match the existing daemon-host convention):

```ts
const DAEMON_PORT = Number(process.env['DAEMON_PORT'] ?? process.env['VITE_DAEMON_HTTP_PORT'] ?? '31415');
```

In `startDaemon`, after `daemon = utilityProcess.fork(...)`, add:

```ts
  daemonStatus?.set('starting');
  daemon.on('spawn', () => daemonStatus?.set('ready'));
  daemon.on('exit', (code) => {
    log.error({ code }, 'daemon exited');
    daemonStatus?.set('stopped');
  });
```

(Remove the old standalone `daemon.on('exit', …)` block to avoid a double-listener.) In development mode (where the daemon is external) `startDaemon` returns early — set `daemonStatus?.set('ready')` in that branch so the renderer connects.

In `setupIPC()`, add the daemon channels:

```ts
  ipcMain.handle('daemon:port', () => daemonStatus?.port() ?? DAEMON_PORT);
  ipcMain.handle('daemon:status', () => daemonStatus?.get() ?? 'initializing');
```

In `app.whenReady()`, construct the tracker BEFORE `startDaemon`:

```ts
  daemonStatus = new DaemonStatusTracker(DAEMON_PORT);
```

After `createWindow()`, wire the broadcast (send `daemon:status` to the renderer on every change):

```ts
  daemonStatus.subscribe((s) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('daemon:status', s);
    }
  });
```

In `packages/desktop/src/preload/index.ts`, add to `MainframeAPI`:

```ts
  daemon: {
    port: () => Promise<number>;
    status: () => Promise<string>;
    onStatus: (callback: (status: string) => void) => () => void;
  };
```

And to `api`:

```ts
  daemon: {
    port: () => ipcRenderer.invoke('daemon:port'),
    status: () => ipcRenderer.invoke('daemon:status'),
    onStatus: (callback: (status: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, status: string): void => callback(status);
      ipcRenderer.on('daemon:status', handler);
      return () => {
        ipcRenderer.removeListener('daemon:status', handler);
      };
    },
  },
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit -p tsconfig.node.json` (use the main/preload tsconfig confirmed in Task 3 Step 7)
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/main/daemon-status.ts \
  packages/desktop/src/main/__tests__/daemon-status.test.ts \
  packages/desktop/src/main/index.ts \
  packages/desktop/src/preload/index.ts
git commit -m "feat(desktop): add daemon port/status/onStatus IPC + status tracker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Terminal bytes over IPC (Electron main + preload)

**Files:**
- Modify: `packages/desktop/src/main/terminal-manager.ts`
- Modify: `packages/desktop/src/preload/index.ts`
- Create: `packages/desktop/src/main/__tests__/terminal-manager.test.ts`

**Interfaces:**
- Consumes: `TerminalCreateOptsSchema`, `TerminalWriteSchema`, `TerminalResizeSchema`, `TerminalIdSchema` (Task 2).
- Produces: `terminal:create` accepts a caller-supplied `{ id, cwd, cols, rows }` and no longer generates the id; `terminal:data(id, Buffer)` and `terminal:exit(id, code)` carry bytes. Consumed by `ElectronAdapter.terminal` (Task 6).

The renderer contract (`TerminalOpts.id` caller-supplied; `onData(Uint8Array)`) requires main to (a) accept the id and (b) send bytes. node-pty's `onData` yields `string`; convert with `Buffer.from(data, 'utf-8')`. An IPC `Buffer` arrives in the renderer as a `Uint8Array`.

- [ ] **Step 1: Write the failing terminal-manager test**

Create `packages/desktop/src/main/__tests__/terminal-manager.test.ts`. Mock `node-pty` and `electron` `ipcMain`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const handlers = new Map<string, (...a: unknown[]) => unknown>();
const sent: Array<{ channel: string; args: unknown[] }> = [];
const onDataCbs: Array<(d: string) => void> = [];
const onExitCbs: Array<(e: { exitCode: number }) => void> = [];

vi.mock('electron', () => ({
  ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn) },
}));
vi.mock('node-pty', () => ({
  default: {
    spawn: () => ({
      onData: (cb: (d: string) => void) => onDataCbs.push(cb),
      onExit: (cb: (e: { exitCode: number }) => void) => onExitCbs.push(cb),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    }),
  },
}));
vi.mock('fs', () => ({ statSync: () => ({ isDirectory: () => true }) }));
vi.mock('../logger.js', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

beforeEach(() => {
  handlers.clear();
  sent.length = 0;
  onDataCbs.length = 0;
  onExitCbs.length = 0;
});

function fakeEvent() {
  return {
    sender: {
      id: 1,
      isDestroyed: () => false,
      send: (channel: string, ...args: unknown[]) => sent.push({ channel, args }),
    },
  };
}

describe('terminal-manager — bytes over IPC, caller-supplied id', () => {
  it('uses the caller-supplied id and sends terminal:data as a Buffer', async () => {
    const { setupTerminalIPC } = await import('../terminal-manager.js');
    setupTerminalIPC({ SHELL: '/bin/zsh' });
    const create = handlers.get('terminal:create')!;
    const result = (await create(fakeEvent(), { id: 'caller-id', cwd: '/tmp', cols: 80, rows: 24 })) as {
      id: string;
    };
    expect(result.id).toBe('caller-id');

    onDataCbs[0]!('hi');
    const dataMsg = sent.find((s) => s.channel === 'terminal:data');
    expect(dataMsg).toBeDefined();
    expect(dataMsg!.args[0]).toBe('caller-id');
    expect(Buffer.isBuffer(dataMsg!.args[1])).toBe(true);
    expect((dataMsg!.args[1] as Buffer).toString('utf-8')).toBe('hi');
  });

  it('sends terminal:exit with the id and exit code', async () => {
    const { setupTerminalIPC } = await import('../terminal-manager.js');
    setupTerminalIPC({ SHELL: '/bin/zsh' });
    const create = handlers.get('terminal:create')!;
    await create(fakeEvent(), { id: 'caller-id', cwd: '/tmp', cols: 80, rows: 24 });
    onExitCbs[0]!({ exitCode: 0 });
    const exitMsg = sent.find((s) => s.channel === 'terminal:exit');
    expect(exitMsg).toBeDefined();
    expect(exitMsg!.args).toEqual(['caller-id', 0]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/main/__tests__/terminal-manager.test.ts`
Expected: FAIL — main still generates `randomUUID()` (id mismatch) and sends `string` (not a Buffer).

- [ ] **Step 3: Update the terminal manager**

In `packages/desktop/src/main/terminal-manager.ts`:

Add `import { TerminalCreateOptsSchema, TerminalWriteSchema, TerminalResizeSchema, TerminalIdSchema } from '@qlan-ro/mainframe-types';` and `import { parseIpcArg } from './ipc-validate.js';`. Remove the `randomUUID` import.

Change the `terminal:create` handler signature/body:

```ts
  ipcMain.handle(
    'terminal:create',
    (event: IpcMainInvokeEvent, options: unknown) => {
      const opts = parseIpcArg(TerminalCreateOptsSchema, options, 'terminal:create');
      try {
        const st = statSync(opts.cwd);
        if (!st.isDirectory()) throw new Error(`Not a directory: ${opts.cwd}`);
      } catch (err) {
        log.warn({ cwd: opts.cwd, err }, 'terminal:create invalid cwd');
        throw new Error(`Invalid terminal cwd: ${opts.cwd}`);
      }

      const id = opts.id;
      const term = pty.spawn(defaultShell, [], {
        name: 'xterm-256color',
        cols: opts.cols,
        rows: opts.rows,
        cwd: opts.cwd,
        env: { ...process.env, ...shellEnv, TERM_PROGRAM: 'Mainframe', ZSH_DOTENV_PROMPT: 'false' },
      });

      const webContentsId = event.sender.id;
      terminals.set(id, { pty: term, webContentsId });

      term.onData((data: string) => {
        try {
          if (!event.sender.isDestroyed()) {
            event.sender.send('terminal:data', id, Buffer.from(data, 'utf-8'));
          }
        } catch {
          /* expected: webContents destroyed — cleaned up on quit */
        }
      });

      term.onExit(({ exitCode }) => {
        try {
          if (!event.sender.isDestroyed()) event.sender.send('terminal:exit', id, exitCode);
        } catch {
          /* expected: webContents destroyed */
        }
        terminals.delete(id);
      });

      log.info({ id, cwd: opts.cwd, shell: defaultShell }, 'terminal created');
      return { id };
    },
  );
```

Update `terminal:write`/`terminal:resize`/`terminal:kill` to parse their args via `TerminalWriteSchema`/`TerminalResizeSchema`/`TerminalIdSchema` and read `id`/`data`/`cols`/`rows` from the parsed object.

- [ ] **Step 4: Update the preload terminal types**

In `packages/desktop/src/preload/index.ts`, change `TerminalAPI`:

```ts
export interface TerminalAPI {
  create: (options: { id: string; cwd: string; cols: number; rows: number }) => Promise<{ id: string }>;
  write: (id: string, data: string) => Promise<void>;
  resize: (id: string, cols: number, rows: number) => Promise<void>;
  kill: (id: string) => Promise<void>;
  onData: (callback: (id: string, data: Uint8Array) => void) => () => void;
  onExit: (callback: (id: string, exitCode: number | null) => void) => () => void;
}
```

Update the `api.terminal.create` to pass the full object and the `onData` handler to type `data` as `Uint8Array` (the IPC `Buffer` arrives as `Uint8Array` in the sandboxed renderer). The `create` call body becomes `(options) => ipcRenderer.invoke('terminal:create', options)`.

- [ ] **Step 5: Run the terminal test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/main/__tests__/terminal-manager.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit -p tsconfig.node.json`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/main/terminal-manager.ts \
  packages/desktop/src/preload/index.ts \
  packages/desktop/src/main/__tests__/terminal-manager.test.ts
git commit -m "feat(desktop): terminal IPC sends bytes + accepts caller-supplied id

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Build the `ElectronAdapter` (app/fs/shell/notify/terminal/daemon/log)

**Files:**
- Create: `packages/app-tauri/src/lib/host/electron-adapter.ts`
- Create: `packages/app-tauri/src/lib/host/__tests__/electron-adapter.test.ts`
- Modify: `packages/app-tauri/src/lib/host/detect.ts`

`preview` is added in Task 8; this task gives `ElectronAdapter.preview` a throwing stub so the file compiles, then Task 8 replaces it.

**Interfaces:**
- Consumes: the `window.mainframe.*` surface from Tasks 3/4/5; `HostBridge`, `Platform`, `DaemonStatus`, `AppInfo`, `TerminalOpts`, `TerminalHandlers`, `TerminalHandle`, `Unsubscribe`, `LogLevel` from `mainframe-types`.
- Produces: `class ElectronAdapter implements HostBridge`; `isElectronRuntime(): boolean`. Consumed by Task 8 (preview), the `getHost()` branch (Task 9), and `main.tsx`.

- [ ] **Step 1: Add `isElectronRuntime` (no test of its own — covered by host-context)**

In `packages/app-tauri/src/lib/host/detect.ts`, append:

```ts
/**
 * Electron exposes `window.mainframe` (the preload bridge). Absent under Tauri
 * (which uses __TAURI_INTERNALS__) and in a plain browser / vitest jsdom.
 */
export function isElectronRuntime(): boolean {
  return typeof window !== 'undefined' && 'mainframe' in window;
}
```

- [ ] **Step 2: Write the failing adapter test**

Create `packages/app-tauri/src/lib/host/__tests__/electron-adapter.test.ts`. Stub `window.mainframe`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ElectronAdapter } from '../electron-adapter';

interface FakeMainframe {
  platform: string;
  getAppInfo: ReturnType<typeof vi.fn>;
  getHomedir: ReturnType<typeof vi.fn>;
  getAuthToken: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  readFileBase64: ReturnType<typeof vi.fn>;
  showItemInFolder: ReturnType<typeof vi.fn>;
  openExternal: ReturnType<typeof vi.fn>;
  showNotification: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  terminal: {
    create: ReturnType<typeof vi.fn>;
    write: ReturnType<typeof vi.fn>;
    resize: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    onData: ReturnType<typeof vi.fn>;
    onExit: ReturnType<typeof vi.fn>;
  };
  daemon: {
    port: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    onStatus: ReturnType<typeof vi.fn>;
  };
}

let mf: FakeMainframe;
let dataCbs: Array<(id: string, data: Uint8Array) => void>;
let exitCbs: Array<(id: string, code: number | null) => void>;

beforeEach(() => {
  dataCbs = [];
  exitCbs = [];
  mf = {
    platform: 'darwin',
    getAppInfo: vi.fn().mockResolvedValue({ version: '1.0', author: 'q', homedir: '/h' }),
    getHomedir: vi.fn().mockResolvedValue('/h'),
    getAuthToken: vi.fn().mockResolvedValue('secret'),
    readFile: vi.fn().mockResolvedValue('text'),
    readFileBase64: vi.fn().mockResolvedValue('YmFzZTY0'),
    showItemInFolder: vi.fn().mockResolvedValue(undefined),
    openExternal: vi.fn().mockResolvedValue(undefined),
    showNotification: vi.fn().mockResolvedValue(undefined),
    log: vi.fn(),
    terminal: {
      create: vi.fn().mockResolvedValue({ id: 't1' }),
      write: vi.fn().mockResolvedValue(undefined),
      resize: vi.fn().mockResolvedValue(undefined),
      kill: vi.fn().mockResolvedValue(undefined),
      onData: vi.fn((cb: (id: string, data: Uint8Array) => void) => {
        dataCbs.push(cb);
        return () => {};
      }),
      onExit: vi.fn((cb: (id: string, code: number | null) => void) => {
        exitCbs.push(cb);
        return () => {};
      }),
    },
    daemon: {
      port: vi.fn().mockResolvedValue(31415),
      status: vi.fn().mockResolvedValue('ready'),
      onStatus: vi.fn((cb: (s: string) => void) => {
        cb('ready');
        return () => {};
      }),
    },
  };
  (globalThis as unknown as { window: { mainframe: FakeMainframe } }).window = Object.assign(globalThis.window ?? {}, {
    mainframe: mf,
  });
});

afterEach(() => {
  delete (globalThis.window as unknown as Record<string, unknown>).mainframe;
});

describe('ElectronAdapter — delegation', () => {
  it('app.platform maps darwin → macos', async () => {
    await expect(new ElectronAdapter().app.platform()).resolves.toBe('macos');
  });

  it('app.getInfo delegates to getAppInfo', async () => {
    await expect(new ElectronAdapter().app.getInfo()).resolves.toEqual({ version: '1.0', author: 'q', homedir: '/h' });
  });

  it('app.getAuthToken delegates', async () => {
    await expect(new ElectronAdapter().app.getAuthToken()).resolves.toBe('secret');
  });

  it('fs.readFileBase64 delegates', async () => {
    await expect(new ElectronAdapter().fs.readFileBase64('/p')).resolves.toBe('YmFzZTY0');
  });

  it('daemon.port/status/onStatus delegate', async () => {
    const a = new ElectronAdapter();
    await expect(a.daemon.port()).resolves.toBe(31415);
    await expect(a.daemon.status()).resolves.toBe('ready');
    const cb = vi.fn();
    const unsub = await a.daemon.onStatus(cb);
    expect(cb).toHaveBeenCalledWith('ready');
    expect(() => unsub()).not.toThrow();
  });
});

describe('ElectronAdapter — terminal demux', () => {
  it('routes terminal:data to the matching handle only, as a Uint8Array', async () => {
    const a = new ElectronAdapter();
    const onData1 = vi.fn();
    const onExit1 = vi.fn();
    const onData2 = vi.fn();
    const onExit2 = vi.fn();
    mf.terminal.create.mockResolvedValueOnce({ id: 't1' });
    await a.terminal.create({ id: 't1', cwd: '/tmp', cols: 80, rows: 24 }, { onData: onData1, onExit: onExit1 });
    mf.terminal.create.mockResolvedValueOnce({ id: 't2' });
    await a.terminal.create({ id: 't2', cwd: '/tmp', cols: 80, rows: 24 }, { onData: onData2, onExit: onExit2 });

    const bytes = new Uint8Array([104, 105]);
    dataCbs.forEach((cb) => cb('t1', bytes));
    expect(onData1).toHaveBeenCalledWith(bytes);
    expect(onData2).not.toHaveBeenCalled();

    exitCbs.forEach((cb) => cb('t2', 0));
    expect(onExit2).toHaveBeenCalledWith(0);
    expect(onExit1).not.toHaveBeenCalled();
  });
});

describe('ElectronAdapter — log', () => {
  it('forwards to window.mainframe.log', () => {
    new ElectronAdapter().log('info', 'mod', 'msg', { a: 1 });
    expect(mf.log).toHaveBeenCalledWith('info', 'mod', 'msg', { a: 1 });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/electron-adapter.test.ts`
Expected: FAIL — `electron-adapter` does not exist.

- [ ] **Step 4: Write the adapter**

Create `packages/app-tauri/src/lib/host/electron-adapter.ts`:

```ts
/**
 * ElectronAdapter — HostBridge over the Electron preload bridge (window.mainframe).
 *
 * The preload exposes GLOBAL terminal events (onData(id, bytes) / onExit(id, code))
 * for all terminals; this adapter registers ONE global listener pair and demuxes
 * by id into per-handle callbacks. Bytes arrive as Uint8Array (the main process
 * sends a Buffer; IPC delivers it as Uint8Array in the sandboxed renderer).
 *
 * preview is implemented in electron-preview.ts (Task 8); mount() delegates there.
 */
import type {
  HostBridge,
  AppInfo,
  Platform,
  LogLevel,
  DaemonStatus,
  TerminalOpts,
  TerminalHandlers,
  TerminalHandle,
  PreviewOpts,
  PreviewHandle,
  Unsubscribe,
} from '@qlan-ro/mainframe-types';
import { mountElectronPreview } from './electron-preview';

interface MainframeBridge {
  platform: string;
  getAppInfo(): Promise<AppInfo>;
  getHomedir(): Promise<string>;
  getAuthToken(): Promise<string | null>;
  readFile(path: string): Promise<string | null>;
  readFileBase64(path: string): Promise<string | null>;
  showItemInFolder(path: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  showNotification(title: string, body?: string): Promise<void>;
  clearSandboxSession(projectId: string): Promise<void>;
  log(level: string, module: string, message: string, data?: unknown): void;
  terminal: {
    create(opts: { id: string; cwd: string; cols: number; rows: number }): Promise<{ id: string }>;
    write(id: string, data: string): Promise<void>;
    resize(id: string, cols: number, rows: number): Promise<void>;
    kill(id: string): Promise<void>;
    onData(cb: (id: string, data: Uint8Array) => void): () => void;
    onExit(cb: (id: string, code: number | null) => void): () => void;
  };
  daemon: {
    port(): Promise<number>;
    status(): Promise<string>;
    onStatus(cb: (status: string) => void): () => void;
  };
}

function bridge(): MainframeBridge {
  const mf = (window as unknown as { mainframe?: MainframeBridge }).mainframe;
  if (!mf) throw new Error('window.mainframe is unavailable (not running under Electron)');
  return mf;
}

function mapPlatform(p: string): Platform {
  if (p === 'darwin') return 'macos';
  if (p === 'win32') return 'windows';
  if (p === 'linux') return 'linux';
  return 'browser';
}

export class ElectronAdapter implements HostBridge {
  /** Per-terminal handler registries; the global listeners demux into these. */
  private readonly dataHandlers = new Map<string, (bytes: Uint8Array) => void>();
  private readonly exitHandlers = new Map<string, (code: number | null) => void>();
  private terminalListenersInstalled = false;

  app = {
    getInfo: (): Promise<AppInfo> => bridge().getAppInfo(),
    getHomedir: (): Promise<string> => bridge().getHomedir(),
    getAuthToken: (): Promise<string | null> => bridge().getAuthToken(),
    platform: (): Promise<Platform> => Promise.resolve(mapPlatform(bridge().platform)),
  };

  fs = {
    readFile: (path: string): Promise<string | null> => bridge().readFile(path),
    readFileBase64: (path: string): Promise<string | null> => bridge().readFileBase64(path),
    showItemInFolder: (path: string): Promise<void> => bridge().showItemInFolder(path),
  };

  shell = {
    openExternal: (url: string): Promise<void> => bridge().openExternal(url),
  };

  notify(title: string, body?: string): Promise<void> {
    return bridge().showNotification(title, body);
  }

  private installTerminalListeners(): void {
    if (this.terminalListenersInstalled) return;
    this.terminalListenersInstalled = true;
    bridge().terminal.onData((id, bytes) => this.dataHandlers.get(id)?.(bytes));
    bridge().terminal.onExit((id, code) => {
      this.exitHandlers.get(id)?.(code);
      this.dataHandlers.delete(id);
      this.exitHandlers.delete(id);
    });
  }

  terminal = {
    create: async (opts: TerminalOpts, handlers: TerminalHandlers): Promise<TerminalHandle> => {
      this.installTerminalListeners();
      this.dataHandlers.set(opts.id, handlers.onData);
      this.exitHandlers.set(opts.id, handlers.onExit);
      await bridge().terminal.create({ id: opts.id, cwd: opts.cwd, cols: opts.cols, rows: opts.rows });
      return {
        write: (data: string): Promise<void> => bridge().terminal.write(opts.id, data),
        resize: (cols: number, rows: number): Promise<void> => bridge().terminal.resize(opts.id, cols, rows),
        kill: async (): Promise<void> => {
          await bridge().terminal.kill(opts.id);
          this.dataHandlers.delete(opts.id);
          this.exitHandlers.delete(opts.id);
        },
      };
    },
  };

  preview = {
    mount: (container: HTMLElement, url: string, opts?: PreviewOpts): PreviewHandle =>
      mountElectronPreview(container, url, opts),
    clearSession: (projectId: string): Promise<void> => bridge().clearSandboxSession(projectId),
  };

  daemon = {
    port: (): Promise<number> => bridge().daemon.port(),
    status: (): Promise<DaemonStatus> => bridge().daemon.status() as Promise<DaemonStatus>,
    onStatus: (cb: (status: DaemonStatus) => void): Promise<Unsubscribe> => {
      const off = bridge().daemon.onStatus((s) => cb(s as DaemonStatus));
      return Promise.resolve(off);
    },
  };

  log(level: LogLevel, module: string, message: string, data?: unknown): void {
    bridge().log(level, module, message, data);
  }
}
```

NOTE: this imports `mountElectronPreview` from `./electron-preview` (Task 8). To keep this task self-contained and compiling, create a MINIMAL `electron-preview.ts` stub now (Task 8 fills it in):

```ts
// packages/app-tauri/src/lib/host/electron-preview.ts (stub — Task 8 implements)
import type { PreviewOpts, PreviewHandle } from '@qlan-ro/mainframe-types';
export function mountElectronPreview(_container: HTMLElement, _url: string, _opts?: PreviewOpts): PreviewHandle {
  throw new Error('mountElectronPreview not yet implemented (Task 8)');
}
```

Add `clearSandboxSession` to the `MainframeBridge` interface (it already exists on the real preload from before this plan).

- [ ] **Step 5: Run the adapter test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/electron-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app-tauri/src/lib/host/electron-adapter.ts \
  packages/app-tauri/src/lib/host/electron-preview.ts \
  packages/app-tauri/src/lib/host/detect.ts \
  packages/app-tauri/src/lib/host/__tests__/electron-adapter.test.ts
git commit -m "feat(app-tauri): add ElectronAdapter (terminal demux + byte translation)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Reshape the renderer onto `PreviewHandle` + the Tauri preview backend

This is the riskiest task. It refactors `PreviewInstance` + the 4 `use-preview-*` hooks (occlusion is unchanged) to consume a single `PreviewHandle`, and implements the `TauriPreviewBackend` that satisfies `mount()` while driving the existing Rust commands. The contract (Task 1) and adapters (`TauriAdapter.preview.mount` stub) are wired here for real on Tauri.

**Files:**
- Create: `packages/app-tauri/src/lib/host/tauri-preview.ts`
- Create: `packages/app-tauri/src/lib/host/__tests__/tauri-preview.test.ts`
- Modify: `packages/app-tauri/src/lib/host/tauri-adapter.ts`
- Modify: `packages/app-tauri/src/features/preview/use-preview-lifecycle.ts`
- Modify: `packages/app-tauri/src/features/preview/use-preview-geometry.ts`
- Modify: `packages/app-tauri/src/features/preview/use-preview-visibility.ts`
- Modify: `packages/app-tauri/src/features/preview/use-preview-capture.ts`
- Modify: `packages/app-tauri/src/features/preview/PreviewInstance.tsx`
- Modify: `packages/app-tauri/src/lib/host/__tests__/tauri-adapter.test.ts` (preview-capture test → mount shape)
- Modify: existing preview hook tests (mock host `preview` → mount shape) — enumerate and fix.

**Interfaces:**
- Consumes: `PreviewHandle`, `PreviewOpts`, `Region`, `InspectResult`, `Unsubscribe` (Task 1). The existing `lib/tauri/preview` free functions.
- Produces: `function mountTauriPreview(container, url, opts?): PreviewHandle`; the reshaped `usePreviewLifecycle` returning `{ processStopped, handle }`. Consumed by `TauriAdapter.preview.mount` and `PreviewInstance`.

### Design of the refactor

Today the 4 hooks each call `host.preview.<verb>(tabId, …)`. After the reshape, **`usePreviewLifecycle` owns the single `PreviewHandle`** (created by `host.preview.mount(container, url, opts)` when the process first goes `running`), stores it in a ref/state, and the other hooks receive the `handle` (or `null`) and call methods on it. The `tabId` is no longer threaded into host calls — the handle is the identity.

Before/after call shapes:

| Hook | Before | After |
|---|---|---|
| lifecycle | `host.preview.create(tabId, url, bounds)` / `navigate` / `destroy(tabId)` | `host.preview.mount(container, url, {projectId, device})` once → `handle`; re-run navigates via `handle.navigate(url)`; teardown `handle.destroy()` |
| geometry | `host.preview.setBounds(tabId, rect)` every rAF | `handle.refit()` on resize/layout change (Tauri reads the rect itself; Electron no-op) |
| visibility | `host.preview.setVisible(tabId, v)` | `handle.setVisible(v)` |
| capture | `host.preview.capture(tabId, region)` / `eval(tabId, js)` / `onInspectResult(cb)` | `handle.capture(region)` / `handle.startInspect()` / `handle.onInspect(cb)` |

`mount(container, url, opts)` takes the CONTAINER element (the `containerRef.current` `flex-1` body wrapper in `PreviewInstance`), not the anchor. The Tauri backend reads `container.getBoundingClientRect()` for positioning; the Electron backend appends a `<webview>` to it.

- [ ] **Step 1: Write the failing Tauri-preview backend test**

Create `packages/app-tauri/src/lib/host/__tests__/tauri-preview.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const invoke = vi.fn();
const listen = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: (...a: unknown[]) => listen(...a) }));

beforeEach(() => {
  (globalThis as Record<string, unknown>).window = Object.assign(globalThis.window ?? {}, { __TAURI_INTERNALS__: {} });
  invoke.mockReset().mockResolvedValue(undefined);
  listen.mockReset().mockResolvedValue(() => {});
});
afterEach(() => {
  delete (globalThis.window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

function fakeContainer(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 300, height: 400 }) as DOMRect;
  return el;
}

describe('mountTauriPreview', () => {
  it('mount() calls preview_create with the container rect bounds', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    mountTauriPreview(fakeContainer(), 'http://localhost:3000', { projectId: 'p1' });
    // mount is sync, create fires async — flush microtasks
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith(
      'preview_create',
      expect.objectContaining({ url: 'http://localhost:3000', bounds: { x: 10, y: 20, w: 300, h: 400 } }),
    );
  });

  it('navigate() delegates to preview_navigate', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://localhost:3000');
    await Promise.resolve();
    invoke.mockClear();
    await handle.navigate('http://localhost:4000');
    expect(invoke).toHaveBeenCalledWith('preview_navigate', expect.objectContaining({ url: 'http://localhost:4000' }));
  });

  it('capture() wraps the invoke number[] as a Uint8Array', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://x');
    await Promise.resolve();
    invoke.mockResolvedValueOnce([137, 80, 78, 71]);
    const bytes = await handle.capture();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(Array.from(bytes)).toEqual([137, 80, 78, 71]);
  });

  it('destroy() calls preview_destroy', async () => {
    const { mountTauriPreview } = await import('../tauri-preview');
    const handle = mountTauriPreview(fakeContainer(), 'http://x');
    await Promise.resolve();
    invoke.mockClear();
    handle.destroy();
    await Promise.resolve();
    expect(invoke).toHaveBeenCalledWith('preview_destroy', expect.objectContaining({ tabId: expect.any(String) }));
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-preview.test.ts`
Expected: FAIL — `tauri-preview` does not exist.

- [ ] **Step 3: Write the Tauri preview backend**

Create `packages/app-tauri/src/lib/host/tauri-preview.ts`:

```ts
/**
 * TauriPreviewBackend — backs HostBridge.preview.mount on Tauri.
 *
 * Tauri composites a native child WKWebView over the DOM. mount() takes the DOM
 * container, generates a stable tabId, creates the child webview at the
 * container's current rect, and returns a PreviewHandle whose methods delegate to
 * the existing Rust commands (lib/tauri/preview). refit() re-reads the container
 * rect and re-issues preview_set_bounds (the renderer no longer threads bounds
 * through every call).
 */
import type { PreviewOpts, PreviewHandle, Region, InspectResult, Unsubscribe } from '@qlan-ro/mainframe-types';
import * as preview from '@/lib/tauri/preview';

let tabSeq = 0;

export function mountTauriPreview(container: HTMLElement, url: string, _opts?: PreviewOpts): PreviewHandle {
  const tabId = `preview-${++tabSeq}`;

  const readBounds = () => {
    const r = container.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  };

  void preview.previewCreate(tabId, url, readBounds()).catch((e) => console.warn('[preview] tauri create', e));

  return {
    setVisible: (visible: boolean): void => {
      void preview.previewSetVisible(tabId, visible).catch((e) => console.warn('[preview] tauri setVisible', e));
    },
    navigate: (next: string): Promise<void> => preview.previewNavigate(tabId, next),
    capture: (region?: Region): Promise<Uint8Array> => preview.previewCapture(tabId, region),
    startInspect: (): Promise<void> =>
      preview.previewEval(tabId, `window.__mfInspectInstall && window.__mfInspectInstall('${tabId}')`),
    onInspect: (cb: (result: InspectResult) => void): Unsubscribe => {
      let unlisten: (() => void) | null = null;
      void preview
        .onInspectResult((result) => {
          if (result.tabId === tabId) cb(result);
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch((e) => console.warn('[preview] tauri onInspect', e));
      return () => unlisten?.();
    },
    refit: (): void => {
      void preview.previewSetBounds(tabId, readBounds()).catch((e) => console.warn('[preview] tauri refit', e));
    },
    setDevice: (): void => {
      // Tauri preview frame sizing is driven by the container rect; device toggle
      // changes the container size, picked up by refit(). No native call needed.
    },
    destroy: (): void => {
      void preview.previewDestroy(tabId).catch((e) => console.warn('[preview] tauri destroy', e));
    },
  };
}
```

NOTE on the inspect filtering: the previous `usePreviewCapture` filtered `result.tabId !== tabId`; that filter now lives in the backend's `onInspect`, so the hook can drop it.

- [ ] **Step 4: Wire `TauriAdapter.preview` to the backend**

In `packages/app-tauri/src/lib/host/tauri-adapter.ts`, replace the Task-1 throwing stub:

```ts
import { mountTauriPreview } from './tauri-preview';
import type { PreviewOpts, PreviewHandle } from '@qlan-ro/mainframe-types';
// …
  preview = {
    mount: (container: HTMLElement, url: string, opts?: PreviewOpts): PreviewHandle =>
      mountTauriPreview(container, url, opts),
    clearSession: (_projectId: string): Promise<void> => Promise.resolve(),
    // clearSession on Tauri is a documented no-op stub for Plan 2; the Rust
    // command lands in Plan 3 (parity matrix: sandbox session isolation).
  };
```

Rename the drag attribute in `init()`: `data-tauri-drag-region` → `data-drag-region`.

- [ ] **Step 5: Run the backend test + Tauri-adapter test**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-preview.test.ts`
Expected: PASS.

Update `packages/app-tauri/src/lib/host/__tests__/tauri-adapter.test.ts`:
- The drag test: change `region.setAttribute('data-tauri-drag-region', '')` → `region.setAttribute('data-drag-region', '')`, and the describe text.
- Delete the `preview.capture wraps the invoke number[]` test (preview is now covered by `tauri-preview.test.ts`; `TauriAdapter.preview.mount` is a one-line delegate). Add instead a delegation test:

```ts
  it('preview.mount returns a handle (delegates to the Tauri backend)', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    const container = document.createElement('div');
    container.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
    const handle = new TauriAdapter().preview.mount(container, 'http://x', { projectId: 'p' });
    expect(typeof handle.setVisible).toBe('function');
    expect(typeof handle.destroy).toBe('function');
  });
```

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Refactor `usePreviewLifecycle` to own the handle**

Rewrite `packages/app-tauri/src/features/preview/use-preview-lifecycle.ts`. The hook now takes the `containerRef` + `projectId` + `device`, mounts once on first `running`, and exposes the handle:

```ts
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useHost } from '@/lib/host';
import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';

interface PreviewLifecycleProps {
  status: LaunchProcessStatus | null;
  port: number | null;
  containerRef: RefObject<HTMLDivElement | null>;
  projectId?: string;
  device: 'desktop' | 'mobile';
}

export function usePreviewLifecycle({ status, port, containerRef, projectId, device }: PreviewLifecycleProps): {
  processStopped: boolean;
  handle: PreviewHandle | null;
} {
  const host = useHost();
  const [handle, setHandle] = useState<PreviewHandle | null>(null);
  const handleRef = useRef<PreviewHandle | null>(null);
  const prevStatusRef = useRef<LaunchProcessStatus | null>(null);
  const [processStopped, setProcessStopped] = useState(false);

  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status ?? null;

    // running → stopped/failed: tear the webview down, show placeholder
    if (handleRef.current && prevStatus === 'running' && (status === 'stopped' || status === 'failed')) {
      handleRef.current.destroy();
      handleRef.current = null;
      setHandle(null);
      setProcessStopped(true);
      return;
    }

    if (status !== 'running' || port === null) return;
    setProcessStopped(false);

    const url = `http://localhost:${port}`;
    if (!handleRef.current) {
      const container = containerRef.current;
      if (!container) return;
      const h = host.preview.mount(container, url, { projectId, device });
      handleRef.current = h;
      setHandle(h);
    } else {
      void handleRef.current.navigate(url).catch((e) => console.warn('[preview] lifecycle navigate', e));
    }
  }, [status, port, containerRef, projectId, device, host]);

  useEffect(() => {
    return () => {
      handleRef.current?.destroy();
      handleRef.current = null;
    };
  }, []);

  return { processStopped, handle };
}
```

- [ ] **Step 7: Refactor `use-preview-geometry`, `use-preview-visibility`, `use-preview-capture`**

`use-preview-geometry.ts` — drop the `host`/`tabId`/`anchorRef` host calls; call `handle.refit()`:

```ts
import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { LaunchProcessStatus, PreviewHandle } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '@/store/layout';
import { useUiPrefs } from '@/store/ui-prefs';

interface PreviewGeometryProps {
  handle: PreviewHandle | null;
  anchorRef: RefObject<HTMLDivElement | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  active: boolean;
  status: LaunchProcessStatus | null;
}

export function usePreviewGeometry({ handle, anchorRef, containerRef, active, status }: PreviewGeometryProps): void {
  const rafRef = useRef<number | null>(null);

  function scheduleRefit() {
    if (!handle) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      handle.refit();
    });
  }

  const topFlex = useLayoutStore((s) => s.layout.topFlex);
  const vFlex = useLayoutStore((s) => s.layout.vFlex);
  const sidebarVisible = useUiPrefs((s) => s.sidebarVisible);
  const inspectorVisible = useUiPrefs((s) => s.inspectorVisible);

  useEffect(() => {
    scheduleRefit();
  }, [topFlex, vFlex, sidebarVisible, inspectorVisible, handle]);

  useEffect(() => {
    if (active) scheduleRefit();
  }, [active, handle]);

  useEffect(() => {
    const observer = new ResizeObserver(() => scheduleRefit());
    if (containerRef.current) observer.observe(containerRef.current);
    if (anchorRef.current) observer.observe(anchorRef.current);
    scheduleRefit();
    return () => {
      observer.disconnect();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [anchorRef, containerRef, status, handle]);
}
```

`use-preview-visibility.ts` — keep `computePreviewVisible` unchanged; call `handle.setVisible(v)`:

```ts
import { useEffect, useRef, useState } from 'react';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '@/store/layout';

// computePreviewVisible(...) unchanged — keep the existing exported function as-is.

export function usePreviewVisibility(
  handle: PreviewHandle | null,
  isActiveTab: boolean,
  occluded: boolean,
): [overlayMounted: boolean, setOverlayMounted: (v: boolean) => void] {
  const [overlayMounted, setOverlayMounted] = useState(false);
  const surfaceVisible = useLayoutStore((s) => {
    const { layout } = s;
    return (Array.isArray(layout.top) && layout.top.includes('run')) || layout.bottom === 'run';
  });
  const prevVisibleRef = useRef<boolean | null>(null);

  useEffect(() => {
    const visible = computePreviewVisible({ isActiveTab, surfaceVisible, overlayMounted, occluded });
    if (visible === prevVisibleRef.current) return;
    prevVisibleRef.current = visible;
    handle?.setVisible(visible);
  }, [handle, isActiveTab, surfaceVisible, overlayMounted, occluded]);

  return [overlayMounted, setOverlayMounted];
}
```

`use-preview-capture.ts` — replace `host.preview.capture/eval/onInspectResult` with `handle.capture/startInspect/onInspect`. The `result.tabId !== tabId` guard moves into the backend (Task 3 of this task), so drop it. Signature becomes `usePreviewCapture(handle: PreviewHandle | null, setOverlayMounted)`:

```ts
import { useState, useCallback, useEffect } from 'react';
import type { InspectResult, Region, PreviewHandle } from '@qlan-ro/mainframe-types';
import { useSandboxStore } from '@/store/sandbox';
import { useSendCaptures } from './use-send-captures';
import type { CaptureLike } from '@/features/run/format-captures';

function bytesToDataUrl(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return `data:image/png;base64,${btoa(binary)}`;
}

const PAD = 20;

export function usePreviewCapture(handle: PreviewHandle | null, setOverlayMounted: (v: boolean) => void) {
  const [regionOverlayOpen, setRegionOverlayOpen] = useState(false);
  const [annotationPopoverOpen, setAnnotationPopoverOpen] = useState(false);
  const [inspectActive, setInspectActive] = useState(false);
  const [annotations, setAnnotations] = useState<Map<string, string>>(new Map());
  const pendingCaptures = useSandboxStore((s) => s.captures);
  const sendCapturesFn = useSendCaptures();

  useEffect(() => {
    if (!handle) return;
    const handleInspectResult = (result: InspectResult) => {
      if (result.selector === null) {
        setInspectActive(false);
        return;
      }
      const { rect, viewport } = result;
      if (!rect || !viewport) return;
      const x = Math.max(0, rect.x - PAD);
      const y = Math.max(0, rect.y - PAD);
      const right = Math.min(viewport.w, rect.x + rect.w + PAD);
      const bottom = Math.min(viewport.h, rect.y + rect.h + PAD);
      const region: Region = { x, y, w: right - x, h: bottom - y };
      handle
        .capture(region)
        .then((bytes) => {
          useSandboxStore.getState().addCapture({
            type: 'element',
            imageDataUrl: bytesToDataUrl(bytes),
            selector: result.selector ?? undefined,
          });
          setAnnotationPopoverOpen(true);
        })
        .catch((e: unknown) => console.warn('[preview] capture failed', e));
    };
    const unsub = handle.onInspect(handleInspectResult);
    return () => unsub();
  }, [handle]);

  useEffect(() => {
    setOverlayMounted(regionOverlayOpen || annotationPopoverOpen);
  }, [regionOverlayOpen, annotationPopoverOpen, setOverlayMounted]);

  const onCaptureClick = useCallback(() => {
    handle
      ?.capture()
      .then((bytes) => {
        useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: bytesToDataUrl(bytes) });
        setAnnotationPopoverOpen(true);
      })
      .catch((e: unknown) => console.warn('[preview] capture failed', e));
  }, [handle]);

  const onRegionClick = useCallback(() => setRegionOverlayOpen((prev) => !prev), []);

  const onInspectClick = useCallback(() => {
    setInspectActive((prev) => {
      const next = !prev;
      if (next) handle?.startInspect().catch((e: unknown) => console.warn('[preview] inspect failed', e));
      return next;
    });
  }, [handle]);

  const onRegionSelect = useCallback(
    (region: Region) => {
      setRegionOverlayOpen(false);
      handle
        ?.capture(region)
        .then((bytes) => {
          useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: bytesToDataUrl(bytes) });
          setAnnotationPopoverOpen(true);
        })
        .catch((e: unknown) => console.warn('[preview] capture failed', e));
    },
    [handle],
  );

  const onAnnotationChange = useCallback((id: string, annotation: string) => {
    setAnnotations((prev) => new Map(prev).set(id, annotation));
  }, []);

  const onAnnotationSubmit = useCallback(async () => {
    const capturesWithAnnotations: CaptureLike[] = pendingCaptures.map((c) => ({
      ...c,
      annotation: annotations.get(c.id) ?? c.annotation,
    }));
    await sendCapturesFn(capturesWithAnnotations).catch((e: unknown) =>
      console.warn('[preview] send captures failed', e),
    );
    useSandboxStore.getState().clearCaptures();
    setAnnotationPopoverOpen(false);
    setAnnotations(new Map());
  }, [pendingCaptures, annotations, sendCapturesFn]);

  const onAnnotationCancel = useCallback(() => {
    useSandboxStore.getState().clearCaptures();
    setAnnotationPopoverOpen(false);
    setAnnotations(new Map());
  }, []);

  return {
    pendingCaptures,
    regionOverlayOpen,
    annotationPopoverOpen,
    inspectActive,
    onCaptureClick,
    onRegionClick,
    onInspectClick,
    onRegionSelect,
    onAnnotationChange,
    onAnnotationSubmit,
    onAnnotationCancel,
  };
}
```

- [ ] **Step 8: Rewire `PreviewInstance.tsx`**

Update the hook wiring block (lines ~64–84). The handle flows from lifecycle into the others:

```tsx
  const { handle } = usePreviewLifecycle({ status, port, containerRef, projectId: effectiveProjectId, device });
  usePreviewGeometry({ handle, anchorRef, containerRef, active: visible, status });
  const occluded = usePreviewOcclusion(anchorRef, status === 'running');
  const [, setOverlayMounted] = usePreviewVisibility(handle, visible, occluded);

  const {
    pendingCaptures,
    regionOverlayOpen,
    annotationPopoverOpen,
    inspectActive,
    onCaptureClick,
    onRegionClick,
    onInspectClick,
    onRegionSelect,
    onAnnotationChange,
    onAnnotationSubmit,
    onAnnotationCancel,
  } = usePreviewCapture(handle, setOverlayMounted);
```

`usePreviewOcclusion` is unchanged. Note `effectiveProjectId` already exists in `PreviewInstance` (the prop fallback to active identity). The `tabId` prop stays on the component (it identifies the React instance / data-testid) but is no longer passed into the hooks.

- [ ] **Step 9: Fix the existing preview hook tests + run them one file at a time**

Enumerate the existing preview tests and update each mock host's `preview` from the imperative shape to the `mount()` shape (a `mount` returning a fake `PreviewHandle` whose methods are `vi.fn()`):

Run to find them: `grep -rln "preview\.\(create\|setBounds\|setVisible\|onInspectResult\)\|use-preview" packages/app-tauri/src/features/preview/__tests__`

For each test file found, update the host mock and the assertion targets (assert on the handle's methods, not `host.preview.<verb>`). Then run each individually:

Run (per file): `pnpm --filter @qlan-ro/mainframe-app-tauri test -- <file>`
Expected: PASS (per file). Do NOT batch.

- [ ] **Step 10: Typecheck app-tauri**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS. (The Electron adapter's preview still throws via the Task 6 stub — that's fine; it typechecks. `ElectronAdapter.preview.mount` returns a `PreviewHandle`.)

- [ ] **Step 11: Commit**

```bash
git add packages/app-tauri/src/lib/host/tauri-preview.ts \
  packages/app-tauri/src/lib/host/__tests__/tauri-preview.test.ts \
  packages/app-tauri/src/lib/host/tauri-adapter.ts \
  packages/app-tauri/src/lib/host/__tests__/tauri-adapter.test.ts \
  packages/app-tauri/src/features/preview/use-preview-lifecycle.ts \
  packages/app-tauri/src/features/preview/use-preview-geometry.ts \
  packages/app-tauri/src/features/preview/use-preview-visibility.ts \
  packages/app-tauri/src/features/preview/use-preview-capture.ts \
  packages/app-tauri/src/features/preview/PreviewInstance.tsx
# plus each updated preview __tests__ file by exact path
git commit -m "refactor(app-tauri): reshape preview onto PreviewHandle + Tauri backend

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Implement the Electron preview backend (`<webview>` injection)

**Files:**
- Modify: `packages/app-tauri/src/lib/host/electron-preview.ts` (replace the Task-6 stub)
- Create: `packages/app-tauri/src/lib/host/__tests__/electron-preview.test.ts`

**Interfaces:**
- Consumes: `PreviewOpts`, `PreviewHandle`, `Region`, `InspectResult`, `Unsubscribe` (Task 1); `window.mainframe.destroyWebview`, `clearSandboxSession` (preload).
- Produces: `mountElectronPreview(container, url, opts?): PreviewHandle` (consumed by `ElectronAdapter.preview.mount`, Task 6).

### Design (ported from legacy `PreviewTab.tsx`)

`mount()` creates a `<webview>` element with `partition="persist:sandbox-${projectId ?? 'default'}"`, appends it into the container (absolutely positioned to fill it), and calls `loadURL(url)` on `dom-ready`. The handle methods:
- `setVisible(v)` → toggle the element's `display` (DOM-overlay model; occlusion blanking is tolerated/effectively redundant).
- `navigate(url)` → `wv.loadURL(url)` (with the retry idiom from `loadUrlWithRetry`; for Plan 2 a single `loadURL` with a `.catch` log is acceptable — note retry as a follow-up).
- `capture(region?)` → `wv.capturePage(scaleCropRect(region, zoom))` then `image.toDataURL()` → decode the data URL to `Uint8Array` (the contract returns PNG bytes, matching Tauri). Apply DPR via `wv.getZoomFactor()` exactly as `scaleCropRect` does in the legacy code. Region is CSS-px viewport space → device px = `region * zoom`.
- `startInspect()` → `wv.executeJavaScript(INSPECT_SCRIPT)` resolving inline; on resolve, translate to an `InspectResult` ({ tabId, selector, rect:{x,y,w,h}, viewport:{x:0,y:0,w,h} }) and fan out to the local `onInspect` subscribers.
- `onInspect(cb)` → register `cb` in a local Set, return an `Unsubscribe`.
- `refit()` → no-op (the `<webview>` is CSS-sized inside the container).
- `setDevice('mobile'|'desktop')` → set the element width (390 for mobile) / full.
- `destroy()` → `getWebContentsId()` → `window.mainframe.destroyWebview(id)`, remove the element.

`scaleCropRect` is reproduced locally (it currently lives in `desktop/renderer`, which this plan is retiring; copy the small pure function into `electron-preview.ts`). Document the coordinate space inline.

- [ ] **Step 1: Write the failing Electron-preview test**

Create `packages/app-tauri/src/lib/host/__tests__/electron-preview.test.ts`. Use a fake `<webview>` element + fake `window.mainframe`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mountElectronPreview, scaleCropRect } from '../electron-preview';

let destroyWebview: ReturnType<typeof vi.fn>;

beforeEach(() => {
  destroyWebview = vi.fn().mockResolvedValue(undefined);
  (globalThis as unknown as { window: { mainframe: unknown } }).window = Object.assign(globalThis.window ?? {}, {
    mainframe: { destroyWebview, clearSandboxSession: vi.fn() },
  });
});
afterEach(() => {
  delete (globalThis.window as unknown as Record<string, unknown>).mainframe;
});

describe('scaleCropRect', () => {
  it('multiplies CSS-px region by zoom for device px', () => {
    expect(scaleCropRect({ x: 10, y: 20, width: 30, height: 40 }, 2)).toEqual({ x: 20, y: 40, width: 60, height: 80 });
  });
});

describe('mountElectronPreview', () => {
  it('appends a <webview> with the per-project partition into the container', () => {
    const container = document.createElement('div');
    mountElectronPreview(container, 'http://localhost:3000', { projectId: 'p1' });
    const wv = container.querySelector('webview');
    expect(wv).not.toBeNull();
    expect(wv!.getAttribute('partition')).toBe('persist:sandbox-p1');
  });

  it('falls back to the default partition when projectId is absent', () => {
    const container = document.createElement('div');
    mountElectronPreview(container, 'http://x');
    expect(container.querySelector('webview')!.getAttribute('partition')).toBe('persist:sandbox-default');
  });

  it('onInspect subscribers receive picks and unsubscribe stops them', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    const cb = vi.fn();
    const unsub = handle.onInspect(cb);
    unsub();
    expect(cb).not.toHaveBeenCalled(); // no pick fired; asserts wiring/teardown does not throw
  });

  it('destroy removes the element', () => {
    const container = document.createElement('div');
    const handle = mountElectronPreview(container, 'http://x', { projectId: 'p1' });
    expect(container.querySelector('webview')).not.toBeNull();
    handle.destroy();
    expect(container.querySelector('webview')).toBeNull();
  });
});
```

(jsdom has no real `<webview>`; `document.createElement('webview')` yields an `HTMLElement`, sufficient for attribute/DOM assertions. `capturePage`/`executeJavaScript` are guarded so they no-op in tests when absent.)

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/electron-preview.test.ts`
Expected: FAIL — `mountElectronPreview` is the throwing stub; `scaleCropRect` not exported.

- [ ] **Step 3: Implement the backend**

Replace `packages/app-tauri/src/lib/host/electron-preview.ts` with the full implementation. Keep it ≤300 lines; extract the in-page inspect script to a const. Core shape:

```ts
/**
 * ElectronPreviewBackend — backs HostBridge.preview.mount on Electron.
 *
 * Injects a <webview partition="persist:sandbox-{projectId}"> into the container
 * (DOM-overlay model: natural z-index stacking, unlike Tauri's OS overlay). capture()
 * uses webContents.capturePage with DPR scaling (scaleCropRect); the element-picker
 * runs INSPECT_SCRIPT via executeJavaScript and resolves inline, fanned out to
 * onInspect subscribers. Ported from the retired desktop renderer PreviewTab.
 */
import type { PreviewOpts, PreviewHandle, Region, InspectResult, Unsubscribe } from '@qlan-ro/mainframe-types';

interface CropRect { x: number; y: number; width: number; height: number; }

/**
 * Converts a CSS-px crop rect to device px (capturePage operates in device px;
 * getBoundingClientRect is CSS px). At zoom != 1.0 (Cmd+/-) this avoids offset crops.
 */
export function scaleCropRect(rect: CropRect, zoom: number): CropRect {
  return {
    x: Math.round(rect.x * zoom),
    y: Math.round(rect.y * zoom),
    width: Math.round(rect.width * zoom),
    height: Math.round(rect.height * zoom),
  };
}

const INSPECT_SCRIPT = `/* ported verbatim from desktop PreviewTab INSPECT_SCRIPT */`;

interface WebviewLike extends HTMLElement {
  loadURL(url: string): Promise<void>;
  capturePage(rect?: CropRect): Promise<{ toDataURL(): string }>;
  executeJavaScript(js: string): Promise<unknown>;
  getZoomFactor?(): number;
  getWebContentsId(): number;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

let tabSeq = 0;

export function mountElectronPreview(container: HTMLElement, url: string, opts?: PreviewOpts): PreviewHandle {
  const tabId = `preview-${++tabSeq}`;
  const partition = `persist:sandbox-${opts?.projectId ?? 'default'}`;
  const inspectCbs = new Set<(r: InspectResult) => void>();

  const wv = document.createElement('webview') as WebviewLike;
  wv.setAttribute('partition', partition);
  wv.setAttribute('src', 'about:blank');
  wv.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  container.appendChild(wv);

  const navigate = (next: string): Promise<void> =>
    Promise.resolve(typeof wv.loadURL === 'function' ? wv.loadURL(next) : undefined).catch((e) => {
      console.warn('[preview] electron loadURL failed', e);
    });

  // Initial load on dom-ready (getWebContentsId throws before that).
  wv.addEventListener('dom-ready', () => void navigate(url), { once: true });

  const capture = async (region?: Region): Promise<Uint8Array> => {
    if (typeof wv.capturePage !== 'function') throw new Error('capturePage unavailable');
    const zoom = wv.getZoomFactor?.() ?? 1;
    const crop = region ? scaleCropRect({ x: region.x, y: region.y, width: region.w, height: region.h }, zoom) : undefined;
    const image = await wv.capturePage(crop);
    return dataUrlToBytes(image.toDataURL());
  };

  return {
    setVisible: (visible: boolean): void => {
      wv.style.display = visible ? '' : 'none';
    },
    navigate,
    capture,
    startInspect: async (): Promise<void> => {
      if (typeof wv.executeJavaScript !== 'function') return;
      try {
        const result = (await wv.executeJavaScript(INSPECT_SCRIPT)) as
          | { selector: string; rect: { x: number; y: number; width: number; height: number }; viewport: { width: number; height: number } }
          | null;
        const payload: InspectResult = result
          ? {
              tabId,
              selector: result.selector,
              rect: { x: result.rect.x, y: result.rect.y, w: result.rect.width, h: result.rect.height },
              viewport: { x: 0, y: 0, w: result.viewport.width, h: result.viewport.height },
            }
          : { tabId, selector: null, rect: null, viewport: null };
        for (const cb of inspectCbs) cb(payload);
      } catch (e) {
        console.warn('[preview] electron inspect failed', e);
      }
    },
    onInspect: (cb: (r: InspectResult) => void): Unsubscribe => {
      inspectCbs.add(cb);
      return () => inspectCbs.delete(cb);
    },
    refit: (): void => {
      /* webview is CSS-sized inside the container; no native reposition */
    },
    setDevice: (device: 'desktop' | 'mobile'): void => {
      wv.style.width = device === 'mobile' ? '390px' : '100%';
    },
    destroy: (): void => {
      try {
        const id = wv.getWebContentsId();
        const mf = (window as unknown as { mainframe?: { destroyWebview(id: number): Promise<void> } }).mainframe;
        mf?.destroyWebview(id).catch((e) => console.warn('[preview] electron destroyWebview', e));
      } catch (e) {
        console.warn('[preview] electron destroy: webContents unavailable', e);
      }
      wv.remove();
    },
  };
}
```

Copy the `INSPECT_SCRIPT` constant verbatim from `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx` (lines 49–99, including `GET_SELECTOR_FN`). Confirm the in-page payload shape `{ selector, rect:{x,y,width,height}, viewport:{width,height} }` matches the translation above.

- [ ] **Step 4: Run the Electron-preview test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/electron-preview.test.ts`
Expected: PASS.
Then re-run the Electron adapter test (its preview stub is now real):
Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/electron-adapter.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/app-tauri/src/lib/host/electron-preview.ts \
  packages/app-tauri/src/lib/host/__tests__/electron-preview.test.ts
git commit -m "feat(app-tauri): implement Electron preview backend via injected <webview>

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Wire the Electron `getHost()` branch + drag rename + main.tsx init gating

**Files:**
- Modify: `packages/app-tauri/src/lib/host/index.ts`
- Modify: `packages/app-tauri/src/app/main.tsx`
- Modify: `packages/app-tauri/src/layout/MainToolbar.tsx`
- Modify: `packages/app-tauri/src/layout/SidebarHeader.tsx`
- Modify: `packages/app-tauri/src/features/chat/thread/ChatCardHeader.tsx`
- Modify: `packages/app-tauri/src/styles/globals.css`
- Modify: `packages/app-tauri/src/lib/host/__tests__/host-context.test.tsx`
- Modify: `packages/app-tauri/src/layout/__tests__/MainToolbar.test.tsx`, `src/features/chat/thread/__tests__/ChatCardHeader.test.tsx` (drag attribute assertions)

**Interfaces:**
- Consumes: `ElectronAdapter` (Task 6), `isElectronRuntime` (Task 6), `TauriAdapter` (with optional `init`).
- Produces: `getHost()` returning `ElectronAdapter` under Electron; the generalized `main.tsx` init.

- [ ] **Step 1: Write the failing getHost-Electron test**

In `packages/app-tauri/src/lib/host/__tests__/host-context.test.tsx`, add a describe that stubs `window.mainframe` and asserts `getHost()` returns an `ElectronAdapter`:

```ts
import { ElectronAdapter } from '../electron-adapter';

describe('getHost — Electron runtime', () => {
  afterEach(() => {
    resetHostForTesting();
    delete (globalThis.window as unknown as Record<string, unknown>).mainframe;
  });

  it('returns an ElectronAdapter when window.mainframe is present', () => {
    (globalThis.window as unknown as Record<string, unknown>).mainframe = {};
    expect(getHost()).toBeInstanceOf(ElectronAdapter);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/host-context.test.tsx`
Expected: FAIL — `getHost()` returns `FakeHostBridge` (no Electron branch).

- [ ] **Step 3: Add the Electron branch + generalize init**

In `packages/app-tauri/src/lib/host/index.ts`:

```ts
import { ElectronAdapter } from './electron-adapter';
import { isElectronRuntime } from './detect';
// …
export { isTauriRuntime, isElectronRuntime } from './detect';

function createHost(): HostBridge {
  if (isTauriRuntime()) return new TauriAdapter();
  if (isElectronRuntime()) return new ElectronAdapter();
  return new FakeHostBridge();
}
```

In `packages/app-tauri/src/app/main.tsx`, generalize the init gating (the optional `init` on the contract lets us call it without an `instanceof` check):

```ts
import { getHost, HostProvider } from '../lib/host';
// …
const host = getHost();
host.init?.(); // Tauri installs the drag listener; Electron/Fake have no init
```

Remove the now-unused `TauriAdapter`/`isTauriRuntime` imports from `main.tsx`.

- [ ] **Step 4: Rename the drag attribute (3 components) + add Electron CSS**

In `MainToolbar.tsx` (line 58), `SidebarHeader.tsx` (line 63), `ChatCardHeader.tsx` (line 40): `data-tauri-drag-region` → `data-drag-region`.

In `packages/app-tauri/src/styles/globals.css`, append (Electron honors `-webkit-app-region`; Tauri ignores it and uses the JS listener):

```css
/* Window drag: Electron uses CSS app-region; Tauri uses the JS mousedown listener
   (TauriAdapter.init). Interactive children opt out so clicks still register. */
[data-drag-region] {
  -webkit-app-region: drag;
}
[data-drag-region] button,
[data-drag-region] input,
[data-drag-region] select,
[data-drag-region] textarea,
[data-drag-region] a,
[data-drag-region] label {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 5: Update the drag-attribute tests**

In `packages/app-tauri/src/layout/__tests__/MainToolbar.test.tsx` and `src/features/chat/thread/__tests__/ChatCardHeader.test.tsx`, change any `data-tauri-drag-region` assertions to `data-drag-region`. (Grep first: `grep -rln "data-tauri-drag-region" packages/app-tauri/src` — fix every non-test and test occurrence except `App.integration.test.tsx`, which is the known-red other-session suite; leave that one as-is and note it.)

- [ ] **Step 6: Run the affected tests (one file each)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/host-context.test.tsx`
Expected: PASS.
Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/layout/__tests__/MainToolbar.test.tsx`
Expected: PASS.
Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/features/chat/thread/__tests__/ChatCardHeader.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/app-tauri/src/lib/host/index.ts \
  packages/app-tauri/src/app/main.tsx \
  packages/app-tauri/src/layout/MainToolbar.tsx \
  packages/app-tauri/src/layout/SidebarHeader.tsx \
  packages/app-tauri/src/features/chat/thread/ChatCardHeader.tsx \
  packages/app-tauri/src/styles/globals.css \
  packages/app-tauri/src/lib/host/__tests__/host-context.test.tsx \
  packages/app-tauri/src/layout/__tests__/MainToolbar.test.tsx \
  packages/app-tauri/src/features/chat/thread/__tests__/ChatCardHeader.test.tsx
git commit -m "feat(app-tauri): add Electron getHost branch + neutral data-drag-region

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 10: Retrofit the `desktop` shell (renderer URL + runtime CSP + Chromium build) + changeset

**Files:**
- Modify: `packages/desktop/src/main/index.ts` (renderer URL + runtime CSP)
- Modify: `packages/desktop/electron.vite.config.ts` (stop building `src/renderer`; remove the CSP plugin)
- Modify: `packages/desktop/package.json` (electron-builder `extraResources` includes the app-tauri `dist`)
- Create: `.changeset/host-bridge-electron-adapter.md`

The legacy `src/renderer` build is LEFT IN PLACE (deleted in Plan 3 / the A/B-cleanup phase per the scoping note "leave the legacy renderer build in place until task 10"). This task points the WINDOW at the app-tauri renderer; it does not delete the legacy tree.

**Interfaces:**
- Consumes: the app-tauri Vite dev server (`http://localhost:5174`) / prod build (`packages/app-tauri/dist`).
- Produces: a `desktop` binary that loads the new renderer with a daemon-reachable CSP.

- [ ] **Step 1: Point the window at the app-tauri renderer + add runtime CSP**

In `packages/desktop/src/main/index.ts`, add a runtime CSP via `session...onHeadersReceived` inside `app.whenReady()` (before `createWindow()`). The CSP must allow the daemon on 31415 + ws, blob images, and inline styles (Vite/Tailwind inject style tags):

```ts
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' http://127.0.0.1:${DAEMON_PORT} ws://127.0.0.1:${DAEMON_PORT} http://localhost:5174 ws://localhost:5174`,
    "font-src 'self' data:",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] },
    });
  });
```

(In production the `localhost:5174` entries are harmless; gate them behind `NODE_ENV === 'development'` if you prefer a tighter prod CSP — recommended: build the connect-src list conditionally.)

Change the renderer load to point at app-tauri. Dev uses the app-tauri Vite server; prod loads the app-tauri `dist`:

```ts
  const APP_TAURI_DEV_URL = process.env['APP_TAURI_RENDERER_URL'] ?? 'http://localhost:5174';
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(APP_TAURI_DEV_URL);
  } else {
    mainWindow.loadFile(join(process.resourcesPath, 'app-tauri-renderer', 'index.html'));
  }
```

(Beware the IPv6 trap: the app-tauri Vite server binds `::1` under `localhost`; loading `http://localhost:5174` in Chromium is correct — do NOT use `127.0.0.1:5174`. The daemon poll still uses `127.0.0.1` for `/health` — unchanged.)

- [ ] **Step 2: Update `electron.vite.config.ts`**

Remove the `dynamicCspPlugin` (runtime CSP replaces it) and stop building `src/renderer` as the shipped renderer. The simplest correct form for Plan 2: keep `main` and `preload` builds; drop the `renderer` dev server / build entry (the window now loads an external URL/dist). Replace the `renderer` block with the minimal config electron-vite requires, or remove it and document that the renderer is supplied by app-tauri. Concretely:

```ts
import { defineConfig } from 'electron-vite';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/main/index.ts') },
        external: ['electron', 'node-pty'],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].js' },
        external: ['electron'],
      },
    },
  },
});
```

NOTE: `electron-vite dev` no longer serves the renderer. The dev workflow is: run the app-tauri Vite server (`pnpm --filter @qlan-ro/mainframe-app-tauri dev` on 5174) AND `electron-vite dev` for the shell; the window loads `http://localhost:5174`. Document this in the package README or a comment.

- [ ] **Step 3: Wire the prod renderer into electron-builder `extraResources`**

In `packages/desktop/package.json` `build.extraResources`, add the app-tauri dist:

```json
      {
        "from": "../app-tauri/dist",
        "to": "app-tauri-renderer",
        "filter": ["**/*"]
      },
```

(The `desktop` `build` script must run the app-tauri build first; document that `pnpm --filter @qlan-ro/mainframe-app-tauri build` produces `packages/app-tauri/dist` before `electron-builder`. The Chromium build target: app-tauri's `vite.config.ts` targets `safari13` on non-Windows for the Tauri/WebKit binary — that target also runs in Chromium, so no app-tauri build change is strictly required for Plan 2; note this in the changeset as a known divergence to revisit. If a Chromium-optimized build is wanted, that is a follow-up.)

- [ ] **Step 4: Typecheck the desktop main/preload**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit -p tsconfig.node.json`
Expected: PASS.

- [ ] **Step 5: Run the full desktop unit suite (one batch is fine for desktop — the React.act pollution is an app-tauri-only issue)**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- src/main`
Expected: PASS for the main-process suites added in this plan (`daemon-status`, `terminal-manager`, `ipc-contract`). Other desktop renderer suites are unaffected (we did not touch them).

- [ ] **Step 6: Add the changeset**

Create `.changeset/host-bridge-electron-adapter.md`:

```md
---
"@qlan-ro/mainframe-types": minor
"@qlan-ro/mainframe-desktop": minor
"@qlan-ro/mainframe-app-tauri": minor
---

Add the Electron HostBridge adapter and retrofit the desktop shell to host the
app-tauri renderer. Reshapes the preview port to `preview.mount(container, url,
opts) -> PreviewHandle` (per-project session partition), lands a Zod
`host-contract.ts` in mainframe-types with `Platform`/`DaemonStatus` enums, sends
terminal output as bytes over IPC, adds daemon port/status IPC, and points the
Electron window at the app-tauri Vite server (dev) / dist (prod) with a runtime
CSP for the daemon on 31415. The same renderer now runs on Tauri/WebKit and
Electron/Chromium, enabling a direct A/B. Plan 2 of 3; full Tauri parity
(updater/presence/log-sink/menu/diagnostics/bundling) follows in Plan 3.
```

- [ ] **Step 7: Commit**

```bash
git add packages/desktop/src/main/index.ts \
  packages/desktop/electron.vite.config.ts \
  packages/desktop/package.json \
  .changeset/host-bridge-electron-adapter.md
git commit -m "feat(desktop): host the app-tauri renderer + runtime CSP for the daemon

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

### 1. Spec coverage (Phase 4 + scoping 10-task breakdown)

| Phase-4 / scoping requirement | Task |
|---|---|
| Repoint `desktop` at app-tauri renderer (dev `:5174` + prod `dist`), legacy build kept | Task 10 |
| Zod `host-contract.ts` in `mainframe-types` (+`zod` dep), `DaemonStatus`/`Platform` enums | Task 2 |
| Trivial channels: `app:getAuthToken`, `fs:readFileBase64`, `app:getInfo`+homedir; validate every `ipcMain.handle` | Task 3 |
| Daemon-status IPC (`daemon:port`/`:status`/`:onStatus` + tracker) | Task 4 |
| `electron-adapter.ts` (terminal demux + byte translation, platform map, app/fs/shell/notify/daemon/log) | Tasks 5 (bytes/main) + 6 (adapter) |
| Electron `getHost()` branch + window-drag rename + `main.tsx` init generalization + `data-drag-region` CSS | Task 9 |
| Reshape contract to `preview.mount()` + refactor `PreviewInstance` + 4 hooks; Tauri stays green | Tasks 1 (contract) + 7 (refactor + Tauri backend) |
| `ElectronHostBridge.preview` via injected `<webview>` (partition, `capturePage`+`scaleCropRect`, `executeJavaScript`, inline-picker→`onInspect`, `clearSession`) | Task 8 + (`clearSession`→`clearSandboxSession` in Task 6) |
| Electron CSP (runtime header, 31415) + Chromium build target note | Task 10 |
| A/B verification + legacy renderer deletion | Deferred to Plan 3 / A/B-cleanup phase (scoping task 10 splits cleanly; deletion is explicitly out of Plan 2 per "leave the legacy renderer build in place") — flagged below |

Locked decisions honored: preview `mount()` reshape (Tasks 1/7/8); capture region CSS-px viewport space + backend applies DPR (documented in the `PreviewHandle` JSDoc + both backends); occlusion model OS-overlay vs DOM-overlay both tolerate `setVisible(false)` (documented; renderer occlusion unchanged); `opts.projectId` → `persist:sandbox-{projectId}` + `clearSession` (Task 8/6); terminal bytes over IPC + global-event demux (Tasks 5/6); Zod contract in `mainframe-types` + `zod` dep + Electron validation + serde note (Tasks 2/3/4/5); Electron runtime CSP for 31415 + ws (Task 10).

### 2. Placeholder scan

No "TBD/handle edge cases/similar to Task N" placeholders. Every code step shows real TypeScript. The one verbatim copy that is NOT inlined is `INSPECT_SCRIPT` (Task 8 Step 3) — it is explicitly "copy verbatim from `PreviewTab.tsx` lines 49–99," a precise source pointer, not a vague instruction (the full script is ~50 lines and is load-bearingly identical to the legacy one). The `tsconfig.node.json` name is flagged for verification (Task 3 Step 7) rather than assumed.

### 3. Type / name consistency

`PreviewHandle` members are identical across all sites: `setVisible`, `navigate`, `capture`, `startInspect`, `onInspect`, `refit`, `setDevice`, `destroy` — defined in Task 1 (contract), produced by `mountTauriPreview` (Task 7) and `mountElectronPreview` (Task 8), consumed by the 4 refactored hooks + `PreviewInstance` (Task 7). `PreviewOpts` = `{ projectId?, device? }` consistent in contract + both backends + lifecycle hook. `DaemonStatus` is the closed enum from the contract (Task 2), used by the tracker (Task 4), the Electron adapter's `daemon.status`/`onStatus` casts (Task 6), and re-exported type-only from `host-bridge.ts`. `isElectronRuntime` defined once (Task 6 detect.ts), consumed by `getHost()` (Task 9). Terminal: `TerminalOpts.id` caller-supplied threads from contract → `terminal-manager` (Task 5) → `ElectronAdapter.terminal.create` (Task 6) → demux maps. `scaleCropRect` reproduced locally in `electron-preview.ts` (Task 8) with the same signature as the legacy `PreviewTab` export.

### 4. Cross-task compile integrity

Task 1 stubs both existing adapters' preview to the new shape so the repo compiles before Task 7 (the renderer-hook typecheck is intentionally red between Tasks 1 and 7, confined to the 5 preview files). Task 6 ships a throwing `electron-preview.ts` stub so `electron-adapter.ts` compiles before Task 8 fills it in. Each task's final step typechecks or runs the touched suite.
