# Run/terminal surface — app-tauri design

**Date:** 2026-06-13
**Branch:** `feat/app-tauri-wt`
**Status:** approved design → spec review (codex)
**Tracker:** `docs/architecture/MIGRATION-TRACKER.md` — Terminal section (lines 189–195, 293–295), step 9 (line 255), open decision 352.

## Summary

Build the Run surface's terminal content for `packages/app-tauri`: replace the
Electron node-pty + IPC backend with a **Tauri-layer Rust PTY** (`portable-pty`),
stream output to **xterm** over a **per-terminal raw `Channel`**, and model each
terminal as a `RunTab{kind:'terminal'}` in the **existing per-session Run pane
model** (no separate terminal store). This is the heaviest remaining Rust leaf of
the migration.

The Run pane layout engine, the surface rail gating, and the disabled "New
terminal" affordance already exist (built 2026-06-11). This work fills in the
**pane content** and the backend behind it — not the layout.

## Settled decisions

Three foundational decisions were confirmed in brainstorming:

1. **PTY backend location → Tauri-local Rust PTY.** A shell is an inherently
   local, desktop-only resource. The daemon WS/REST contract has no terminal
   channel and is mobile-co-owned (additive-only); putting PTY there would ship a
   local shell over the network at the wrong layer. Desktop puts node-pty in the
   Electron main process for the same reason. → new `src-tauri/src/terminal.rs`.

2. **Output transport → two per-terminal Tauri Channels (Path A).** PTY output
   streams as **raw bytes** via a raw `Channel` (Rust sends
   `InvokeResponseBody::Raw(Vec<u8>)`) so a UTF-8 character split across two PTY
   reads stays intact. A `Channel<T: Serialize>` serializes through serde → JSON,
   so `Data(Vec<u8>)` inside a typed enum becomes a JSON number array; that path
   is rejected because it would corrupt partial UTF-8 sequences. Exit events
   travel on a separate typed `Channel<ExitEvent>` (serde JSON is fine for a
   single small payload). Writes/resize/kill stay ordinary `invoke` commands.

   The JS bridge receives raw PTY output as `ArrayBuffer` and exit events as a
   typed JSON payload. A live encoding check (see Testing) verifies that data
   arrives as `ArrayBuffer`, not `number[]`, before the xterm wiring is merged.

3. **Tab state model → the `RunTab` is the terminal tab.** A terminal is a
   `RunTab{kind:'terminal'}` in the Run pane model. The layout store already
   provides per-session tab lists, the active tab, split-pane placement, and
   ephemeral-on-restart (it is in-memory; no `persist` middleware) for free.
   Desktop's separate `useTerminalStore` (`terminalsByScope`/cap) is **dropped**.

## Architecture & layering

Three independently testable layers:

```
features/terminal/  ──emit intent──▶  store/ subscriber  ──addRunTab──▶  layout store
   (xterm + cache       (new-terminal)    (resolve cwd, orchestrate)        (RunTab model)
    + cwd helper)              │
        │                      └── lib/tauri/terminal.ts ──invoke/Channel──▶ src-tauri/terminal.rs
        └── RunSurface mounts <TerminalInstance> for kind:'terminal' tabs        (portable-pty)
```

- No feature imports `layout/`. New-terminal is a **surface intent**, mirroring
  `open-file-picker`. The store-level subscriber (the sanctioned cross-store
  bridge, which already imports pure helpers from `features/`) does the
  orchestration.
- `lib/tauri/` stays the only Tauri-aware module.

### Reference (read-only — never edit `desktop/`)

- `packages/desktop/src/main/terminal-manager.ts` — node-pty backend being replaced.
- `packages/desktop/src/renderer/components/terminal/TerminalInstance.tsx` — xterm
  + FitAddon + the **module-level instance cache** pattern (ported).
- `packages/desktop/src/renderer/components/terminal/terminal-cwd.ts` — pure
  `resolveCwd` (ported verbatim).
