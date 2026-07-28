# Implementation plan — URL tabs in the Run surface (#281)

**Spec:** [`docs/specs/2026-07-28-todo-281-preview-open-urls.md`](../specs/2026-07-28-todo-281-preview-open-urls.md)
**Branch:** `todo/281-preview-open-urls`
**Packages:** `@qlan-ro/mainframe-ui` (all TypeScript work), `@qlan-ro/mainframe-app-tauri` (capability + Rust test only).
**No change to `packages/core-rs`, `packages/types`, or `packages/mobile`.**

## Goal

Give the Run surface a new tab kind — `url` — that points the webview engine the app already
owns at any `http`/`https` address the user names, with no launch configuration and no running
process behind it. The tab is created from two entry points that funnel through one path (the Run
tab strip's `+` menu / the empty-state Run picker, and the chat localhost chip's new "Open in
Mainframe" row), keeps every preview control except run/stop/restart and the console drawer, and
survives a restart. On a remote daemon a loopback URL is routed through the existing per-port quick
tunnel strictly as a consumer: the tab checks port eligibility locally, adopts a ready tunnel with
no wait, waits for the DNS check only when it watched the tunnel come up, carries the original
path/query/fragment onto the tunnel origin, and stops a tunnel on close only when it started it and
no other URL tab still needs the port. The preview bridge's remote-origin allowlist widens to
`http://*:*` / `https://*:*` so inspect, region capture, and navigation tracking work on every
origin — which also repairs the launch-config preview tabs, where those controls are silently dead
today on any non-localhost URL.

## Constraints carried from CLAUDE.md

- Max **300 lines/file**, **50 lines/function**. Several tasks below exist purely to keep files
  under the cap — do not merge them.
- `data-testid` on every interactive element, `<surface>-<element>` kebab-case, keyed by domain id
  (tab id), never by array index.
- Single canonical type: the `url` tab kind stays renderer layout state (`packages/ui/src/store/run-pane.ts`).
  The spec **declines** promoting it to `@qlan-ro/mainframe-types` and declines any Rust type.
- Pure logic outside React and unit-tested; no `@ts-ignore`; no silent catches (`console.warn` with a
  tag is the desktop convention in this package).
- **Changeset required** before committing (Task 13).
- No leftovers: dead code found while editing a file is removed in the same pass (Task 16 removes
  `processStopped`).

## Verified facts this plan is built on

Each was read in the worktree; do not re-derive them.

1. `RunTabKind` is `'preview' | 'console' | 'terminal' | 'code' | 'diff' | 'skill' | 'viewer'`
   (`packages/ui/src/store/run-pane.ts:11`). `addRunTab` already dedups launch tabs **across every
   pane** before the `paneId` lookup, so URL dedup extends the same block.
2. `useLayoutStore.addRunTab` calls `placeInLayout(layout, 'run')` (`packages/ui/src/store/layout.ts:264`),
   so adding a tab reveals the Run surface — AC4's "reveals the Run surface if it was hidden" needs
   no extra `toggleSurface`.
3. The webview label is generated inside the host adapter as `preview-${++tabSeq}`
   (`packages/ui/src/lib/host/tauri-preview.ts:32`) and never contains the URL. AC16 therefore
   constrains only the **Run tab id** we mint.
4. `usePreviewLifecycle` gates mounting on `status === 'running' && port !== null`
   (`packages/ui/src/features/preview/use-preview-lifecycle.ts:75`). A URL tab has neither, so the
   mount/navigate/reanchor/destroy logic must be extracted rather than duplicated.
5. `usePreviewLifecycle` returns `processStopped`, which **no caller reads** (only its own file
   mentions it). It is dead code.
6. Launch-preview tunnels (`useSandboxStore.tunnelUrls`, keyed by `(scopeKey, config)`) are a
   *different* mechanism from the per-port quick tunnels (`store/port-tunnels.ts`, keyed by port).
   URL tabs use only the latter. Do not touch `resolve-preview-url.ts` or `use-tunnel-fallback.ts`.
7. Daemon rejection strings, verbatim, from
   `packages/core-rs/crates/mainframe-server/src/routes/tunnel_ports.rs`:
   `"Port must be 1024 or higher"` and `"Cannot tunnel the daemon's own port"` (`MIN_PORT: u16 = 1024`).
   `packages/types/src/smart-actions/port-tunnels.ts` already exports the matching pure predicate
   `isTunnelEligiblePort(port, daemonPort)` and `classifyLocalhostUrl(href)`.
8. `GET /api/tunnel/ports` reports `state: "ready"` only for a registry `Entry::Ready`, which is
   reached after `TunnelManager::start` resolves — i.e. after the DNS check. This is the premise of
   spec decision D11 and of the "adopting never waits" rule.
9. `store/port-tunnels.ts` currently collapses the `ready` and `dns_verified` WS events into one
   `{ state: 'ready' }` entry, so the DNS signal is presently unobservable to the renderer.
10. `tauri::utils::acl::RemoteUrlPattern` is public and ungated (`tauri-utils-2.9.2/src/acl/mod.rs:277`),
    `tauri` re-exports it as `tauri::utils`, and `url = "2"` is already a direct dependency of
    `packages/app-tauri/src-tauri`. **AC11's Rust test needs no new dependency** — this supersedes an
    earlier assumption that `urlpattern` had to be added as a dev-dependency.
11. `usePreviewOcclusion` scans all `[data-radix-popper-content-wrapper]`, `[role=dialog|menu|listbox]`,
    and `[data-preview-overlay]` nodes against the anchor rect, so any overlay built from the existing
    Radix primitives is covered with no new wiring.
12. Existing call sites of the `terminalIds*` helpers: `store/layout.ts` (×3),
    `lib/daemon/dispose-daemon-session.ts` (×1), plus three test files.
13. `store/layout.ts` is **317 lines today** — already over the 300-line cap before this work adds a
    line to it. Task 32 decomposes it first; every later task that edits it lands on the smaller file.
14. The daemon's `PortTunnelRegistry::start` is **single-flight and idempotent per port**
    (`plan_start`, `packages/core-rs/crates/mainframe-launch/src/port_tunnel_registry.rs`): a second
    POST while an entry is `Starting` joins the in-flight start (`StartAction::Wait`), and one on a
    live `Ready` entry returns the existing URL (`StartAction::Existing`) **without spawning anything
    and without broadcasting a `tunnel:status` event**. Two consequences the plan relies on: a client
    guard against issuing a second start is not what prevents a duplicate tunnel, and a client that
    waits only for WS events can wait forever for a tunnel the daemon already holds. The start POST's
    own `{ url }` response (`lib/api/tunnel-ports.ts` `startPortTunnel`) is therefore a first-class
    URL source, not just a signal.
15. `classifyLocalhostUrl('')` returns `null` (`new URL('')` throws), and `isTunnelEligiblePort` is
    never reached for it — so an empty or unparseable stored URL cannot be expressed by any
    tunnel-shaped target. Task 11 gives it its own `invalid` variant instead.
16. `store/port-tunnels.ts`'s `clearEntry(port)` is module-private, and `UrlChip`'s `badgeFor(undefined, false)`
    renders **no badge** while `canStop` is `false` — so removing a non-`ready` entry returns every chip
    on that port to its pre-tunnel appearance rather than to a wrong one.

## New and changed files

**New (all under `packages/ui/src/`):**

| File | Purpose |
|---|---|
| `features/url-tab/url-tab-id.ts` | `urlTabId(url)`, `urlTabTitle(url)` — pure |
| `features/url-tab/resolve-url-target.ts` | `resolveUrlTabTarget()`, `composeTunnelUrl()`, `portRejectionReason()` — pure |
| `features/url-tab/url-tunnel-ownership.ts` | pure consumer registry reducers |
| `features/url-tab/tunnel-consumers.ts` | stateful wrapper over the pure registry + `stopPortTunnel` |
| `features/url-tab/use-url-tab-tunnel.ts` | the React hook (start request, watchdog, DNS reload) |
| `features/url-tab/UrlTabInstance.tsx` | the tab body |
| `features/url-tab/UrlTabToolbar.tsx` | toolbar without process controls |
| `features/url-tab/UrlTabBodyState.tsx` | pending / rejected / failed / stopped / loaded bodies |
| `features/preview/use-webview-mount.ts` | extracted mount lifecycle |
| `layout/RunUrlEntry.tsx` | the inline URL entry, shared by the strip and the picker |
| `store/url-tunnel-cleanup.ts` | layout-facing release helper (mirrors `terminal-cleanup.ts`) |
| `store/url-tab-intent-subscriber.ts` | the `open-url-tab` intent boundary |
| `store/layout-placement.ts` | the layout types + pure placement helpers lifted out of `layout.ts` (Task 32) |

**Changed:** `store/run-pane.ts`, `store/layout.ts`, `store/layout-persist.ts`, `store/port-tunnels.ts`,
`store/surface-intents.ts`, `lib/daemon/dispose-daemon-session.ts`,
`features/preview/{normalize-url,use-preview-lifecycle,use-preview-address,PreviewUrlBar,PreviewToolbar,PreviewInstance}.*`,
`layout/{RunTabStrip,SurfacePicker,RunTabPill,SurfaceHost}.tsx`, `layout/surfaces/RunSurface.tsx`,
`features/chat/smart-actions/UrlChip.tsx`,
`packages/app-tauri/src-tauri/capabilities/preview.json`,
`packages/app-tauri/src-tauri/src/preview/bridge_plugin.rs`.

## Execution groups

The names below are the ones the lane schedules. `parallel_safe` is a file-collision flag only;
`depends_on` names the groups whose output this one reads or verifies.

| Group | Tasks | Kind | parallel_safe | depends_on |
|---|---|---|---|---|
| `test-pure-red` | 1–6 | test | yes | — |
| `core` | 7–13, 32, 33 | core | yes | `test-pure-red` |
| `rust` | 14, 15 | core | yes | — |
| `ui-tab` | 16–21 | ui | yes | `core` |
| `ui-entrypoints` | 22–26 | ui | yes | `core` |
| `test-ui` | 27–31 | test | yes | `core`, `rust`, `ui-tab`, `ui-entrypoints` |

`test-ui` depends on `rust` because Task 31's sweep runs `cargo check` and asserts the diff's package
boundaries — it verifies the widened capability, so running it before Task 14/15 would record a green
sweep that never saw them.

## Plan-level decisions

- **PD1. Retry re-drives the start POST and resets every per-attempt flag, keyed on an attempt nonce.**
  The daemon is the single-flight point (fact 14), so the earlier `entry === undefined` guard bought no
  safety and made Retry inert in three of its four reachable states. Task 18 owns the trace.
- **PD2. Retry may clear a non-`ready` port-tunnel entry; a `ready` entry is never cleared.** A shared
  `error` or `starting` entry is a stale local marker, and dropping it returns the chat chip to its
  pre-tunnel appearance (fact 16). Dropping a `ready` entry would take a live tunnel's URL away from
  the chip, which `reportPortTunnelError` already refuses to do.
- **PD3. Committing a URL in a URL tab's address bar rewrites the tab's `url` through the layout store
  (Task 33), keeping the tab id.** The id is the webview label's source and the tunnel-consumer key;
  minting a new one would remount the webview and orphan the registration. The typed URL is the tab's
  identity for dedup, persistence, and re-resolution (D9, AC14).
- **PD4. The address bar reflects in-page navigation but only Enter changes the tab's identity.** A
  tunnelled tab therefore displays the tunnel origin once loaded — honest browser behaviour — while
  what persists and re-seeds is always `tab.url`, never a tunnel URL (AC14, and the spec's deferred
  "preserving in-page navigation across a restart").
- **PD5. AC17's 300-line cap is honoured on `store/layout.ts` by decomposing it (Task 32), not by
  scoping the rule to new files.** It is 317 lines today (fact 13) and this work adds to it.

---

## Group A — `test-pure-red` (red phase; must be observed failing)

These tests are written **before** the code in Group B and must fail when written. Tests importing
a module that does not exist yet fail at collection — that is the intended red. Run each file with
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>` (never the whole suite; batches hit the
cross-file `React.act` failure).

### Task 1 — Normalizer rejects non-http(s) (D2, AC6)

**File:** `packages/ui/src/features/preview/__tests__/normalize-url.test.ts` (extend).

Add cases asserting `normalizePreviewUrl` returns `null` for: `''`, `'   '`, `'not a url'`,
`'file:///etc/passwd'`, `'javascript://x'`, `'ssh://host'`, `'data:text/html,x'`. Keep the existing
passing cases (`'localhost:3000'` → `'http://localhost:3000/'`, scheme preserved for
`https://example.com`). Add `'HTTP://Example.com'` → normalized `http://example.com/` (scheme test is
case-insensitive).

