# Implementation plan — URL tabs in the Run surface (#281), remaining work

**Spec:** [`docs/specs/2026-07-28-todo-281-preview-open-urls.md`](../specs/2026-07-28-todo-281-preview-open-urls.md)
**Supersedes:** [`docs/plans/2026-07-28-todo-281-preview-open-urls-plan.md`](2026-07-28-todo-281-preview-open-urls-plan.md) —
that plan's Groups A–E are **implemented and committed** on this branch. This plan re-scopes to what
is genuinely left: Group F (behavioural UI coverage) plus the verification sweep.
**Branch:** `todo/281-preview-open-urls` · **Worktree:** `.worktrees/todo-281-preview-open-urls`
**Packages:** `@qlan-ro/mainframe-ui` only. Nothing under `packages/core-rs`, `packages/types`, or
`packages/mobile` changes; `packages/app-tauri/src-tauri` is already done and is only *verified* here.

## Goal

Give the Run surface a `url` tab kind that points the webview engine the app already owns at any
`http`/`https` address the user names — no launch configuration, no running process. Two entry points
(the Run tab strip's `+` menu and the empty-state Run picker, plus the chat localhost chip's "Open in
Mainframe" row) funnel through one creation path that dedups by normalized URL within a launch scope;
the tab keeps every preview control except run/stop/restart and the console drawer, persists across a
restart, and on a remote daemon routes a loopback address through the existing per-port quick tunnel
strictly as a consumer. The feature code for all of that is on the branch. What is missing is the
behavioural test layer that proves the composed components behave as the spec's acceptance criteria
require, and the sweep that records typecheck, tests, `cargo`, and the diff's package boundaries.

## Status: what is already on the branch

Audited in the worktree on 2026-07-29 against `origin/main` (`ca7cda36`). Every row below was read,
not inferred.

| Prev. group | Tasks | Landed as | What it produced |
|---|---|---|---|
| `test-pure-red` | 1–6 | `736c6677`, `208df5cf`, `ee9a31a0`, `76288d95`, `be9e800d`, `114b4f56` | Pure/store tests: `normalize-url`, `run-pane-url-tab`, `layout-persist`, `port-tunnels`, `resolve-url-target`, `url-tunnel-ownership` |
| `core` | 7–13, 32, 33 | `22134eaa`, `fc64cfae`, `27e5fad2`, `d4c25ed0`, `a598b031`, `18b03c1e`, `3c4e6026`, `1c8c6476`, `af6c0e62` | `url` kind + dedup, `tabIds*` generalization, persistence, `dnsVerified`, `resolve-url-target.ts`, `layout-placement.ts`, tunnel-ownership registry, `setUrlTabTarget`, changeset |
| `rust` | 14, 15 | `a129e0de` | `capabilities/preview.json` → `["http://*:*", "https://*:*"]` + three `bridge_plugin.rs` tests (pattern span, scheme guard, capability shape) |
| `ui-tab` | 16–21 | `9d5bb5b7`, `67e5586b`, `df82a058`, `06467698`, `b6fd61c2`, `8289641b` | `use-webview-mount.ts` extraction, `PreviewUrlBar` seed/commit rework, `use-url-tab-tunnel.ts`, `UrlTabBodyState`, `UrlTabToolbar`, `UrlTabInstance`, the `RunSurface` arm |
| `ui-entrypoints` | 22–26 | `62d4498c`, `9858d7d0`, `a991b9cf`, `09527a40`, `fe3da1bd` | `open-url-tab` intent + subscriber, `RunUrlEntry`, the `+` menu row, the picker row, the chip's open menu |

**Verification run today, before writing this plan:**

- `pnpm --filter @qlan-ro/mainframe-ui typecheck` — clean.
- `pnpm --filter @qlan-ro/mainframe-ui test` — **561 files, 5253 tests, all passing.**
- `git status` — clean tree; `.changeset/preview-open-urls.md` present.

**Not yet done, and the reason this plan exists:** the previous lane died (agent unreachable) in the
wave that would have run Group F. No test asserts the *composed* behaviour — that `UrlTabInstance`
renders the address bar and omits the process controls, that the Run surface routes the `url` kind,
that the entry points emit one intent, that closing a tab releases exactly the tunnel it owns.
Acceptance criteria AC1–AC5, AC9, AC12–AC13, AC15 are implemented but unproven.

## Constraints (from `CLAUDE.md` and `packages/ui/CLAUDE.md`)

- Max **300 lines/file**, **50 lines/function** — Task 2 and Task 3 exist as separate files for
  exactly this reason; do not merge them.
- Tests live beside their subject in `__tests__/`. `.test.tsx` runs under jsdom, `.test.ts` under
  node (`vitest.config.ts` projects). A DOM-touching `.test.ts` needs a `// @vitest-environment jsdom`
  pragma — none of the tasks below should need one.
- Run single files (`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`); large multi-suite
  runs hit the known cross-file `React.act` failure.
- `data-testid` on every interactive element, keyed by tab id, never by array index.
- No `@ts-ignore`; no silent catches; delete dead code found in a file you edit.
- The changeset already exists — **do not add a second one.**

## Verified facts the tests must be written against

Read in the worktree on 2026-07-29. Do not re-derive; do not guess an API.

1. **`UrlTabBodyState`** (`features/url-tab/UrlTabBodyState.tsx`) takes
   `{ target, device, inspectActive, anchorRef, onRetry }` and renders exactly one of:
   `url-tab-body-loaded` (for `direct` **and** `tunnelled`), `url-tab-body-pending`,
   `url-tab-body-rejected`, `url-tab-body-failed`, `url-tab-body-stopped`, `url-tab-body-invalid`.
   `url-tab-retry` appears only in `failed` and `stopped`. `url-tab-inspect-active-indicator` appears
   only when `inspectActive` and the body is loaded.
2. **`UrlTabTarget`** (`features/url-tab/resolve-url-target.ts`) is a 7-member union:
   `direct{url}`, `tunnelled{url}`, `pending{port}`, `rejected{port,reason}`, `failed{error}`,
   `stopped{port}`, `invalid{url}`. `URL_TAB_TUNNEL_TIMEOUT_MS = 120_000`.
3. **`UrlTabInstance`** props: `{ tabId, url, visible, scopeKey?, projectId? }`; root testid
   `url-tab-instance-<tabId>`. It commits an address-bar edit through
   `useLayoutStore.getState().setUrlTabTarget(tabId, next, urlTabTitle(next))`.
4. **`UrlTabToolbar`** renders `PreviewUrlBar` with `enabled` hardcoded true (`preview-url-input` is
   never `disabled`), `PreviewDeviceToggle`, and `PreviewCaptureCluster` with
   `isRunning={handle !== null}`. Testids reachable from it: `preview-url-input`,
   `preview-url-reload`, `preview-url-open-browser`, `preview-url-clear-cache`,
   `preview-capture-cluster`, `preview-toolbar-inspect`, `preview-toolbar-capture`,
   `preview-toolbar-region`, `preview-device-toggle`, `preview-device-desktop`,
   `preview-device-mobile`, `preview-capture-cluster`, `url-tab-toolbar`. **Absent by
   construction:** `preview-toolbar` and the `PreviewRunControl` pair `preview-run-start` /
   `preview-run-stop`. Note `preview-url-reload` renders but is `disabled` while no handle is
   mounted — assert presence, not enabled state.
5. **The mount seam** is `useHost().preview.mount(el, url, { projectId, device })` inside
   `features/preview/use-webview-mount.ts`. Mock `@/lib/host` and return a handle stub; set
   `compositesAboveDom: false` on the stub so `usePreviewOcclusion` stays inert in jsdom.
   `useWebviewMount` destroys the handle on unmount and on `url === null`.
6. **`useUrlTabTunnel`** reads: `useDaemonIsLocal()` (`@/lib/daemon/use-daemon-is-local`),
   `useDaemonPort()` (`@/features/sessions/runtime/daemon-port-context`) for the HTTP port,
   `useTunnelDaemonPort()` (from `@/store/port-tunnels`, backed by `usePortTunnelsStore.daemonPort`),
   `useActiveIdentity().chatId`, `usePortTunnelsStore.byPort[port]`. It calls
   `startPortTunnel(httpPort, { port, chatId })` from `@/lib/api/tunnel-ports` and
   `registerUrlTunnelConsumer(tabId, { port, started, daemonHttpPort })` from
   `@/features/url-tab/tunnel-consumers`.
7. **Ownership**: `started: true` only when no entry existed for that port at the moment this tab's
   start fired; a Retry never demotes an owner (`addConsumer` in `url-tunnel-ownership.ts`).
   `releaseUrlTunnelConsumers` calls `stopPortTunnel(daemonHttpPort, port)` only for a removed
   **owner** whose port has no remaining consumer.
8. **`clearPortTunnelEntry(port)`** (in `@/store/port-tunnels`) refuses to clear a `ready` entry and
   returns whether it cleared. `retry()` calls it, then bumps the attempt counter.
9. **`composeTunnelUrl`** puts the original path/query/hash on the tunnel origin, so a tab on
   `http://localhost:5173/app?x=1` with tunnel origin `https://abc.trycloudflare.com` mounts
   `https://abc.trycloudflare.com/app?x=1`.
10. **`RunSurface`**'s fallback for an unhandled kind renders `` `${tab.kind}: ${tab.title}` `` as
    plain text (`layout/surfaces/RunSurface.tsx:159`). `RunSurface.tab-scope.test.tsx` is the model
    for scope filtering and for the stub-every-body-component mock set.
11. **`RunUrlEntry`** (`layout/RunUrlEntry.tsx`) emits `emitSurfaceIntent({ type: 'open-url-tab', url,
    paneId })` with the **normalized** URL, sets an invalid state (`aria-invalid`, `text-destructive
    ring-1 ring-destructive`) without emitting when `normalizePreviewUrl` returns null, and calls
    `onDone` on commit, Escape, and blur. Testids `run-tab-url-entry`, `run-tab-url-entry-input`.
12. **The chip menu** (`features/chat/smart-actions/UrlChip.tsx`): trigger `smart-action-url-open`,
    rows `smart-action-url-open-in-app` (first, "Open in Mainframe") and
    `smart-action-url-open-browser` (second). The in-app row emits the intent and must not start a
    tunnel. `url-chip.test.tsx` already drives the browser row through the menu and explicitly defers
    row-order coverage to a separate file — that file is Task 5.
13. **The subscriber** (`store/url-tab-intent-subscriber.ts`) normalizes again, reads `scopeKey` from
    `useActiveBasesStore`, and calls `useLayoutStore.getState().addRunTab({ id: urlTabId(url), kind:
    'url', title: urlTabTitle(url), url, scopeKey }, paneId)`. `addRunTab` internally runs
    `placeInLayout(layout, 'run')`, so no `toggleSurface` is needed for AC4's "reveals Run".
14. **Release sites** in `store/layout.ts`: `closeRunTab` (single tab), `closePane`, `releaseRunScope`,
    and `toggleSurface('run')` when Run was lit — each calls `releaseUrlTunnels(...)` from
    `store/url-tunnel-cleanup.ts`. `disposeDaemonSession` calls `clearUrlTunnelConsumers()`, which
    deliberately stops nothing.
15. **The registry is module-level state.** Any test touching it must call
    `clearUrlTunnelConsumers()` in `beforeEach`, or ownership leaks between cases.
16. **jsdom setup** (`src/__tests__/setup.ts`) already stubs `ResizeObserver`, `localStorage`, and
    Range rects; both vitest projects load it.

## Scope guard for parallel groups

The two test groups are file-disjoint and may run at the same time. If a test exposes a real defect
in the landed code, fix it **inside your group's lane** and say so in the commit body:

- `test-url-tab-view` may repair files under `packages/ui/src/features/url-tab/`.
- `test-run-surface-entry` may repair files under `packages/ui/src/layout/`,
  `packages/ui/src/store/`, and `packages/ui/src/features/chat/smart-actions/`.
- A defect outside your lane (notably `features/preview/*`) is **reported, not edited** — `verify`
  owns cross-lane repairs so the two groups never collide on a file.

Never weaken an assertion to make a test pass. A test that contradicts the spec is a finding.

---

## Group A — `test-url-tab-view`

### Task 1 — `UrlTabBodyState` renders one explicit state per target

**File (new):** `packages/ui/src/features/url-tab/__tests__/UrlTabBodyState.test.tsx`

Pure render tests; no store, no host. Build `anchorRef` with `createRef<HTMLDivElement>()`.

- `direct` and `tunnelled` → `url-tab-body-loaded`; assert once for `device="desktop"` and once for
  `device="mobile"` (both must render the anchor div).
- `inspectActive` true on a loaded body → `url-tab-inspect-active-indicator` present; false → absent.
- `pending{port: 5173}` → `url-tab-body-pending`, text contains `5173`, **no** `url-tab-retry`.
- `rejected{port: 22, reason: 'Port must be 1024 or higher'}` → `url-tab-body-rejected` showing the
  reason **verbatim**, no `url-tab-retry` (AC10: a rejection is not a retryable failure).
- `failed{error: 'cloudflared exited with code 1'}` → `url-tab-body-failed` showing that text, plus
  `url-tab-retry`; clicking it calls `onRetry` exactly once (AC9).
- `stopped{port: 5173}` → `url-tab-body-stopped` naming the port, plus a working `url-tab-retry`.
- `invalid{url: ''}` → `url-tab-body-invalid` with no mono URL line; `invalid{url: 'not a url'}` →
  the same body **with** that text rendered; neither shows Retry.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/url-tab/__tests__/UrlTabBodyState.test.tsx`

### Task 2 — `UrlTabInstance`: toolbar composition and the live address bar

**File (new):** `packages/ui/src/features/url-tab/__tests__/UrlTabInstance.test.tsx`

Mocks (fact 5, 6): `@/lib/host` (mount spy returning a handle stub with `compositesAboveDom: false`
and `navigate` resolving), `@/features/sessions/use-active-identity` →
`{ projectId: 'proj-A', chatId: 'chat-1' }`, `@/features/sessions/runtime/daemon-port-context` →
`useDaemonPort: () => 31415`, `@/lib/daemon/use-daemon-is-local` → a mutable local flag,
`@/lib/api/tunnel-ports` → `startPortTunnel`/`stopPortTunnel` spies. Use the **real**
`usePortTunnelsStore` and the **real** `useLayoutStore`, seeded via `setState`.

- **Local daemon, `http://localhost:5173/`** → `host.preview.mount` called once with that URL and
  `{ projectId: 'proj-A', device: 'desktop' }`; root `url-tab-instance-<tabId>` present;
  `url-tab-body-loaded` present (AC1).
- **Control inventory** (AC5): `preview-url-input`, `preview-url-reload`, `preview-url-open-browser`,
  `preview-url-clear-cache`, `preview-toolbar-inspect`, `preview-toolbar-capture`,
  `preview-toolbar-region` are all in the DOM under `url-tab-toolbar`; assert `queryByTestId` is
  null for `preview-run-start`, `preview-run-stop`, and `preview-toolbar` (the preview tab's own
  toolbar — a URL tab must render `UrlTabToolbar`, never `PreviewToolbar`, which is where the
  process controls live). The console is a separate `console` tab kind, not a drawer, so there is
  nothing further to assert absent inside this component.
- **The bar stays live with nothing mounted** (spec §6, D9): seed `useLayoutStore` with a run holding
  this `url` tab, set the daemon remote and the port entry to `{ state: 'error', error: 'boom' }` so
  the target resolves `failed`; assert `preview-url-input` is **not** `disabled`, then type
  `localhost:5173` and press Enter and assert `useLayoutStore.getState()`'s tab now carries
  `url: 'http://localhost:5173/'` and the matching title — and that `host.preview.mount` was never
  called in this case.
- **Invalid tab** (`url: ''`) → `url-tab-body-invalid`, `mount` never called, input still enabled
  (AC6's "invalid input never mounts a webview", in its persisted-tab form).
- **Device toggle** flips the mount option: switching to mobile re-renders with the mobile frame and
  does not call `mount` a second time (the handle is reanchored, not recreated).
- **Unmount destroys**: unmount the tree and assert the handle stub's `destroy` was called (AC12's
  "closing a URL tab destroys its webview", at the component seam).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/url-tab/__tests__/UrlTabInstance.test.tsx`

### Task 3 — `UrlTabInstance`: tunnel adoption, ownership, retry, DNS reload

**File (new):** `packages/ui/src/features/url-tab/__tests__/UrlTabInstance.tunnel.test.tsx`

Same mock set as Task 2, plus a spy on `registerUrlTunnelConsumer`
(`vi.mock('@/features/url-tab/tunnel-consumers')`). Daemon remote for every case
(`useDaemonIsLocal → false`), `usePortTunnelsStore.setState({ daemonPort: 31415 })`, tab URL
`http://localhost:5173/app?x=1`.

- **Fresh start owns the tunnel** (D10, AC12): no entry for 5173 at mount → body is
  `url-tab-body-pending`, `startPortTunnel` called once with `(31415, { port: 5173, chatId: 'chat-1' })`,
  and `registerUrlTunnelConsumer` called with `started: true`.
- **Adopting mid-start does not own it**: seed `{ 5173: { state: 'starting' } }` before mount → the
  tab still issues its start (the daemon is the single-flight point) but registers `started: false`.
- **A ready tunnel skips pending and carries the path** (D12, AC8): seed
  `{ 5173: { state: 'ready', url: 'https://abc.trycloudflare.com', dnsVerified: true } }` → no
  pending body, `mount` called with `https://abc.trycloudflare.com/app?x=1`.
- **DNS reload fires exactly once** (D11): same seed but `dnsVerified: false`; after mount, flip the
  entry to `dnsVerified: true` and assert the handle's `navigate` was called once with the same
  composed URL; flipping other fields afterwards adds no further `navigate`.
- **Port rejection short-circuits** (AC10): tab URL `http://localhost:22/` → `url-tab-body-rejected`
  reading `Port must be 1024 or higher`, and `startPortTunnel` **never called**. Repeat for the
  daemon's own port (`31415`) expecting `Cannot tunnel the daemon's own port`.
- **Retry re-requests** (PD1, AC9): entry `{ state: 'error', error: 'boom' }` → `url-tab-body-failed`;
  click `url-tab-retry` → the entry is gone from `usePortTunnelsStore` and exactly one further
  `startPortTunnel` call was made.
- **A ready entry survives Retry** (PD2): with `{ state: 'ready', url, dnsVerified: true }` the body
  is loaded and there is no Retry to click — assert `url-tab-retry` is absent, guarding the rule that
  a live tunnel is never cleared.

Keep the file under 300 lines; factor the seed/mount boilerplate into local helpers.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/url-tab/__tests__/UrlTabInstance.tunnel.test.tsx`

---

## Group B — `test-run-surface-entry`

### Task 4 — The Run surface renders the kind and scopes it

**File (new):** `packages/ui/src/layout/__tests__/RunSurface.url-tab.test.tsx`

Copy the mock set from `RunSurface.tab-scope.test.tsx` (fact 10) and add a stub for
`@/features/url-tab/UrlTabInstance` that captures props.

- A `url` tab renders the stub and **never** the `` `${kind}: ${title}` `` placeholder (AC3).
- The stub receives `tabId`, `url`, `visible`, `scopeKey`, `projectId` threaded from the tab and the
  active identity.
- A `code` tab still renders the placeholder — proving the assertion above is not vacuous.
- A `url` tab stamped with a non-matching `scopeKey` renders nothing, and one stamped with the active
  scope renders (AC13).
- After `releaseRunScope(activeScope)` the tab is gone from the DOM (AC13's release half).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/layout/__tests__/RunSurface.url-tab.test.tsx`

### Task 5 — Both entry points emit one intent

**Files (new):** `packages/ui/src/layout/__tests__/RunUrlEntry.test.tsx`,
`packages/ui/src/features/chat/smart-actions/__tests__/url-chip-menu.test.tsx`

`RunUrlEntry` (fact 11) — mock `@/store/surface-intents`:

- Typing `localhost:5173` + Enter emits exactly one `{ type: 'open-url-tab', url:
  'http://localhost:5173/', paneId }` and calls `onDone`.
- Each of `''`, `'   '`, `'not a url'`, `'file:///etc/passwd'`, `'javascript:alert(1)'` emits
  **nothing**, leaves the field mounted, and sets `aria-invalid` (AC6, and D2's http/https-only rule
  at the entry point).
- Typing after an invalid attempt clears the invalid state.
- Escape emits nothing and calls `onDone`.
- Omitting `paneId` (the empty-state picker case) emits the intent with `paneId: undefined`.

`url-chip-menu` (fact 12) — reuse `url-chip.test.tsx`'s mock scaffolding, do not duplicate its
tunnelling assertions:

- Opening `smart-action-url-open` lists **Open in Mainframe above Open in browser** — assert DOM
  order, not just presence (AC4, D7).
- Selecting the in-app row emits one `open-url-tab` intent with the chip's `href` and calls
  neither `startPortTunnel` nor the OS opener.
- Selecting the browser row still calls the pre-existing opener.

**Verify:** run both files individually with `vitest run`.

### Task 6 — Creation path, dedup, and tunnel release through the stores

**File (new):** `packages/ui/src/store/__tests__/url-tab-intent-subscriber.test.ts` (node env)

Real `useLayoutStore`, `useActiveBasesStore`, `usePortTunnelsStore`, and the real
`tunnel-consumers` registry; mock only `@/lib/api/tunnel-ports`. Call
`clearUrlTunnelConsumers()` and reset the layout store in `beforeEach` (fact 15).

- `subscribeToUrlTabIntents()` + one `open-url-tab` emit creates one `url` tab whose id matches
  `/^url-[A-Za-z0-9_-]+$/` (AC16 — the id is the webview label) and whose `url` is normalized.
- Emitting the same URL twice yields **one** tab, active both times (AC4's "focuses rather than
  stacks"); a different scope yields a second tab (AC13).
- Emitting while Run is not in the layout leaves `run` placed in `layout` afterwards (AC4's reveal,
  fact 13).
- Emitting an unnormalizable URL creates no tab.
- The returned unsubscribe stops further intents from creating tabs.
- **Release** (AC12, D10), driving `useLayoutStore` with consumers registered by hand via
  `registerUrlTunnelConsumer`:
  - closing a tab registered `started: true`, sole consumer of 5173 → `stopPortTunnel` called once
    with `(31415, 5173)`;
  - closing one of two tabs on 5173 → `stopPortTunnel` **not** called;
  - closing a tab registered `started: false` (adopted the chip's tunnel) → not called;
  - `releaseRunScope(scope)` holding an exclusively-started tunnel → called once;
  - `closePane` and `toggleSurface('run')` (Run lit) each release the pane's/run's URL tabs — one
    case per site, so a future edit that drops a call site fails here (fact 14).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/store/__tests__/url-tab-intent-subscriber.test.ts`

---

## Group C — `verify`

### Task 7 — Full verification sweep

Runs after both test groups; it verifies their output and the already-landed Rust arm. Record each
result in the group's commit body or the lane result — a sweep whose output nobody wrote down did not
happen.

1. `pnpm --filter @qlan-ro/mainframe-ui typecheck` — must be clean.
2. `pnpm --filter @qlan-ro/mainframe-ui test` — full suite. If the known cross-file `React.act`
   batch failure appears, re-run the affected files individually and note it; do not "fix" it here.
3. `cd packages/app-tauri/src-tauri && cargo test --lib preview::bridge_plugin` — the three tests
   added by `a129e0de` (pattern span, scheme guard, capability shape) must pass. The worktree's
   `target/` is already warm (~2.3 GB); do **not** set `CARGO_TARGET_DIR`. If the `tauri::utils::acl::RemoteUrlPattern`
   re-export fails to resolve in this toolchain, add `urlpattern = "0.3"` + `regex = "1"` as
   **dev-dependencies only** (both already in `Cargo.lock`) and reproduce the assertion — do not
   delete the test.
4. `git diff --name-only origin/main...HEAD` must show **no** path under `packages/core-rs/`,
   `packages/types/`, or `packages/mobile` (spec: no daemon change), and exactly one `.changeset/`
   file (`preview-open-urls.md`).
5. Testid audit: every interactive element added by this feature carries a `data-testid` —
   `run-pane-open-url-<paneId>`, `run-picker-open-url`, `run-tab-url-entry`,
   `run-tab-url-entry-input`, `url-tab-toolbar`, `url-tab-retry`, `url-tab-instance-<tabId>`,
   `url-tab-body-*`, `smart-action-url-open-in-app`, `smart-action-url-open-browser`. Confirm none is
   keyed by array index. Note in the sweep that a URL tab's strip pill uses the shared
   `run-tab-<id>` testid, which resolves to `run-tab-url-<host>-<uuid>` because `urlTabId` prefixes
   the id with `url-` — this satisfies the spec's `run-tab-url-<tabId>` without a special case.
6. Size audit: `git diff --name-only origin/main...HEAD -- '*.ts' '*.tsx' | xargs wc -l | sort -n` —
   no file over 300 lines; spot-check that no function added by this work exceeds 50.

**Exit:** all six recorded, everything green.

---

## Execution groups

| Group | Tasks | Kind | parallel_safe | depends_on |
|---|---|---|---|---|
| `test-url-tab-view` | 1–3 | test | yes | — |
| `test-run-surface-entry` | 4–6 | test | yes | — |
| `verify` | 7 | test | yes | `test-url-tab-view`, `test-run-surface-entry` |

Both test groups write only new files, in disjoint directories, against implementation that is
already at HEAD — so neither is a red-phase group and neither depends on the other. `verify` depends
on both because it runs the suite they extend and audits the whole diff.

## Manual verification (not automatable)

The Tauri automation bridge stops answering once a child webview exists, so mounted-webview behaviour
is checked by hand. Run `pnpm tauri:dev` from `packages/app-tauri` with an isolated
`MAINFRAME_DATA_DIR` **and** `DAEMON_PORT` — never the defaults; a stray launch hijacks the real
`~/.mainframe` and port 31415.

1. With no launch config, `+` → **URL…** → `localhost:5173` renders the dev server (AC1).
2. Inspect and region capture deliver to chat from `http://localhost:5173/` **and** from a public
   `https://` site (AC11) — the two origins the old allowlist excluded.
3. On a remote daemon: a loopback URL on port 22 shows "Port must be 1024 or higher" with no request
   in the daemon log (AC10); an eligible port shows pending, then loads the tunnel origin **with the
   original path and query** (AC7); a second tab on that port loads with no pending (AC8).
4. Quit and relaunch: the tab returns with its title, loads on activation, and the address bar seeds
   with the typed URL — never a tunnel URL (AC14).
5. In a tab left in the failure state, type a different URL and press Enter: it loads, the title
   follows, and the new URL survives a relaunch (spec §6, D9).

## Risks

- **The widened `remote.urls` is the one hard-to-reverse change and it is already committed.** Any
  `http`/`https` page a user opens can call the four bridge commands, including fabricating an
  inspect payload that reaches the agent's context. The spec accepted this at the design gate (D1)
  and `capabilities/preview.json`'s description records it in-tree. Task 7 only confirms the tests
  still hold; re-litigating the decision is out of scope here.
- **`registerUrlTunnelConsumer` is module-level state.** A test that forgets `clearUrlTunnelConsumers()`
  passes alone and fails in a batch, or worse, the reverse. Fact 15 is not optional.
- **Retry clears a shared port entry** (PD2), so one tab's Retry drops the badge every `UrlChip` on
  that port shows. It refuses `ready` entries, so only a stale `error` or an abandoned `starting`
  is ever removed and the next `tunnel:status` event restores the truth. Task 3's last case pins the
  refusal.
- **A test that fails against landed code is a finding, not a nuisance.** Follow the scope guard:
  repair in your lane, report anything outside it.
