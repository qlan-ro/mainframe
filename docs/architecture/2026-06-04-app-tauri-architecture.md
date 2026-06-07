# `packages/app-tauri` — Proposed Folder Architecture

**Status:** Proposed (2026-06-04) — **⚠ PARTIALLY SUPERSEDED.** The folder tree + principles remain the target, BUT: the **runtime is NOT AssistantTransport** — it is `useExternalStoreRuntime` + a per-chat controller/reducer/projection (see `2026-06-05-chat-runtime-decision.md`). Read every "AssistantTransport" mention below as "ExternalStore controller seam." `convert-message` invariants are **load-bearing — keep them**. Pure logic goes to a **shared bundleable location (TBD)**, not the `mainframe-core` sidecar.

**Realized as of 2026-06-07:** the **Chat** and **Sessions** surfaces are BUILT + design-conformed. Sessions live under `features/sessions/` (NOT `features/chat/sessions/`) with `runtime/ · sidebar/ · tags/ · filter/ · new-thread/ · view-model/ · ws/`. Everything else in the tree below (`editor/ · viewers/ · terminal/ · settings/ · tasks/ · git/ · tags/(run-side) · review/ · plugins/ · preview/`, the typed-surface `layout/` engine, the surface rail, and the `lib/tauri/` bridge) is still **proposed / not built**.

Target: a new package in the existing pnpm monorepo. Tauri 2 shell + React 19 renderer.
Reuses `@qlan-ro/mainframe-types`; consumes `mainframe-core` as a compiled sidecar (Phase 1),
to be replaced by a Rust daemon behind a frozen contract (Phase 2).

## Tree

```text
packages/app-tauri/
├── src-tauri/                      Rust shell
│   ├── src/
│   │   ├── commands/               #[tauri::command]: reveal-in-dir, open-external, app-info, updater
│   │   ├── terminal.rs             NEW Rust PTY (replaces Electron node-pty)
│   │   └── sidecar.rs              spawn / supervise the Node daemon sidecar
│   ├── capabilities/               Tauri permissions
│   └── tauri.conf.json
└── src/                            React renderer
    ├── app/                        main.tsx, App.tsx, providers, global keybinds, useAppInit
    ├── shell/                      TitleBar, StatusBar, ConnectionOverlay, ErrorBoundary, Toaster, Tutorial
    ├── layout/                     NEW typed-surface engine: SurfaceHost, SurfaceRail, by-arrival, per-session store
    ├── surfaces/                   thin shells mounting features into the 3 surfaces
    │   ├── chat/
    │   ├── files/
    │   └── run/
    ├── features/
    │   ├── chat/                   REALIZED structure (see features/chat/README.md for the charter)
    │   │   ├── controller/         per-chat ChatThreadController + pure reducer + handle-daemon-event  ← the daemon seam (ExternalStore, NOT AssistantTransport)
    │   │   ├── runtime/            assistant-ui adapter: ChatRuntimeProvider + useExternalStoreRuntime wiring + extras
    │   │   ├── view-model/         pure projection: convert-message + mappers + tool-group-summary (WS14c invariants)
    │   │   ├── messages/           per-role message components (Assistant/User/System, queued, action bar, timing)
    │   │   ├── parts/              content-part renderers (markdown-text, CodeHeader, syntax-highlight)
    │   │   ├── thread/             the thread shell (ChatThread)
    │   │   ├── tools/              ONE tool-card registry + dispatch + per-family display cards (cards/, shared/)
    │   │   ├── gates/              interactive blocking cards: permission / ask-question / plan  (was the proposal's "cards/")
    │   │   └── composer/           shell + attachments · edit/ · config-toolbar/ (model/effort/features/plan/permission + synthesize-draft-chat.ts, use-composer-tuning.ts)
    │   ├── sessions/               BUILT (build-order step 11) — thread-list sidebar, lives at features/sessions/ (NOT under chat/)
    │   │   ├── runtime/            one global useRemoteThreadListRuntime + chats-remote-adapter · chat-controller-registry · new-thread-coordinator/-ready-store · draft-config · archive-confirm-bridge · daemon-port-context · use-sessions-thread-list
    │   │   ├── sidebar/            SessionSidebar (grouped/filtered) · SessionGroup · SessionRow(+Meta/+Rename) · SessionContextMenu · SessionSortMenu · ProjectFilterPillBar · FilterPill · ArchiveWorktreeDialog · project-color
    │   │   ├── filter/             apply-session-filters · tags-in-use · TagFilterBar (collapsible wrapping bar)
    │   │   ├── tags/               TagPopover(+Host) · TagRecolorPanel · TagDeleteConfirm · TagRegistryItemMenu · build-tag-cascade · validate-tag-name · tag-colors · use-tag-registry/-popover-target
    │   │   ├── new-thread/         ChatSurface · NewThreadConfigPicker · use-new-thread-auto-config (draft-aware: picker skipped when a project pill is active)
    │   │   ├── view-model/         group-sessions (TIME groups: Pinned/Today/Yesterday/Earlier) · initial-session (boot auto-open most-recent) · chat-to-thread-custom · session-status · attention-counts · relative-time
    │   │   ├── ws/                 session-list-router + use-session-list-router
    │   │   └── use-projects.ts
    │   ├── editor/                 Monaco code+diff, inline comments (+ lsp/)
    │   ├── viewers/                image, svg, pdf, csv, markdown
    │   ├── terminal/               xterm UI (backed by the Rust PTY)
    │   ├── preview/                Tauri-webview preview (replaces Electron <webview>)
    │   ├── settings/
    │   ├── tasks/
    │   ├── git/
    │   ├── tags/
    │   ├── review/
    │   └── plugins/
    ├── components/
    │   ├── ui/                     shadcn primitives  ← BUILD FIRST
    │   └── overlays/               command palette, pickers (on ui/Command + Dialog)
    ├── lib/
    │   ├── daemon/                 WS client + event router (ports cleanly)
    │   ├── api/                    HTTP modules
    │   ├── tauri/                  the bridge: replaces every window.mainframe.* call
    │   ├── model-tuning.ts
    │   └── file-types.ts, utils, …
    ├── stores/                     Zustand slices (chats → list/messages/process/permission), surfaces/, composer-drafts, sandbox, settings-ui, terminal
    │                               REALIZED so far at src/store/ (singular): session-filters.ts, unread-store.ts (NB: zustand is currently a phantom dep via shamefully-hoist — must be declared in package.json on merge)
    ├── hooks/                      useAppInit, useChatSession, useConnectionState
    └── styles/                     tokens.css (Tailwind v4 @theme) + components.css (split from index.css)
```

