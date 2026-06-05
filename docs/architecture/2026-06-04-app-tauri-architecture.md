# `packages/app-tauri` — Proposed Folder Architecture

**Status:** Proposed (2026-06-04) — **⚠ PARTIALLY SUPERSEDED.** The folder tree + principles remain the target, BUT: the **runtime is NOT AssistantTransport** — it is `useExternalStoreRuntime` + a per-chat controller/reducer/projection (see `2026-06-05-chat-runtime-decision.md`). Read every "AssistantTransport" mention below as "ExternalStore controller seam." `convert-message` invariants are **load-bearing — keep them**. Pure logic goes to a **shared bundleable location (TBD)**, not the `mainframe-core` sidecar.

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
    │   ├── chat/
    │   │   ├── runtime/            AssistantTransport custom runtime  ← the daemon seam
    │   │   ├── thread/             message slots (MessagePrimitive), markers
    │   │   ├── tools/              ONE tool-card registry + card library
    │   │   ├── composer/           InputArea, ConfigToolbar, AttachmentTray, worktree/, QueuedBanner
    │   │   ├── sessions/           decomposed ChatsPanel / FlatSessionRow
    │   │   └── cards/              permission, plan, ask-question
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
    ├── hooks/                      useAppInit, useChatSession, useConnectionState
    └── styles/                     tokens.css (Tailwind v4 @theme) + components.css (split from index.css)
```

## Principles

1. **Feature-first + thin surfaces** — `features/*` own the work; `layout/` + `surfaces/` only *compose* them into Chat / Files / Run. No feature knows about the surface engine.
2. **One daemon seam** — `features/chat/runtime/` (AssistantTransport) + `lib/daemon` + `lib/api`. This is the frozen contract; the Rust daemon (Phase 2) re-implements it with zero renderer changes.
3. **`lib/tauri/` is the only Tauri-aware module** — everything `window.mainframe.*` collapses here (the future `tauri-bridge` subagent's home).
4. **Pure logic → a shared bundleable location (TBD; not the `mainframe-core` sidecar process)** — diff math, message-variant derivation, tool summaries, file-type classification leave the renderer. *(Shared-package home is an open decision — see the tracker.)*
5. **shadcn `components/ui/` first**, then port features onto it — dissolves the 6× duplicated overlay/dropdown code.

## Build order

1. tokens + shadcn `ui/`
2. shell + typed-surface `layout/`
3. AssistantTransport `runtime/` seam (Node sidecar adapts its event stream)
4. features port surface-by-surface (Chat first)
5. Rust PTY when terminal lands

## Drop-on-arrival (do NOT port)

- entire `zone/` system (8 files), `store/layout.ts`, `store/ui.ts` (~90% dead), `tool-windows.ts`
- plugin ↔ zone coupling; `ZoneHeaderSlot` context escape-hatch
- `navigation.ts` regex go-to-definition (LSP covers it)
- one of the two tool dispatchers (keep a single registry)
- module-level nav-stack singletons; in-memory `composer-drafts` Map
- ~~the `convert-message` sentinel / dual-encoding hacks~~ — **do NOT drop these; the `convert-message` invariants (WS14c dual re-encode, `\0` sentinel, `uniqueId()` dedup) are load-bearing.** Reshape only inside the shared projection.

## Decompose before porting (God-files)

`PluginView` (779) · `ChatsPanel` (684) · settings RemoteAccess (697) · `FlatSessionRow` (508) · `ComposerCard` (485) · `useChatsStore` (393) · `WorktreePopover` (369) · `SearchPalette` (345) · `index.css` (561)

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