- `packages/desktop/src/renderer/store/terminal.ts` — `useTerminalStore` (dropped,
  superseded by the Run pane model).

## Component 1 — Rust PTY backend (`src-tauri/src/terminal.rs`)

- **`TerminalManager`** — `Mutex<HashMap<String, Session>>` registered via
  `app.manage()` in `lib.rs::run()`/`setup`. The login-shell env already captured
  by `shell_env::resolve_shell_env_with_timeout()` is cloned into managed state so
  the PTY spawns with the user's real PATH — the same env the daemon receives, plus
  `TERM=xterm-256color`, `TERM_PROGRAM=Mainframe`, `ZSH_DOTENV_PROMPT=false`.
- **`Session`** holds the `portable-pty` master, a writer handle, and the child.
- **Commands** (`#[tauri::command]`, added to `generate_handler!` in `lib.rs`,
  re-exported through `commands/mod.rs` or a top-level `terminal` module):
  - `terminal_create(id: String, cwd: String, cols: u16, rows: u16, on_data: Channel, on_exit: Channel<ExitEvent>) -> Result<(), String>`
    - Validate `cwd` is a directory (mirrors desktop; reject otherwise).
    - Resolve the shell: `shell_env["SHELL"]` → `/bin/zsh` (unix) / `powershell.exe`
      (windows).
    - `PtySystem::openpty(PtySize{rows, cols, ..})`, build `CommandBuilder` with the
      merged env + `cwd`, `slave.spawn_command(cmd)`.
    - Insert the session into the manager keyed by `id`.
    - Spawn a dedicated **reader thread**: loop reading bytes from the master reader
      → `on_data.send(InvokeResponseBody::Raw(bytes))`; on EOF/child exit →
      `on_exit.send(ExitEvent { code })`, then remove the session.
  - `terminal_write(id, data: String)` → `writer.write_all(data.as_bytes())`.
  - `terminal_resize(id, cols, rows)` → `master.resize(PtySize{…})`.
  - `terminal_kill(id)` → `child.kill()`, drop the master (ends the reader), remove.
- **`kill_all()`** invoked from the existing `WindowEvent::Destroyed` handler in
  `lib.rs`, next to the daemon kill.
- **`ExitEvent`** — `#[derive(Serialize, Clone)] struct ExitEvent { code: Option<i32> }`.
  Sent on the typed `on_exit` channel when the child process ends.

## Component 2 — JS bridge (`lib/tauri/terminal.ts`)

A new sibling to `bridge.ts` (keeps `bridge.ts` under 300 lines).

```ts
interface TerminalHandle {
  write(data: string): Promise<void>;
  resize(cols: number, rows: number): Promise<void>;
  kill(): Promise<void>;
}
export function createTerminal(
  opts: { id: string; cwd: string; cols: number; rows: number },
  handlers: { onData: (bytes: Uint8Array) => void; onExit: (code: number | null) => void },
): Promise<TerminalHandle>;
```

- Constructs two Tauri Channels: a raw `Channel` (receives `ArrayBuffer` → wrapped
  as `Uint8Array` for `onData`) and a typed `Channel<ExitEvent>` (receives JSON →
  calls `onExit(event.code)`). Both channels and `{ id, cwd, cols, rows }` are
  passed to `invoke('terminal_create', { id, cwd, cols, rows, onData: rawChannel, onExit: exitChannel })`.
- `IS_TAURI`-guarded: in browser/dev mode `createTerminal` rejects (terminals need a
  real PTY; live-verify runs in the Tauri app via the MCP bridge). Tests mock this
  module.

## Component 3 — Terminal feature (`features/terminal/`)