## Principles

1. **Feature-first + thin surfaces** — `features/*` own the work; `layout/` + `surfaces/` only *compose* them into Chat / Files / Run. No feature knows about the surface engine.
2. **One daemon seam** — the **frozen contract is the WS/REST schema behind `lib/daemon` + `lib/api`**; `features/chat/runtime/` is the chat *adapter* (ExternalStore controller/reducer/projection) over that seam, not part of the contract. The Rust daemon (Phase 2) re-implements the contract with zero renderer changes.
3. **`lib/tauri/` is the only Tauri-aware module** — everything `window.mainframe.*` collapses here (the future `tauri-bridge` subagent's home).
4. **Pure logic → a shared bundleable location (TBD; not the `mainframe-core` sidecar process)** — diff math, message-variant derivation, tool summaries, file-type classification leave the renderer. *(Shared-package home is an open decision — see the tracker.)*
5. **shadcn `components/ui/` first**, then port features onto it — dissolves the 6× duplicated overlay/dropdown code.

## Build order

1. tokens + shadcn `ui/` — **DONE**
2. shell + typed-surface `layout/` — not built (the layout engine + surface rail are still proposed)
3. ExternalStore controller `runtime/` seam (Node sidecar adapts its event stream) — **DONE** (was "AssistantTransport"; see `2026-06-05-chat-runtime-decision.md`)
4. features port surface-by-surface (Chat first) — **Chat DONE**, **Sessions DONE** (step 11); remaining surfaces not built
5. Rust PTY when terminal lands — not built

Remaining order (2026-06-07): shell + layout engine (step 2), then the non-chat surfaces feature-by-feature, then the Rust PTY (step 5).

## Drop-on-arrival (do NOT port)

- entire `zone/` system (8 files), `store/layout.ts`, `store/ui.ts` (~90% dead), `tool-windows.ts`
- plugin ↔ zone coupling; `ZoneHeaderSlot` context escape-hatch
- `navigation.ts` regex go-to-definition (LSP covers it)
- one of the two tool dispatchers (keep a single registry)
- module-level nav-stack singletons; in-memory `composer-drafts` Map
- ~~the `convert-message` sentinel / dual-encoding hacks~~ — **do NOT drop these; the `convert-message` invariants (WS14c dual re-encode, `\0` sentinel, `uniqueId()` dedup) are load-bearing.** Reshape only inside the shared projection.

## Decompose before porting (God-files)

`PluginView` (779) · `ChatsPanel` (684) · settings RemoteAccess (697) · `FlatSessionRow` (508) · `ComposerCard` (485) · `useChatsStore` (393) · `WorktreePopover` (369) · `SearchPalette` (345) · `index.css` (561)

## Sessions — deferred leaves (2026-06-07)

The `features/sessions/` tree above is built, but these leaves are intentionally deferred (tracked in `MIGRATION-TRACKER.md`):

- **Ghosted "Add project" pill** in `sidebar/ProjectFilterPillBar.tsx` (dashed button) — inert until the **add-project flow** (directory picker + project create/register) is ported.
- **Group-header "more" popover** in `sidebar/SessionSidebar.tsx` (`sessions-more-button`) — presentational placeholder; overflow menu not yet wired.
- **Deferred sidebar chrome** (full-artboard parity): surface rail (Chat/Files/Run), bottom Context/Skills/Agents tabbed panel + resize handle, window chrome / traffic-lights, floating-panel-on-warm-gradient background.
- **Deprecated assistant-ui hooks** still in use (`useAssistantRuntime().threads` workaround — `useThreadListRuntime` is not publicly exported) — migration to `useAui`/`useAuiState` is a tracked backlog item, not actioned.

## Electron → Tauri bridge inventory (all land in `lib/tauri/` + `src-tauri/commands/`)

- `window.mainframe.updates.*` → Tauri updater plugin + events
- `window.mainframe.showItemInFolder` → reveal-in-dir command
- `window.mainframe.openExternal` → opener command
- `window.mainframe.{getAppInfo, getHomedir, readFile, showNotification, log}` → Tauri commands
- `window.mainframe.terminal` (PTY) → **NEW Rust PTY** (`src-tauri/terminal.rs`) — not in the daemon today
- `window.confirm` → shadcn `AlertDialog`
- `-webkit-app-region: drag` → `data-tauri-drag-region`
- plugin Electron `<webview>` → Tauri webview / iframe

## Provenance

Derived from a 10-subsystem analysis of the existing `packages/desktop` renderer
(structure, coupling, IPC usage, smells, port disposition) plus the typed-surface
brainstorm and the `HANDOFF-screens.md` production-stack decisions.