**Verify:** the new cases fail (today the function returns a URL string for `file://` and `ssh://`);
the pre-existing cases still pass.

### Task 2 — URL tab model, dedup, and tab-id conformance (AC13, AC16, edge cases)

**Files (new):** `packages/ui/src/store/__tests__/run-pane-url-tab.test.ts`,
`packages/ui/src/features/url-tab/__tests__/url-tab-id.test.ts`.

`run-pane-url-tab.test.ts` asserts against `addRunTab` / `releaseRunScope` / the new
`tabIdsForScope`:
- adding a `{ kind: 'url', url: 'http://localhost:5173/' }` tab appends and focuses it;
- adding the same normalized URL **in the same scope** returns a state with the same tab count and
  the existing tab active (no duplicate), including when the existing tab lives in a **different
  pane** than the `paneId` argument;
- the same URL with a **different `scopeKey`** creates a second tab;
- two URL tabs on the same port with different paths are two tabs;
- `releaseRunScope` removes URL tabs of that scope and leaves the others;
- `tabIdsInRun(run, 'url')` / `tabIdsInPane(run, paneId, 'url')` / `tabIdsForScope(run, scope, 'url')`
  return only URL tab ids, and the same functions with `'terminal'` return the terminal ids.

Same file, against the new `retargetUrlTab(run, tabId, url, title)` reducer (Task 8 item 5):
- retargeting a URL tab to a new URL updates that tab's `url` and `title` **in place** and keeps its
  `id` (PD3);