- **`terminal-cache.ts`** — module-level `Map<id, CachedTerminal>` (ported from
  desktop). `getOrCreate(id)` builds an xterm `Terminal` + `FitAddon`, themed from
  app-tauri `mf-*` tokens, `open()`ed into a **detached wrapper** so it accepts
  writes before being attached. The xterm `onData` / `onResize` listeners are wired
  to the PTY handle **in `create-terminal.ts`** (not in `getOrCreate`) so the cache
  entry exists without a handle until the PTY is created. `disposeCachedTerminal(id)`
  tears it down — called whenever the terminal tab is removed from Run state: tab
  close, pane close, and Run surface toggle-off (never on component unmount, to
  preserve output).

  **Create-failure cleanup:** if `lib/tauri.createTerminal` rejects after
  `getOrCreate` has already inserted a cache entry, `create-terminal.ts` must call
  `disposeCachedTerminal(id)` in the catch path so no orphaned xterm entry remains.

- **`TerminalInstance.tsx`** — mounts the cached wrapper into the pane body, a
  debounced `ResizeObserver` drives `FitAddon.fit()`, re-fits on visibility change.
  Container carries `data-testid="run-terminal-{id}"`.
- **`terminal-cwd.ts`** — ported pure `resolveCwd(worktreePath → projectPath →
  homedir)`. When no project is active, the chain falls through to `homedir` as the
  final default (same fallback as desktop).
- **`create-terminal.ts`** — `createTerminalSession({cwd, cols, rows})`: generate the
  id, `getOrCreate` the xterm, call `lib/tauri.createTerminal` wiring `onData →
  cache.write` / `onExit → cache.write('[process exited]')`; on failure call
  `disposeCachedTerminal(id)` and re-throw. Return `{ id, title }`.
  Knows nothing about the layout store.

## Component 4 — UI integration & the new-terminal intent

- **`store/surface-intents.ts`** — extend the `SurfaceIntent` union with
  `{ type: 'new-terminal'; paneId?: string }`.
- **`store/` subscriber** (`subscribeToTerminalIntents`, mounted once alongside
  `subscribeToFileIntents`) — on `new-terminal`: read `useActiveBasesStore` +
  cached `getHomedir()`, `resolveCwd`, `await createTerminalSession(...)`, ensure the
  Run surface is active, then `useLayoutStore.getState().addRunTab({ id, kind:
  'terminal', title }, paneId?)`.
- **`RunSurface.tsx`** — the pane body renders `<TerminalInstance terminalId={tab.id}
  visible={…} />` for `kind:'terminal'` tabs; other kinds keep the placeholder.
- **`SurfacePicker.tsx`** — enable the `run-picker-new-terminal` row (drop `disabled`),
  emit `{type:'new-terminal'}`.
- **Pane tab strip** — add a `+` button (`data-testid="run-pane-new-terminal-{paneId}"`)
  emitting `{type:'new-terminal', paneId}`. Requires a small `addRunTab(tab,
  paneId?)` extension to target a specific pane (defaults to first pane).

## Lifecycle

| Event | Behavior |
|-------|----------|
| Create | PTY + cached xterm + `RunTab`; one shared id |
| Tab / session switch | xterm cached, PTY keeps running, output continues — **no kill on unmount** |
| Close tab | kill PTY + `disposeCachedTerminal` |
| Pane close (`closePane`) | kill PTY + `disposeCachedTerminal` for every `kind:'terminal'` tab in the removed pane — **v1 scope** |
| Toggle Run off (`toggleSurface`) | kill PTY + `disposeCachedTerminal` for every `kind:'terminal'` tab in `run` state — **v1 scope** |
| Process exits | dim `[process exited]` notice; tab stays until user closes it |
| App quit | `kill_all()` from `WindowEvent::Destroyed` |

**Known gap (logged, not v1):** deleting/archiving a session drops its Run workspace
without per-tab close, so its PTYs live until quit. A small orphan-reap follow-up.

The **v1 cleanup hook** (pane close + toggle-off) must be wired in the layout store's
`closePane` and `toggleSurface` actions: before writing the new state, collect all
removed `RunTab{kind:'terminal'}` ids, emit a `cleanup-terminals` intent (or call
`killAndDisposeCachedTerminals(ids)` directly from the subscriber if the architectural
boundary allows), and complete the state update. This is in scope for v1.

