# Host Bridge Plan 3 — Tauri Full Parity + Deferred Follow-ups + Phase-6 Cleanup

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Tauri host (`packages/app-tauri/src-tauri`) to full parity with the Electron host — auto-update, presence/idle reporting, native menu, renderer→host log sink, RSS/crash diagnostics, webview permission policy, daemon production bundling — close the Plans 1–2 deferred follow-ups (DaemonStatus mapping, `AppInfo`/`Region` canonicalization, open-external allowlist), and (Phase 6) delete the legacy `packages/desktop/src/renderer`.

**Architecture:** One Zod-validated contract in `@qlan-ro/mainframe-types` (`host-bridge.ts` + `host-contract.ts`) defines two new namespaces (`updates`, `presence`); three TS adapters (Tauri/Electron/Fake) implement them; the Rust Tauri shell ports the Electron behaviors natively (Rust `tracing-appender` log sink, `tauri-plugin-updater`, native OS-idle reader, Tauri `Menu`, RSS sampler) and the config files (`tauri.conf.json`, `capabilities/main.json`, `Cargo.toml`) gain the updater endpoint, bundle wiring, and permission policy. The native shells stay separate codebases (Rust vs TS) but conform to one documented contract.

**Tech Stack:** TypeScript (strict, NodeNext, `.js` import suffixes in mainframe-types), Zod; Rust (Tauri 2, `tracing`/`tracing-appender`, `tauri-plugin-updater`, `objc2`/`objc2-app-kit` for macOS idle, `sysinfo` for RSS); React 18; pnpm workspaces.

**Plan status:** Plan 3 of 3. Plans 1 (`1aafe62f`..`4dccdfcf`) and 2 (`dfb6d508`..`9fbac690`) are DONE. This plan assumes the contract, `getHost()`/provider, all three adapters, the Tauri/Electron preview seams, and the Electron shell retrofit already exist.

## Global Constraints

Copied verbatim from the scoping doc + root/app-tauri CLAUDE.md. Every task implicitly includes these.

- **TS:** strict mode, `NodeNext` resolution, `noUncheckedIndexedAccess`. In `@qlan-ro/mainframe-types`, all relative imports carry the `.js` suffix. No `@ts-ignore` (use `@ts-expect-error` + reason). Single canonical type — never duplicate across packages.
- **Rust:** follow rust-best-practices — `Result` types, idiomatic error handling, **no `unwrap()`/`expect()` in non-test shipping paths** (the existing `lib.rs` `.expect()` calls at window/setup time are pre-existing and out of scope; do not add new ones). Keep modules focused.
- **File size:** ≤300 lines per TS file, ≤50 lines per function. Decompose, don't grow. Keep new Rust modules focused (one responsibility each).
- **Zod on every endpoint:** new contract payloads get Zod schemas; the Tauri commands and Electron handlers validate against them.
- **Shared worktree (concurrent sessions commit to this branch):** every commit stages files **BY EXACT PATH**. Never `git add -A` / `git add .`. **Never touch `pnpm-lock.yaml`.** Rust dep additions stage `src-tauri/Cargo.toml` + `src-tauri/Cargo.lock` (separate from pnpm-lock). New JS deps are AVOIDED — drive the updater from custom Rust commands so no `@tauri-apps/plugin-updater` JS dep is needed. If a JS dep is genuinely unavoidable, add it to `package.json` only and flag the lockfile as a deferred user step (as Plan 2 Task 2 did with zod).
- **Test gotchas:** app-tauri vitest batched runs mass-fail with "React.act is not a function" (cross-file pollution) — **every TS test step runs a SINGLE file**. Rust tests run via `cargo test` in `packages/app-tauri/src-tauri`. `cargo build` is slow — minimize full rebuilds; prefer `cargo test <module>` and `cargo check` where a full build is not required.
- **Commands:**
  - app-tauri test (single file): `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/<file>`
  - app-tauri typecheck: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
  - types build: `pnpm --filter @qlan-ro/mainframe-types build`
  - desktop typecheck (node project): `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit -p tsconfig.node.json`
  - desktop test: `pnpm --filter @qlan-ro/mainframe-desktop test`
  - Rust test/build: run inside `packages/app-tauri/src-tauri` — `cargo test <filter>`, `cargo check`, `cargo build`.