- retargeting to the URL it already holds returns the same `RunState` reference;
- when another URL tab **in the same scope** already holds the target URL, the source tab is left
  untouched and the holder is activated in its own pane (D8's dedup, applied to a retarget);
- a tab in a different scope holding that URL does not block the retarget;
- an unknown `tabId`, or a tab whose `kind` is not `'url'`, returns the same reference.

`url-tab-id.test.ts` asserts:
- `urlTabId('http://localhost:5173/a/b?q=1#frag')` matches `/^[A-Za-z0-9_-]+$/`;
- two calls for the same URL produce different ids (uniqueness);
- `urlTabTitle('http://localhost:5173/a?q=1')` === `'localhost:5173'`;
- `urlTabTitle('https://example.com/x')` === `'example.com'` (no port when it is the scheme default).

**Verify:** both files fail — `url-tab-id.ts` does not exist and `'url'` is not a valid `RunTabKind`.

### Task 3 — Persistence sanitizer keeps URL tabs (D4, AC14)

**File:** `packages/ui/src/store/__tests__/layout-persist.test.ts` (extend).

Assert `sanitizeRun` keeps a `kind: 'url'` tab **with its `url` and `title` intact** while still
stripping `preview`, `console`, and `terminal`; and that a pane containing only a URL tab survives
instead of being dropped.

**Verify:** fails — `SAFE_RUN_TAB_KINDS` does not contain `'url'`.

### Task 4 — Port-tunnel store carries the DNS flag (D11)

**File:** `packages/ui/src/store/__tests__/port-tunnels.test.ts` (extend).

Assert:
- a `ready` event produces `{ state: 'ready', url, dnsVerified: false }`;
- a following `dns_verified` event produces `{ state: 'ready', url, dnsVerified: true }` and keeps
  the known url when the event carries none;
- a `dns_verified` event arriving with no prior `ready` still yields `dnsVerified: true`;
- `applyPortTunnelSnapshot` marks a `state: 'ready'` entry `dnsVerified: true` (fact 8) and leaves a
  `starting` entry without the flag.

Same file, against the new `clearPortTunnelEntry(port)` export (Task 10, PD2):
- clearing an `error` entry removes the key, bumps `generation`, and returns `true`;
- clearing a `starting` entry does the same;
- clearing a `ready` entry is a **no-op**: the entry keeps its `state`, `url`, and `dnsVerified`, the
  function returns `false`, and `generation` is unchanged;
- clearing a port with no entry returns `false` and leaves the state reference untouched.

Keep the existing "treats dns_verified as ready" expectations working.

**Verify:** the new assertions fail — neither the field nor the export exists.

### Task 5 — Tunnel-state resolution (AC7, AC8, AC9, AC10, D11–D14)

**File (new):** `packages/ui/src/features/url-tab/__tests__/resolve-url-target.test.ts`.

Table-drive `resolveUrlTabTarget(input)` over the contract in Task 11. Required cases:
- `url: ''`, `url: '   '`, `url: 'not a url'` → `{ kind: 'invalid', url }` on **both** a local and a
  remote daemon (the variant is resolved ahead of the locality check, fact 15);
- local daemon, any URL → `{ kind: 'direct', url }` (including a loopback URL);
- remote daemon, non-loopback URL (`https://example.com/x`, `http://192.168.1.5:3000/`) → `direct`;
- remote + loopback + `daemonPort === null` → `pending`;
- remote + loopback port `22` → `{ kind: 'rejected', reason: 'Port must be 1024 or higher' }`;
- remote + loopback port equal to `daemonPort` → `{ kind: 'rejected', reason: "Cannot tunnel the daemon's own port" }`;
- remote + eligible port + no entry + `everHadEntry: false` → `pending` naming the port;
- remote + entry `{ state: 'starting' }` → `pending`;
- remote + entry ready with url + `watching: false` (adopting) → `tunnelled`, **regardless of
  `dnsVerified`** (AC8);
- remote + entry ready + `watching: true` + `dnsVerified: false` + `startUrl: null` → `pending`;
- same, plus `dnsVerified: true` → `tunnelled`;
- same, plus `startUrl` set → `tunnelled` (the tab's own POST answered);
- remote + eligible port + **`entry === undefined`** + `everHadEntry: false` + `startUrl` set →
  `tunnelled` composed from `startUrl` — the daemon returns an existing tunnel's URL with no
  broadcast, so the store may never gain an entry (fact 14);
- remote + entry `{ state: 'error', error: 'boom' }` → `{ kind: 'failed', error: 'boom' }`;
- error entry with no message → `failed` with `'Tunnel failed to start'`;
- `timedOut: true` while still pending → `failed` with the stated timeout text;
- **non-terminal failure:** `timedOut: true` **and** a ready+gate-open entry → `tunnelled` (AC9's
  "a URL that arrives after the failure body replaces it");
- entry `undefined` with `everHadEntry: true` and `startUrl: null` → `{ kind: 'stopped', port }` (D14);
- entry `undefined` with `everHadEntry: true` and **`startUrl` set** → `{ kind: 'stopped', port }` as
  well. This is the canonical §7 case, so it is not an edge row: the tab POSTed, the entry went
  `ready`, the page loaded, and the user then pressed Stop on the chat chip — the `stopped` WS event
  runs `clearEntry(port)` (verified in `store/port-tunnels.ts`) while `startUrl` still holds the now
  dead tunnel URL. `everHadEntry` outranks `startUrl` so the tab reports the stop and offers Retry
  instead of re-mounting a 502 page (D14, AC9);
- **the four post-Retry inputs** (the states Task 18's `retry` produces, PD1) each resolve to
  `pending`, so the start effect can fire again: `{ entry: undefined, everHadEntry: false,
  startUrl: null, timedOut: false }` after a rejected start; the same after an externally stopped
  tunnel; the same after a 120 s timeout whose `starting` entry was cleared; and
  `{ entry: undefined, everHadEntry: false, timedOut: false }` after a timeout that never had an entry;
- `composeTunnelUrl('https://x.trycloudflare.com', 'http://localhost:5173/a/b?q=1#f')` →
  `'https://x.trycloudflare.com/a/b?q=1#f'` (D12), and an origin-only original URL →
  `'https://x.trycloudflare.com/'`.

**Verify:** fails — the module does not exist.

### Task 6 — Tunnel ownership on close (D10, AC12)

**File (new):** `packages/ui/src/features/url-tab/__tests__/url-tunnel-ownership.test.ts`.

Against the pure reducers in Task 12:
- `releaseConsumers` on a tab that **started** its tunnel and is the only consumer of the port →
  `stop` lists that port;
- a tab that **adopted** (started `false`) and is the only consumer → `stop` is empty;
- two tabs on one port, the starter released while the other remains → `stop` is empty;
- both released together → `stop` lists the port once, not twice;
- releasing an unknown tab id is a no-op and returns the same state reference;
- `clearConsumers` empties the registry and returns no ports to stop;
- `addConsumer` re-registering a tab on the **same** port with `started: false` keeps `started: true`
  (Retry never demotes an owner);
- `addConsumer` re-registering a tab on a **different** port takes the new `started` verbatim, both
  `true → false` and `false → true`, so a retarget cannot carry ownership onto a tunnel the tab
  merely adopted (D10, AC12).

**Verify:** fails — the module does not exist.

---

## Group B — `core` (pure logic, stores, wiring)

Turns Group A green. Every task here ends with the named test file passing.

### Task 7 — Restrict normalization to http/https (D2)

**File:** `packages/ui/src/features/preview/normalize-url.ts`.

After `new URL(withScheme)` succeeds, return `null` unless `protocol` is `http:` or `https:`.
Keep the bare-host → `http://` prefixing. Update the file's doc comment to say why (the address bar
could point a child webview at `file://`).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/preview/__tests__/normalize-url.test.ts` green.

### Task 8 — `url` tab kind, dedup, kind-parameterized id helpers

**File:** `packages/ui/src/store/run-pane.ts` (207 lines today; ~245 after this task, still under 300).

1. Add `'url'` to `RunTabKind`.
2. Add `url?: string` to `RunTab` with a doc line: normalized committed URL for a `url` tab; the
   tab's identity for dedup and persistence; **never** a tunnel URL.
3. Generalize the dedup block in `addRunTab` into a small `dedupMatcher(tab): ((t: RunTab) => boolean) | null`
   helper returning the launch-tab matcher for `preview`/`console` with a `config`, the
   `kind === 'url' && t.url === tab.url && t.scopeKey === tab.scopeKey` matcher for a `url` tab with a
   `url`, and `null` otherwise. `addRunTab` keeps its existing across-all-panes scan and must stay
   under 50 lines.
4. Replace `terminalIdsInRun` / `terminalIdsInPane` / `terminalIdsForScope` with
   `tabIdsInRun(run, kind)` / `tabIdsInPane(run, paneId, kind)` / `tabIdsForScope(run, scopeKey, kind)`
   (`kind: RunTabKind`). Three near-identical pairs would otherwise exist — the hygiene rule
   requires the extraction.
5. Add the pure retarget reducer used by the address bar (PD3):
   ```ts
   export function retargetUrlTab(run: RunState, tabId: string, url: string, title: string): RunState;
   ```
   It finds the tab across every pane; returns `run` unchanged when the id is unknown, the tab's
   `kind` is not `'url'`, or its `url` already equals `url`. When another `url` tab **in the same
   `scopeKey`** already holds `url`, it activates that tab in its own pane and leaves the source tab
   alone (D8). Otherwise it replaces the tab's `url` and `title` in place, keeping the `id` — the id
   is the webview label's source and the tunnel-consumer key. The caller supplies `title` so
   `run-pane.ts` stays free of feature imports.
6. Update the call sites (fact 12): `store/layout.ts` ×3 (`'terminal'` argument),
   `lib/daemon/dispose-daemon-session.ts` ×1, and mechanically rename in
   `store/__tests__/run-pane-terminal.test.ts`, `store/__tests__/run-pane-release-scope.test.ts`,
   and the `vi.mock('../../../store/run-pane', …)` factory in
   `lib/daemon/__tests__/dispose-daemon-session.test.ts`. These three test edits are renames only —
   no assertion changes.

**Verify:** `vitest run src/store/__tests__/run-pane-url-tab.test.ts src/store/__tests__/run-pane-terminal.test.ts src/store/__tests__/run-pane-release-scope.test.ts` and
`vitest run src/lib/daemon/__tests__/dispose-daemon-session.test.ts` all green.

### Task 9 — Persist URL tabs (D4)

**File:** `packages/ui/src/store/layout-persist.ts`.

Add `'url'` to `SAFE_RUN_TAB_KINDS` and update the comment above it: a URL tab's whole identity is a
string, so it carries no live handle. Nothing else changes — `sanitizeRun` copies the tab object, so
`url` and `title` survive.

**Verify:** `vitest run src/store/__tests__/layout-persist.test.ts` green.

### Task 10 — Surface the DNS check to the renderer (D11)

**File:** `packages/ui/src/store/port-tunnels.ts`.

Add `dnsVerified?: boolean` to `PortTunnelEntry` with a comment stating it is a **reload trigger**,
not a gate — a tunnel the daemon lists as ready has already passed the check. In
`applyPortTunnelEvent`, split the collapsed arm: `ready` writes `dnsVerified: false` (preserving an
existing `true` if one is already recorded, so a late duplicate `ready` cannot un-verify a tunnel);
`dns_verified` writes `dnsVerified: true`. Both keep the existing url-fallback behaviour. In
`applyPortTunnelSnapshot`, set `dnsVerified: true` for `state === 'ready'` entries.
`reportPortTunnelError`'s never-downgrade-a-ready-tunnel rule is unchanged.

Also export the module-private `clearEntry` as a guarded public function (PD2), because Task 18's
`retry` has no other way to drop the stale entry that pins a URL tab in `failed`:
```ts
/** Drops a non-live entry so a consumer can retry. Refuses a `ready` entry. Returns whether it cleared. */
export function clearPortTunnelEntry(port: number): boolean;
```
It returns `false` without touching state when the entry is `ready` or absent, and otherwise removes
the key and bumps `generation` exactly as `clearEntry` does. Document the shared-badge consequence in
the doc comment: every `UrlChip` on that port re-renders with no badge and no Stop control (fact 16),
which is the chip's pre-tunnel appearance — the cleared entry was a stale failure or a start the
daemon has since abandoned, and the next `tunnel:status` event repopulates it. A `ready` entry is
refused for the same reason `reportPortTunnelError` refuses to downgrade one.

**Verify:** `vitest run src/store/__tests__/port-tunnels.test.ts` green.

### Task 11 — Pure tunnel-state resolution + tab identity

**Files (new):** `packages/ui/src/features/url-tab/resolve-url-target.ts`,
`packages/ui/src/features/url-tab/url-tab-id.ts`.

`url-tab-id.ts`:
```ts
export function urlTabId(url: string): string;   // `url-${sanitizedHost}-${crypto.randomUUID().slice(0, 8)}`
export function urlTabTitle(url: string): string; // host, plus `:port` when the port is not the scheme default
```
Sanitize with `.replace(/[^A-Za-z0-9_-]/g, '_')`, mirroring `features/run/run-tab-for-config.ts`. On
an unparseable URL (defensive only — callers normalize first) fall back to `url-${uuid8}` /
the raw input.

`resolve-url-target.ts` exports:
```ts
export type UrlTabTarget =
  | { kind: 'direct'; url: string }
  | { kind: 'tunnelled'; url: string }
  | { kind: 'pending'; port: number }
  | { kind: 'rejected'; port: number; reason: string }
  | { kind: 'failed'; error: string }
  | { kind: 'stopped'; port: number }
  | { kind: 'invalid'; url: string };

export interface UrlTabTunnelInput {
  url: string;                 // normalized, user-committed
  isLocal: boolean;
  daemonPort: number | null;   // the DAEMON's own port from the tunnel snapshot, not the HTTP client port
  entry: PortTunnelEntry | undefined;
  watching: boolean;           // this tab attached while the tunnel was absent or starting
  startUrl: string | null;     // the url this tab's own POST /tunnel/ports/start returned
  timedOut: boolean;           // the 120s watchdog fired
  everHadEntry: boolean;       // an entry existed for this port and then disappeared
}

export const URL_TAB_TUNNEL_TIMEOUT_MS = 120_000;
export function resolveUrlTabTarget(input: UrlTabTunnelInput): UrlTabTarget;
export function composeTunnelUrl(tunnelOrigin: string, originalUrl: string): string;
export function portRejectionReason(port: number, daemonPort: number): string | null;
```

`portRejectionReason` returns the daemon's strings verbatim (fact 7): `port < 1024` →
`'Port must be 1024 or higher'`; `port === daemonPort` → `"Cannot tunnel the daemon's own port"`;
any other ineligibility per `isTunnelEligiblePort` → `` `Port ${port} cannot be tunnelled` ``;
otherwise `null`.

`resolveUrlTabTarget` evaluates in this exact order (split the tail into a `resolveEntryTarget`
helper to stay under 50 lines per function):
0. `normalizePreviewUrl(url) === null` → `{ kind: 'invalid', url }`. This runs **ahead of the locality
   check** because no other variant can express an unusable URL: `classifyLocalhostUrl('')` returns
   `null`, which would otherwise fall out of step 2 as `direct` with an empty `url` and hand
   `WebviewUrl::External(Url::parse(""))` to the Tauri shell (fact 15). Callers normalize before
   creating a tab, so the only live source is corrupt persisted state (Task 21).
1. `isLocal` → `direct`.
2. `classifyLocalhostUrl(url) === null` → `direct`.
3. `daemonPort === null` → `pending`.
4. `portRejectionReason(...) !== null` → `rejected`.
5. `entry === undefined` → `everHadEntry ? stopped : (startUrl !== null ? tunnelled(composeTunnelUrl(startUrl, url)) : pending)`.
   The two branches answer two different histories, and **`everHadEntry` must be tested first**:
   - `everHadEntry === true` means an entry for this port existed during this attempt and is now gone,
     which happens only when the daemon broadcast `stopped` and the store ran `clearEntry(port)`. The
     tunnel is dead no matter what this tab's own POST once returned, so the tab reports `stopped` and
     offers Retry (D14, spec behaviour §7). Testing `startUrl` first would swallow this: every tab that
     ever reached `pending` issues a start (the effect has no `entry === undefined` guard, Task 18), so
     nearly every tab holds a non-null `startUrl` and would keep mounting the dead tunnel URL forever.
   - `everHadEntry === false` with a `startUrl` means the POST answered from a tunnel the daemon
     already held: it returns that URL and broadcasts nothing (fact 14), so no entry will ever appear.
     Without this branch a tab whose entry Retry just cleared — the attempt reset sets `everHadEntry`
     back to `false` — would wait for an event that never arrives.
6. `entry.state === 'error'` → `failed` with `entry.error ?? 'Tunnel failed to start'`.
7. `entry.state === 'ready' && (entry.url ?? startUrl)` and the gate is open
   (`!watching || startUrl !== null || entry.dnsVerified === true`) → `tunnelled` with
   `composeTunnelUrl(entry.url ?? startUrl, url)`.
8. anything else → `timedOut ? failed('The tunnel did not produce a URL within 120 seconds') : pending`.

Step 5's `startUrl` branch and step 7 preceding step 8 are what make the failure non-terminal (AC9).

`composeTunnelUrl` takes the origin of `tunnelOrigin` and appends `pathname + search + hash` of
`originalUrl` (D12); on a parse failure it returns `tunnelOrigin` unchanged.

**Verify:** `vitest run src/features/url-tab/__tests__/resolve-url-target.test.ts src/features/url-tab/__tests__/url-tab-id.test.ts` green.

### Task 32 — Decompose `store/layout.ts` before it grows (AC17, PD5)

**Order:** runs **before** Task 12 and Task 33, which both add lines to `layout.ts`.
**Files:** `packages/ui/src/store/layout-placement.ts` (new), `packages/ui/src/store/layout.ts`.

`layout.ts` is 317 lines today (fact 13) — already over the cap this plan's final sweep enforces.
Move, with no behaviour change, the layout value types and the pure placement helpers into
`store/layout-placement.ts`: the `SurfaceId`, `RepositionTarget`, and `WorkspaceLayout` types, plus
`insertTop`, `placeInLayout`, `removeSurface`, `repositionInLayout`, `layoutCanSplit`,
`litSurfaceCount`, and `isSurfaceFloor` (`layout.ts:22–123`). They touch no store state, which is why
this is the seam rather than the mutators — the four Run-tab mutators all close over `get()` and
`writeWorkspace`, so lifting them would mean inventing an injection shape for a line count this
extraction already buys.

`layout.ts` imports what it uses and **re-exports the public surface unchanged** so no call site moves:
`export type { SurfaceId, RepositionTarget, WorkspaceLayout } from './layout-placement';` and
`export { isSurfaceFloor, layoutCanSplit, litSurfaceCount } from './layout-placement';` (a `export type`
form is required — the package is `verbatimModuleSyntax`). Fourteen files import these from
`@/store/layout`; none of them changes.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/store/__tests__/layout.test.ts src/layout/__tests__/use-surface-drag.test.ts` green with no edits to either file;
`pnpm --filter @qlan-ro/mainframe-ui typecheck`; `wc -l packages/ui/src/store/layout.ts` reports under 250.

### Task 12 — Tunnel ownership registry + layout release wiring (D10, AC12)

**Files (new):** `packages/ui/src/features/url-tab/url-tunnel-ownership.ts`,
`packages/ui/src/features/url-tab/tunnel-consumers.ts`,
`packages/ui/src/store/url-tunnel-cleanup.ts`.
**Files (changed):** `packages/ui/src/store/layout.ts`, `packages/ui/src/lib/daemon/dispose-daemon-session.ts`.

`url-tunnel-ownership.ts` — pure, no I/O:
```ts
export interface ConsumerRecord { port: number; started: boolean; daemonHttpPort: number }
export interface ConsumerState { byTab: Record<string, ConsumerRecord> }
export const emptyConsumerState: ConsumerState;
export function addConsumer(state: ConsumerState, tabId: string, rec: ConsumerRecord): ConsumerState;
export function releaseConsumers(
  state: ConsumerState,
  tabIds: string[],
): { next: ConsumerState; stop: Array<{ port: number; daemonHttpPort: number }> };
export function clearConsumers(state: ConsumerState): ConsumerState;
```
`releaseConsumers` removes the tabs first, then for each removed record with `started === true`
whose port has **no remaining consumer**, emits one stop entry — deduplicated by port. Returns the
same state reference when nothing was removed.

The record carries `daemonHttpPort` (the value `useDaemonPort()` gave the tab at registration)
because the release path runs outside React and there is no module-level accessor for it.

`tunnel-consumers.ts` — module-level `ConsumerState` plus
`registerUrlTunnelConsumer(tabId, rec)`, `releaseUrlTunnelConsumers(tabIds)` (calls
`stopPortTunnel(daemonHttpPort, port)` for each stop entry, `.catch` logged with a
`[url-tab]` tag — never a silent catch), and `clearUrlTunnelConsumers()`.
Registration is idempotent per tab id, and the rule is **keyed by port**:
- re-registering a tab on the port it already holds replaces the record but must not flip `started`
  from `true` to `false` — an owner stays an owner across a Retry (D10);
- re-registering it on a **different** port (the address-bar retarget, Task 33) takes the new
  `started` value verbatim, in both directions. The old port's ownership says nothing about the new
  one, and carrying `true` across would let the tab stop a tunnel on the new port that it only
  adopted. Implement it as: preserve the old `started` only when `rec.port === existing.port`.

The retarget drops the tab out of the old port's consumer set without stopping that port's tunnel.
That is D10's err-toward-leaving-it-up rule applied to a live tunnel a user may still be using from
the chat chip; a retarget is not a close.

`store/url-tunnel-cleanup.ts` — a one-import shim over `features/url-tab/tunnel-consumers`, mirroring
`store/terminal-cleanup.ts`, so `layout.ts` never imports a feature store and no import cycle forms.

`store/layout.ts` — call `releaseUrlTunnels(tabIdsInRun(run, 'url'))` in `toggleSurface` when Run is
being hidden (beside the existing `killAndDisposeCachedTerminals`), `releaseUrlTunnels([tabId])` in
`closeRunTab` when the closed tab's `kind === 'url'`, `releaseUrlTunnels(tabIdsInPane(run, paneId, 'url'))`
in `closePane`, and `releaseUrlTunnels(tabIdsForScope(run, scopeKey, 'url'))` in `releaseRunScope`.

`lib/daemon/dispose-daemon-session.ts` — add a `try/catch` step calling `clearUrlTunnelConsumers()`.
**It must not stop anything**: a daemon switch would send the stop to the wrong daemon, layout
storage and `resetPortTunnels()` are already daemon-scoped, and the spec's daemon-switch edge case
only requires re-resolution. Record that reason in a one-line comment.

**Verify:** `vitest run src/features/url-tab/__tests__/url-tunnel-ownership.test.ts` green;
`vitest run src/store/__tests__/layout.test.ts src/store/__tests__/layout.terminal-cleanup.test.ts src/store/__tests__/layout-release-scope.test.ts`
still green.

### Task 33 — `setUrlTabTarget`, the address bar's write path (D9, PD3)

**Files:** `packages/ui/src/store/layout.ts`,
`packages/ui/src/store/__tests__/url-tab-retarget.test.ts` (new).

Add one action to `LayoutStore`:
```ts
/** Point a URL tab at a newly committed URL. The tab's id — and its webview — survive. */
setUrlTabTarget: (tabId: string, url: string, title: string) => void;
```
It reads `run`, returns early when `run` is `null`, calls `retargetUrlTab` (Task 8 item 5), and
`writeWorkspace`s only when the reducer returned a different reference. It does not touch `layout` —
the tab already exists, so there is nothing to reveal. Keep it under 10 lines; Task 32 has already
made room.

This is the only way a URL tab's identity changes after creation. `UrlTabInstance` (Task 20) calls it
from the address bar's commit handler; the changed `tab.url` flows back down as a new `url` prop,
which re-drives `useUrlTabTunnel` and `useWebviewMount` — so a URL typed while the tab sits in
`failed`, `stopped`, `pending`, `rejected`, or `invalid` re-runs tunnel resolution and dedup instead of
being lost (spec behaviour §6, AC14).

`url-tab-retarget.test.ts` drives the store, not the reducer: committing a new URL on a URL tab
updates `run` and persists through `writeWorkspace`; committing the URL a sibling tab in the same
scope already holds activates that sibling and leaves the source tab's `url` alone; committing on a
`terminal` tab id is a no-op.

**Verify:** `vitest run src/store/__tests__/url-tab-retarget.test.ts` green;
`vitest run src/store/__tests__/layout.test.ts` still green.

### Task 13 — Changeset

**File:** `.changeset/<generated>.md` via `pnpm changeset`.

Minor bump for `@qlan-ro/mainframe-ui` and `@qlan-ro/mainframe-app-tauri`. One user-facing sentence:
the Run surface can open any http/https URL in a tab, tunnelling loopback URLs on a remote daemon.
No package other than those two changes.

**Verify:** the file exists and names both packages.

---

## Group C — `rust` (capability widening; independent of all TypeScript work)

### Task 14 — Widen the preview bridge's remote-origin allowlist (D1, AC11)

**File:** `packages/app-tauri/src-tauri/capabilities/preview.json`.

Replace `remote.urls` with exactly `["http://*:*", "https://*:*"]`. **Not** `http://*` /
`https://*`: Tauri's `RemoteUrlPattern` fills in a missing search, hash, and path with `*` but
leaves the port component empty, and an empty port matches only the scheme's default port — those
patterns would not match `http://localhost:5173/` (fact 10, spec D1).

Rewrite `description`: the current text justifies the narrow scope and would be a false statement
after this change. New text states that preview and URL tabs load arbitrary user-named `http`/`https`
origins, that every such origin may call the four bridge callbacks, that no other scheme matches
because the scheme component stays literal, and that the accepted risk is a hostile page fabricating
an inspect payload into the agent's context.

Leave `webviews` and `permissions` untouched. Leave `is_allowed_external_scheme`
(`src/preview/mod.rs`) untouched — it is what still rejects `file:`, `javascript:`, and `ssh:` for
the OS opener.

**Verify:** `cd packages/app-tauri/src-tauri && cargo check` passes.

### Task 15 — Rust tests for the widened patterns (AC11)

**File:** `packages/app-tauri/src-tauri/src/preview/bridge_plugin.rs` (test module).

Update `preview_capability_grants_bridge_commands_to_preview_webviews`: its
`urls.contains(&"http://localhost:*")` / `"http://127.0.0.1:*"` assertions are now false. Replace
them with `urls.contains(&"http://*:*")` and `urls.contains(&"https://*:*")` and an assertion that
`remote.urls` has exactly two entries. Keep the `webviews[0] == "preview-*"` and the four-permission
assertions unchanged.

Add `preview_capability_patterns_match_every_http_origin`: parse each pattern via
`"http://*:*".parse::<tauri::utils::acl::RemoteUrlPattern>()` and assert that at least one pattern
`test`s true for `tauri::Url::parse` of `http://localhost:5173/path`,
`http://192.168.1.5:3000/a?b=1`, `https://example.com:8443/a`, and `https://example.com/x`, and false
for `file:///etc/passwd` and `ssh://host`.
*If `RemoteUrlPattern` turns out not to be reachable through the `tauri::utils` re-export in this
Tauri version, add `urlpattern = "0.3"` and `regex = "1"` to `[dev-dependencies]` (both already
resolved in `Cargo.lock`) and construct the pattern the same way `RemoteUrlPattern::from_str` does.
Do not change the runtime dependency list.*

Add `external_open_scheme_guard_still_rejects_dangerous_schemes` asserting
`is_allowed_external_scheme` is `false` for `file:///etc/passwd`, `javascript:alert(1)`, and
`ssh://host`, and `true` for `http://x` and `https://x` — the widened allowlist must not be read as
widening the opener.

**Verify:** `cd packages/app-tauri/src-tauri && cargo test preview_capability && cargo test external_open_scheme_guard`.

---

## Group D — `ui-tab` (the tab itself)

### Task 16 — Extract the webview mount lifecycle

**Files:** `packages/ui/src/features/preview/use-webview-mount.ts` (new),
`packages/ui/src/features/preview/use-preview-lifecycle.ts`.

`useWebviewMount({ url, anchorRef, containerRef, projectId, device }): PreviewHandle | null` owns
everything currently inside `usePreviewLifecycle`'s effect below the status gate: destroy when `url`
goes `null` after having been non-null, mount on first non-null `url`, `reanchor` when the mount
element changes, `navigate` on a URL change, and the unmount cleanup that destroys the handle.

`usePreviewLifecycle` becomes a thin wrapper: it computes
`url = status === 'running' && port !== null ? resolvedUrl : null`, delegates to `useWebviewMount`,
and keeps `pendingTunnel` (`status === 'running' && port !== null && resolvedUrl === null`).
**Delete `processStopped`** — no caller reads it (fact 5).

Behaviour must be byte-identical for preview tabs: a `running → stopped` transition still destroys
the handle; a `null` status still destroys it.

**Files also touched:** `packages/ui/src/features/preview/__tests__/use-preview-lifecycle.test.ts` —
drop `processStopped` assertions if any exist; every other assertion must pass unchanged. Add a
`__tests__/use-webview-mount.test.ts` covering mount-on-first-url, navigate-on-url-change,
reanchor-on-element-change, destroy-on-null-url, and destroy-on-unmount.

**Verify:** `vitest run src/features/preview/__tests__/use-preview-lifecycle.test.ts src/features/preview/__tests__/use-webview-mount.test.ts src/features/preview/__tests__/PreviewInstance.test.tsx` green.

### Task 17 — Address bar seeds from a URL and reloads what is displayed (D9, D13)

**Files:** `packages/ui/src/features/preview/use-preview-address.ts`,
`packages/ui/src/features/preview/PreviewUrlBar.tsx`,
`packages/ui/src/features/preview/PreviewToolbar.tsx`,
`packages/ui/src/features/preview/PreviewInstance.tsx`.

`usePreviewAddress(handle, seedUrl: string | null)` replaces the `port` parameter: it seeds
`currentUrl` from `seedUrl` and re-seeds when `seedUrl` changes. The `onNavigate` reflection is
unchanged. Callers that had a port pass `` port !== null ? `http://localhost:${port}` : null ``.

`PreviewUrlBar` props become `{ handle, seedUrl, enabled, onCommitUrl? }`:

- `enabled` replaces `isRunning`, whose name no longer fits a tab with no process, and it now gates
  **only** the text input and the status dot. The three icon buttons gate on
  `const canAct = enabled && handle !== null` — for a preview tab that is today's behaviour plus a
  handle check the actions already no-op'd on, and for a URL tab it is what lets the input stay live
  while nothing is mounted.
- `onCommitUrl?: (url: string) => void`. When it is supplied, Enter normalizes with
  `normalizePreviewUrl` and calls `onCommitUrl(normalized)` **instead of** `navigateTo` — the owner
  re-drives the mount, so there is exactly one navigation and no race between an optimistic navigate
  and a changed `seedUrl`. Invalid input keeps the existing invalid treatment and calls nothing. When
  `onCommitUrl` is absent (the preview tab) the current `navigateTo(draft)` path is untouched.

`handleReload` navigates to `currentUrl` and no-ops when it is empty — it must not re-derive
`http://localhost:${port}` (D13). `handleOpenBrowser` uses `currentUrl` only. The four testids
(`preview-url-reload`, `preview-url-input`, `preview-url-open-browser`, `preview-url-clear-cache`) are
unchanged — the URL tab reuses this component and inherits them.

`PreviewToolbar` passes `seedUrl` through and keeps its own `port` prop only for the pieces that
still need it. `PreviewInstance` supplies the seed.

**Files also touched:** `packages/ui/src/features/preview/__tests__/use-preview-address.test.ts`
and `PreviewUrlBar.test.tsx` and `PreviewToolbar.test.tsx` — update to the new props; add a case
asserting reload navigates to the **navigated-to** URL, not `localhost:<port>`, after an
`onNavigate` event; add two `onCommitUrl` cases — with a `null` handle and `enabled` true, Enter on
valid input calls `onCommitUrl` once and `handle.navigate` never, and Enter on `file:///etc/passwd`
calls neither and shows the invalid treatment.

**Verify:** `vitest run src/features/preview/__tests__/use-preview-address.test.ts src/features/preview/__tests__/PreviewUrlBar.test.tsx src/features/preview/__tests__/PreviewToolbar.test.tsx` green.

### Task 18 — `useUrlTabTunnel` hook

**File (new):** `packages/ui/src/features/url-tab/use-url-tab-tunnel.ts`.

`useUrlTabTunnel({ tabId, url }): { target: UrlTabTarget; retry: () => void; reloadNonce: number }`.

Reads `useDaemonIsLocal()`, `useDaemonPort()` (HTTP client port), `useTunnelDaemonPort()` (the
daemon's own port, for eligibility), `useActiveIdentity().chatId`, and
`usePortTunnel(port)` for the classified loopback port (skip the subscription entirely when the URL
is not loopback or the daemon is local).

**Every piece of resolver state below is per *attempt*.** `attempt` is a counter the tab bumps on
Retry; the hook holds the flags in one object replaced wholesale, and a `useEffect` on
`[attempt, port]` resets them. Keying on `attempt` — not on `target.kind === 'pending'` or on
`entry === undefined` — is what makes Retry work in all four states it is reachable from (PD1). The
one exception is `ownedRef`, which is per *port*.

State it owns — everything but `ownedRef` feeds `resolveUrlTabTarget`:
- `watchingRef` — set `true` on the first render of the attempt at which an entry is absent or
  `starting` **and** a start is needed; never set `false` within the attempt.
- `startUrl` — the URL this tab's own `startPortTunnel` POST resolved with, `null` until it does.
- `everHadEntry` — set once an entry has been seen during this attempt; drives the `stopped` state (D14).
- `timedOut` — a 120 s (`URL_TAB_TUNNEL_TIMEOUT_MS`) watchdog started when the target first becomes
  `pending`, cleared when it leaves `pending`.
- `startedForAttemptRef` — the attempt number whose start POST has been issued, so the effect fires
  once per attempt rather than once per tab.
- `ownedRef` — the ownership observation that feeds the consumer registration, **not** the resolver:
  `true` once the start effect has fired at a moment when `entry === undefined`. The reset effect
  clears it only when `port` changes, never on an attempt bump, so a Retry cannot demote an owner
  (D10) and Task 12's same-port idempotency rule agrees with it. A port change resets it to the value
  observed on the new port, which is why Task 12 drops the preserve rule across ports.

Effects:
- **Start request.** When the target is `pending`, `daemonPort !== null`, `chatId` is present, and
  `startedForAttemptRef.current !== attempt`, stamp the ref and POST
  `startPortTunnel(httpPort, { port, chatId })`; on resolve store the returned `url` in `startUrl`; on
  rejection call `reportPortTunnelError(port, message)` (which is the single funnel for both the POST
  rejection and the WS error, so the toast is not doubled). There is deliberately **no
  `entry === undefined` guard**: the daemon's registry is the single-flight point — a POST during
  another consumer's start joins it and a POST on a live tunnel returns its URL, in neither case
  spawning a second cloudflared (fact 14). Adopting mid-start therefore still holds (spec "Tunnel
  adopted mid-start"), and the tab gains a URL source for the case where the daemon has a tunnel but
  will never broadcast about it again. In the same statement that stamps `startedForAttemptRef`,
  record `ownedRef.current ||= entry === undefined` — an observation taken as the POST goes out, not a
  gate on sending it.
- **DNS reload trigger.** When `entry.dnsVerified` transitions to `true` while the target is already
  `tunnelled` **and** the tab loaded before verification, fire the caller-provided reload once
  (expose it as a `reloadNonce` counter in the return so `UrlTabInstance` can re-navigate). Exactly
  once per transition (D11 / spec step 5).
- **Consumer registration.** Call `registerUrlTunnelConsumer(tabId, { port, started: ownedRef.current, daemonHttpPort })`
  whenever the port or `ownedRef.current` changes. `started` is `true` only when this tab's start
  effect fired at a moment when **no entry existed for the port** — the tab observed itself creating
  the tunnel. Issuing the POST is not enough on its own: in the spec's "Tunnel adopted mid-start" case
  the chip has already put a `starting` entry in the store, the tab's POST joins that in-flight start
  (fact 14), and registering `started: true` there would make `releaseConsumers` kill the chip's
  tunnel on tab close while the chip still shows its badge and Stop control — the exact inversion of
  AC12. The daemon cannot disambiguate for us: `POST /api/tunnel/ports/start` answers `{ url, port }`
  for a create, a join, and an adopt alike, and D5 declines any daemon change.
- **`retry`** — the only way out of `failed` and `stopped`, and it never runs automatically (D14):
  ```ts
  function retry() {
    clearPortTunnelEntry(port);   // no-op on a ready entry (PD2)
    setAttempt((n) => n + 1);     // resets watching / startUrl / everHadEntry / timedOut / startedForAttempt
  }
  ```
  Trace, because the previous shape was inert in three of these four (spec behaviour §6 and §7, AC9,
  D14):

  | How the tab got there | State before Retry | After `retry()` |
  |---|---|---|
  | Start POST rejected | `{ state: 'error' }` entry → `failed` | entry cleared, `everHadEntry` false → `pending` → start fires |
  | Tunnel stopped from the chip | no entry, `everHadEntry` true → `stopped` | `everHadEntry` false → `pending` → start fires |
  | 120 s timeout, entry stuck `starting` | `starting` entry → `failed` | entry cleared, `timedOut` false → `pending` → start fires; the daemon joins its own in-flight start or answers with the live URL, which lands in `startUrl` |
  | 120 s timeout, no entry | no entry → `failed` | `timedOut` false → `pending` → start fires |

  `rejected` is the one failure body with **no** Retry — the port is ineligible, and retrying it would
  re-issue a request the client already knows the daemon refuses (AC10).

  Retry does not clear the consumer registration's `started` flag: `ownedRef` survives an attempt
  bump, so a tab that has ever been observed creating this port's tunnel stays its owner (D10), and
  Task 12's same-port registration never flips `started` back to `false`.

Keep the file under 300 lines and each effect under 50; extract the watchdog into a small local hook
if it grows.

**Verify:** covered behaviourally by Task 27's `UrlTabInstance` retry cases and by the post-Retry
resolver rows in Task 5; there is no separate hook test (the hook is React-bound glue over pure logic
that is already table-driven).

### Task 19 — `UrlTabBodyState`

**File (new):** `packages/ui/src/features/url-tab/UrlTabBodyState.tsx`.

Props `{ target, device, inspectActive, anchorRef, onRetry }`. Renders, per `target.kind`:
- `direct` / `tunnelled` → the loaded body, structurally identical to `PreviewBodyState`'s
  `status === 'running'` branch (desktop frame vs the 230×420 phone frame, the inspect outline and
  the "Click an element" badge), with the anchor div. testid `url-tab-body-loaded`.
- `pending` → spinner plus `` `Starting a tunnel for port ${target.port}…` ``. testid `url-tab-body-pending`.
- `rejected` → the reason text verbatim, no Retry (nothing to retry). testid `url-tab-body-rejected`.
- `failed` → the error text plus a **Retry** button, testids `url-tab-body-failed` and
  `url-tab-retry`.
- `stopped` → "The tunnel for port N was stopped" plus the same Retry. testid `url-tab-body-stopped`.
- `invalid` → "This tab's saved address can't be opened" plus the raw stored value, no Retry —
  retrying resolves nothing; the address bar above is the way out (Task 20 keeps it live). testid
  `url-tab-body-invalid`.

Use `mainframe-design-system` tokens; mirror `PreviewBodyState`'s classes rather than inventing new
ones. Never render a blank body — every `UrlTabTarget` variant has a branch (AC9).

### Task 20 — `UrlTabToolbar` and `UrlTabInstance`

**Files (new):** `packages/ui/src/features/url-tab/UrlTabToolbar.tsx`,
`packages/ui/src/features/url-tab/UrlTabInstance.tsx`.

`UrlTabToolbar` renders `PreviewUrlBar` + `PreviewDeviceToggle` + `PreviewCaptureCluster` and **no**
`PreviewRunControl` and no console drawer (AC5) — the controls are absent, not disabled. testid
`url-tab-toolbar`.

It passes `enabled={true}` unconditionally — **not** `handle !== null`. A URL tab's address bar is the
tab's escape hatch: the spec requires it live in `failed` and `stopped` ("the user can type a
different URL out of the failure state", §6) and it is the only exit from `invalid`, and in none of
those states is a webview mounted. The three icon buttons still dim on their own `handle` check inside
`PreviewUrlBar` (Task 17). It also passes `seedUrl={url}` — the tab's committed URL, never the tunnel
URL — and `onCommitUrl`.

`UrlTabInstance({ tabId, url, visible, scopeKey, projectId })` mirrors `PreviewInstance` minus the
launch plumbing:
- `const { target, retry, reloadNonce } = useUrlTabTunnel({ tabId, url })`;
- `const loadUrl = target.kind === 'direct' || target.kind === 'tunnelled' ? target.url : null` — the
  other five kinds, `invalid` included, mount nothing;
- `onCommitUrl` = `(next) => useLayoutStore.getState().setUrlTabTarget(tabId, next, urlTabTitle(next))`
  behind a `useLayoutStore((s) => s.setUrlTabTarget)` selector (no `getState()` reach-through). The
  store rewrites `tab.url`, the new value arrives as the `url` prop, and `useUrlTabTunnel` +
  `useWebviewMount` re-resolve from it — one path for a URL typed in any state (PD3);
- `const handle = useWebviewMount({ url: loadUrl, anchorRef, containerRef, projectId, device })`;
- `usePreviewGeometry({ handle, anchorRef, containerRef, active: visible, status: loadUrl ? 'running' : null })`
  — pass the shape the hook already expects; if its `status` parameter is launch-specific, widen it to
  a boolean `mounted` flag and update the two call sites in the same pass rather than faking a status;
- `usePreviewOcclusion(anchorRef, loadUrl !== null && (handle?.compositesAboveDom ?? false))`;
- `usePreviewVisibility` and `usePreviewCapture` exactly as `PreviewInstance` uses them, so captures
  and inspect results reach the active chat unchanged;
- a `useEffect` on `reloadNonce` that re-navigates the handle to `loadUrl` (the DNS reload, spec step 5);
- root testid `url-tab-instance-${tabId}`; `CaptureAnnotationPopover` mounted as in `PreviewInstance`.

Both files stay under 300 lines; the annotation/capture block is already a hook, so no new
decomposition should be needed.

### Task 21 — Render the kind in the Run surface

**Files:** `packages/ui/src/layout/surfaces/RunSurface.tsx`, `packages/ui/src/layout/RunTabPill.tsx`.

`RunTabBody` gains a `tab.kind === 'url'` arm **above** the file-guest fallback, rendering
`<UrlTabInstance tabId={tab.id} url={tab.url ?? ''} visible={active} scopeKey={tabScope ?? undefined} projectId={projectId} />`.
A URL tab with no `url` (corrupt persisted state) passes `''` down and lands on the resolver's
`invalid` variant (Task 11 step 0), which renders `url-tab-body-invalid` with a live address bar —
it never falls through to the placeholder (AC3) and never reaches `host.preview.mount` with an
unparseable URL. The `<kind>: <title>` placeholder must remain reachable for
`code`/`diff`/`skill`/`viewer`.

`RunTabPill.tabGlyph` gains a `Globe` (lucide) for `'url'`, coloured `text-mf-surface-run` when
active like the other Run-owned kinds (spec: "a globe glyph, distinct from the preview eye"). The
`live && config` Stop branch is untouched — a URL tab has no `config`, so it never shows a Stop.

**Verify:** `vitest run src/layout/__tests__/RunSurface.tab-scope.test.tsx src/layout/__tests__/RunSurface.preview-port.test.tsx` still green; `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

---

## Group E — `ui-entrypoints` (the two creation paths)

### Task 22 — `open-url-tab` intent and its subscriber (D6)

**Files:** `packages/ui/src/store/surface-intents.ts`,
`packages/ui/src/store/url-tab-intent-subscriber.ts` (new),
`packages/ui/src/layout/SurfaceHost.tsx`.

Add `| { type: 'open-url-tab'; url: string; paneId?: string }` to `SurfaceIntent`, documented as
"Open (or focus) a URL tab in the Run surface".

`subscribeToUrlTabIntents()` mirrors `terminal-intent-subscriber.ts` but is fully synchronous:
normalize with `normalizePreviewUrl` (a second guard — the entry points already normalize; a
`null` result is dropped with a tagged `console.warn`), read `scopeKey` from
`useActiveBasesStore.getState()`, and call
`useLayoutStore.getState().addRunTab({ id: urlTabId(url), kind: 'url', title: urlTabTitle(url), url, scopeKey }, paneId)`.
No `toggleSurface` call — `addRunTab` already reveals Run (fact 2). No disposal path is needed: a URL
tab creates nothing before the tab exists, so a `false` return only needs the tagged warn.

This subscriber is the **single creation path** both entry points use; neither entry point may call
`addRunTab` directly.

`SurfaceHost.tsx` mounts it in a `useEffect` beside `subscribeToTerminalIntents()`.

**Verify:** `vitest run src/store/__tests__/surface-intents.test.ts` green; add nothing here — the
behavioural test lands in Task 30.

### Task 23 — `RunUrlEntry`, the shared inline entry

**File (new):** `packages/ui/src/layout/RunUrlEntry.tsx`.

`RunUrlEntry({ paneId, onDone })` renders a single inline input, placeholder `localhost:3000`,
autofocused on mount. Enter normalizes with `normalizePreviewUrl`; on success it emits
`{ type: 'open-url-tab', url: normalized, paneId }` and calls `onDone()`; on failure it applies the
address bar's invalid treatment (`text-destructive ring-1 ring-destructive rounded-sm`, copied from
`PreviewUrlBar`) and emits nothing — including for empty or whitespace-only input (AC6). Escape and
blur call `onDone()` without emitting. Typing clears the invalid state.

testids: `run-tab-url-entry` on the wrapper, `run-tab-url-entry-input` on the input (AC15).

It lives in `layout/` because both consumers are layout components and it only emits an intent — it
does not read layout state.

### Task 24 — "URL…" in the `+` menu (AC1)

**File:** `packages/ui/src/layout/RunTabStrip.tsx`.

`RunAddMenu` gains a `MenuRow` labelled `URL…` with a `Globe` icon, placed directly under the
"New terminal" row and above the launch-config divider, testid `run-pane-open-url-${paneId}`.
Choosing it closes the popover and sets strip-local state that swaps the tab-pill row for
`<RunUrlEntry paneId={pane.id} onDone={…} />`. The entry sits **in the strip**, above the webview
region, so it is never occluded (spec edge case). Update the file's testid docblock.

Watch the 300-line cap: `RunTabStrip.tsx` is 210 lines and gains ~25. If it crosses 300, extract
`RunAddMenu` into `layout/RunAddMenu.tsx` in the same pass.

**Verify:** `vitest run src/layout/__tests__/RunTabStrip.test.tsx` still green (adjust it only if the
new row breaks an existing menu-shape assertion).

### Task 25 — "Open URL…" in the empty-state picker (AC2)

**File:** `packages/ui/src/layout/SurfacePicker.tsx`.

`RunPickerContent` gains a `PickerRow` labelled `Open URL…` with a `Globe` icon, testid
`run-picker-open-url`, above "New terminal". Choosing it replaces the row with `<RunUrlEntry onDone={…} />`
**in place** (no `paneId` — the surface has no pane yet), matching "reveals the same inline input in
place".

**Verify:** `vitest run src/layout/__tests__/SurfacePicker.test.tsx` still green.

### Task 26 — The chip's open control becomes a menu (D7, AC4)

**File:** `packages/ui/src/features/chat/smart-actions/UrlChip.tsx`.

Replace the single open button with a `DropdownMenu` (the existing shadcn primitive — it renders
through `[data-radix-popper-content-wrapper]`, which `usePreviewOcclusion` already covers, fact 11).
The trigger keeps `data-testid="smart-action-url-open"` and its dynamic `title`/`aria-label` so the
existing `url-chip.test.tsx` assertions on the trigger keep meaning. Rows, in order:

1. **Open in Mainframe** — testid `smart-action-url-open-in-app` — emits
   `{ type: 'open-url-tab', url: href }`. No tunnel logic here: the tab owns tunnelling, and the chip
   must not start one on this path.
2. **Open in browser** — testid `smart-action-url-open-browser` — calls the existing `open()` from
   `useUrlTunnel`, preserving today's behaviour exactly (local: direct open; remote: tunnel-then-open).

`badgeFor`, `busy`, and `smart-action-url-stop-tunnel` are unchanged. `busy` disables the trigger as
before. `UrlChip.tsx` must not import `layout/` — the intent bus is the boundary.

**Verify:** `vitest run src/features/chat/smart-actions/__tests__/url-chip.test.tsx` green (update it
to open the menu before asserting the browser-open behaviour).

---

## Group F — `test-ui` (behavioural coverage of the built UI)

All files here are **new**; the tasks above own every pre-existing test file they had to touch.
This group runs after `core`, `rust`, `ui-tab`, and `ui-entrypoints` — Task 31 verifies all four.

### Task 27 — URL tab body and instance

**Files (new):** `packages/ui/src/features/url-tab/__tests__/UrlTabBodyState.test.tsx`,
`packages/ui/src/features/url-tab/__tests__/UrlTabInstance.test.tsx`.

`UrlTabBodyState`: one case per `UrlTabTarget` variant — all seven — asserting the right testid
renders and that `rejected` and `invalid` show their text with **no** Retry while `failed` and
`stopped` show Retry.

`UrlTabInstance` (fake host adapter, `lib/host/fake-adapter.ts`): mounts the webview for a `direct`
target; renders **no** run/stop/restart control and no console drawer, and does render the address
bar, reload, open-in-browser, clear-cache, device toggle, inspect, and region-capture controls
(AC5); the root testid is `url-tab-instance-<tabId>`.

Two more `UrlTabInstance` cases, both regressions this plan's review caught:
- **The bar stays live with nothing mounted.** With the tunnel store seeded so the target resolves to
  `failed`, and again with a tab whose `url` is `''` (`invalid`), `preview-url-input` is **not**
  `disabled`; committing `localhost:5173` in it calls the mocked `setUrlTabTarget` once with the
  normalized URL and never calls `host.preview.mount` with the old value (spec §6, D9, AC14).
- **Adopting mid-start registers as an adopter.** With a `{ state: 'starting' }` entry already in
  `usePortTunnelsStore` for the port (the chat chip's start), mounting the tab still issues its
  `startPortTunnel` POST but registers with `started: false` — assert through the mocked
  `registerUrlTunnelConsumer`, then unmount the tab and assert `stopPortTunnel` was never called
  (D10, AC12). With no entry present at mount, the same tab registers `started: true`.
- **Retry re-requests.** With the target `failed` from an `{ state: 'error' }` entry, clicking
  `url-tab-retry` clears the entry from `usePortTunnelsStore` and issues exactly one
  `startPortTunnel` call (mock `lib/api/tunnel-ports`); with the target `stopped` (entry gone after
  one was seen), clicking it likewise issues one start (PD1, spec §7).

### Task 28 — Run surface renders the kind and scopes it

**File (new):** `packages/ui/src/layout/__tests__/RunSurface.url-tab.test.tsx`.

A `url` tab renders `UrlTabInstance` and never the `<kind>: <title>` placeholder (AC3); a `code` tab
still renders the placeholder; a URL tab stamped with scope A does not render under scope B and
disappears when that scope is released (AC13, mirroring `RunSurface.tab-scope.test.tsx`).

### Task 29 — Entry points

**Files (new):** `packages/ui/src/layout/__tests__/RunUrlEntry.test.tsx`,
`packages/ui/src/features/chat/smart-actions/__tests__/url-chip-menu.test.tsx`.

`RunUrlEntry`: committing `localhost:5173` emits one `open-url-tab` intent with
`http://localhost:5173/`; each of `''`, `'   '`, `'not a url'`, `'file:///etc/passwd'`,
`'javascript://x'` emits nothing and applies the invalid class; Escape emits nothing and calls
`onDone`.

`url-chip-menu`: the menu lists **Open in Mainframe above Open in browser** (assert DOM order, AC4);
"Open in Mainframe" emits the intent and does not call `startPortTunnel`; "Open in browser" still
calls the pre-existing opener.

### Task 30 — Creation path, dedup, and tunnel release through the stores

**File (new):** `packages/ui/src/store/__tests__/url-tab-intent-subscriber.test.ts`.

- Emitting `open-url-tab` twice for the same URL yields exactly **one** tab, active both times (AC4).
- Emitting it while Run is hidden lands the tab **and** places `run` in the layout (AC4's reveal).
- Closing a URL tab whose tunnel it started calls `stopPortTunnel` once with that port; closing one
  of two tabs sharing a port calls it zero times; closing a tab that adopted the chip's tunnel calls
  it zero times (AC12) — drive these through `useLayoutStore.closeRunTab` with the consumer registry
  seeded, mocking `lib/api/tunnel-ports`.
- `releaseRunScope` on a scope holding an exclusively-started tunnel stops it (spec edge case).

### Task 31 — Full verification sweep (AC18)

This task verifies the `rust` group's output as well as the TypeScript groups' — that is why `test-ui`
carries `rust` in `depends_on`. Run and record:
- `pnpm --filter @qlan-ro/mainframe-ui typecheck`
- `pnpm --filter @qlan-ro/mainframe-ui test` (full suite; if the known cross-file `React.act` batch
  failure appears, re-run the affected files individually and note it — do not "fix" it here)
- `cd packages/app-tauri/src-tauri && cargo check`
- confirm `git status` shows a `.changeset/*.md` and **no** change under `packages/core-rs/`,
  `packages/types/`, or `packages/mobile` (AC7's "the diff adds no route and changes no file under
  `packages/core-rs`")
- confirm every new interactive element carries a testid in the AC15 list and none is keyed by array
  index
- confirm no file added or modified exceeds 300 lines and no function exceeds 50 (AC17) — run it as
  `git diff --name-only main...HEAD -- '*.ts' '*.tsx' | xargs wc -l | sort -n`, and note that
  `store/layout.ts` entered this work at 317 lines and leaves it under 250 via Task 32

---

## Manual verification (not automatable — spec: the Tauri automation bridge stops answering once a
child webview exists)

Run `pnpm tauri:dev` from `packages/app-tauri` with an isolated `MAINFRAME_DATA_DIR` and
`DAEMON_PORT` (never the defaults — a stray launch hijacks the real `~/.mainframe`), then check:

1. With no launch config, `+` → **URL…** → `localhost:5173` renders the dev server (AC1).
2. Inspect and region capture deliver to chat from `http://localhost:5173/` and from a public
   `https://` site (AC11) — the two origins the old allowlist excluded.
3. On a remote daemon: a loopback URL on port 22 shows "Port must be 1024 or higher" and no request
   is made (AC10, checkable in the daemon log); an eligible port shows pending, then loads the tunnel
   origin **with the original path and query** (AC7); a second tab on that port loads with no pending
   (AC8).
4. Quit and relaunch: the tab is back with its title, loads on activation, and the address bar seeds
   with the typed URL — the stored value is never a tunnel URL (AC14). On a tunnelled tab the bar then
   follows the page to the tunnel origin once it loads (PD4); what persists is still `tab.url`.
5. In a tab left in the failure state, type a different URL into the address bar and press Enter: it
   loads, the tab's title follows, and the new URL survives a relaunch (spec §6, D9).

## Risks

- **Widening `remote.urls` is the one hard-to-reverse change.** Any `http`/`https` page a user opens
  can call the four bridge commands, including fabricating an inspect payload that reaches the
  agent's context. The spec accepted this at the design gate (D1); Task 14 records it in the
  capability description so it is not later rediscovered as a bug.
- **`RemoteUrlPattern` re-export.** Task 15 names a concrete fallback if the `tauri::utils` path does
  not resolve in this Tauri version.
- **The DNS gate depends on the daemon's `ready`-means-verified semantics** for the REST snapshot
  (fact 8). If that ever changes, an adopting tab could load an unresolvable name — the single
  automatic reload on `dns_verified` (Task 18) is the safety net, not the gate.
- **Retry mutates shared state.** `clearPortTunnelEntry` (PD2) is keyed by port, so one tab's Retry
  drops the badge every `UrlChip` on that port was showing. The guard is that it refuses a `ready`
  entry, so only a stale `error` or an abandoned `starting` is ever removed, and the next
  `tunnel:status` event restores the truth. If this proves confusing in use, the narrower fix is a
  per-consumer failure marker rather than re-narrowing Retry.