## Dependencies (lockfile trap respected)

- **Rust:** add `portable-pty` to `src-tauri/Cargo.toml`; `cargo build` (separate
  lockfile — no mobile-submodule risk).
- **JS:** `@xterm/xterm` + `@xterm/addon-fit` via the hide-mobile-`package.json` →
  `pnpm --filter app-tauri add -E <pkg>` → verify the lockfile diff is additive →
  restore the mobile `package.json`. **Never** `pnpm dlx shadcn add` or any
  workspace-re-resolving install on this branch.

## Testing (TDD — failing test first)

- **Rust unit tests:** `cwd` validation rejects non-directories; manager
  add/kill/kill_all; the reader thread forwards output then signals `ExitEvent` against
  a trivial child (`printf`/`echo`).
- **JS:** ported `resolveCwd` order tests (including no-active-project → homedir
  fallback); `terminal-cache` get/create/dispose; **create-failure cleanup**: assert
  `disposeCachedTerminal` is called when `lib/tauri.createTerminal` rejects; the
  new-terminal intent subscriber (mocked `lib/tauri/terminal`) asserts `addRunTab` is
  called with `kind:'terminal'` and the right cwd resolution order; `TerminalInstance`
  wiring (`onData → write`, channel raw bytes → `term.write`) with a mocked handle;
  **pane-close and toggle-off cleanup**: assert that all `kind:'terminal'` tabs in
  the closed pane/removed surface have their PTYs killed and cache entries disposed.
- **Channel encoding live check:** before merging the xterm wiring, add a single live
  Tauri test that opens a terminal, sends one byte, and asserts the JS side receives
  an `ArrayBuffer`, not a `number[]`. This catches any serde vs raw-channel
  misconfiguration that mocked unit tests cannot catch.
- **Live verify** in the Tauri app via the MCP bridge: open a terminal, type a
  command, assert echoed output (caught the dead-LSP bugs unit tests missed last
  session because they mocked readiness).

## Scope

**In:** local zsh/pwsh terminals in Run panes (single + split), create/write/resize/
kill, output preservation across switches, cwd from the active session, theme +
data-testids, drop the obsolete tool-windows terminal registration (never existed in
app-tauri — satisfied by building on the Run surface), pane-close and toggle-off
PTY cleanup.

**Out (separate tracker leaves):** Sandbox preview tab + capture-to-chat, multi-window
state sync, the orphan-PTY reap on session delete/archive, packaging the PTY into a
release build (the sidecar/native-deps packaging leaf — `portable-pty` is statically
linked into the Tauri binary, so unlike node-pty it needs no separate bundling, but
release-build verification is deferred to that leaf).

## Definition of done

Typecheck + tests green · matches the Run artboard chrome (`04-engine.jsx`) ·
data-testids present · no `getState()` reach-through from features · files < 300
lines, functions < 50 · `useTerminalStore`/zone registration dropped · tracker
updated · Channel encoding live check passes · pane-close and toggle-off cleanup
wired.

## Key file map

- **New:** `src-tauri/src/terminal.rs`, `lib/tauri/terminal.ts`,
  `features/terminal/{terminal-cache.ts,TerminalInstance.tsx,terminal-cwd.ts,create-terminal.ts}`,
  `store/terminal-intent-subscriber.ts` (or extend `intent-subscriber.ts`).
- **Edit:** `src-tauri/src/lib.rs` (manage state + register commands + kill_all),
  `src-tauri/Cargo.toml`, `src/layout/surfaces/RunSurface.tsx`,
  `src/layout/SurfacePicker.tsx`, `src/store/surface-intents.ts`,
  `src/store/layout.ts` (`addRunTab` pane-targeting + terminal cleanup in `closePane`/`toggleSurface`), `package.json`.
- **Reference (read-only):** `packages/desktop/src/main/terminal-manager.ts`,
  `packages/desktop/src/renderer/components/terminal/*`,
  `packages/desktop/src/renderer/store/terminal.ts`.
