# Host Bridge Abstraction — Design

- **Date:** 2026-06-24
- **Status:** Approved (brainstorm) — pending implementation plan
- **Scope:** The native host layer only (`app-tauri/src-tauri` ↔ `desktop/main`+`preload`) and the renderer-side bridge that calls into it. The React renderer's feature code is in scope only where it directly couples to a host mechanism (preview webview, window drag).
- **Related:** [`MIGRATION-INDEX.md`](./MIGRATION-INDEX.md), [`2026-06-04-app-tauri-architecture.md`](./2026-06-04-app-tauri-architecture.md), [`2026-06-13-run-terminal-design.md`](./2026-06-13-run-terminal-design.md), [`FS-PATH-CONTRACT.md`](./FS-PATH-CONTRACT.md)

## Why

The app-tauri renderer is hardwired to Tauri: it imports `@/lib/tauri/{bridge,preview,terminal}` and calls `invoke()` directly. The Electron host (`packages/desktop/src/main` + `preload`) exposes the same class of capabilities through a completely different shape — a `window.mainframe.*` global. The two host layers diverge **structurally**, not just in implementation: different naming (`shell:openExternal` vs `openExternal`), different event delivery (IPC events vs Tauri Channels/`listen`), and in one case a different UI primitive (`<webview>` tag vs native child webview). There is **no shared contract** in `@qlan-ro/mainframe-types`; each side invented its own surface.

WebKit rendering problems in the Tauri webview have raised the question of returning to Electron (Chromium). Today that would mean re-coupling the UI to a second host. This design removes the coupling so the **same renderer runs on either host**, making the host a swappable decision rather than a rewrite — and letting us A/B Chromium vs WebKit directly.

The actual product engine — the Node daemon `@qlan-ro/mainframe-core` — is shared and untouched by host choice. Only the thin native shim differs. This design formalizes that shim.

## Goals