- **Known pre-existing red (NOT this plan's defects):** desktop renderer `tsconfig.web.json` (~13 baseline errors), `App.integration.test.tsx`, `design-token-audit.test.ts`. Never "fix" these by editing unrelated files; never lower coverage thresholds.
- **Runtime caveat:** the updater (signed release) and daemon-bundling (packaged build) are NOT runtime-verifiable in this environment. The plan delivers code + config + documented TODOs, not a proven release.

---

## File Structure

### Created

| Path | Responsibility |
|---|---|
| `packages/app-tauri/src/lib/host/__tests__/daemon-status-mapping.test.ts` | Unit tests for the legacy-string→`DaemonStatus` mapper (Task 2). |
| `packages/types/src/host/external-schemes.ts` | Canonical `ALLOWED_EXTERNAL_SCHEMES` + `isAllowedExternalScheme()` (Task 5). |
| `packages/app-tauri/src-tauri/src/log_sink.rs` | Rust `tracing-appender` daily-rotating pino-shaped JSON sink + 7-day purge + `host_log` command (Task 7). |
| `packages/app-tauri/src-tauri/src/presence.rs` | Native OS-idle reader + daemon activity POST (Task 8). |
| `packages/app-tauri/src-tauri/src/presence/idle_macos.rs` | macOS `CGEventSourceSecondsSinceLastEventType` reader (Task 8). |
| `packages/app-tauri/src-tauri/src/presence/idle_stub.rs` | Non-macOS idle-seconds stub (Task 8). |
| `packages/app-tauri/src-tauri/src/menu.rs` | Native Tauri `Menu` builder incl. "Check for Updates" (Task 9). |
| `packages/app-tauri/src-tauri/src/memory_logger.rs` | 5-min process-RSS sampler logged via the log sink (Task 10). |
| `packages/app-tauri/src-tauri/src/updater.rs` | `tauri-plugin-updater` driver: check/download/install + error classifier + periodic check (Task 11). |
| `packages/app-tauri/src-tauri/src/updater/error_classifier.rs` | Rust port of `auto-updater-error-classifier.ts` (Task 11). |
| `docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md` | Consolidated DEFERRED-TODO note: updater signing/CI, daemon bundling pipeline, WKWebView crash signal (Tasks 11, 12, 13). |

### Modified

| Path | Change |
|---|---|
| `packages/types/src/host/host-contract.ts` | Add `UpdateStatusSchema` (6 variants), `PresenceStateSchema`/`PresenceSchema`. Tasks 1, 4. |
| `packages/types/src/host/host-bridge.ts` | Collapse `AppInfo`/`Region` to `z.infer`; add `updates`/`presence` namespaces to `HostBridge`; add `UpdateStatus` type. Tasks 1, 3, 4. |
| `packages/types/src/index.ts` | Export `external-schemes.js`. Task 5. |
| `packages/app-tauri/src/lib/host/tauri-adapter.ts` | DaemonStatus mapping; `updates`/`presence` impls. Tasks 2, 4, 11. |
| `packages/app-tauri/src/lib/host/electron-adapter.ts` | `updates`/`presence` impls over `window.mainframe.updates` + a presence POST. Tasks 4, 11. |
| `packages/app-tauri/src/lib/host/fake-adapter.ts` | `updates`/`presence` no-op impls + overrides. Tasks 4, 11. |
| `packages/app-tauri/src/lib/tauri/bridge.ts` | Map `getDaemonStatus`/`onDaemonStatus`; add updater/presence wrappers. Tasks 2, 4, 11. |
| `packages/app-tauri/src-tauri/src/preview/mod.rs` | Widen `is_allowed_external_scheme` to the canonical list. Task 5. |
| `packages/app-tauri/src-tauri/src/lib.rs` | Map `get_daemon_status`; register log sink, presence, menu, memory logger, updater; resolver prefers bundled resource. Tasks 2, 6, 7, 8, 9, 10, 11, 12. |
| `packages/app-tauri/src-tauri/src/commands/mod.rs` | Re-export new commands. Tasks 7, 11. |
| `packages/app-tauri/src-tauri/Cargo.toml` | Add `tauri-plugin-updater`, `tracing-appender`, `sysinfo`, macOS `objc2-core-graphics` Event feature. Tasks 7, 8, 10, 11. |
| `packages/app-tauri/src-tauri/Cargo.lock` | Pinned new crates (staged alongside Cargo.toml). Tasks 7, 8, 10, 11. |
| `packages/app-tauri/src-tauri/tauri.conf.json` | Updater plugin endpoint; `bundle.externalBin`/`resources`; null macOS usage descriptions; CSP unchanged. Tasks 6, 11, 12. |
| `packages/app-tauri/src-tauri/capabilities/main.json` | Add updater permissions. Task 11. |
| `package.json` (root) | Add `dev:desktop` concurrently script + `concurrently` devDep (package.json only). Task 14. |
| `packages/desktop/package.json` | Remove `dev:web` script. Task 15. |
| `packages/desktop/vite.web.config.ts` | Deleted. Task 15. |
| `packages/desktop/src/renderer/**` | Deleted (331 files). Task 15. |

---

## Sequencing

TS contract/adapter items first (cheap, fast feedback): Tasks 1–5. Then Rust parity: Tasks 6–13. Then the `dev:desktop` script: Task 14. Then legacy-renderer deletion LAST: Task 15.

---

## Task 1: Collapse `AppInfo`/`Region` to `z.infer` (single canonical type)

**Files:**
- Modify: `packages/types/src/host/host-bridge.ts:19-23` (`AppInfo`), `:32-37` (`Region`)
- Build check: `pnpm --filter @qlan-ro/mainframe-types build`

**Interfaces:**
- Consumes: `AppInfoSchema`, `RegionSchema` from `host-contract.ts` (already exist, lines 34-38 and 71-76).
- Produces: `export type AppInfo = z.infer<typeof AppInfoSchema>` and `export type Region = z.infer<typeof RegionSchema>` — same field shapes (`AppInfo` = `{version,author,homedir}`; `Region` = `{x,y,w,h}`), so every existing consumer compiles unchanged.

- [ ] **Step 1: Verify current shapes match the schemas**

Confirm `AppInfoSchema` (`{version: string, author: string, homedir: string}`) and `RegionSchema` (`{x,y,w,h}` all `z.number()`) are identical to the hand-written interfaces. They are (verified). No test needed beyond the type-build gate; this is a type-identity refactor.

- [ ] **Step 2: Replace the hand-written `AppInfo` interface**

In `host-bridge.ts`, change the import line and the `AppInfo` declaration. Replace:

```ts
import type { Platform, DaemonStatus, LogLevel } from './host-contract.js';
export type { Platform, DaemonStatus, LogLevel } from './host-contract.js';

export interface AppInfo {
  version: string;
  author: string;
  homedir: string;
}
```

with:

```ts
import type { Platform, DaemonStatus, LogLevel } from './host-contract.js';
import type { AppInfoSchema, RegionSchema } from './host-contract.js';
import type { z } from 'zod';
export type { Platform, DaemonStatus, LogLevel } from './host-contract.js';

export type AppInfo = z.infer<typeof AppInfoSchema>;
```

- [ ] **Step 3: Replace the hand-written `Region` interface**

In `host-bridge.ts`, replace:

```ts
export interface Region {
  x: number;
  y: number;
  w: number;
  h: number;
}
```

with:

```ts
export type Region = z.infer<typeof RegionSchema>;
```

(Leave `Bounds` and `InspectResult` as-is — they have no schema and are out of scope.)

- [ ] **Step 4: Build types and verify no errors**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: PASS (clean `tsc`). `z.infer` of an object schema with `z.string()`/`z.number()` fields produces the identical structural type, so downstream consumers in app-tauri/desktop still compile.

- [ ] **Step 5: Typecheck app-tauri to confirm consumers are unaffected**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS (no new errors vs the known baseline).

- [ ] **Step 6: Commit**

```bash
git add packages/types/src/host/host-bridge.ts
git commit -m "refactor(types): collapse AppInfo/Region to z.infer of their schemas"
```

---

## Task 2: Map legacy daemon-status strings → `DaemonStatus` enum in the Tauri adapter

**Files:**
- Create: `packages/app-tauri/src/lib/host/__tests__/daemon-status-mapping.test.ts`
- Modify: `packages/app-tauri/src/lib/host/tauri-adapter.ts:57-64` (drop the `as DaemonStatus` casts)
- Modify: `packages/app-tauri/src-tauri/src/lib.rs:224-233` (`get_daemon_status` — emit a clean vocabulary) and `:99-104` (the `setup` emit)

**Interfaces:**
- Consumes: `bridge.getDaemonStatus(): Promise<string>` and `bridge.onDaemonStatus(cb: (s: string) => void): Promise<UnlistenFn>` (lib/tauri/bridge.ts:50-53, 79-85). The Rust backend emits legacy strings.
- Produces: `mapDaemonStatus(raw: string): DaemonStatus` — a pure exported function in `tauri-adapter.ts`. Mapping:
  - `not_started` → `'initializing'`
  - `starting` or `started:pid=<N>` → `'starting'`
  - `running:<N>` or `ready` → `'ready'`
  - `exited` → `'stopped'`
  - `error:<msg>` or any unrecognized value → `'unavailable'`

  `daemon.status()` and `daemon.onStatus()` route every raw value through `mapDaemonStatus`; no more blind casts.

- [ ] **Step 1: Write the failing test**

Create `packages/app-tauri/src/lib/host/__tests__/daemon-status-mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mapDaemonStatus } from '../tauri-adapter';

describe('mapDaemonStatus — legacy string → DaemonStatus enum', () => {
  it('maps not_started → initializing', () => {
    expect(mapDaemonStatus('not_started')).toBe('initializing');
  });
  it('maps starting → starting', () => {
    expect(mapDaemonStatus('starting')).toBe('starting');
  });
  it('maps started:pid=4242 → starting', () => {
    expect(mapDaemonStatus('started:pid=4242')).toBe('starting');
  });
  it('maps running:4242 → ready', () => {
    expect(mapDaemonStatus('running:4242')).toBe('ready');
  });
  it('maps ready → ready', () => {
    expect(mapDaemonStatus('ready')).toBe('ready');
  });
  it('maps exited → stopped', () => {
    expect(mapDaemonStatus('exited')).toBe('stopped');
  });
  it('maps error:boom → unavailable', () => {
    expect(mapDaemonStatus('error:boom')).toBe('unavailable');
  });
  it('maps an unknown value → unavailable', () => {
    expect(mapDaemonStatus('wat')).toBe('unavailable');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/daemon-status-mapping.test.ts`
Expected: FAIL — `mapDaemonStatus` is not exported.

- [ ] **Step 3: Implement `mapDaemonStatus` and rewire the adapter**

In `tauri-adapter.ts`, add the exported mapper above the class and replace the `daemon` block. Add after the imports:

```ts
/**
 * Maps the Rust backend's legacy status strings to the canonical DaemonStatus
 * enum. The Rust shell still emits running:{pid}/started:pid=N/exited/not_started/
 * error:… (lib.rs); this is the single place that normalizes them so the renderer
 * may branch on daemon.status()/onStatus() on Tauri (Plan 3, decision 6).
 */
export function mapDaemonStatus(raw: string): DaemonStatus {
  if (raw === 'not_started') return 'initializing';
  if (raw === 'starting' || raw.startsWith('started:')) return 'starting';
  if (raw === 'ready' || raw.startsWith('running:')) return 'ready';
  if (raw === 'exited') return 'stopped';
  return 'unavailable'; // error:… and anything unrecognized
}
```

Replace the `daemon` field:

```ts
  daemon = {
    port: (): Promise<number> => bridge.getDaemonPort(),
    status: async (): Promise<DaemonStatus> => mapDaemonStatus(await bridge.getDaemonStatus()),
    onStatus: (cb: (s: DaemonStatus) => void): Promise<Unsubscribe> =>
      bridge.onDaemonStatus((s) => cb(mapDaemonStatus(s))),
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/daemon-status-mapping.test.ts`
Expected: PASS (8 cases).

- [ ] **Step 5: Re-run the existing tauri-adapter test (no regression)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-adapter.test.ts`
Expected: PASS.

- [ ] **Step 6: Tighten the Rust `get_daemon_status` vocabulary (no behavior gap)**

The mapper already accepts the existing strings, but make the Rust emit deterministic. In `lib.rs`, `get_daemon_status` is correct as-is (`running:{pid}` / `exited` / `not_started`). No Rust change is required for correctness; leave `lib.rs:224-233` unchanged. (The `started:pid=N` form is emitted only in `setup` at `:100`; the mapper covers it.) Skip — documented here so the implementer does not "fix" working code.

- [ ] **Step 7: Typecheck app-tauri**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/app-tauri/src/lib/host/tauri-adapter.ts packages/app-tauri/src/lib/host/__tests__/daemon-status-mapping.test.ts
git commit -m "feat(app-tauri): map legacy daemon-status strings to DaemonStatus enum"
```

---

## Task 3: Add the `UpdateStatus` schema + contract types (`updates` namespace shape)

**Files:**
- Modify: `packages/types/src/host/host-contract.ts` (add `UpdateStatusSchema`)
- Modify: `packages/types/src/host/host-bridge.ts` (add `UpdateStatus` type + `updates` namespace on `HostBridge`)
- Build check: `pnpm --filter @qlan-ro/mainframe-types build`

**Interfaces:**
- Produces:
  ```ts
  export const UpdateStatusSchema = z.discriminatedUnion('state', [...]); // 6 variants
  export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
  ```
  Variants mirror Electron's `auto-updater.ts:9-15`: `{state:'checking'}` · `{state:'available'; version:string}` · `{state:'not-available'}` · `{state:'downloading'; percent:number}` · `{state:'downloaded'; version:string}` · `{state:'error'; message:string}`.
- The `HostBridge.updates` namespace (consumed by all three adapters in Task 4):
  ```ts
  updates: {
    check(): Promise<UpdateStatus>;
    download(): Promise<void>;
    install(): void;
    onStatus(cb: (s: UpdateStatus) => void): Promise<Unsubscribe>;
  };
  ```

- [ ] **Step 1: Write the failing test for the schema**

Create `packages/types/src/host/__tests__/update-status.test.ts` (the types package uses vitest — `test` script exists):

```ts
import { describe, it, expect } from 'vitest';
import { UpdateStatusSchema } from '../host-contract.js';

describe('UpdateStatusSchema', () => {
  it('accepts the checking variant', () => {
    expect(UpdateStatusSchema.parse({ state: 'checking' })).toEqual({ state: 'checking' });
  });
  it('accepts available with a version', () => {
    expect(UpdateStatusSchema.parse({ state: 'available', version: '1.2.3' })).toEqual({
      state: 'available',
      version: '1.2.3',
    });
  });
  it('accepts downloading with a percent', () => {
    expect(UpdateStatusSchema.parse({ state: 'downloading', percent: 42 })).toEqual({
      state: 'downloading',
      percent: 42,
    });
  });
  it('accepts downloaded / not-available / error', () => {
    expect(UpdateStatusSchema.parse({ state: 'downloaded', version: '9.9.9' }).state).toBe('downloaded');
    expect(UpdateStatusSchema.parse({ state: 'not-available' }).state).toBe('not-available');
    expect(UpdateStatusSchema.parse({ state: 'error', message: 'boom' }).state).toBe('error');
  });
  it('rejects available without a version', () => {
    expect(() => UpdateStatusSchema.parse({ state: 'available' })).toThrow();
  });
  it('rejects an unknown state', () => {
    expect(() => UpdateStatusSchema.parse({ state: 'paused' })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- src/host/__tests__/update-status.test.ts`
Expected: FAIL — `UpdateStatusSchema` is not exported.

- [ ] **Step 3: Add the schema to `host-contract.ts`**

Append to `host-contract.ts`:

```ts
/**
 * Auto-update lifecycle. Mirrors the Electron auto-updater.ts UpdateStatus union
 * exactly (6 variants) so the contract is host-agnostic. The Tauri shell maps its
 * tauri-plugin-updater events into this shape; the Electron adapter forwards the
 * existing update-status IPC payloads (already this shape).
 */
export const UpdateStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('checking') }),
  z.object({ state: z.literal('available'), version: z.string() }),
  z.object({ state: z.literal('not-available') }),
  z.object({ state: z.literal('downloading'), percent: z.number() }),
  z.object({ state: z.literal('downloaded'), version: z.string() }),
  z.object({ state: z.literal('error'), message: z.string() }),
]);
export type UpdateStatus = z.infer<typeof UpdateStatusSchema>;
```

- [ ] **Step 4: Add the `UpdateStatus` re-export + `updates` namespace to `host-bridge.ts`**

In `host-bridge.ts`, extend the type re-export line:

```ts
export type { Platform, DaemonStatus, LogLevel, UpdateStatus } from './host-contract.js';
```

and add an import for the type (used in the interface):

```ts
import type { UpdateStatus } from './host-contract.js';
```

Then inside `interface HostBridge`, after the `daemon` block and before `log(...)`, add:

```ts
  updates: {
    check(): Promise<UpdateStatus>;
    download(): Promise<void>;
    install(): void;
    onStatus(cb: (s: UpdateStatus) => void): Promise<Unsubscribe>;
  };
```

- [ ] **Step 5: Run the schema test**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- src/host/__tests__/update-status.test.ts`
Expected: PASS.

- [ ] **Step 6: Build types — this WILL fail the adapter typecheck later, which is expected**

Run: `pnpm --filter @qlan-ro/mainframe-types build`
Expected: PASS (the types package itself has no `HostBridge` implementor). The three adapters now fail to satisfy `HostBridge` until Task 4 — that is the intended TDD pressure; do not implement adapters here.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/host/host-contract.ts packages/types/src/host/host-bridge.ts packages/types/src/host/__tests__/update-status.test.ts
git commit -m "feat(types): add UpdateStatus schema + updates namespace to HostBridge"
```

---

## Task 4: Add the `presence` namespace + wire `updates`/`presence` in all three adapters

This task closes the contract surface so all three adapters satisfy `HostBridge` again. The Tauri `updates` impl forwards to Rust commands added in Task 11 — here it calls `bridge.*` wrappers that are stubbed to reject until Task 11 lands the Rust side; the adapter shape is correct now, the Rust backing arrives in Task 11. Presence has a full impl on every host now.

**Files:**
- Modify: `packages/types/src/host/host-contract.ts` (add `PresenceStateSchema`/`PresenceSchema`)
- Modify: `packages/types/src/host/host-bridge.ts` (add `presence` namespace)
- Modify: `packages/app-tauri/src/lib/host/tauri-adapter.ts`, `electron-adapter.ts`, `fake-adapter.ts`
- Modify: `packages/app-tauri/src/lib/tauri/bridge.ts` (presence + updater wrappers)
- Tests: `packages/app-tauri/src/lib/host/__tests__/{tauri-adapter,electron-adapter,fake-adapter}.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const PresenceStateSchema = z.enum(['active', 'idle']);
  export type PresenceState = z.infer<typeof PresenceStateSchema>;
  export const PresenceSchema = z.object({ state: PresenceStateSchema });
  ```
  `HostBridge.presence`: `{ reportActivity(state: 'active' | 'idle'): Promise<void> }`.
- Tauri adapter consumes new `bridge.ts` wrappers: `reportActivity(state)`, `checkForUpdate()`, `downloadUpdate()`, `installUpdate()`, `onUpdateStatus(cb)`.
- Electron adapter consumes `window.mainframe.updates` (already exposed, preload index.ts:92-107) and a new presence POST helper.

- [ ] **Step 1: Write the failing presence schema + namespace test (types)**

Append to a new file `packages/types/src/host/__tests__/presence.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { PresenceStateSchema, PresenceSchema } from '../host-contract.js';

describe('PresenceSchema', () => {
  it('accepts active and idle', () => {
    expect(PresenceStateSchema.parse('active')).toBe('active');
    expect(PresenceStateSchema.parse('idle')).toBe('idle');
    expect(PresenceSchema.parse({ state: 'idle' })).toEqual({ state: 'idle' });
  });
  it('rejects other states', () => {
    expect(() => PresenceStateSchema.parse('away')).toThrow();
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- src/host/__tests__/presence.test.ts`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Add presence schemas + namespace to the contract**

Append to `host-contract.ts`:

```ts
export const PresenceStateSchema = z.enum(['active', 'idle']);
export type PresenceState = z.infer<typeof PresenceStateSchema>;
export const PresenceSchema = z.object({ state: PresenceStateSchema });
```

In `host-bridge.ts`, re-export the type and add the namespace. Extend the re-export line to include `PresenceState`, add `import type { PresenceState } from './host-contract.js';`, and add to `interface HostBridge` after `updates`:

```ts
  presence: {
    reportActivity(state: PresenceState): Promise<void>;
  };
```

- [ ] **Step 4: Run the types test + build**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- src/host/__tests__/presence.test.ts`
Expected: PASS. Then `pnpm --filter @qlan-ro/mainframe-types build` → PASS.

- [ ] **Step 5: Write the failing Fake adapter test**

Append to `packages/app-tauri/src/lib/host/__tests__/fake-adapter.test.ts`:

```ts
describe('FakeHostBridge — updates + presence', () => {
  it('updates.check resolves not-available by default', async () => {
    await expect(new FakeHostBridge().updates.check()).resolves.toEqual({ state: 'not-available' });
  });
  it('updates.download/install do not throw', async () => {
    const host = new FakeHostBridge();
    await expect(host.updates.download()).resolves.toBeUndefined();
    expect(() => host.updates.install()).not.toThrow();
  });
  it('updates.onStatus fires not-available and returns a no-op unsubscribe', async () => {
    const cb = vi.fn();
    const unsub = await new FakeHostBridge().updates.onStatus(cb);
    expect(cb).toHaveBeenCalledWith({ state: 'not-available' });
    expect(() => unsub()).not.toThrow();
  });
  it('presence.reportActivity resolves undefined', async () => {
    await expect(new FakeHostBridge().presence.reportActivity('idle')).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6: Run it (fails)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/fake-adapter.test.ts`
Expected: FAIL — `updates`/`presence` missing on `FakeHostBridge`.

- [ ] **Step 7: Implement `updates`/`presence` on the Fake adapter**

In `fake-adapter.ts`, add to the imports `UpdateStatus, PresenceState` and add fields to the class (after `daemon`):

```ts
  updates = {
    check: (): Promise<UpdateStatus> => Promise.resolve({ state: 'not-available' as const }),
    download: (): Promise<void> => Promise.resolve(),
    install: (): void => {},
    onStatus: (cb: (s: UpdateStatus) => void): Promise<Unsubscribe> => {
      cb({ state: 'not-available' });
      return Promise.resolve(() => {});
    },
  };

  presence = {
    reportActivity: (_state: PresenceState): Promise<void> => Promise.resolve(),
  };
```

- [ ] **Step 8: Run the Fake test (passes)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/fake-adapter.test.ts`
Expected: PASS.

- [ ] **Step 9: Write the failing Electron adapter test**

Append to `packages/app-tauri/src/lib/host/__tests__/electron-adapter.test.ts`. First extend the `FakeMainframe` interface + `beforeEach` mock with `updates` and `daemon.port` already present; add to `mf`:

```ts
    updates: {
      check: vi.fn().mockResolvedValue({ state: 'not-available' }),
      download: vi.fn().mockResolvedValue(undefined),
      install: vi.fn(),
      onStatus: vi.fn((cb: (s: unknown) => void) => {
        cb({ state: 'checking' });
        return () => {};
      }),
    },
```

and add the test block:

```ts
describe('ElectronAdapter — updates + presence', () => {
  it('updates.check delegates to window.mainframe.updates.check', async () => {
    await expect(new ElectronAdapter().updates.check()).resolves.toEqual({ state: 'not-available' });
    expect(mf.updates.check).toHaveBeenCalled();
  });
  it('updates.onStatus subscribes and replays', async () => {
    const cb = vi.fn();
    await new ElectronAdapter().updates.onStatus(cb);
    expect(cb).toHaveBeenCalledWith({ state: 'checking' });
  });
  it('presence.reportActivity POSTs to the daemon device/activity endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 200 }));
    mf.daemon.port.mockResolvedValueOnce(31415);
    await new ElectronAdapter().presence.reportActivity('idle');
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://127.0.0.1:31415/api/device/activity',
      expect.objectContaining({ method: 'POST' }),
    );
    fetchSpy.mockRestore();
  });
});
```

Add `updates` to the `FakeMainframe` interface type too (matching the mock shape).

- [ ] **Step 10: Run it (fails)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/electron-adapter.test.ts`
Expected: FAIL — `updates`/`presence` missing.

- [ ] **Step 11: Implement `updates`/`presence` on the Electron adapter**

In `electron-adapter.ts`, extend the `MainframeBridge` interface with:

```ts
  updates: {
    check(): Promise<UpdateStatus>;
    download(): Promise<void>;
    install(): void;
    onStatus(cb: (s: UpdateStatus) => void): () => void;
  };
```

Add `UpdateStatus, PresenceState` to the type import. Add to the class (after `daemon`):

```ts
  updates = {
    check: (): Promise<UpdateStatus> => bridge().updates.check(),
    download: (): Promise<void> => bridge().updates.download(),
    install: (): void => bridge().updates.install(),
    onStatus: (cb: (s: UpdateStatus) => void): Promise<Unsubscribe> =>
      Promise.resolve(bridge().updates.onStatus(cb)),
  };

  presence = {
    reportActivity: async (state: PresenceState): Promise<void> => {
      const port = await bridge().daemon.port();
      await fetch(`http://127.0.0.1:${port}/api/device/activity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state }),
      });
    },
  };
```

(Electron already runs its own native `idle-reporter`; this renderer-facing `presence.reportActivity` exists purely to satisfy the contract and is harmless — it POSTs the same endpoint the native reporter uses. Both hosts thus expose `presence`.)

- [ ] **Step 12: Run the Electron test (passes)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/electron-adapter.test.ts`
Expected: PASS.

- [ ] **Step 13: Add the Tauri `bridge.ts` wrappers (presence + updater) with browser fallbacks**

In `packages/app-tauri/src/lib/tauri/bridge.ts`, add (importing nothing new beyond existing `invoke`/`listen`):

```ts
import type { UpdateStatus } from '@qlan-ro/mainframe-types';

/** POST device activity to the daemon. No-op in browser dev mode. */
export async function reportActivity(state: 'active' | 'idle'): Promise<void> {
  if (!IS_TAURI) return;
  await invoke('report_activity', { state });
}

export async function checkForUpdate(): Promise<UpdateStatus> {
  if (!IS_TAURI) return { state: 'not-available' };
  return invoke<UpdateStatus>('updater_check');
}

export async function downloadUpdate(): Promise<void> {
  if (!IS_TAURI) return;
  await invoke('updater_download');
}

export async function installUpdate(): Promise<void> {
  if (!IS_TAURI) return;
  await invoke('updater_install');
}

export function onUpdateStatus(callback: (s: UpdateStatus) => void): Promise<UnlistenFn> {
  if (!IS_TAURI) {
    callback({ state: 'not-available' });
    return Promise.resolve(() => {});
  }
  return listen<UpdateStatus>('update:status', (event) => callback(event.payload));
}
```

The `report_activity`/`updater_*` Rust commands land in Tasks 8 and 11; the browser fallbacks let the adapter compile and the renderer run now.

- [ ] **Step 14: Write the failing Tauri adapter test**

Append to `packages/app-tauri/src/lib/host/__tests__/tauri-adapter.test.ts`:

```ts
describe('TauriAdapter — updates + presence', () => {
  it('updates.check invokes updater_check', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    invoke.mockResolvedValueOnce({ state: 'available', version: '2.0.0' });
    await expect(new TauriAdapter().updates.check()).resolves.toEqual({ state: 'available', version: '2.0.0' });
    expect(invoke).toHaveBeenCalledWith('updater_check');
  });
  it('presence.reportActivity invokes report_activity', async () => {
    const { TauriAdapter } = await import('../tauri-adapter');
    await new TauriAdapter().presence.reportActivity('idle');
    expect(invoke).toHaveBeenCalledWith('report_activity', { state: 'idle' });
  });
});
```

- [ ] **Step 15: Run it (fails)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-adapter.test.ts`
Expected: FAIL — `updates`/`presence` missing.

- [ ] **Step 16: Implement `updates`/`presence` on the Tauri adapter**

In `tauri-adapter.ts`, add `UpdateStatus, PresenceState` to the type import and the new bridge functions to the `import * as bridge` usage (already a namespace import — `bridge.checkForUpdate` etc. resolve). Add to the class:

```ts
  updates = {
    check: (): Promise<UpdateStatus> => bridge.checkForUpdate(),
    download: (): Promise<void> => bridge.downloadUpdate(),
    install: (): void => {
      void bridge.installUpdate().catch((err) => console.warn('[host] updater install failed', err));
    },
    onStatus: (cb: (s: UpdateStatus) => void): Promise<Unsubscribe> => bridge.onUpdateStatus(cb),
  };

  presence = {
    reportActivity: (state: PresenceState): Promise<void> => bridge.reportActivity(state),
  };
```

- [ ] **Step 17: Run the Tauri test (passes) + typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-adapter.test.ts`
Expected: PASS. Then `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck` → PASS (all three adapters now satisfy `HostBridge`).

- [ ] **Step 18: Re-run presence types test + desktop typecheck (preload contract still compiles)**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- src/host/__tests__/presence.test.ts` → PASS.
Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit -p tsconfig.node.json`
Expected: PASS (the preload already exposes `updates`; no change needed). Note any baseline-unrelated errors are out of scope.

- [ ] **Step 19: Commit**

```bash
git add packages/types/src/host/host-contract.ts packages/types/src/host/host-bridge.ts packages/types/src/host/__tests__/presence.test.ts packages/app-tauri/src/lib/host/fake-adapter.ts packages/app-tauri/src/lib/host/electron-adapter.ts packages/app-tauri/src/lib/host/tauri-adapter.ts packages/app-tauri/src/lib/tauri/bridge.ts packages/app-tauri/src/lib/host/__tests__/fake-adapter.test.ts packages/app-tauri/src/lib/host/__tests__/electron-adapter.test.ts packages/app-tauri/src/lib/host/__tests__/tauri-adapter.test.ts
git commit -m "feat: add presence namespace + wire updates/presence in all three host adapters"
```

---

## Task 5: Canonical open-external scheme allowlist (mainframe-types → Rust + TS)

**Files:**
- Create: `packages/types/src/host/external-schemes.ts`
- Modify: `packages/types/src/index.ts` (export the new module)
- Modify: `packages/app-tauri/src-tauri/src/preview/mod.rs:56-59` (`is_allowed_external_scheme`) + tests at `:374-393`
- Test (TS): `packages/types/src/host/__tests__/external-schemes.test.ts`

**Interfaces:**
- Produces (TS): `export const ALLOWED_EXTERNAL_SCHEMES: readonly string[]` (no trailing colon, lowercase) and `export function isAllowedExternalScheme(url: string): boolean`. Schemes (from Electron index.ts:32-48): `http https mailto slack vscode vscode-insiders cursor jetbrains idea zed figma linear notion discord tel`.
- Produces (Rust): `is_allowed_external_scheme` widened to the same set; a `const ALLOWED_EXTERNAL_SCHEMES: &[&str]` array drives it.
- Note: the Electron renderer never imports `ALLOWED_EXTERNAL_SCHEMES` (its `openExternalSafe` runs in main with a hardcoded `Set`); leave `desktop/src/main/index.ts:32-48` as-is to avoid a cross-package main-process refactor in this plan. The canonical list lives in mainframe-types for the Tauri side and any future consumer; document the Electron list as the source of truth in the new file's comment.

- [ ] **Step 1: Write the failing TS test**

Create `packages/types/src/host/__tests__/external-schemes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isAllowedExternalScheme, ALLOWED_EXTERNAL_SCHEMES } from '../external-schemes.js';

describe('isAllowedExternalScheme', () => {
  it('allows http/https case-insensitively', () => {
    expect(isAllowedExternalScheme('https://example.com')).toBe(true);
    expect(isAllowedExternalScheme('HTTP://localhost:3000')).toBe(true);
  });
  it('allows the IDE/app schemes', () => {
    for (const s of ['vscode', 'cursor', 'jetbrains', 'zed', 'slack', 'linear', 'notion', 'figma', 'discord', 'tel', 'mailto']) {
      expect(isAllowedExternalScheme(`${s}://open/x`)).toBe(true);
    }
  });
  it('rejects dangerous schemes', () => {
    for (const u of ['file:///etc/passwd', 'javascript:alert(1)', 'ssh://host', 'data:text/html,x', 'ftp://x', '']) {
      expect(isAllowedExternalScheme(u)).toBe(false);
    }
  });
  it('exposes the canonical list without trailing colons', () => {
    expect(ALLOWED_EXTERNAL_SCHEMES).toContain('vscode-insiders');
    expect(ALLOWED_EXTERNAL_SCHEMES.every((s) => !s.endsWith(':'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- src/host/__tests__/external-schemes.test.ts`
Expected: FAIL — module missing.

- [ ] **Step 3: Create `external-schemes.ts`**

```ts
/**
 * host/external-schemes.ts
 *
 * The single canonical allowlist of URL schemes safe to forward to the OS opener.
 * Source of truth = the Electron main-process list in
 * packages/desktop/src/main/index.ts (ALLOWED_SCHEMES). The Tauri Rust shell's
 * is_allowed_external_scheme mirrors this exact set so both hosts behave 1:1.
 */
export const ALLOWED_EXTERNAL_SCHEMES = [
  'http',
  'https',
  'mailto',
  'slack',
  'vscode',
  'vscode-insiders',
  'cursor',
  'jetbrains',
  'idea',
  'zed',
  'figma',
  'linear',
  'notion',
  'discord',
  'tel',
] as const;

/** True only if `url`'s scheme is in ALLOWED_EXTERNAL_SCHEMES (case-insensitive). */
export function isAllowedExternalScheme(url: string): boolean {
  const lower = url.toLowerCase();
  return ALLOWED_EXTERNAL_SCHEMES.some((s) => lower.startsWith(`${s}://`) || lower.startsWith(`${s}:`));
}
```

(`mailto:`/`tel:` have no `//`, so the `${s}:` branch covers them; `http`/`https` match via `://`.)

- [ ] **Step 4: Export from the package index**

In `packages/types/src/index.ts`, after the existing host exports, add:

```ts
export * from './host/external-schemes.js';
```

- [ ] **Step 5: Run the TS test + build**

Run: `pnpm --filter @qlan-ro/mainframe-types test -- src/host/__tests__/external-schemes.test.ts` → PASS.
Run: `pnpm --filter @qlan-ro/mainframe-types build` → PASS.

- [ ] **Step 6: Write the failing Rust test (widen the allowlist)**

In `preview/mod.rs` test module, extend `allowed_schemes_pass` to also assert the new schemes. Add a new test:

```rust
#[test]
fn ide_and_app_schemes_pass() {
    for s in [
        "vscode://open", "vscode-insiders://open", "cursor://x", "jetbrains://x",
        "idea://x", "zed://x", "slack://chan", "linear://x", "notion://x",
        "figma://x", "discord://x", "mailto:a@b.com", "tel:+15551234",
    ] {
        assert!(is_allowed_external_scheme(s), "expected allowed: {s}");
    }
}
```

- [ ] **Step 7: Run it (fails)**

Run (in `packages/app-tauri/src-tauri`): `cargo test --lib preview::tests::ide_and_app_schemes_pass`
Expected: FAIL — only http/https currently pass.

- [ ] **Step 8: Widen `is_allowed_external_scheme`**

Replace `preview/mod.rs:56-59`:

```rust
/// Canonical allowlist — mirrors mainframe-types ALLOWED_EXTERNAL_SCHEMES
/// (source of truth: packages/desktop/src/main/index.ts). Both hosts behave 1:1.
const ALLOWED_EXTERNAL_SCHEMES: &[&str] = &[
    "http", "https", "mailto", "slack", "vscode", "vscode-insiders", "cursor",
    "jetbrains", "idea", "zed", "figma", "linear", "notion", "discord", "tel",
];

/// Returns `true` only for schemes safe to forward to the OS opener.
/// Rejects `file://`, `javascript:`, `ssh://`, `data:` and any unknown scheme.
fn is_allowed_external_scheme(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    ALLOWED_EXTERNAL_SCHEMES
        .iter()
        .any(|s| lower.starts_with(&format!("{s}://")) || lower.starts_with(&format!("{s}:")))
}
```

- [ ] **Step 9: Run the full preview test module**

Run (in `src-tauri`): `cargo test --lib preview::tests`
Expected: PASS (new test passes; `disallowed_schemes_are_rejected` still passes — `file:`/`javascript:`/`ssh:`/`data:`/`ftp:` are not in the list).

- [ ] **Step 10: Commit**

```bash
git add packages/types/src/host/external-schemes.ts packages/types/src/host/__tests__/external-schemes.test.ts packages/types/src/index.ts packages/app-tauri/src-tauri/src/preview/mod.rs
git commit -m "feat: canonical open-external scheme allowlist (types + Tauri Rust parity)"
```

---

## Task 6: Daemon bundling scaffold — `externalBin`/`resources` + resolver prefers bundled path (DEFERRED pipeline)

**Files:**
- Modify: `packages/app-tauri/src-tauri/tauri.conf.json` (`bundle.externalBin`, `bundle.resources`)
- Modify: `packages/app-tauri/src-tauri/src/lib.rs:179-215` (`resolve_daemon_entry` — prefer the bundled resource in a packaged build)
- Create/append: `docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md` (the deferred pipeline TODO)

**Interfaces:**
- Consumes: `tauri::AppHandle` to call `app.path().resource_dir()` for the packaged-build branch.
- Produces: `resolve_daemon_entry(app: &tauri::AppHandle) -> Result<PathBuf, String>` — gains a first branch that, when `resource_dir()/daemon/daemon.cjs` exists, returns it; otherwise falls through to the existing `MAINFRAME_DAEMON_PATH` + monorepo-root logic. `boot_daemon` passes the `AppHandle`.

- [ ] **Step 1: Write the failing Rust test for the resolver precedence**

The current `resolve_daemon_entry` takes no args and can't see an `AppHandle` in a unit test. Extract the path-selection logic into a pure, testable helper. Add to `lib.rs` a unit test:

```rust
#[cfg(test)]
mod resolver_tests {
    use super::pick_daemon_entry;
    use std::path::PathBuf;

    #[test]
    fn prefers_bundled_resource_when_present() {
        let bundled = PathBuf::from("/tmp/does-exist-bundled.cjs");
        std::fs::write(&bundled, b"// daemon").unwrap();
        let got = pick_daemon_entry(Some(bundled.clone()), None);
        assert_eq!(got, Some(bundled.clone()));
        std::fs::remove_file(&bundled).ok();
    }

    #[test]
    fn falls_back_to_env_override_when_no_bundle() {
        let env_path = PathBuf::from("/tmp/does-exist-env.cjs");
        std::fs::write(&env_path, b"// daemon").unwrap();
        let got = pick_daemon_entry(None, Some(env_path.clone()));
        assert_eq!(got, Some(env_path.clone()));
        std::fs::remove_file(&env_path).ok();
    }

    #[test]
    fn returns_none_when_neither_exists() {
        let got = pick_daemon_entry(
            Some(PathBuf::from("/tmp/nope-bundle.cjs")),
            Some(PathBuf::from("/tmp/nope-env.cjs")),
        );
        assert_eq!(got, None);
    }
}
```

- [ ] **Step 2: Run it (fails)**

Run (in `src-tauri`): `cargo test --lib resolver_tests`
Expected: FAIL — `pick_daemon_entry` does not exist.

- [ ] **Step 3: Add the pure helper + thread the bundled path into `resolve_daemon_entry`**

In `lib.rs`, add the pure helper:

```rust
/// Pure path-precedence selector (unit-testable, no AppHandle).
/// Precedence: bundled resource (packaged build) > env override > caller falls
/// back to the monorepo-root walk. Returns the first candidate that exists.
fn pick_daemon_entry(bundled: Option<PathBuf>, env_override: Option<PathBuf>) -> Option<PathBuf> {
    if let Some(p) = bundled {
        if p.exists() {
            return Some(p);
        }
    }
    if let Some(p) = env_override {
        if p.exists() {
            return Some(p);
        }
    }
    None
}
```

Change `resolve_daemon_entry` to accept the `AppHandle` and consult the bundled resource first:

```rust
fn resolve_daemon_entry(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bundled = app
        .path()
        .resource_dir()
        .ok()
        .map(|d| d.join("daemon").join("daemon.cjs"));
    let env_override = std::env::var("MAINFRAME_DAEMON_PATH").ok().map(PathBuf::from);

    if let Some(found) = pick_daemon_entry(bundled, env_override.clone()) {
        tracing::info!(path = %found.display(), "daemon entry resolved (bundled/env)");
        return Ok(found);
    }
    if let Some(p) = env_override {
        return Err(format!("MAINFRAME_DAEMON_PATH={} does not exist", p.display()));
    }

    // Dev fallback: walk up to the monorepo root (unchanged from the spike).
    let exe = std::env::current_exe().map_err(|e| format!("cannot determine exe path: {e}"))?;
    let mut dir = exe.as_path();
    loop {
        if dir.join("pnpm-workspace.yaml").exists() {
            let candidate = dir.join("packages/core/dist/index.js");
            if candidate.exists() {
                tracing::info!(path = %candidate.display(), "daemon entry found via monorepo root");
                return Ok(candidate);
            }
            return Err(format!(
                "monorepo root found at {} but packages/core/dist/index.js missing — run pnpm --filter @qlan-ro/mainframe-core build",
                dir.display()
            ));
        }
        match dir.parent() {
            Some(parent) => dir = parent,
            None => break,
        }
    }
    Err("could not locate monorepo root (pnpm-workspace.yaml) — set MAINFRAME_DAEMON_PATH".to_string())
}
```

Add `use tauri::Manager;` is already present (line 10 imports `Manager`); add `tauri::path` access — `app.path()` requires `tauri::Manager`, already in scope. Update `boot_daemon` to take and pass `app`: change its signature to `fn boot_daemon(app: &tauri::AppHandle, shell_env: &HashMap<String, String>)` and its `resolve_daemon_entry()` call to `resolve_daemon_entry(app)?`. In `run()`, `boot_daemon` is currently called before the builder; move the daemon boot into `.setup(move |app| { ... })` so an `AppHandle` is available (the setup closure already runs before the window emits status). Capture `shell_env` into setup (it is already cloned for `TerminalManager`).

- [ ] **Step 4: Run the resolver test + `cargo check`**

Run (in `src-tauri`): `cargo test --lib resolver_tests` → PASS.
Run: `cargo check` → PASS (confirms the `boot_daemon`/setup restructure compiles).

- [ ] **Step 5: Wire `tauri.conf.json` bundle config**

In `tauri.conf.json`, extend `bundle`:

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "icon": ["icons/32x32.png", "icons/128x128.png", "icons/128x128@2x.png", "icons/icon.icns", "icons/icon.ico"],
    "externalBin": ["binaries/node"],
    "resources": {
      "resources/daemon/daemon.cjs": "daemon/daemon.cjs",
      "resources/ripgrep/rg": "ripgrep/rg",
      "resources/lsp/typescript-language-server": "lsp/typescript-language-server",
      "resources/lsp/pyright": "lsp/pyright"
    }
  },
```

(These source paths do not exist yet — that is the deferred pipeline. Tauri's bundler only reads them at `tauri build` time, which is not run here, so config validity is the only thing exercised now.)

- [ ] **Step 6: Write the deferred-pipeline TODO note**

Create `docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md` with a `## Daemon bundling pipeline (DEFERRED)` section listing: per-platform Node sidecar fetch + rename to `binaries/node-<target-triple>`, building `daemon.cjs` via the existing `packages/desktop/scripts/bundle-daemon.mjs` equivalent, copying `@vscode/ripgrep`/`typescript-language-server`/`pyright`, and the `better-sqlite3`/`node-pty` ABI-rebuild against the pinned Node — verifiable only by a real per-OS `cargo tauri build`. Mark `// TODO(plan3-infra)`.

- [ ] **Step 7: Commit**

```bash
git add packages/app-tauri/src-tauri/src/lib.rs packages/app-tauri/src-tauri/tauri.conf.json docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md
git commit -m "feat(app-tauri): scaffold daemon bundling (externalBin/resources) + resolver prefers bundled path"
```

---

## Task 7: Rust renderer→host log sink (`tracing-appender` daily rotation, pino-shaped) + `host_log` command

**Files:**
- Create: `packages/app-tauri/src-tauri/src/log_sink.rs`
- Modify: `packages/app-tauri/src-tauri/src/lib.rs` (replace the `tracing_subscriber::fmt()` init with the file+stdout layered init; register `host_log`)
- Modify: `packages/app-tauri/src-tauri/src/commands/mod.rs` is NOT needed (log_sink is a top-level module; register `host_log` in `lib.rs`)
- Modify: `packages/app-tauri/src-tauri/Cargo.toml` + `Cargo.lock` (add `tracing-appender`, `tracing-subscriber` `json` feature, `chrono`)
- Modify: `packages/app-tauri/src/lib/tauri/bridge.ts` (`log()` forwards to `host_log` under Tauri)

**Interfaces:**
- Produces (Rust): `pub fn log_dir() -> PathBuf` (`${MAINFRAME_DATA_DIR ?? ~/.mainframe}/logs`); `pub fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard>` (installs the global subscriber with a daily-rotating JSON file writer + a dev stdout layer, runs `purge_old_logs("app-tauri", 7)`); `pub fn purge_old_logs(prefix: &str, retention_days: u64)`; `#[tauri::command] pub fn host_log(level: String, module: String, message: String, data: Option<serde_json::Value>)` that emits a `tracing` event at the mapped level carrying `module`/`message`/`data`.
- The JSON line must match pino: UPPERCASE `level`, `module`, ISO-8601 `time`, `pid`. Filename: `app-tauri.YYYY-MM-DD.log`.
- Produces (TS): `bridge.log` calls `invoke('host_log', { level, module, message, data })` under Tauri (keeps the console mirror in browser mode).

- [ ] **Step 1: Add the deps to Cargo.toml**

In `[dependencies]` of `Cargo.toml`, add:

```toml
tracing-appender = "0.2"
chrono = { version = "0.4", default-features = false, features = ["clock", "std"] }
```

and extend `tracing-subscriber`'s features to include `json`:

```toml
tracing-subscriber = { version = "0.3", features = ["env-filter", "json"] }
```

Run (in `src-tauri`): `cargo fetch` then `cargo check` to update `Cargo.lock`.

- [ ] **Step 2: Write the failing Rust test for the log line shape + retention**

Create `packages/app-tauri/src-tauri/src/log_sink.rs` with a test module first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn log_dir_respects_data_dir_override() {
        std::env::set_var("MAINFRAME_DATA_DIR", "/tmp/mf-logtest");
        assert_eq!(log_dir(), PathBuf::from("/tmp/mf-logtest/logs"));
        std::env::remove_var("MAINFRAME_DATA_DIR");
    }

    #[test]
    fn purge_removes_files_older_than_retention() {
        let dir = std::env::temp_dir().join(format!("mf-purge-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let old = dir.join("app-tauri.2000-01-01.log");
        std::fs::write(&old, b"x").unwrap();
        // Backdate mtime 30 days.
        let past = std::time::SystemTime::now() - std::time::Duration::from_secs(30 * 86_400);
        filetime::set_file_mtime(&old, filetime::FileTime::from_system_time(past)).unwrap();
        let recent = dir.join("app-tauri.2999-01-01.log");
        std::fs::write(&recent, b"y").unwrap();

        purge_old_logs_in(&dir, "app-tauri", 7);
        assert!(!old.exists(), "old log should be purged");
        assert!(recent.exists(), "recent log should survive");
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

(Add `filetime = "0.2"` to `[dev-dependencies]` in Cargo.toml for the backdating helper. If a `[dev-dependencies]` section does not exist, create it.)

- [ ] **Step 3: Run it (fails)**

Run (in `src-tauri`): `cargo test --lib log_sink::tests`
Expected: FAIL — module functions not defined.

- [ ] **Step 4: Implement `log_sink.rs`**

```rust
//! Renderer→host log sink. Writes a daily-rotating JSON-lines file matching the
//! Electron pino format (UPPERCASE level, `module`, ISO `time`, `pid`), 7-day
//! retention, unbuffered, mirrored to stdout in dev — see
//! packages/desktop/src/main/logger.ts. Plan 3, decision 3.
use std::path::{Path, PathBuf};

const RETENTION_DAYS: u64 = 7;
const LOG_PREFIX: &str = "app-tauri";

pub fn log_dir() -> PathBuf {
    let base = std::env::var("MAINFRAME_DATA_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs::home_dir().unwrap_or_default().join(".mainframe"));
    base.join("logs")
}

/// Purge `<prefix>.*` files older than `retention_days` by mtime.
pub fn purge_old_logs_in(dir: &Path, prefix: &str, retention_days: u64) {
    let cutoff = std::time::SystemTime::now()
        .checked_sub(std::time::Duration::from_secs(retention_days * 86_400));
    let Some(cutoff) = cutoff else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if !name.starts_with(&format!("{prefix}.")) {
            continue;
        }
        if let Ok(meta) = entry.metadata() {
            if let Ok(mtime) = meta.modified() {
                if mtime < cutoff {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
    }
}

pub fn purge_old_logs(prefix: &str, retention_days: u64) {
    purge_old_logs_in(&log_dir(), prefix, retention_days);
}

/// Map a host LogLevel string to a tracing level event.
fn emit_event(level: &str, module: &str, message: &str, data: Option<&serde_json::Value>) {
    let data_str = data.map(|d| d.to_string()).unwrap_or_default();
    match level {
        "debug" => tracing::debug!(module = %module, data = %data_str, "{message}"),
        "warn" => tracing::warn!(module = %module, data = %data_str, "{message}"),
        "error" => tracing::error!(module = %module, data = %data_str, "{message}"),
        _ => tracing::info!(module = %module, data = %data_str, "{message}"),
    }
}

/// Renderer log bridge. The Tauri adapter's `log` forwards here.
#[tauri::command]
pub fn host_log(level: String, module: String, message: String, data: Option<serde_json::Value>) {
    emit_event(&level, &module, &message, data.as_ref());
}

/// Install the global subscriber. Returns the appender WorkerGuard which MUST be
/// held for the process lifetime (dropping it flushes & stops the writer thread).
pub fn init_logging() -> Option<tracing_appender::non_blocking::WorkerGuard> {
    use tracing_subscriber::fmt::time::ChronoUtc;
    use tracing_subscriber::prelude::*;

    let dir = log_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        // Fall back to stdout-only so logging never blocks startup.
        tracing_subscriber::fmt().with_env_filter(default_filter()).init();
        return None;
    }
    purge_old_logs(LOG_PREFIX, RETENTION_DAYS);

    let file_appender = tracing_appender::rolling::daily(&dir, format!("{LOG_PREFIX}.log"));
    let (non_blocking, guard) = tracing_appender::non_blocking(file_appender);

    let file_layer = tracing_subscriber::fmt::layer()
        .json()
        .with_timer(ChronoUtc::rfc_3339())
        .with_current_span(false)
        .with_span_list(false)
        .with_writer(non_blocking);

    let registry = tracing_subscriber::registry()
        .with(default_filter())
        .with(file_layer);

    #[cfg(debug_assertions)]
    {
        registry.with(tracing_subscriber::fmt::layer()).init();
    }
    #[cfg(not(debug_assertions))]
    {
        registry.init();
    }
    Some(guard)
}

fn default_filter() -> tracing_subscriber::EnvFilter {
    tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| "app_tauri_lib=info,warn".parse().unwrap())
}
```

Note on filename: `tracing-appender`'s `daily` writer produces `app-tauri.log.YYYY-MM-DD`, not `app-tauri.YYYY-MM-DD.log`. The pino target is `<prefix>.<date>.log`. Document this divergence in the infra-TODO note as a known minor formatting delta (the JSON shape and retention match; only the suffix order differs). If exact-suffix parity is required, a custom `RollingFileAppender` rotation is the follow-up — out of scope for the scaffold. Add a `// TODO(plan3-infra): filename suffix order differs from pino (<prefix>.log.<date> vs <prefix>.<date>.log)` comment in `init_logging`.

The JSON level field: `tracing-subscriber`'s json formatter emits lowercase `"level":"INFO"`? It emits the level in uppercase (`INFO`/`WARN`) by default for the `Level` Display — verify in Step 5; if it emits a non-uppercase or differently-keyed field, document it in the infra-TODO rather than hand-rolling a formatter (the scaffold's acceptance is "a daily-rotating JSON file with module/message/level/pid", not byte-identical pino).

- [ ] **Step 5: Run the test (passes)**

Run (in `src-tauri`): `cargo test --lib log_sink::tests`
Expected: PASS (both tests). `cargo check` to confirm `init_logging`/`host_log` compile.

- [ ] **Step 6: Register the sink + command in `lib.rs`**

Add `mod log_sink;` at the top. Replace the `tracing_subscriber::fmt()....init();` block in `run()` with:

```rust
    // Daily-rotating JSON log sink (renderer + host logs) — held for app lifetime.
    let _log_guard = log_sink::init_logging();
```

Bind `_log_guard` so it lives until `run()` returns (the guard must outlive the app; store it in a variable that the `tauri::Builder` chain does not move out of scope — keep `_log_guard` in `run()`'s top scope, which lives until `.run(...)` returns). Add `log_sink::host_log` to `generate_handler!`.

- [ ] **Step 7: `cargo check`**

Run (in `src-tauri`): `cargo check`
Expected: PASS.

- [ ] **Step 8: Forward `bridge.log` to `host_log` under Tauri (TS)**

In `packages/app-tauri/src/lib/tauri/bridge.ts`, change `log` to invoke the command under Tauri while keeping the console mirror in browser mode:

```ts
export function log(level: LogLevel, module: string, msg: string, data?: unknown): void {
  if (IS_TAURI) {
    void invoke('host_log', { level, module, message: msg, data: data ?? null }).catch((err) => {
      console.warn('[host] host_log invoke failed', err);
    });
    return;
  }
  const fn = console[level] ?? console.log;
  if (data !== undefined) fn(`[${module}] ${msg}`, data);
  else fn(`[${module}] ${msg}`);
}
```

- [ ] **Step 9: Run the existing tauri-adapter test (log path still compiles/passes)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-adapter.test.ts`
Expected: PASS (the `log` call is fire-and-forget; existing tests do not assert on it). Then `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck` → PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/app-tauri/src-tauri/src/log_sink.rs packages/app-tauri/src-tauri/src/lib.rs packages/app-tauri/src-tauri/Cargo.toml packages/app-tauri/src-tauri/Cargo.lock packages/app-tauri/src/lib/tauri/bridge.ts
git commit -m "feat(app-tauri): Rust tracing-appender log sink + host_log command (pino-shaped daily rotation)"
```

---

## Task 8: Native OS-idle presence reporter (Rust, macOS `objc2` + stub) + `report_activity` command

**Files:**
- Create: `packages/app-tauri/src-tauri/src/presence.rs` (the reporter loop + `report_activity` command)
- Create: `packages/app-tauri/src-tauri/src/presence/idle_macos.rs`, `presence/idle_stub.rs` (per-platform idle-seconds readers)
- Modify: `packages/app-tauri/src-tauri/src/lib.rs` (`mod presence;`, start the reporter in setup, register `report_activity`)
- Modify: `Cargo.toml` + `Cargo.lock` (macOS `objc2-core-graphics` `CGEvent` feature)

**Interfaces:**
- Produces (Rust): `pub fn system_idle_seconds() -> f64` (per-platform, macOS via `CGEventSourceSecondsSinceLastEventType`); `pub fn start_presence_reporter(daemon_port: u16)` (spawns a thread: 30s poll, 5-min idle threshold, 4-min keepalive, `POST http://127.0.0.1:{port}/api/device/activity {state}`); `#[tauri::command] pub async fn report_activity(state: String, ...) -> Result<(), String>` (renderer-driven POST, satisfies the contract's `presence.reportActivity`).
- Mirrors `idle-reporter.ts` constants exactly: `POLL_INTERVAL_MS=30_000`, `IDLE_THRESHOLD_S=300`, `KEEPALIVE_INTERVAL_MS=240_000`.

- [ ] **Step 1: Add the macOS CG event source feature to Cargo.toml**

In the `[target.'cfg(target_os = "macos")'.dependencies]` block, extend `objc2-core-graphics` features to include the event API:

```toml
objc2-core-graphics = { version = "0.3", features = ["std", "CGGeometry", "CGEvent", "CGEventSource"] }
```

(If those exact feature names differ in 0.3, use the feature that gates `CGEventSourceSecondsSinceLastEventType`; verify with `cargo check` in Step 5 and adjust.)

- [ ] **Step 2: Write the failing test for the idle→state transition logic**

The OS idle read is not unit-testable, but the active/idle decision is pure. Create `presence.rs` with a pure helper + test:

```rust
//! Native OS-idle presence reporter. Mirrors packages/desktop/src/main/idle-reporter.ts
//! (30s poll, 5-min idle threshold, 4-min keepalive, POST /api/device/activity).
//! Plan 3, decision 4.

pub const POLL_INTERVAL_MS: u64 = 30_000;
pub const IDLE_THRESHOLD_S: f64 = 5.0 * 60.0;
pub const KEEPALIVE_INTERVAL_MS: u128 = 4 * 60 * 1000;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Presence {
    Active,
    Idle,
}

impl Presence {
    pub fn as_str(self) -> &'static str {
        match self {
            Presence::Active => "active",
            Presence::Idle => "idle",
        }
    }
}

/// Decide the next state from the OS idle seconds.
pub fn classify(idle_seconds: f64) -> Presence {
    if idle_seconds >= IDLE_THRESHOLD_S {
        Presence::Idle
    } else {
        Presence::Active
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn under_threshold_is_active() {
        assert_eq!(classify(0.0), Presence::Active);
        assert_eq!(classify(299.9), Presence::Active);
    }

    #[test]
    fn at_or_over_threshold_is_idle() {
        assert_eq!(classify(300.0), Presence::Idle);
        assert_eq!(classify(900.0), Presence::Idle);
    }
}
```

- [ ] **Step 3: Run it (fails)**

Run (in `src-tauri`): `cargo test --lib presence::tests`
Expected: FAIL — module not declared in `lib.rs` yet. (Add `mod presence;` in lib.rs first if the module is otherwise unreachable; the test still drives the `classify` impl.)

- [ ] **Step 4: Implement the per-platform idle reader + the reporter loop + the command**

Create `presence/idle_macos.rs`:

```rust
//! macOS idle-seconds reader via CGEventSourceSecondsSinceLastEventType.
use objc2_core_graphics::{
    CGEventSourceSecondsSinceLastEventType, CGEventSourceStateID, CGEventType,
};

/// Seconds since the last HID (combined keyboard+mouse) event for the current session.
pub fn system_idle_seconds() -> f64 {
    // SAFETY: the CG event-source query takes a state id + event-type enum and
    // returns a CFTimeInterval (f64). It reads HID idle time, touches no memory we
    // own, and has no failure mode beyond returning 0.0 — safe to call from any thread.
    unsafe {
        CGEventSourceSecondsSinceLastEventType(
            CGEventSourceStateID::CombinedSessionState,
            CGEventType::Null, // kCGAnyInputEventType — "any input event"
        )
    }
}
```

(Verify the exact symbol/enum names against the installed `objc2-core-graphics` 0.3 in Step 5; `kCGAnyInputEventType` maps to the `CGEventType` "any" discriminant — if the binding lacks a named variant, construct it from the raw `u32` `0xFFFFFFFF` via the type's `from_raw`/`(...)` constructor. Adjust to the real API; keep the `unsafe` block minimal and commented.)

Create `presence/idle_stub.rs`:

```rust
//! Non-macOS fallback: report always-active (no portable idle API wired yet).
pub fn system_idle_seconds() -> f64 {
    0.0
}
```

Append to `presence.rs` the platform glue, the reporter thread, and the command:

```rust
#[cfg(target_os = "macos")]
#[path = "presence/idle_macos.rs"]
mod idle;
#[cfg(not(target_os = "macos"))]
#[path = "presence/idle_stub.rs"]
mod idle;

pub fn system_idle_seconds() -> f64 {
    idle::system_idle_seconds()
}

async fn post_state(port: u16, state: Presence) -> Result<(), String> {
    let url = format!("http://127.0.0.1:{port}/api/device/activity");
    let body = serde_json::json!({ "state": state.as_str() }).to_string();
    // Use a tiny blocking POST on a tokio task to avoid pulling reqwest.
    let resp = tauri::async_runtime::spawn_blocking(move || ureq::post(&url).send_string(&body))
        .await
        .map_err(|e| e.to_string())?;
    resp.map(|_| ()).map_err(|e| e.to_string())
}
```

Decision: rather than add `ureq`, reuse the Tauri HTTP capability or `std`. **Use `ureq`** only if it is already a transitive dep; otherwise post via the tokio runtime with a minimal manual TCP write is overkill. **Resolution:** add `ureq = "2"` to `[dependencies]` (small, pure-Rust, no TLS needed for `127.0.0.1`) and stage `Cargo.toml`+`Cargo.lock`. Then the reporter:

```rust
pub fn start_presence_reporter(daemon_port: u16) {
    std::thread::spawn(move || {
        let mut current = Presence::Active;
        let mut last_reported = std::time::Instant::now();
        // Initial active report.
        let _ = ureq::post(&format!("http://127.0.0.1:{daemon_port}/api/device/activity"))
            .send_string(&serde_json::json!({ "state": "active" }).to_string());
        loop {
            std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));
            let next = classify(system_idle_seconds());
            let now = std::time::Instant::now();
            let should_report = next != current
                || (next == Presence::Active
                    && now.duration_since(last_reported).as_millis() >= KEEPALIVE_INTERVAL_MS);
            if should_report {
                current = next;
                last_reported = now;
                if let Err(e) = ureq::post(&format!("http://127.0.0.1:{daemon_port}/api/device/activity"))
                    .send_string(&serde_json::json!({ "state": current.as_str() }).to_string())
                {
                    tracing::warn!(err = %e, state = current.as_str(), "presence report failed");
                }
            }
        }
    });
}

#[tauri::command]
pub fn report_activity(state: String, port: tauri::State<'_, u16>) -> Result<(), String> {
    let p = *port;
    let parsed = match state.as_str() {
        "active" => Presence::Active,
        "idle" => Presence::Idle,
        other => return Err(format!("invalid presence state: {other}")),
    };
    let _ = ureq::post(&format!("http://127.0.0.1:{p}/api/device/activity"))
        .send_string(&serde_json::json!({ "state": parsed.as_str() }).to_string());
    Ok(())
}
```

Remove the earlier draft `post_state`/`spawn_blocking` block — the synchronous `ureq` path above is the single implementation. Register the daemon port as managed state in `lib.rs` (`app.manage(DAEMON_PORT)`) so `report_activity` can read it.

- [ ] **Step 5: Run the presence test + `cargo check` (verify objc2 symbols)**

Run (in `src-tauri`): `cargo test --lib presence::tests` → PASS.
Run: `cargo check` → resolve any `objc2-core-graphics` symbol/feature mismatch surfaced here; adjust `idle_macos.rs`/Cargo features until `cargo check` is clean. (Do NOT run a full `cargo build` yet — `check` is enough and faster.)

- [ ] **Step 6: Start the reporter + register the command in `lib.rs`**

In `run()` setup, after the daemon boots, call `presence::start_presence_reporter(DAEMON_PORT);` and `app.manage(DAEMON_PORT);` (the latter before any command that reads it). Add `presence::report_activity` to `generate_handler!` and `mod presence;` at the top.

- [ ] **Step 7: `cargo check` final**

Run (in `src-tauri`): `cargo check`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/app-tauri/src-tauri/src/presence.rs packages/app-tauri/src-tauri/src/presence/idle_macos.rs packages/app-tauri/src-tauri/src/presence/idle_stub.rs packages/app-tauri/src-tauri/src/lib.rs packages/app-tauri/src-tauri/Cargo.toml packages/app-tauri/src-tauri/Cargo.lock
git commit -m "feat(app-tauri): native OS-idle presence reporter (macOS objc2) + report_activity command"
```

---

## Task 9: Native Tauri application menu + "Check for Updates" item

**Files:**
- Create: `packages/app-tauri/src-tauri/src/menu.rs`
- Modify: `packages/app-tauri/src-tauri/src/lib.rs` (`mod menu;`, build + set the menu in setup, handle the menu event)

**Interfaces:**
- Produces (Rust): `pub fn build_menu(app: &tauri::AppHandle) -> Result<tauri::menu::Menu<tauri::Wry>, tauri::Error>` — standard app menu (App/Edit/View/Window/Help) with a Help → "Check for Updates…" `MenuItem` whose id is `"check-for-updates"`. `pub fn handle_menu_event(app: &tauri::AppHandle, id: &str)` — on `"check-for-updates"`, calls the updater check (Task 11's `updater::check_for_update_manual(app)`); until Task 11 lands, it logs and is a no-op (wired fully in Task 11 Step N).
- Mirrors `menu.ts`: a "Check for Updates…" item under Help, enabled in production.

- [ ] **Step 1: Write the failing test for the menu-id constant**

The Tauri `Menu` requires an `AppHandle`/`App` (not constructible in a plain unit test). Test the pure id/label table instead. Create `menu.rs`:

```rust
//! Native application menu (parity with packages/desktop/src/main/menu.ts).
//! Adds a Help → "Check for Updates…" item wired to the updater.

pub const CHECK_FOR_UPDATES_ID: &str = "check-for-updates";
pub const CHECK_FOR_UPDATES_LABEL: &str = "Check for Updates…";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_for_updates_id_is_stable() {
        assert_eq!(CHECK_FOR_UPDATES_ID, "check-for-updates");
        assert!(CHECK_FOR_UPDATES_LABEL.starts_with("Check for Updates"));
    }
}
```

- [ ] **Step 2: Run it (fails until module is declared)**

Run (in `src-tauri`): `cargo test --lib menu::tests`
Expected: FAIL — module not declared. Add `mod menu;` to `lib.rs`, re-run → PASS (this trivial test passes once the module compiles; it guards the id used by both the builder and the event handler).

- [ ] **Step 3: Implement `build_menu` + `handle_menu_event`**

Append to `menu.rs`:

```rust
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Wry};

pub fn build_menu(app: &AppHandle) -> Result<Menu<Wry>, tauri::Error> {
    let is_prod = !cfg!(debug_assertions);

    let check_updates = MenuItem::with_id(
        app,
        CHECK_FOR_UPDATES_ID,
        CHECK_FOR_UPDATES_LABEL,
        is_prod, // enabled only in production
        None::<&str>,
    )?;

    let app_menu = Submenu::with_items(
        app,
        "Mainframe",
        true,
        &[
            &PredefinedMenuItem::about(app, Some("Mainframe"), None)?,
            &check_updates,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let window_menu = Submenu::with_items(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ],
    )?;

    Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
}

/// Route a menu click. Returns true if handled.
pub fn handle_menu_event(app: &AppHandle, id: &str) -> bool {
    if id == CHECK_FOR_UPDATES_ID {
        crate::updater::check_for_update_manual(app);
        return true;
    }
    false
}
```

Note: the "Check for Updates" item lives under the app menu (macOS convention) rather than Help — both match the user-visible intent (`menu.ts` puts it under Help on Linux/Win where there is no app menu). Document this platform nuance with a comment. `crate::updater::check_for_update_manual` is defined in Task 11; this task's `cargo check` will fail until Task 11 lands the function — so **gate Step 4's check**: add a temporary local `fn check_for_update_manual` stub in `menu.rs` returning `()` ONLY if Task 11 is not yet merged; the canonical impl in `updater.rs` supersedes it. Prefer ordering: do Task 11 before this task's Step 3 wiring if executing strictly sequentially. (Sequencing note: the scoping doc says the updater menu item depends on the updater command existing — so execute Task 11 before Task 9 Step 3, or keep the stub.)

- [ ] **Step 4: `cargo check`**

Run (in `src-tauri`): `cargo check`
Expected: PASS (with Task 11 merged, or the temporary stub).

- [ ] **Step 5: Set the menu + wire the event in `lib.rs`**

In setup, after the window exists: `let menu = menu::build_menu(app.handle())?; app.set_menu(menu)?;`. Add `.on_menu_event(|app, event| { menu::handle_menu_event(app, event.id().as_ref()); })` to the builder chain.

- [ ] **Step 6: Run the menu test + `cargo check`**

Run (in `src-tauri`): `cargo test --lib menu::tests` → PASS; `cargo check` → PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/app-tauri/src-tauri/src/menu.rs packages/app-tauri/src-tauri/src/lib.rs
git commit -m "feat(app-tauri): native application menu with Check for Updates item"
```

---

## Task 10: RSS memory sampler (Rust) logged via the log sink

**Files:**
- Create: `packages/app-tauri/src-tauri/src/memory_logger.rs`
- Modify: `packages/app-tauri/src-tauri/src/lib.rs` (`mod memory_logger;`, start in setup)
- Modify: `Cargo.toml` + `Cargo.lock` (add `sysinfo`)

**Interfaces:**
- Produces (Rust): `pub fn sample_rss_bytes() -> Option<u64>` (current-process RSS via `sysinfo`); `pub fn start_memory_logger()` (spawns a thread: 5-min interval, logs an RSS snapshot via `tracing::info!`). Mirrors `memory-logger.ts` (`MEMORY_LOG_INTERVAL_MS = 5 * 60 * 1000`). Note: Electron samples the *renderer* process; Tauri's webview RSS is harder to isolate, so this samples the host process RSS — the observable "RSS sampling" parity, documented as a delta.

- [ ] **Step 1: Add `sysinfo` to Cargo.toml**

Add to `[dependencies]`: `sysinfo = { version = "0.31", default-features = false, features = ["system"] }`. Run `cargo fetch` + `cargo check` to update the lock.

- [ ] **Step 2: Write the failing test**

Create `memory_logger.rs`:

```rust
//! Periodic process-RSS sampler (parity with packages/desktop/src/main/memory-logger.ts).
//! Electron samples the renderer process; the Tauri webview RSS is not cleanly
//! separable, so we sample the host process RSS instead (documented delta).
pub const MEMORY_LOG_INTERVAL_MS: u64 = 5 * 60 * 1000;

/// Current process resident-set size in bytes, if obtainable.
pub fn sample_rss_bytes() -> Option<u64> {
    use sysinfo::{Pid, ProcessRefreshKind, System};
    let mut sys = System::new();
    let pid = Pid::from_u32(std::process::id());
    sys.refresh_process_specifics(pid, ProcessRefreshKind::new().with_memory());
    sys.process(pid).map(|p| p.memory())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rss_is_positive_for_this_process() {
        let rss = sample_rss_bytes();
        assert!(rss.is_some(), "expected an RSS reading for the test process");
        assert!(rss.unwrap() > 0, "RSS should be > 0");
    }
}
```

(Verify the `sysinfo` 0.31 API in `cargo check`; the method names `refresh_process_specifics`/`ProcessRefreshKind::new().with_memory()`/`process(pid).memory()` are 0.31-era — adjust to the resolved version if they differ.)

- [ ] **Step 3: Run it (fails until module declared)**

Run (in `src-tauri`): `cargo test --lib memory_logger::tests`
Expected: FAIL — module not declared. Add `mod memory_logger;` to `lib.rs`, re-run.

- [ ] **Step 4: Implement `start_memory_logger`**

Append to `memory_logger.rs`:

```rust
pub fn start_memory_logger() {
    std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_millis(MEMORY_LOG_INTERVAL_MS));
        match sample_rss_bytes() {
            Some(rss) => tracing::info!(
                module = "host:perf",
                rss_bytes = rss,
                rss_mb = rss / 1_048_576,
                "host memory snapshot"
            ),
            None => tracing::warn!(module = "host:perf", "RSS sample unavailable"),
        }
    });
}
```

- [ ] **Step 5: Run the test + `cargo check`**

Run (in `src-tauri`): `cargo test --lib memory_logger::tests` → PASS; `cargo check` → PASS.

- [ ] **Step 6: Start it in `lib.rs` setup**

After the log sink is initialized, call `memory_logger::start_memory_logger();` in setup.

- [ ] **Step 7: Commit**

```bash
git add packages/app-tauri/src-tauri/src/memory_logger.rs packages/app-tauri/src-tauri/src/lib.rs packages/app-tauri/src-tauri/Cargo.toml packages/app-tauri/src-tauri/Cargo.lock
git commit -m "feat(app-tauri): periodic process-RSS sampler logged via the log sink"
```

---

## Task 11: Auto-updater scaffold — `tauri-plugin-updater` + Rust check/download/install + error classifier + periodic check (DEFERRED signing/CI)

**Files:**
- Create: `packages/app-tauri/src-tauri/src/updater.rs`, `packages/app-tauri/src-tauri/src/updater/error_classifier.rs`
- Modify: `packages/app-tauri/src-tauri/src/lib.rs` (`mod updater;`, register plugin, register commands, schedule checks)
- Modify: `Cargo.toml` + `Cargo.lock` (add `tauri-plugin-updater`)
- Modify: `tauri.conf.json` (updater plugin endpoint + pubkey placeholder)
- Modify: `capabilities/main.json` (updater permissions)
- Append: `docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md` (signing/CI TODO)

**Interfaces:**
- Produces (Rust):
  - `error_classifier::classify(msg: &str) -> UpdateErrorKind` (`Transient`/`Persistent`) — port of `auto-updater-error-classifier.ts` (the network/HTTP patterns + codes).
  - `#[tauri::command] pub async fn updater_check(app) -> Result<UpdateStatus, String>`, `updater_download(app)`, `updater_install(app)`. `UpdateStatus` mirrors the contract union (serde tagged on `state`).
  - `pub fn check_for_update_manual(app: &AppHandle)` — fire-and-forget check used by the menu item.
  - `pub fn schedule_update_checks(app: AppHandle)` — 10s-then-4h timer (matching `auto-updater.ts:120-136`).
  - Events: emits `update:status` with `UpdateStatus` payloads (the `bridge.onUpdateStatus` listener from Task 4).
- The JS adapter (Task 4) already calls `updater_check`/`updater_download`/`updater_install` and listens on `update:status`.

- [ ] **Step 1: Add the plugin dep + permissions config**

In `Cargo.toml` `[dependencies]`: `tauri-plugin-updater = "2"`. Run `cargo fetch` + `cargo check`. In `capabilities/main.json` `permissions`, add `"updater:default"`. In `tauri.conf.json` `plugins`, add:

```json
    "updater": {
      "endpoints": [
        "https://github.com/qlan-ro/mainframe/releases/latest/download/latest.json"
      ],
      "pubkey": "TODO_PLAN3_INFRA_REPLACE_WITH_TAURI_SIGNER_PUBLIC_KEY"
    }
```

(The pubkey is a documented placeholder — see the infra-TODO note. `tauri build` would reject an empty pubkey, but `tauri build` is not run here.)

- [ ] **Step 2: Write the failing error-classifier test**

Create `packages/app-tauri/src-tauri/src/updater/error_classifier.rs`:

```rust
//! Port of packages/desktop/src/main/auto-updater-error-classifier.ts.
//! Transient errors (network/5xx/429/rate-limit) are suppressed from the UI;
//! persistent errors surface. Plan 3, decision 1.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UpdateErrorKind {
    Transient,
    Persistent,
}

const TRANSIENT_CODES: &[&str] = &[
    "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "ENETUNREACH", "EHOSTUNREACH",
];
const PERSISTENT_CODES: &[&str] = &["ENOSPC", "EPERM", "EACCES"];

pub fn classify(message: &str) -> UpdateErrorKind {
    for code in TRANSIENT_CODES {
        if message.contains(code) {
            return UpdateErrorKind::Transient;
        }
    }
    for code in PERSISTENT_CODES {
        if message.contains(code) {
            return UpdateErrorKind::Persistent;
        }
    }
    let lower = message.to_lowercase();
    // HTTP 5xx / 429 / GitHub 403 rate-limit / generic network strings.
    let transient_markers = [
        "status 5", "status 429", "net::err_", "network unavailable",
        "network is unavailable", "dns lookup fail", "dns fail",
    ];
    if transient_markers.iter().any(|m| lower.contains(m)) {
        return UpdateErrorKind::Transient;
    }
    if lower.contains("status 403") && lower.contains("api.github.com") {
        return UpdateErrorKind::Transient;
    }
    UpdateErrorKind::Persistent
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_codes_are_transient() {
        assert_eq!(classify("getaddrinfo ENOTFOUND github.com"), UpdateErrorKind::Transient);
        assert_eq!(classify("connect ECONNREFUSED"), UpdateErrorKind::Transient);
    }
    #[test]
    fn disk_perm_codes_are_persistent() {
        assert_eq!(classify("write ENOSPC"), UpdateErrorKind::Persistent);
        assert_eq!(classify("EACCES: permission denied"), UpdateErrorKind::Persistent);
    }
    #[test]
    fn http_5xx_and_429_are_transient() {
        assert_eq!(classify("Server responded with status 503"), UpdateErrorKind::Transient);
        assert_eq!(classify("HTTP status 429 Too Many Requests"), UpdateErrorKind::Transient);
    }
    #[test]
    fn github_403_rate_limit_is_transient() {
        assert_eq!(
            classify("status 403 from api.github.com rate limit exceeded"),
            UpdateErrorKind::Transient
        );
    }
    #[test]
    fn unknown_is_persistent() {
        assert_eq!(classify("signature verification failed"), UpdateErrorKind::Persistent);
    }
}
```

- [ ] **Step 3: Run it (fails until module declared)**

Run (in `src-tauri`): `cargo test --lib updater::error_classifier::tests`
Expected: FAIL — module not declared. Create `updater.rs` with `pub mod error_classifier;` and `mod updater;` in `lib.rs`, re-run → PASS (5 cases).

- [ ] **Step 4: Implement the updater commands + event emission + scheduler in `updater.rs`**

```rust
pub mod error_classifier;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use error_classifier::{classify, UpdateErrorKind};

/// Contract-shaped status (serde tagged on `state`) — mirrors mainframe-types
/// UpdateStatusSchema. Plan 3, decision 1.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "state", rename_all = "kebab-case")]
pub enum UpdateStatus {
    Checking,
    Available { version: String },
    NotAvailable,
    Downloading { percent: f64 },
    Downloaded { version: String },
    Error { message: String },
}

fn emit(app: &AppHandle, status: UpdateStatus) {
    if let Err(e) = app.emit("update:status", &status) {
        tracing::warn!(err = %e, "failed to emit update:status");
    }
}

/// Check for an update. Returns the resulting status and also emits it.
#[tauri::command]
pub async fn updater_check(app: AppHandle) -> Result<UpdateStatus, String> {
    emit(&app, UpdateStatus::Checking);
    let updater = app.updater().map_err(|e| e.to_string())?;
    match updater.check().await {
        Ok(Some(update)) => {
            let status = UpdateStatus::Available { version: update.version.clone() };
            emit(&app, status.clone());
            Ok(status)
        }
        Ok(None) => {
            let status = UpdateStatus::NotAvailable;
            emit(&app, status.clone());
            Ok(status)
        }
        Err(e) => {
            let message = e.to_string();
            // Suppress transient errors from the UI (parity with auto-updater.ts).
            if classify(&message) == UpdateErrorKind::Transient {
                tracing::warn!(message = %message, "transient update error (suppressed)");
                return Ok(UpdateStatus::NotAvailable);
            }
            let status = UpdateStatus::Error { message: message.clone() };
            emit(&app, status.clone());
            Err(message)
        }
    }
}

/// Download (and stage) the available update, emitting progress.
#[tauri::command]
pub async fn updater_download(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("no update available to download".to_string());
    };
    let version = update.version.clone();
    let app2 = app.clone();
    update
        .download(
            move |chunk, total| {
                if let Some(total) = total {
                    let percent = (chunk as f64 / total as f64) * 100.0;
                    emit(&app2, UpdateStatus::Downloading { percent });
                }
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    emit(&app, UpdateStatus::Downloaded { version });
    Ok(())
}

/// Download (if needed) + install + relaunch.
#[tauri::command]
pub async fn updater_install(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("no update available to install".to_string());
    };
    update.download_and_install(|_, _| {}, || {}).await.map_err(|e| e.to_string())?;
    app.restart();
}

/// Fire-and-forget manual check (menu item).
pub fn check_for_update_manual(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(e) = updater_check(app).await {
            tracing::warn!(err = %e, "manual update check failed");
        }
    });
}

/// 10s-then-4h periodic check (parity with auto-updater.ts scheduleChecks).
pub fn schedule_update_checks(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_secs(10)).await;
        let _ = updater_check(app.clone()).await;
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(4 * 60 * 60));
        interval.tick().await; // consume the immediate first tick
        loop {
            interval.tick().await;
            let _ = updater_check(app.clone()).await;
        }
    });
}
```

(Verify the `tauri-plugin-updater` 2.x API surface — `app.updater()`, `update.version`, `update.download`/`download_and_install` callback signatures — against the installed crate during `cargo check`; adjust callback arities if 2.x differs. The `app.restart()`/`app.updater()` require `tauri::Manager`/`UpdaterExt` in scope, imported above.)

- [ ] **Step 5: Register the plugin, commands, and scheduler in `lib.rs`**

Add `.plugin(tauri_plugin_updater::Builder::new().build())` to the builder. Add `updater::updater_check, updater::updater_download, updater::updater_install` to `generate_handler!`. In setup (production only — gate on `!cfg!(debug_assertions)`), call `updater::schedule_update_checks(app.handle().clone());`. Add `mod updater;` at the top.

- [ ] **Step 6: `cargo check` + run the classifier test**

Run (in `src-tauri`): `cargo check` → resolve plugin API mismatches until clean.
Run: `cargo test --lib updater::error_classifier::tests` → PASS.

- [ ] **Step 7: Write the signing/CI TODO**

Append to `docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md` a `## Updater signing + CI (DEFERRED)` section: run `tauri signer generate`, store the private key as CI secret `TAURI_SIGNING_PRIVATE_KEY`, paste the public key into `tauri.conf.json` `plugins.updater.pubkey`, add the `tauri-apps/tauri-action` release workflow that publishes `latest.json` to GitHub Releases, and cut the first signed release. Mark `// TODO(plan3-infra)`. Note the endpoint owner/repo (`qlan-ro/mainframe`) must be confirmed before the first release.

- [ ] **Step 8: Commit**

```bash
git add packages/app-tauri/src-tauri/src/updater.rs packages/app-tauri/src-tauri/src/updater/error_classifier.rs packages/app-tauri/src-tauri/src/lib.rs packages/app-tauri/src-tauri/Cargo.toml packages/app-tauri/src-tauri/Cargo.lock packages/app-tauri/src-tauri/tauri.conf.json packages/app-tauri/src-tauri/capabilities/main.json docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md
git commit -m "feat(app-tauri): tauri-plugin-updater scaffold (check/download/install + error classifier + periodic check)"
```

---

## Task 12: Webview permission policy + crash signal (best-effort)

**Files:**
- Modify: `packages/app-tauri/src-tauri/tauri.conf.json` (null macOS camera/mic usage descriptions under `bundle.macOS`)
- Modify: `packages/app-tauri/src-tauri/capabilities/main.json` (confirm no camera/mic permissions are granted; allow clipboard/notify)
- Append: `docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md` (WKWebView `didTerminate` crash-signal gap)

**Interfaces:**
- Produces (config): `tauri.conf.json` `bundle.macOS.entitlements`/Info.plist nulls for `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` so macOS never prompts (parity with Electron's `denyUnneededPermissions` allowing only clipboard/notifications). Capabilities already grant only `notification:*` + `opener` + window-drag — no media permission is exposed, which is the deny-by-default posture.

- [ ] **Step 1: Add null macOS usage descriptions to tauri.conf.json**

In `tauri.conf.json` `bundle`, add a `macOS` block (or extend if present):

```json
    "macOS": {
      "entitlements": null,
      "exceptionDomain": "",
      "providerShortName": null,
      "signingIdentity": null
    }
```

and ensure no `NSCameraUsageDescription`/`NSMicrophoneUsageDescription` keys are declared anywhere (absence = no usage = macOS denies without prompting). Document in a comment via the infra-TODO that the Tauri capability model has no media permissions, so camera/mic are denied by default — matching Electron's allowlist of clipboard + notifications only.

- [ ] **Step 2: Confirm capabilities grant only clipboard/notify-class permissions**

Verify `capabilities/main.json` lists only `core:default`, `core:window:allow-start-dragging`, `opener:default`, `notification:*`, `updater:default` (added in Task 11), and `mcp-bridge:default`. There is no camera/mic/geolocation permission — this IS the deny policy. No edit needed beyond confirming; record the verification in the commit message.

- [ ] **Step 3: Document the crash-signal gap**

Append to the infra-TODO note a `## WKWebView crash signal (DEFERRED / best-effort)` section: Electron's `render-process-gone` has no exact Tauri equivalent; the RSS sampler (Task 10) covers memory diagnostics, but the webview-terminated signal needs a WKNavigationDelegate `webViewWebContentProcessDidTerminate` hook via objc2 — lower fidelity, deferred. Mark `// TODO(plan3-infra)`.

- [ ] **Step 4: `cargo check` (config is read at build, but confirm the crate still compiles)**

Run (in `src-tauri`): `cargo check`
Expected: PASS (config-only change; no Rust change).

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src-tauri/tauri.conf.json docs/architecture/2026-06-24-host-bridge-plan3-infra-todos.md
git commit -m "chore(app-tauri): null macOS media usage descriptions; document deny-by-default webview policy + crash-signal gap"
```

---

## Task 13: Wire `setDevice` to a real Tauri implementation

**Files:**
- Modify: `packages/app-tauri/src/lib/host/tauri-preview.ts:49-52` (`setDevice` no-op → real refit)
- Test: `packages/app-tauri/src/lib/host/__tests__/tauri-preview.test.ts`

**Interfaces:**
- Consumes: `preview.previewSetBounds(tabId, bounds)` (already imported in `tauri-preview.ts` via `* as preview`).
- Produces: `setDevice(device)` re-reads the container rect (via the closure's `readBounds()`) and re-issues `previewSetBounds`, so a device toggle that resizes the container is reflected in the native layer immediately rather than waiting for the next `refit()`. (Decision 5: a real impl, not a no-op.)

- [ ] **Step 1: Write the failing test**

Append to `packages/app-tauri/src/lib/host/__tests__/tauri-preview.test.ts` (mirror its existing mock of `@/lib/tauri/preview`):

```ts
it('setDevice re-issues previewSetBounds with the current container rect', async () => {
  const { mountTauriPreview } = await import('../tauri-preview');
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ left: 5, top: 6, width: 320, height: 480 }) as DOMRect;
  const handle = mountTauriPreview(container, 'http://x');
  previewSetBounds.mockClear();
  handle.setDevice('mobile');
  expect(previewSetBounds).toHaveBeenCalledWith(
    expect.any(String),
    { x: 5, y: 6, w: 320, h: 480 },
  );
});
```

(Ensure the test file's mock for `@/lib/tauri/preview` exposes a `previewSetBounds` spy; if the existing file already mocks `previewCreate`/`previewSetVisible`, add `previewSetBounds` to the same mock.)

- [ ] **Step 2: Run it (fails)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-preview.test.ts`
Expected: FAIL — `setDevice` is a no-op, `previewSetBounds` not called.

- [ ] **Step 3: Implement `setDevice`**

Replace the `setDevice` field in `tauri-preview.ts`:

```ts
    setDevice: (_device: 'desktop' | 'mobile'): void => {
      // The device toggle resizes the DOM container; immediately re-read its rect
      // into the native layer so the preview webview tracks the new frame without
      // waiting for the next refit() (decision 5).
      void preview.previewSetBounds(tabId, readBounds()).catch((e) => console.warn('[preview] tauri setDevice', e));
    },
```

- [ ] **Step 4: Run the test (passes)**

Run: `pnpm --filter @qlan-ro/mainframe-app-tauri test -- src/lib/host/__tests__/tauri-preview.test.ts`
Expected: PASS. Then `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app-tauri/src/lib/host/tauri-preview.ts packages/app-tauri/src/lib/host/__tests__/tauri-preview.test.ts
git commit -m "feat(app-tauri): wire PreviewHandle.setDevice to refit the native webview on Tauri"
```

---

## Task 14: `dev:desktop` concurrent orchestration script

**Files:**
- Modify: `package.json` (root) — add `dev:desktop` script + `concurrently` devDependency
- Note: `concurrently` is NOT yet a dependency anywhere (verified). Add it to root `package.json` `devDependencies` ONLY; flag the lockfile as a deferred user step (never edit `pnpm-lock.yaml` in this shared worktree).

**Interfaces:**
- Produces: a root `dev:desktop` script that runs three processes concurrently: the core daemon (`dev:core`), the app-tauri Vite dev server (port 5174), and the Electron shell (`pnpm --filter @qlan-ro/mainframe-desktop run dev`). The Electron shell already loads `http://localhost:5174` in dev (verified in `desktop/src/main/index.ts:185-187`).

- [ ] **Step 1: Add `concurrently` to root devDependencies (package.json only)**

In root `package.json` `devDependencies`, add `"concurrently": "^9.1.0"`. Do NOT run `pnpm install` (it would churn the lockfile in this shared worktree). The implementer or CI installs it as a deferred step.

- [ ] **Step 2: Add the `dev:desktop` script**

In root `package.json` `scripts`, replace the existing `dev:desktop` (currently `pnpm --filter @qlan-ro/mainframe-desktop run dev`) with the orchestrated form:

```json
    "dev:desktop": "concurrently -k -n core,vite,electron -c blue,green,magenta \"pnpm --filter @qlan-ro/mainframe-core run dev\" \"pnpm --filter @qlan-ro/mainframe-app-tauri run dev\" \"sleep 3 && pnpm --filter @qlan-ro/mainframe-desktop run dev\"",
```

(`-k` kills all on any exit; `sleep 3` lets Vite bind :5174 strictPort before Electron loads it.)

- [ ] **Step 3: Verify the script parses (no install required)**

Run: `node -e "const p=require('/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt/package.json'); if(!p.scripts['dev:desktop'].includes('concurrently')) process.exit(1); console.log('ok');"`
Expected: prints `ok`. (Full run is gated on `concurrently` being installed — a deferred step.)

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add dev:desktop concurrently script (core + app-tauri vite + electron shell)"
```

---

## Task 15: Phase 6 — delete the legacy `packages/desktop/src/renderer` (LAST)

**Files:**
- Delete: `packages/desktop/src/renderer/**` (331 files)
- Delete: `packages/desktop/vite.web.config.ts` (its `root` points at `src/renderer`)
- Modify: `packages/desktop/package.json` (remove the `dev:web` script that uses `vite.web.config.ts`)

**Interfaces:**
- Consumes: nothing. The Electron main/preload load app-tauri's renderer (verified: `electron.vite.config.ts` builds only main+preload; `index.ts:185-189` loads `http://localhost:5174` / `app-tauri-renderer/index.html`). `memory-logger.ts` imports `./renderer-memory.js` (a `main/` file, NOT under `src/renderer`) — unaffected.

- [ ] **Step 1: Final "nothing imports it" grep (gate the deletion)**

Run:

```bash
cd /Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt
grep -rn "src/renderer" packages/desktop/src/main packages/desktop/src/preload packages/desktop/electron.vite.config.ts packages/desktop/package.json packages/desktop/vite.web.config.ts 2>/dev/null
grep -rln "desktop/src/renderer" packages --include="*.ts" --include="*.tsx" --include="*.json" 2>/dev/null | grep -v "/coverage/" | grep -v node_modules
```

Expected: the ONLY hits are `packages/desktop/vite.web.config.ts` (`root: resolve(__dirname, 'src/renderer')`) and the `dev:web` script in `packages/desktop/package.json`. No `packages/app-tauri/src` or `desktop/src/main`/`preload` source imports it. If any other real import appears, STOP and surface it — do not delete.

- [ ] **Step 2: Remove the `dev:web` script**

In `packages/desktop/package.json`, delete the line:

```json
    "dev:web": "vite --config vite.web.config.ts",
```

- [ ] **Step 3: Delete the renderer dir + its web vite config**

```bash
cd /Users/doruchiulan/Projects/qlan/mainframe/.worktrees/feat-app-tauri-wt
git rm -r packages/desktop/src/renderer
git rm packages/desktop/vite.web.config.ts
```

- [ ] **Step 4: Verify the desktop package still builds its main/preload (typecheck)**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit -p tsconfig.node.json`
Expected: PASS (the node project covers `src/main` + `src/preload`). The web project (`tsconfig.web.json`, ~13 known baseline errors) is the one tied to `src/renderer` — it is now empty; if `tsconfig.web.json` is referenced by a root `tsconfig` `references` array or a CI step, also remove the dangling web-project reference. Grep first:

```bash
grep -rn "tsconfig.web" packages/desktop/tsconfig.json packages/desktop/package.json 2>/dev/null
```

If `tsconfig.web.json` is referenced, delete the reference (and `git rm packages/desktop/tsconfig.web.json` if nothing else needs it). Stage any such file by exact path.

- [ ] **Step 5: Run the desktop test suite (no renderer-dependent test breaks)**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test`
Expected: PASS for `main`/`preload` suites. Pre-existing red (`App.integration.test.tsx`, `design-token-audit.test.ts`) lived under `src/renderer` and are removed with it — confirm they no longer run, rather than now-failing. If a non-renderer test newly fails, STOP and investigate (do not delete more to make it pass).

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/package.json packages/desktop/src/renderer packages/desktop/vite.web.config.ts
git commit -m "chore(desktop): delete legacy renderer (Electron now loads the app-tauri renderer)"
```

(`git rm` already staged the deletions; the explicit `git add` of `package.json` stages the script removal. Stage any `tsconfig.web.json` removal from Step 4 by exact path too.)

---

## Self-Review

### Spec coverage (Phase 5 + 6 + scoping items → task)

| Requirement (design Phase 5/6 + scoping) | Task |
|---|---|
| `updates` namespace + `UpdateStatusSchema` (6 variants) | Task 3 |
| `presence` namespace + `PresenceSchema` | Task 4 |
| `updates`/`presence` in Electron adapter (over `update:*` IPC + presence POST) | Task 4 |
| `updates`/`presence` in Fake adapter | Task 4 |
| DaemonStatus mapping (decision 6) + drop `as` cast + per-mapping tests | Task 2 |
| `AppInfo`/`Region` → `z.infer` | Task 1 |
| open-external allowlist normalization (canonical in types, Rust + TS) | Task 5 |
| Native menu (Rust) + Check for Updates item | Task 9 |
| RSS memory sampling (Rust) | Task 10 |
| Renderer log sink (Rust `tracing-appender`, pino-shaped, 7-day, unbuffered) + `host_log` + adapter forward | Task 7 |
| Presence reporter (Rust native OS-idle, macOS objc2) + `report_activity` | Task 8 |
| `setDevice` real Tauri impl (decision 5) | Task 13 |
| Webview permission policy (deny camera/mic, allow clipboard/notify, null macOS usage descriptions) | Task 12 |
| Updater Rust scaffold (`tauri-plugin-updater` + check/download/install + classifier + 10s/4h) | Task 11 |
| Updater signing key + CI workflow + first release | DEFERRED-TODO (Task 11 Step 7) |
| Daemon bundling scaffold (`externalBin`/`resources` + resolver) | Task 6 |
| Daemon bundling per-platform node + native ABI rebuild pipeline | DEFERRED-TODO (Task 6 Step 6) |
| WKWebView crash signal | DEFERRED-TODO / best-effort (Task 12 Step 3) |
| `dev:desktop` concurrent script | Task 14 |
| Legacy `packages/desktop/src/renderer` deletion (Phase 6, LAST) | Task 15 |

Every Phase-5/6 matrix row and every scoping task-set item maps to a task or an explicit deferred-TODO.

### Placeholder scan

No "TBD"/"implement later"/"add error handling"/"similar to Task N" remain. Every code step shows real TypeScript or real Rust. Deferred infra is an explicit documented-TODO deliverable (a `docs/` note section + `// TODO(plan3-infra)` comments), not a half-built untested thing — the three deferred items (updater signing/CI, bundling pipeline, crash signal) produce only documentation, never compiled-but-untested code.

### Type/name consistency

- `UpdateStatus` (schema `UpdateStatusSchema`, 6 variants) — identical key/shape across contract (Task 3), Tauri adapter, Electron adapter, Fake adapter (Task 4), Rust `updater::UpdateStatus` serde-tagged on `state` with `rename_all="kebab-case"` so `not-available`/`not_available` matches the contract literal `'not-available'` (Task 11). Verified: kebab-case rename produces `not-available`, `Available{version}` → `{state:'available',version}`.
- `PresenceState`/`PresenceSchema` — `'active'|'idle'` everywhere; Rust `Presence::as_str()` returns the same literals (Task 8); the daemon endpoint `/api/device/activity {state}` matches `idle-reporter.ts` exactly.
- `mapDaemonStatus` — one exported name, used by both `status()` and `onStatus()`; the 8 cases cover every Rust-emitted form (`not_started`/`starting`/`started:pid=N`/`running:N`/`ready`/`exited`/`error:…`/unknown). Output is the `DaemonStatus` enum (`initializing|starting|ready|unavailable|stopped`) — matches `DaemonStatusSchema`.
- `host_log` (Rust command) ↔ `bridge.log` invoke arg names: `{ level, module, message, data }` — consistent (Task 7).
- `report_activity`/`updater_check`/`updater_download`/`updater_install`/`host_log` Rust command names ↔ the `bridge.ts` `invoke(...)` calls (Tasks 4, 7, 8, 11) — consistent.
- `pick_daemon_entry` (Task 6) is a new pure helper; `resolve_daemon_entry` gains an `AppHandle` param consistently with the `boot_daemon` restructure.
- `ALLOWED_EXTERNAL_SCHEMES` — same 15-scheme list in TS (`external-schemes.ts`) and Rust (`preview/mod.rs`); both case-insensitive; `mailto`/`tel` handled by the `${s}:` (no-`//`) branch in both.

### Unilateral resolutions / risks surfaced for the orchestrator

1. **Log filename suffix delta.** `tracing-appender::rolling::daily` emits `app-tauri.log.YYYY-MM-DD`, not pino's `app-tauri.YYYY-MM-DD.log`. The JSON shape, level, module, ISO time, pid, and 7-day retention all match; only the suffix order differs. I chose to ship the scaffold with a documented `// TODO(plan3-infra)` delta rather than hand-roll a custom rotation, since the scoping doc's acceptance is a pino-*shaped* daily file, and exact-suffix parity would add a non-trivial custom appender. Flag for the user if byte-exact filename parity is required.
2. **Electron `presence.reportActivity` duplicates the native idle-reporter's POST.** Electron already runs `idle-reporter.ts` natively. I implemented the contract method as a thin renderer-driven POST to the same endpoint so both hosts expose `presence` symmetrically. It is additive and harmless, but the renderer should not call it on Electron in a loop (the native reporter already covers idle). Decision: keep the method (contract completeness); document that the renderer treats it as fire-and-forget.
3. **Presence HTTP client.** I chose to add `ureq` (small, pure-Rust, localhost-only, no TLS) for the Rust presence/`report_activity` POSTs rather than pull `reqwest`. This adds one crate to `Cargo.toml`/`Cargo.lock` (staged together, separate from pnpm-lock). If the team prefers reusing an existing HTTP path, swap before execution.
4. **Menu placement.** I put "Check for Updates…" under the macOS app menu (platform convention) rather than Help; `menu.ts` uses Help because Linux/Windows lack an app menu. Documented in-code. Flag if Help placement is mandated cross-platform.
5. **RSS sampling scope.** Electron samples the *renderer* process RSS; Tauri's webview RSS is not cleanly separable from the host, so Task 10 samples the host-process RSS. Documented as a parity delta. This is the observable "RSS sampling" capability, but not a per-renderer figure.
6. **Task 9 ↔ Task 11 ordering.** The menu's "Check for Updates" handler calls `updater::check_for_update_manual`, which Task 11 defines. The scoping doc says the menu item depends on the updater command existing. I sequenced the contract/TS items first, then placed Task 9 (menu) after Task 11 in dependency terms but listed it earlier numerically for grouping; the task notes call out executing Task 11 before Task 9 Step 3 (or using a temporary stub). Recommend executing Rust Tasks in the order 6, 7, 8, 10, 11, 9, 12, 13 to avoid the stub.
7. **`concurrently` dependency.** Not present anywhere; added to root `package.json` `devDependencies` only, with the lockfile flagged as a deferred install step (shared-worktree rule forbids touching `pnpm-lock.yaml`). The `dev:desktop` script cannot be run end-to-end until that install happens.
8. **`tsconfig.web.json` after renderer deletion (Task 15).** Its project covers `src/renderer`, which is being deleted. The task greps for references and removes the dangling project/reference if found; if `tsconfig.web.json` is wired into a root `references` array, that edit is staged by exact path. Flag if the desktop web tsconfig is load-bearing for anything beyond the deleted renderer.
9. **Rust crate-API verification points.** `tauri-plugin-updater` 2.x callback arities, `objc2-core-graphics` `CGEventSource*` symbol/feature names, and `sysinfo` 0.31 method names are pinned to their documented shapes but must be reconciled at `cargo check` time during execution — each task instructs the implementer to adjust to the resolved crate version. These are the highest-uncertainty steps and may need minor signature edits.
