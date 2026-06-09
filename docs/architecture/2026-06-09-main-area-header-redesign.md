# Main-Area Header Redesign (MainToolbar + ChatCardHeader)

**Status:** Design · 2026-06-09 · branch `feat/app-tauri-wt`
**Scope:** the first of the header-band drift fixes (the "global top bar" piece). The PR badge / review button / session-metrics bar are a separate follow-up (piece #2) that attaches to the `ChatCardHeader` built here.

## Problem

The app-tauri surface header drifts from both the prototype (`docs/design-reference/prototype/02-chrome.jsx` `MainToolbar`) and desktop (`packages/desktop/.../TitleBar.tsx`). Today `ChatHeader` shows only a drag grip + message icon + session title + split buttons. The design has **two stacked headers** in the surface panel:

1. a **main-area toolbar** — `mainframe | ⎇ branch` on the left, find/preview/play/theme/inspector controls on the right;
2. a **chat-card header** — the grip + message icon + session title + split buttons (and, later, the PR badge + metrics).

The native traffic lights stay in the sidebar (unchanged floating-panels layout), so the collapsed-sidebar drag offset stays relevant — but moves to a simpler model.

## Goals

- Build the **MainToolbar** matching the prototype: wire what has backing (project name, branch label, **theme toggle**); render the rest as gated, disabled, testid'd stubs (search, launch/preview, play, branch-switch, inspector/right-sidebar).
- Extract today's `ChatHeader` content **unchanged** into a **ChatCardHeader** component (grip + message icon + title + split), pinned below the MainToolbar.
- Simplify the drag mechanism: move the show-sidebar button **in-flow** into the MainToolbar left; retire `COLLAPSED_CHROME_INSET` + the absolute-overlay button in favor of the plain traffic-light `leadingInset`.

## Non-goals (deferred)

- PR badge / review button / session-metrics bar (piece #2 — attaches to `ChatCardHeader`).
- Real search/command palette, launch/sandbox subsystem, right-sidebar/inspector surface, branch-switch API. These remain gated stubs until their subsystems land.

## Design

### Layout

Inside the surface panel (`ChatSurface`), two **fixed** headers stack, then the scrolling thread:

```
┌ surface panel ───────────────────────────┐
│ MainToolbar   (fixed)                     │
│ ChatCardHeader(fixed)                     │
│ ─ message thread (scrolls) ─────────────  │
│ … composer …                              │
└───────────────────────────────────────────┘
```

### MainToolbar (new — `layout/MainToolbar.tsx`)

`flex` row, `h-[38px]`, `data-tauri-drag-region`, `[border-bottom:0.5px_solid_var(--border)]`, left/right groups.

- **Left (identity):**
  - Show-sidebar button (`data-testid="show-sidebar-button"`) rendered **in-flow** only when the sidebar is not rendered (collapsed or hidden). On click → expand (one click, from either collapsed state) — same `expandSidebar` behavior already built, just relocated here.
  - `mainframe` project name (from the active chat's project) · `|` · branch chip `⎇ <branchName> ⌄` (from `chat.branchName`). The chip is a **gated stub** (disabled; no branch-switch API) — `data-testid="main-toolbar-branch"`.
  - Carries the collapsed-state `leadingInset` so the in-flow content clears the traffic lights when the sidebar is collapsed.
- **Right (controls), in order:** `Search ⌘O` stub · divider · launch/preview picker stub · play stub · divider · **theme toggle (wired)** · inspector/right-sidebar toggle stub. Every control gets a `main-toolbar-*` testid; stubs are `disabled` with a title explaining they're coming with their surface.

### ChatCardHeader (new — `features/chat/thread/ChatCardHeader.tsx`)

The **current `ChatHeader` body, moved verbatim**: `GripHorizontal` (grip, in front) + `MessageSquare` + session title (`useAuiState … title`) + `chat-header-split-right` / `chat-header-split-down` buttons (`layoutCanSplit`/`splitSurface`). Keeps `data-tauri-drag-region` and `h-[38px]`. This is where the PR badge + metrics will attach (piece #2). No behavior change vs today.

### Theme toggle (new — `store/theme.ts`)

A tiny zustand store: `mode: 'light' | 'dark'`, `toggle()`, persisted to `localStorage('mf-theme')`, applied by toggling the `.dark` class on `document.documentElement` in an effect. Initial value: stored value, else `'light'` (system-preference detection is out of scope for v1). The MainToolbar theme button reads `mode` and renders moon/sun.

### Drag-mechanism rework (`AppShell.tsx`, `useSidebarResize.ts`, `chrome.test.tsx`)

- Remove the absolute `ShowSidebarButton` from `AppShell` and the `COLLAPSED_CHROME_INSET` / `SHOW_SIDEBAR_BUTTON_LEFT` constants; the button now lives in `MainToolbar`'s left.
- Collapsed `mainChromeInset` reverts to the plain traffic-light clearance (`TRAFFIC_LIGHTS_SPACER_WIDTH`) since the header content (show-sidebar + identity) is in-flow after the inset — no absolute button to clear.
- `expandSidebar` (already built) moves to where the button is rendered (MainToolbar, via props from `ChatSurface`/`AppShell`).
- Update `chrome.test.tsx`: the collapsed-inset assertions revert to `TRAFFIC_LIGHTS_SPACER_WIDTH`; the show-sidebar-button-present / one-click-expand tests now target the in-flow button in the MainToolbar.

### Composition

`ChatSurface` renders `<MainToolbar … />` then `<ChatCardHeader />` then the thread/composer column. `mainChromeInset` flows to `MainToolbar` (it owns the collapsed leadingInset now), not `ChatCardHeader`.

## Data sources

- **Project name / branch:** the active chat's `projectId` → project name (sessions/projects data already in app-tauri); `chat.branchName` for the branch label. Read via the controller's `chatConfig` / thread-list item where available.
- **Theme:** local only (no daemon).
- Stubs need no data.

## Testing

- `useTheme` store: unit tests (toggle flips mode + `.dark` class + persists; reads stored value on init).
- `MainToolbar`: renders identity (project/branch), the wired theme toggle flips theme, stubs are present + disabled with testids; show-sidebar button appears only when collapsed and expands on click.
- `ChatCardHeader`: grip + title + split present (port the existing ChatHeader assertions).
- `chrome.test.tsx`: updated collapse/inset/expand assertions per the rework.
- Full `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck` + `test` green.

## Files

- New: `layout/MainToolbar.tsx`, `features/chat/thread/ChatCardHeader.tsx`, `store/theme.ts` (+ tests).
- Changed: `features/sessions/new-thread/ChatSurface.tsx` (compose both headers), `app/AppShell.tsx` (drop absolute button + constants), `layout/useSidebarResize.ts` (expose expand — already done), `layout/__tests__/chrome.test.tsx` (revert collapse assertions).
- Retired: `layout/ChatHeader.tsx` (content moves to `ChatCardHeader`; delete or repurpose).

## Resolved decisions

- `ChatCardHeader` lives in `features/chat/thread/` (chat-specific, next to `ChatThread`).
- Both `MainToolbar` and `ChatCardHeader` carry `data-tauri-drag-region` (both are natural window-drag areas); interactive children opt out as usual. The grip + title stay in `ChatCardHeader` exactly as today.