1. One renderer-facing interface (`HostBridge`) shaped around **renderer needs**, not around either host's mechanism.
2. Two runtime implementations (adapters): Tauri and Electron, both satisfying one Zod-validated contract.
3. The new app-tauri renderer runs unmodified under **either** host (A/B-capable).
4. Host becomes mockable in tests via a `FakeHostBridge`.
5. Reach **full host parity — no deferred items.** Every capability either flows through `HostBridge` or is matched in both native shells: auto-update, device idle/activity reporting, native application menu, the renderer→host logging bridge, crash/memory diagnostics, sandbox session isolation (`clearSession`), daemon auth-token access, and Tauri daemon/sidecar **production bundling** (see [parity matrix](#appendix-host-parity-matrix)).

## Parity principle

Where a capability exists on desktop (Electron) but not on Tauri, we **port the behavior, not a stub.** The Tauri implementation must reproduce desktop's *observable result*: same file locations and formats, same rotation/retention, same level/semantics, same user-visible effect. The mechanism may differ to suit the Rust host (e.g., a Rust logging sink, or forwarding to the shared daemon's existing pino), but the result must be indistinguishable from desktop. "Done" for any ported feature is a test or manual check confirming the desktop result is matched — not merely that the port-level method exists.

## Constraints & Non-Goals

Per the directive that **no host capability is out of scope**, the items below are hard constraints or anti-goals — not declined work.

- **Constraint (not a scope choice):** the **native** implementations cannot share a code-level interface — they are different languages (Rust vs TypeScript). They share the documented Zod contract instead. This is the one boundary that stays two codebases by necessity.
- **Anti-goal:** reviving the legacy `packages/desktop/src/renderer` UI. The Electron shell hosts the **new** renderer; retiring the legacy renderer is the point of the migration, not a regression.
- **Lowest-priority cleanup (in scope, done last):** renaming `packages/app-tauri` to a host-neutral name now that it is host-agnostic. Cosmetic; sequenced after everything functional.

## Current State (evidence)

- Renderer→host coupling is **concentrated**: 3 modules (`bridge.ts`, `preview.ts`, `terminal.ts`) and ~23 import sites (15 × `bridge`, 7 × `preview`, 1 × `terminal`).
- **No `@tauri-apps/api` imports leak outside `lib/tauri/`** — the renderer is already cleanly decoupled at the import boundary.
- Window-drag leaks as a `data-tauri-drag-region` attribute in 3 components (`MainToolbar`, `SidebarHeader`, `ChatCardHeader`); the handler is centralized in `bridge.ts`.
- Preview already uses the right seam: `PreviewInstance` reserves a DOM rect via `containerRef`; the native webview is overlaid onto that rect and hidden when a DOM overlay covers it.
- Electron host (`desktop/main`) already implements terminal, sandbox session partitions, `openExternal`, `electron-updater`, idle reporting, and daemon spawn — ~90% of what the Electron adapter needs.

## Architecture

```
packages/types/src/host/            ← CONTRACT (canonical, shared)
  host-bridge.ts                     ← HostBridge interface (type-only)
  host-contract.ts                   ← Zod schemas for every command payload + event

packages/app-tauri/src/lib/host/     ← renderer-side port + adapters (renderer stays host-agnostic)
  index.ts                           ← getHost() + runtime detection + React context/provider
  tauri-adapter.ts                   ← wraps invoke()/listen/Channel (absorbs today's lib/tauri/*)
  electron-adapter.ts                ← wraps window.mainframe.*
  fake-adapter.ts                    ← in-memory implementation for tests

packages/desktop/                     ← RETROFIT: main + preload kept; legacy renderer dropped;
                                         loadURL/loadFile points at app-tauri's built renderer
```

The `HostBridge` interface is the single shared abstraction (one TS type used by the renderer and both adapters). The two native shells (`src-tauri` in Rust, `desktop/main` in TS) remain separate codebases but both conform to the same Zod contract, so they stop drifting.

### Layer boundary

| Layer | Shared as an interface? | Mechanism |
|---|---|---|
| Renderer → host (TS) | **Yes** — `HostBridge` + 2 TS adapters | One interface, two implementations |
| Native host impl | **No** — different languages | Both satisfy one Zod contract (`host-contract.ts`) |

## The `HostBridge` port

Need-shaped. Events are subscription functions returning an `Unsubscribe`, so Channels-vs-IPC stays inside the adapter. (Illustrative; exact member list finalized in the plan.)

```ts
type Unsubscribe = () => void

interface HostBridge {
  app:      { getInfo(): Promise<AppInfo>; getHomedir(): Promise<string>; platform(): Platform
              getAuthToken(): Promise<string | null> }
  fs:       { readFile(p: string): Promise<string | null>
              readFileBase64(p: string): Promise<string | null>
              showItemInFolder(p: string): Promise<void> }
  shell:    { openExternal(url: string): Promise<void> }
  notify:   (title: string, body?: string) => Promise<void>
  terminal: { create(opts: TerminalOpts): Promise<{ id: string }>
              write(id: string, data: string): Promise<void>
              resize(id: string, cols: number, rows: number): Promise<void>
              kill(id: string): Promise<void>
              onData(cb: (id: string, data: Uint8Array) => void): Unsubscribe
              onExit(cb: (id: string, code: number | null) => void): Unsubscribe }
  preview:  { mount(container: HTMLElement, url: string, opts?: PreviewOpts): PreviewHandle
              // opts.projectId selects the persistent session partition
              // PreviewHandle: setVisible, navigate, capture(region?) => Promise<Uint8Array>,
              //               onInspect(cb) => Unsubscribe, destroy()
              clearSession(projectId: string): Promise<void> }
  updates:  { check(): Promise<UpdateStatus>; download(): Promise<void>; install(): void
              onStatus(cb: (s: UpdateStatus) => void): Unsubscribe }
  window:   { startDrag(target: HTMLElement): void }
  daemon:   { port(): Promise<number>; status(): Promise<DaemonStatus>
              onStatus(cb: (s: DaemonStatus) => void): Unsubscribe }
  presence: { reportActivity(state: 'active' | 'idle'): Promise<void> }
  log:      (level: LogLevel, module: string, message: string, data?: unknown) => void
}
```

`getHost()` detects the runtime (`window.__TAURI_INTERNALS__` present → Tauri; `window.mainframe` present → Electron; neither → Fake/browser-dev) and returns the matching adapter, exposed to React through a provider so feature code never imports an adapter directly.

## The contract (`host-contract.ts`)

Zod schemas for every command's input/output and every event payload. Purpose:

- The native shells validate against it (the Tauri commands and the Electron `ipcMain` handlers each parse with the shared schema — satisfying the project's "Zod on every endpoint" rule).
- Adapter unit tests assert the adapter produces/consumes contract-shaped values.
- One source of truth for payload shapes, replacing the per-side ad-hoc types.

## Adapters and the hard seams

| Capability | Tauri adapter | Electron adapter | Notes |
|---|---|---|---|
| app / fs / shell / notify | `invoke()` + opener/notification plugins | `window.mainframe.*` | trivial; both exist |
| terminal | Tauri `Channel` | IPC `terminal:data`/`exit` events | identical port shape |
| **preview** | position native child webview to the container's rect; `preview_capture` | inject `<webview partition="persist:sandbox-…">` into the container; `webContents.capturePage` | the real seam — hidden behind `preview.mount()` |
| **window drag** | mousedown → `startDragging()` | CSS `-webkit-app-region: drag` via class | rename attribute to neutral `data-drag-region`; each adapter wires its mechanism |
| updates | `tauri-plugin-updater` (**to add**) | `electron-updater` (exists) | closes a Tauri gap |
| presence | report from renderer, or a Rust `powerMonitor` equivalent (**to add**) | existing `idle-reporter` | closes a Tauri gap |
| daemon status | `get_daemon_port`/`get_daemon_status` + `daemon:status` | derive from spawn + a new IPC channel | Electron currently has no renderer-facing daemon status; add one |
| renderer logging | `host.log` → host writes same rotating file/format/retention as desktop (see seam) | `host.log` → `window.mainframe.log` → pino | result must match desktop, not just exist |
| sandbox session clear | `preview.clearSession` → new Rust command | `clearSandboxSession` (exists) | per-project session isolation |
| auth token | `get_auth_token` (exists) | read `config.json` via existing readFile, or a dedicated channel | `app.getAuthToken()` |

### Native-shell parity (contract/config, not renderer-facing)

These have no renderer API but must reach 1:1 between the shells; each is validated against the contract or the shell config where applicable.

- **Native application menu** — add to the Tauri shell (Tauri `Menu`/`MenuItem`), including the "Check for Updates" item once the updater lands. Electron already has one.
- **Crash & memory diagnostics** — add a Tauri equivalent of Electron's `render-process-gone` logging and `getAppMetrics` memory polling (webview crash + RSS sampling on the Rust side).
- **Webview permission handler** — align the Tauri capability set / WKWebView permissions with Electron's "deny camera/mic, allow clipboard/notifications" policy.
- **open-external scheme allowlist** — normalize one allowlist in the contract (`http/https` + the IDE/app schemes Electron permits: `vscode`, `jetbrains`, `zed`, `slack`, `linear`, `notion`, `figma`, …) and enforce it in both shells.
- **Daemon/sidecar production bundling (Tauri)** — wire `externalBin`/`resources` in `tauri.conf.json` so a packaged Tauri build ships `daemon` + `better-sqlite3`/`node-pty` (ABI-rebuilt), `@vscode/ripgrep`, `typescript-language-server`, and `pyright` — matching Electron's `extraResources`. This is the current Tauri shipping blocker.

### Seam detail: preview

`preview.mount(container, url)` returns a `PreviewHandle`. The renderer keeps doing what it does today — reserve a rect, observe overlaps, request captures — and never learns which mechanism backs it:

- **Tauri:** create/position a native child webview to `container.getBoundingClientRect()`; reposition on resize/scroll; `capture()` → `preview_capture` PNG (macOS).
- **Electron:** create a `<webview>` element inside `container` with the per-project `persist:sandbox-{projectId}` partition; `capture()` → `webContents.capturePage()`. Screenshot capture is, if anything, simpler in Electron.

`PreviewInstance` switches from importing `@/lib/tauri/preview` to calling `host.preview.mount(...)`. The overlap-hiding logic stays in the renderer; only the backing call changes.

### Seam detail: logging (host log bridge)

**Target — must match desktop exactly** (`packages/desktop/src/main/logger.ts`): desktop routes main *and* renderer logs through pino into a daily-rotated file `${MAINFRAME_DATA_DIR ?? ~/.mainframe}/logs/desktop-app.YYYY-MM-DD.log` — JSON lines, level uppercased, `module` child field, ISO timestamp, `pid` base, **7-day retention** (purge by mtime), **unbuffered** writes (`minLength: 0`, crash-safe), and in dev also mirrored to stdout. `window.mainframe.log(level, module, message, data?)` feeds that same file via `logFromRenderer`.

**Tauri must produce the same result, by whatever mechanism fits the Rust host.** `host.log(...)` carries renderer logs to the host, which writes them — together with host-side logs — to an equivalent daily-rotated, 7-day-retained, pino-compatible JSON-lines file under the same `~/.mainframe/logs/` directory, unbuffered, mirrored to stdout in dev. Two candidate mechanisms (chosen in the plan):

- **Rust sink** — `tracing` + `tracing-appender` daily rotation with a JSON formatter matching pino's field shape, plus a retention purge.
- **Forward to the daemon's pino** — hand log records to the shared daemon (which already runs pino with rotation) over its existing channel, writing an app log of identical format. Reuses pino directly; cleanest format match.

Acceptance: launch Tauri, emit a log at each level from the renderer, and confirm a file appears under `~/.mainframe/logs/` with the same naming convention, JSON shape, level/module tagging, rotation, and 7-day retention as desktop's `desktop-app.*.log`.

### Seam detail: window drag

Rename `data-tauri-drag-region` → `data-drag-region` in the 3 components. The Tauri adapter keeps the existing mousedown→`startDragging` handler keyed on the neutral attribute; the Electron adapter applies `-webkit-app-region: drag` (a no-op `startDrag`, handled by CSS targeting `[data-drag-region]`).

## The Electron shell (retrofit `packages/desktop`)

- Keep `desktop/src/main` and `desktop/src/preload`. Drop `desktop/src/renderer`.
- Point the window's `loadURL`/`loadFile` at app-tauri's built renderer (dev: app-tauri's Vite server; prod: app-tauri's `dist`).
- Extend the preload to expose exactly the contract surface the new renderer needs (it already exposes most of it). Add the few missing channels (e.g., daemon status, presence already exists internally).
- Reuse the existing daemon spawn, sandbox partitions, updater, and idle reporter as the Electron adapter's backing.

This is the least-new-code path. Trade-off: the `desktop` package temporarily contains both the retired legacy renderer (until deleted) and the retrofit shell; cleanup is part of the plan.

## Testing

- **`FakeHostBridge`** — in-memory implementation so every renderer feature test runs without a real host (resolves the cross-file pollution / Tauri-mocking friction noted in the migration memory).
- **Contract tests** — assert each adapter's calls and parsed responses conform to the Zod schemas.
- **Native conformance** — the Tauri commands and Electron IPC handlers parse inputs with the shared Zod schemas; a test feeds contract fixtures to each.
- Existing app-tauri suites are migrated to inject `FakeHostBridge` via the provider.

## Phasing

1. **Contract + port.** Land `HostBridge` + Zod schemas in `mainframe-types`; add `getHost()` + provider in app-tauri. No behavior change.
2. **Tauri adapter + refactor.** Move `lib/tauri/*` behind `tauri-adapter.ts`; refactor the ~23 call sites + the preview/drag seams to the port. Renderer behavior unchanged on Tauri.
3. **Fake adapter + test migration.** Add `FakeHostBridge`; migrate feature tests.
4. **Electron adapter + shell retrofit.** Build `electron-adapter.ts`; retrofit `desktop` to load the new renderer; route logging (`host.log`), auth-token, and sandbox `clearSession` through the port on both hosts.
5. **Full host parity.** Close every remaining gap so the two hosts are 1:1: add `tauri-plugin-updater`; add the Tauri presence reporter, renderer log sink, native menu, and crash/memory diagnostics; align the webview permission handler and the open-external scheme allowlist; and wire Tauri daemon/sidecar **production bundling** (externalBin/resources + native-module ABI rebuild).
6. **A/B + cleanup.** Same renderer, two binaries; compare Chromium vs WebKit. Delete the legacy renderer; optionally rename `app-tauri` to a host-neutral name.

Each phase is independently shippable; phases 1–3 deliver value (drift killed, renderer testable) even before the Electron adapter exists.

## Risks & open questions

- **Preview parity across hosts.** The native-overlay (Tauri) vs in-DOM `<webview>` (Electron) models differ in z-index/scroll/DPR behavior. The `PreviewHandle` contract must be defined against renderer needs precisely enough that both satisfy it; element-picker/inspect and capture semantics need explicit specs. *Highest-risk seam.*
- **`desktop` entanglement.** Retrofitting assumes `desktop/main` is cleanly separable from its legacy renderer. The plan's first Electron-phase task is to confirm this and extract if needed.
- **DPR / capture format.** Capture returns `Uint8Array` PNG; both hosts must agree on scale handling so annotations line up.
- **Build/CSP divergence.** app-tauri's Vite/CSP config assumes Tauri; the Electron shell needs its own CSP (daemon host:port) and dev-server wiring. Mechanical but must be enumerated.
- **Daemon port divergence** (Tauri 31500 vs Electron 31415) — the renderer must read the port via `host.daemon.port()`, never hardcode.

## Success criteria

- The app-tauri renderer imports nothing from `@tauri-apps/*` and nothing from `window.mainframe`; it uses only `getHost()`.
- `HostBridge` + Zod contract live in `mainframe-types` and are the only host-shape source.
- Both adapters pass contract tests; renderer feature tests run on `FakeHostBridge`.
- The same renderer build launches and functions under both the Tauri binary and the retrofit Electron binary.
- **Full parity:** every row in the matrix below reads ✅ on both hosts — auto-update, idle/activity, native menu, renderer logging bridge, crash/memory diagnostics, sandbox session isolation, auth-token access, aligned permission/scheme policies, and a packaged Tauri build that bundles the daemon + native modules + ripgrep + LSP servers.

## Appendix: host parity matrix

Condensed from the 2026-06-24 host-layer comparison. 🔴 = real gap, 🟡 = minor/diagnostic, ✅ = parity, ➕ = host-only extra.

| Capability | Electron | Tauri | Under this design |
|---|---|---|---|
| Daemon spawn/supervise | ✅ `utilityProcess` (31415) | ✅ Rust sidecar (31500) | port via `daemon.port()` |
| Shell-env capture | ✅ | ✅ | unchanged |
| Terminal/PTY | ✅ node-pty | ✅ portable-pty | `terminal.*` |
| File read (text/base64) | text only | text + base64 ➕ | `fs.*` (both) |
| open-external | ✅ broad scheme allowlist | http/https only | normalize allowlist in contract |
| Notifications | ✅ +click-focus | ✅ | `notify` |
| Preview/sandbox webview | `<webview>`+partitions | native child webview + capture/inspect ➕ | `preview.mount()` seam |
| Auto-update | ✅ electron-updater | 🔴 none | add `tauri-plugin-updater` |
| Idle/activity reporting | ✅ | 🔴 none | add Tauri `presence` |
| Renderer→host log bridge | ✅ pino daily file, 7-day retention | 🔴 stdout only | `host.log` → same file/format/retention (see seam) |
| Sandbox session isolation | ✅ partitions + clear | 🟡 no clear | `preview.clearSession` |
| Auth-token access | via readFile | ✅ `get_auth_token` | `app.getAuthToken()` |
| Native menu | ✅ | 🔴 none | **add to Tauri shell** |
| Renderer mem / crash logging | ✅ | 🔴 none | **add to Tauri shell** |
| Daemon/sidecar prod bundling | ✅ extraResources | 🔴 not wired | **wire Tauri externalBin/resources** |
