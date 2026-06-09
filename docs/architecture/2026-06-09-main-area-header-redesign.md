# Main-Area Header Redesign (MainToolbar + ChatCardHeader)

**Status:** Design · 2026-06-09 · branch `feat/app-tauri-wt`
**Scope:** the "global top bar" piece of the header-band drift. PR badge / review button / session-metrics bar are a separate follow-up (piece #2) that attaches to the `ChatCardHeader` built here.

## Problem

The app-tauri main surface area drifts from both the prototype (`docs/design-reference/prototype/02-chrome.jsx` + `04-engine.jsx`) and desktop (`packages/desktop/.../TitleBar.tsx`). Today the chat surface renders a single `ChatHeader` (grip + message icon + session title + split). The design has **two distinct chrome levels** in the main area:

1. a **shell-level `MainToolbar`** above the surface zones — `mainframe | ⎇ branch` + find/preview/play/theme/inspector;
2. a **per-zone surface header** — for chat, the `ChatCardHeader` (grip + chat icon + session title + split).

## Surface-engine context (so the headers are modelled right)

The main area is the **typed-surface engine**: Chat / Files / Run are **zones** arranged in a layout (`layout/SurfaceHost` + `SurfDivider` splits + `SurfaceRail`, already built). Each zone has a `SurfaceTabStrip`-style header with a **drag-to-reposition grip** + surface icon + content. **Chat is a surface like the others** — same grip anatomy.

Engine behavior, split by where it actually lives (verified):
- **In app-tauri `store/layout.ts` today:** the **floor invariant** (`removeSurface` restores `['chat']` when the row empties, line 53) and chat **pinned leftmost** (`insertTop`, line 19). That's it for placement.
- **Prototype-only / future (not in app-tauri):** `repositionSurface` (chat moves top-left/right, never to the bottom strip) and `chatSide`. app-tauri has **no reposition API and no `chatSide`**.

So for THIS change the chat grip is a **visual-only placeholder** (matching the existing Files/Run grips), and whether chat ever shows a **close** affordance is left to the future surface-engine workstream — **not asserted here**.

Current realized state (verified): surfaces + `toggleSurface`/`splitSurface`/`setTopFrac` exist; **tabs, surface-reposition drag, and the surface-close model are NOT built** — every `SurfaceTabStrip` grip is "visual only." So the chat grip is likewise a **visual-only placeholder** here, and no close affordance is added; wiring real reposition/close is a separate future workstream, out of this scope.

Traffic lights + a layout-preset switcher live in the **sidebar header** (unchanged). So lights stay in the sidebar, and the collapsed-sidebar offset belongs to whatever sits top-left of the surface area — now the `MainToolbar`.

## Layout

```
┌ window ──────────────────────────────────────────────┐
│ ┌ sidebar (floating) ┐ ┌ main-surface-shell ────────┐ │
│ │ [traffic lights]   │ │ MainToolbar (shell)        │ │  ← project|branch + controls
│ │ [preset switch]    │ │ ┌ SurfaceHost (zones) ────┐ │ │
│ │ SESSIONS …         │ │ │ chat zone:              │ │ │
│ │                    │ │ │  ChatCardHeader (grip + │ │ │  ← chat surface header
│ │                    │ │ │   icon + title + split) │ │ │
│ │                    │ │ │  thread (scrolls)       │ │ │
│ │                    │ │ │  composer               │ │ │
│ │                    │ │ │ [files/run zones if any]│ │ │
│ │                    │ │ └─────────────────────────┘ │ │
│ └────────────────────┘ └────────────────────────────┘ │
└────────────────────────────────────────────────────────┘
```

`MainToolbar` is a fixed bar at the top of `main-surface-shell`, above `SurfaceHost`. The chat zone's `ChatCardHeader` is fixed at the top of the chat panel; thread scrolls beneath; composer pinned.

## Goals

- Build the shell-level **`MainToolbar`**, matching the prototype: wire what has backing (project name, branch label, **theme toggle**); render the rest as gated, disabled, testid'd stubs (search, launch/preview, play, branch-switch, inspector/right-sidebar).
- Recast today's `ChatHeader` content into the chat zone's **`ChatCardHeader`** — grip (visual-only reposition placeholder, like the other surfaces) + chat icon + session title + split — kept verbatim otherwise. No close affordance is added (the surface-close model is unbuilt; chat-close is deferred to that workstream).
- Simplify the drag mechanism: the show-sidebar button moves **in-flow** into the `MainToolbar` left; `COLLAPSED_CHROME_INSET` + the absolute-overlay button retire in favor of the plain traffic-light `leadingInset` on the `MainToolbar`.

## Non-goals (deferred)

- PR badge / review button / session-metrics bar (piece #2 — attaches to `ChatCardHeader`).
- Real search/command palette, launch/sandbox subsystem, right-sidebar/inspector surface, branch-switch API, and the **surface tab model + drag-to-reposition** engine. All remain gated/visual-only until their workstreams land.

## Components

### `MainToolbar` (new — `layout/MainToolbar.tsx`)

`flex` row, `h-[38px]`, `data-tauri-drag-region`, bottom hairline, left/right groups.

- **Left:** show-sidebar button (`show-sidebar-button`, **in-flow**, only when the sidebar isn't rendered) → expands in one click (existing `expandSidebar`, relocated). Then `mainframe` project name `|` `⎇ <branch> ⌄` chip — **gated stub** (disabled, `main-toolbar-branch`). Carries the collapsed `leadingInset` to clear the traffic lights.
- **Right:** `Search ⌘O` stub · divider · launch/preview picker stub · play stub · divider · **theme toggle (wired)** · inspector/right-sidebar stub. Every control gets a `main-toolbar-*` testid; stubs are `disabled` with an explanatory title.

### `ChatCardHeader` (new — `features/chat/thread/ChatCardHeader.tsx`)

Today's `ChatHeader` body, recast as the **chat zone's surface header**: `GripHorizontal` (drag-to-reposition grip, **visual-only placeholder** matching `SurfaceTabStrip`) + `MessageSquare` + session title (`useAuiState … title`) + `chat-header-split-right`/`chat-header-split-down` (`layoutCanSplit`/`splitSurface`). No close affordance is added (surface-close model unbuilt; deferred). Keeps `data-tauri-drag-region` + `h-[38px]`. PR badge + metrics attach here later (piece #2). No behavior change vs today otherwise.

### `useTheme` store (new — `store/theme.ts`)

zustand: `mode: 'light' | 'dark'`, `toggle()`, persisted to `localStorage('mf-theme')`.

- **DOM side effect:** a single `ThemeEffect` mounted at the app root (`App.tsx`, above `AppShell`) toggles the `.dark` class on `document.documentElement` whenever `mode` changes. The store's initial value reads + **validates** the stored string (only `'light'`/`'dark'` accepted, else `'light'`) at module init, and the effect applies it on first mount, so there is no light-flash before render. System-preference detection is out of scope.
- **Known limitation — code syntax tokens don't recolor on toggle:** `features/chat/parts/syntax-highlight.tsx` builds the Shiki theme once from CSS vars and only rebuilds on reload (documented there). For v1, toggling theme recolors everything *except* already-rendered code blocks until the next reload. This is **explicitly deferred** (handling live Shiki re-init is its own task); the spec/plan must call it out so it isn't mistaken for a bug.

The `MainToolbar` theme button reads `mode` → moon/sun.

### Drag-mechanism rework (`AppShell.tsx`, `useSidebarResize.ts`, `chrome.test.tsx`)

- Remove the absolute `ShowSidebarButton` + `COLLAPSED_CHROME_INSET`/`SHOW_SIDEBAR_BUTTON_LEFT` from `AppShell`; the button now lives in `MainToolbar`'s left.
- `MainToolbar`'s collapsed `leadingInset` is the plain traffic-light clearance (`TRAFFIC_LIGHTS_SPACER_WIDTH`); the in-flow content clears the lights, so no absolute button to over-clear.
- `expandSidebar` (already built) moves to where the button renders.
- **Hit-test / z-index check (Codex):** `SidebarCollapseHandle` stays absolutely positioned at `left:0` with `z-20` while drag-collapsed. The in-flow `MainToolbar` show-sidebar button must remain **clickable and keyboard-reachable** in BOTH states (instant-hidden via the header button, and drag-collapsed). The plan must verify the handle's `left:0/z-20` region does not sit over the button (the button is offset by `leadingInset`, the handle is a 6–10px strip at `left:0`, so they should not overlap — but confirm), and the drag handle only renders while `sidebarVisible`.
- `chrome.test.tsx`: collapsed-inset assertions revert to `TRAFFIC_LIGHTS_SPACER_WIDTH`; the button-present / one-click-expand tests target the in-flow `MainToolbar` button; **add** a test that the in-flow `show-sidebar-button` is clickable + keyboard-reachable in both the instant-hidden and drag-collapsed states.

### Composition

`main-surface-shell` (in `AppShell`) renders `<MainToolbar leadingInset={…} />` then `<SurfaceHost />`. The collapsed traffic-light clearance now flows **only** to `MainToolbar` (its left is the surface-area's top-left, nearest the lights). Inside `SurfaceHost`, the chat panel renders `ChatSurface` = `<ChatCardHeader />` + thread/composer. `ChatHeader.tsx` retires (content → `ChatCardHeader`).

**`mainChromeInset` is removed from the surface path.** Today `AppShell` → `SurfaceHost(mainChromeInset)` → `SurfaceView(i===0)` → `ChatSurface(mainChromeInset)` → `ChatHeader(leadingInset)`. With a shell toolbar above the surfaces, the chat-zone header must **not** keep receiving traffic-light padding (the `MainToolbar` above it already clears the lights). So: drop the `mainChromeInset` prop from `SurfaceHost` and `SurfaceView`, and from `ChatSurface`; `ChatCardHeader` takes no `leadingInset`. The only consumer of the collapsed clearance is `MainToolbar`.

## Data sources

- **Project name:** active thread-list item's `custom.projectId` → project name (projects list). Already in the `SessionCustom` projection.
- **Branch label (Codex — needs a reliable source):** `chat.branchName` is the only source today, but it is **not** in the `SessionCustom` thread projection (`chat-to-thread-custom.ts` drops it), and reading it via the controller's `chatConfig` is unsafe because `sameComposerConfig` deliberately ignores non-composer fields (`chat-thread-state.ts`) — a later worktree/branch change could be filtered out as "same config." **Resolution:** add `branchName` to the `SessionCustom` projection (additive) so the shell reads it reactively from `useAuiState(s => s.threadListItem?.custom)` — no feature reach-through, updates whenever the thread custom data refreshes. The plan owns this projection change.
- **Theme:** local only.
- Stubs need no data.

## Testing

- `useTheme`: unit (toggle flips mode + `.dark` + persists; reads stored value on init).
- `MainToolbar`: renders identity (project/branch); theme toggle flips theme; stubs present + disabled with testids; show-sidebar button appears only when collapsed and expands on click.
- `ChatCardHeader`: grip + chat icon + title + split present (port the existing ChatHeader assertions).
- `chrome.test.tsx`: updated collapse/inset/expand assertions per the rework.
- `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck` + `test` green.

## Files

- New: `layout/MainToolbar.tsx`, `features/chat/thread/ChatCardHeader.tsx`, `store/theme.ts` + a root `ThemeEffect` (+ tests).
- Changed:
  - `app/AppShell.tsx` — mount `MainToolbar` (with `leadingInset`); drop the absolute show-sidebar button + `COLLAPSED_CHROME_INSET`/`SHOW_SIDEBAR_BUTTON_LEFT`; stop passing `mainChromeInset` to `SurfaceHost`.
  - `app/App.tsx` — mount the `ThemeEffect` at the root.
  - `layout/SurfaceHost.tsx` + `SurfaceView` — drop the `mainChromeInset` prop.
  - `features/sessions/new-thread/ChatSurface.tsx` — render `<ChatCardHeader />` (not `ChatHeader`); drop the `mainChromeInset` prop/`leadingInset` thread-through.
  - `features/sessions/view-model/chat-to-thread-custom.ts` (+ the `SessionCustom` type) — add `branchName` to the projection.
  - `layout/__tests__/chrome.test.tsx` — revert collapse/inset assertions + add the in-flow-button hit-test.
- Retired: `layout/ChatHeader.tsx` (content → `ChatCardHeader`).

## Resolved decisions

- `ChatCardHeader` lives in `features/chat/thread/` (next to `ChatThread`).
- `MainToolbar` and `ChatCardHeader` both carry `data-tauri-drag-region`; interactive children opt out. The grip + title stay in `ChatCardHeader` exactly as today.
- The chat grip is a **visual-only** reposition placeholder (the surface-reposition engine is unbuilt and out of scope) — consistent with the existing Files/Run grips.
