# Main-Area Header Redesign — Implementation Plan

**Goal:** Split the chat surface header into a shell-level `MainToolbar` (project/branch + theme toggle + gated stubs) and a chat-zone `ChatCardHeader` (today's `ChatHeader` content), and simplify the sidebar-collapse drag mechanism.

**Architecture:** `MainToolbar` mounts in `AppShell` above `SurfaceHost` and owns the collapsed traffic-light `leadingInset`; the in-flow show-sidebar button replaces the absolute overlay (`COLLAPSED_CHROME_INSET` retires). `mainChromeInset` is removed from the surface path. A new `useTheme` store + root `ThemeEffect` toggles `.dark`.

**Spec:** `docs/architecture/2026-06-09-main-area-header-redesign.md` (Codex-APPROVED).

**Tech:** Tauri 2 + React 19 + assistant-ui 0.14.14 + zustand + Tailwind v4 + vitest. Verify each task: `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck` + `… exec vitest run <file>`. Tests delegated to the `test-writer` agent per project preference. Commit after each task.

---

## Task 1: `useTheme` store + root `ThemeEffect`

**Files:** Create `src/store/theme.ts`, `src/app/ThemeEffect.tsx`; modify `src/app/App.tsx`; tests `src/store/__tests__/theme.test.ts`.

- [ ] **1.1** (test-writer) Write `theme.test.ts`: default mode is `'light'` when storage empty/invalid; `toggle()` flips light↔dark; `setMode` persists to `localStorage('mf-theme')`; reading an invalid stored value (`'x'`) falls back to `'light'`; reading `'dark'` yields `'dark'`. Run → RED (module missing).
- [ ] **1.2** Implement `store/theme.ts`: `readStored()` (validate `'light'|'dark'`, else `'light'`); zustand store `{ mode, toggle, setMode }`, `setMode` writes localStorage. Implement `ThemeEffect.tsx`: subscribes to `mode`, toggles `document.documentElement.classList` `.dark`, runs on mount + change; renders `null`.
- [ ] **1.3** Mount `<ThemeEffect />` in `App.tsx` at root (above `AppShell`).
- [ ] **1.4** Run theme tests → GREEN; typecheck; eslint. Commit.

## Task 2: Extract `ChatCardHeader` from `ChatHeader`

**Files:** Create `src/features/chat/thread/ChatCardHeader.tsx`; modify `src/features/sessions/new-thread/ChatSurface.tsx`; retire `src/layout/ChatHeader.tsx`; tests `src/features/chat/thread/__tests__/ChatCardHeader.test.tsx`.

`ChatCardHeader` = today's `ChatHeader` body **verbatim** (grip `GripHorizontal` + `MessageSquare` + title via `useAuiState(s=>s.threadListItem?.title)` + `chat-header-split-right`/`-split-down` gated on `layoutCanSplit`/`splitSurface`), `data-tauri-drag-region`, `h-[38px]`, **no `leadingInset` prop** (drop it — MainToolbar owns the inset now).

- [ ] **2.1** (test-writer) `ChatCardHeader.test.tsx`: renders `chat-header` testid with grip, `MessageSquare`, the title, and (when `layoutCanSplit`) the two split buttons; clicking split calls `splitSurface`. Port the relevant assertions from the existing ChatHeader coverage in `chrome.test.tsx`. Run → RED.
- [ ] **2.2** Create `ChatCardHeader.tsx` (copy `ChatHeader.tsx` body, remove the `leadingInset` prop + its `paddingLeft` style). Keep all testids.
- [ ] **2.3** `ChatSurface.tsx`: import + render `<ChatCardHeader />` instead of `<ChatHeader leadingInset={mainChromeInset} />`; **remove** the `mainChromeInset` prop from `ChatSurface`'s signature.
- [ ] **2.4** Delete `layout/ChatHeader.tsx`. Grep for remaining `ChatHeader` imports; none should remain except the new tests.
- [ ] **2.5** Run ChatCardHeader tests → GREEN; typecheck. (chrome.test.tsx may break here — fixed in Task 4.) Commit.

## Task 3: `branchName` in `SessionCustom` + `MainToolbar`

**Files:** modify `src/features/sessions/view-model/chat-to-thread-custom.ts` (+ its `SessionCustom` type); create `src/layout/MainToolbar.tsx`; tests `src/features/sessions/view-model/__tests__/chat-to-thread-custom.test.ts` (extend) + `src/layout/__tests__/MainToolbar.test.tsx`.

- [ ] **3.1** (test-writer) Extend the chat-to-thread-custom test: `branchName` from `chat.branchName` is projected into `custom.branchName` (and `undefined` when absent). Run → RED.
- [ ] **3.2** Add `branchName?: string` to `SessionCustom`; project `chat.branchName` in `chatToThreadCustom()`. Run → GREEN.
- [ ] **3.3** (test-writer) `MainToolbar.test.tsx`: renders project name + branch chip (`main-toolbar-branch`, disabled) from props/threadListItem; theme button (`main-toolbar-theme`) toggles `useTheme`; search/launch/play/inspector stubs present + `disabled` with `main-toolbar-*` testids; the in-flow show-sidebar button (`show-sidebar-button`) renders only when collapsed and calls the expand callback on click. Run → RED.
- [ ] **3.4** Implement `MainToolbar.tsx`: `flex` row `h-[38px]` `data-tauri-drag-region` bottom-hairline; props `{ leadingInset, sidebarRendered, onExpandSidebar, projectName, branchName }`. Left group: in-flow `ShowSidebarButton` when `!sidebarRendered` (style `paddingLeft: leadingInset`), then `projectName | ⎇ branch` (branch chip disabled). Right group: Search⌘O / launch / play / inspector stubs (`disabled`, titles "coming with <surface>"), `|`, theme toggle (moon/sun reading `useTheme`). All interactive elements get `main-toolbar-*` testids; the theme + show-sidebar are the only enabled ones.
- [ ] **3.5** Run MainToolbar + projection tests → GREEN; typecheck; eslint. Commit.

## Task 4: Wire `MainToolbar` into `AppShell` + retire the absolute button

**Files:** modify `src/app/AppShell.tsx`, `src/layout/SurfaceHost.tsx`; tests `src/layout/__tests__/chrome.test.tsx` (revert + extend).

- [ ] **4.1** (test-writer) Update `chrome.test.tsx`: render `<AppShell>`, the show-sidebar button now lives in `MainToolbar` (`main-surface-shell` no longer hosts the absolute button); collapsed `surface-host` `data-main-chrome-inset` assertions are **removed** (prop dropped); add: the in-flow `show-sidebar-button` is present + clickable + keyboard-focusable (tabIndex/role) in BOTH the instant-hidden (`sidebar-hide-button` click) and drag-collapsed (drag past threshold) states, and one click re-expands. Run → RED.
- [ ] **4.2** `SurfaceHost.tsx` + `SurfaceView`: remove the `mainChromeInset` prop entirely (and the `data-main-chrome-inset` passthrough on the mock-observed element if any). `ChatSurface` no longer takes it (done in Task 2).
- [ ] **4.3** `AppShell.tsx`: remove `ShowSidebarButton`, `COLLAPSED_CHROME_INSET`, `SHOW_SIDEBAR_BUTTON_LEFT`, `getMainChromeInset`/`getMainOverlap`'s inset arg as needed; compute `leadingInset = sidebarRendered ? 0 : TRAFFIC_LIGHTS_SPACER_WIDTH`; render `<MainToolbar leadingInset={leadingInset} sidebarRendered={sidebarRendered} onExpandSidebar={expandSidebar} projectName={…} branchName={…} />` at the top of `main-surface-shell`, then `<SurfaceHost port={port} />` (no inset prop). Keep `mainOverlap` marginLeft (sidebar-grow overlap) untouched.
- [ ] **4.4** Run `chrome.test.tsx` → GREEN; full `… test` → GREEN; typecheck; eslint. Commit.

## Task 5: Final verification

- [ ] **5.1** `pnpm --filter @qlan-ro/mainframe-app-tauri typecheck` → clean.
- [ ] **5.2** `pnpm --filter @qlan-ro/mainframe-app-tauri test` → all green.
- [ ] **5.3** Changeset (`pnpm changeset` / hand-write minor) + final commit.
- [ ] **5.4** (optional) `/code-review` the diff; live eyeball.

## Notes / known limitations (from the spec)

- Theme toggle does NOT recolor already-rendered code blocks until reload (Shiki built once) — deferred, documented, not a bug.
- Branch chip, search, launch, play, inspector are **gated stubs** (disabled) until their subsystems land.
- Chat grip is visual-only (surface-reposition engine unbuilt).
