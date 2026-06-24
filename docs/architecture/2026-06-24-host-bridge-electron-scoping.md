# Host Bridge Plan 2 — Electron Adapter + `desktop` Retrofit Scoping

- **Date:** 2026-06-24
- **Status:** Scoping (informs the Plan 2 implementation plan)
- **Parent:** [`2026-06-24-host-bridge-abstraction-design.md`](./2026-06-24-host-bridge-abstraction-design.md) (Phase 4). Plan 1 (foundation) is complete: `HostBridge` port + `TauriAdapter` + `FakeHostBridge`, commits `1aafe62f..4dccdfcf`.

Goal of Plan 2: build an **Electron adapter** for the `HostBridge` port and **retrofit `packages/desktop`** to host the NEW app-tauri renderer, so the same renderer runs on Electron/Chromium — enabling an A/B against Tauri/WebKit without a UI rewrite.

## Locked decisions (from review of the seams)

- **Preview: adopt the `preview.mount(container, url, opts)` reshape** (replaces the Plan-1 imperative `PreviewPort`). Required, not optional — the Plan-1 `PreviewPort` carries no `projectId`, so Electron's per-project `persist:sandbox-{projectId}` partition isolation is otherwise inexpressible. Touches the contract + `PreviewInstance` + the 4 `use-preview-*` hooks; the Tauri adapter must stay green.
- **Terminal: send bytes over IPC** (`Buffer`/`Uint8Array`), not `string` — avoids the UTF-8-split-across-reads corruption the Tauri side guards against. The Electron adapter still demuxes the global `terminal:data(id,…)`/`terminal:exit(id,…)` events into per-handle `onData(Uint8Array)`/`onExit` callbacks.
- **Zod contract lives in `mainframe-types`** (`host/host-contract.ts`); add `zod` as a dependency of `mainframe-types` (currently dep-free; `@qlan-ro/mainframe-core` already uses `zod ^4.4.3`). Rust validates via serde against the documented contract (no shared code across languages).
- **Electron CSP via runtime header injection** (`session…onHeadersReceived`) allowing `http://127.0.0.1:31415` + `ws://127.0.0.1:31415`, not a per-host renderer-build fork. (app-tauri's `index.html` carries no CSP meta; Tauri injects it from `tauri.conf.json` hardcoded to 31500.)

## Seam findings (file:line evidence)

### 1. `desktop/main` separability — EASY, low risk
- `packages/desktop/src/main/index.ts` imports only its own `./*` siblings + Electron; **zero imports from `src/renderer/`**. Renderer loaded purely by URL/file: `index.ts:249-253` (`loadURL(ELECTRON_RENDERER_URL)` dev / `loadFile('../renderer/index.html')` prod). Wiring in `electron.vite.config.ts:48-65`.
- **Build:** point at app-tauri renderer — dev `http://localhost:5174` (app-tauri `vite.config.ts:19`, `strictPort`), prod `packages/app-tauri/dist/index.html` (electron-builder `files`/`extraResources` must include it). **Recommended:** consume app-tauri's own Vite build (URL + `dist`), don't fold app-tauri's source into desktop's electron-vite. Beware the IPv6/`localhost` trap (vite v6 binds `::1`; `useConnectionState.ts:22` polls `127.0.0.1`).

### 2. Preload vs `HostBridge` contract — MEDIUM
Existing (`packages/desktop/src/preload/index.ts` + `main/index.ts`): `app.getInfo` (`app:getInfo` — **missing `homedir`**), `app.getHomedir`, `fs.readFile`, `fs.showItemInFolder`, `shell.openExternal`, `notify`, `terminal.*` (shape mismatch — below), `log` (→ `logFromRenderer` → pino daily file; **already matches the spec logging target**).
Missing / net-new: `app.getAuthToken` (read `~/.mainframe/config.json` `authSecret`; `fs:readFile` already whitelists `~/.mainframe`), `fs.readFileBase64`, `app.platform()` (map `darwin→macos`/`win32→windows`, return `Promise<Platform>`), the `daemon.*` surface (Seam 6), the `preview` surface (Seam 3).
**Terminal mismatch:** main generates the id (`terminal-manager.ts:38` `randomUUID()`), emits global `terminal:data`/`terminal:exit` keyed by id carrying `string` (`terminal-manager.ts:53,63`; `preload:64-77`). Contract wants caller-supplied `TerminalOpts{id,…}` + `handlers{onData(Uint8Array),onExit}` → `TerminalHandle`. Adapter must thread/track the id, demux global events per-handle, and (per locked decision) main sends bytes.

### 3. Preview seam — HARD (riskiest)
- Tauri: renderer reserves a DOM rect (`PreviewInstance.tsx:36-37,147`); Rust overlays a native WKWebView. Hooks: `use-preview-lifecycle.ts:46-53` (create/navigate/destroy), `use-preview-geometry.ts:36-38` (setBounds, rAF-coalesced, fires often), `use-preview-visibility.ts:47` + `use-preview-occlusion.ts` (setVisible(false) when DOM overlaps the OS-composited layer), `use-preview-capture.ts:40,69,97` (capture→PNG, eval picker, onInspectResult event).
- Legacy Electron: in-DOM `<webview>` (`renderer/components/sandbox/PreviewTab.tsx:639`), `partition="persist:sandbox-{projectId}"` (`:643`), `loadURL` (`:282`), `executeJavaScript(INSPECT_SCRIPT)` resolving the pick **inline** (`:49-99,399`), `capturePage(cropRect)`→`toDataURL` (`:332,352,413`) with `scaleCropRect` DPR (`:125-132`); guest teardown via `webview:destroy` (`main/index.ts:145`) + `sandbox.ts` partitions.
- **`preview.mount(container,url,{projectId})` → `PreviewHandle`** {setVisible, navigate, capture(region?)→Uint8Array, onInspect(cb)→Unsubscribe, destroy}. Tauri adapter: read `container.getBoundingClientRect()`, drive the native webview as today (ignore the element). Electron adapter: append a fixed-positioned `<webview partition="persist:sandbox-{projectId}">` into `container`, `capturePage`+`scaleCropRect`, `executeJavaScript` for eval, bridge the inline picker promise → `onInspect` callbacks.
- **Divergences to spec in the PreviewHandle contract:** OS-overlay (Tauri, composites above DOM → needs occlusion blanking) vs DOM-overlay (Electron, natural stacking → setVisible-on-occlusion may be a no-op but must be tolerated); capture region coordinate space (CSS px vs device px) + who applies DPR; `clearSession(projectId)` → existing Electron `sandbox:clearSession` (`main/index.ts:155`), new Rust command on Tauri (Plan 3 gap — for Plan 2, Tauri `clearSession` may be a documented no-op/stub).

### 4. Zod contract — EASY (decision made)
`packages/types` dep-free today; `mainframe-core` has `zod ^4.4.3`. Add `host/host-contract.ts` with schemas for every command payload/event + `DaemonStatus`/`Platform` enums. Validate in Electron `ipcMain.handle` args. Rust conforms via serde to the documented contract.

### 5. Build / CSP / dev-server — MEDIUM
app-tauri Vite: port 5174 strictPort, `envPrefix ['VITE_','TAURI_ENV_*']`, build target `safari13` on non-Windows (Chromium can target `chrome*`). Tauri CSP hardcoded to 31500 in `tauri.conf.json`; app-tauri `index.html` has no CSP meta. Electron needs runtime CSP for `127.0.0.1:31415` + ws, `img-src blob:`, `'unsafe-inline'` styles.

### 6. Daemon spawn divergence — EASY–MEDIUM
Electron: `utilityProcess.fork(daemon.cjs)` on 31415 (`main/index.ts:99`); **no renderer-facing daemon-status IPC** (legacy read the port from Vite env: `client.ts:13`, `lib/api/http.ts:2`). New renderer requires `host.daemon.port()/status()/onStatus()` (`useConnectionState.ts:90-91,110`). Add: `daemon:port` (trivial — main owns it), `daemon:status` (main tracks `'initializing'`/`'ready'`/… ; derive `'ready'` from utilityProcess `spawn` or first `/health`), `daemon:onStatus` (new event channel). Define the `DaemonStatus` vocabulary in the contract (Seam 4) so both hosts emit the same values.

## Proposed Plan 2 task breakdown (riskiest: #7+#8)

1. Repoint `desktop` at the app-tauri renderer (dev `:5174` URL + prod `dist`); leave legacy renderer build in place. (Seam 1)
2. Land Zod `host-contract.ts` in `mainframe-types` (+ `zod` dep); schemas + `DaemonStatus`/`Platform` enums. (Seam 4)
3. Extend Electron preload/main with trivial channels: `app:getAuthToken`, `fs:readFileBase64`, `app:getInfo`+homedir; Zod-validate every `ipcMain.handle`. (Seam 2)
4. Add daemon-status IPC to Electron main + preload (`daemon:port`/`:status`/`:onStatus` + status tracker). (Seam 6)
5. Build `electron-adapter.ts` (HostBridge over `window.mainframe.*`): terminal demux + byte translation, `platform` mapping, app/fs/shell/notify/daemon/log. (Seams 2/6)
6. Add the Electron `getHost()` branch + window-drag: detect `window.mainframe` → `ElectronAdapter`; generalize `main.tsx`'s `init()` gating; rename `data-tauri-drag-region`→`data-drag-region` (3 components) + Electron `-webkit-app-region: drag` CSS. (Seams 1/2)
7. Reshape the contract to `preview.mount()` + refactor `PreviewInstance` + 4 `use-preview-*` hooks onto a `PreviewHandle`; keep the Tauri adapter green. (Seam 3 — HARD)
8. Implement `ElectronHostBridge.preview` via injected `<webview>` (partition, `capturePage`+`scaleCropRect`, `executeJavaScript`, inline-picker→`onInspect` bridge, `clearSession`→`sandbox:clearSession`). (Seam 3 — HARD)
9. Electron CSP (runtime header, 31415) + Chromium build target. (Seam 5)
10. A/B verification + legacy `desktop/src/renderer` deletion (Phase 6 cleanup).

## Cross-cutting notes for the planner
- The `VITE_DAEMON_*` build-time port path is DEAD under the retrofit — port/auth flow through the adapter at runtime.
- `app.getInfo` on Electron lacks `homedir` (contract `AppInfo` includes it) — fold `getHomedir` in or extend the IPC.
- Logging bridge already done on Electron; Tauri-side log sink is Plan 3, not here.
- Plan 1's deferred Minors that intersect: `FakeHostOverrides` lacks `shell/notify/log/showItemInFolder` slots; `bridge.ts` duplicate `AppInfo`/`LogLevel`. Address opportunistically where Plan 2 touches them.
