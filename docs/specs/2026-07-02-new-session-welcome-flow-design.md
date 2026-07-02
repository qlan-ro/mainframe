# New-session flow — entry point, draft session, welcome empty-state

**Date:** 2026-07-02
**Status:** Approved (design)
**Source handoff:** `design_handoff_new_session_flow` (README + `02-chrome.jsx`, `03-content.jsx`, `04-engine.jsx`, `New Session Review.html`) — delta on `docs/design-reference/HANDOFF-screens.md` + `component-map.md`.

## Overview

Redesign how a new session starts. Today the "+" mints a transient thread and, in "All" view, shows an interstitial "Choose a project to start" `<select>` *inside the chat surface* (`NewThreadConfigPicker`). This replaces that flow:

1. The **"+" resolves the project before the chat opens** — directly when a project pill is active, or via an anchored **project-picker popover** in "All" view. The chat surface never hosts a project dropdown.
2. A **draft session** ("New Session") appears as a row at the top of the sidebar list — at most one, cleared if abandoned.
3. The empty chat is a designed **Welcome state**: project + branch context, a headline, and repo-derived suggestion rows that pre-fill the composer on click.
4. **First run (zero projects)** gets a welcome hero with a single "Add project…" CTA and **no composer**.

## Target & scope

- **Single renderer.** All UI lands in `packages/ui/src` (`@qlan-ro/mainframe-ui`). `packages/app-tauri` and `packages/app-electron` both render this bundle (app-electron is now only the Electron main process + preload), so one implementation covers both apps. No host-bridge changes: "Add project…" reuses the existing `useDirectoryPicker` → `createProject` seam.
- **Suggestions scope (decided):** cheap sources only for v1 — recent **churn** (existing git routes) + a new lightweight **TODO-comment scan**. Open-PR and failing-CI-check rows are **deferred** to a later spec (they need GitHub API + auth). The "honesty rule" holds: render only data we actually have.
- **Draft-clears-on-navigation (decided):** navigating to another session discards an unsent draft (matches the handoff). Trade-off accepted: unsent composer text is lost on navigation.

## Approach

**Extend the existing draft machinery.** A draft is already an assistant-ui `__LOCALID_` thread (status `new`, 0 messages, no daemon chat) backed by:
- `features/sessions/runtime/draft-config.ts` — `useDraftConfigStore` (`Map<localId, DraftCfg>`), `setDraftConfig`/`patchDraftConfig`/`clearDraftConfig`/`useDraftConfig`.
- `features/sessions/runtime/new-thread-ready-store.ts` — `useNewThreadReady`, `markReady`/`clearReady`.
- `features/sessions/runtime/new-thread-coordinator.ts` — `createForLocal` (idempotent commit → `createChat` + `applyDraftTuning` on first send).
- `features/sessions/new-thread/reset-new-thread-draft.ts`, `use-new-thread-auto-config.ts` — reset + pill-seed.
- `features/chat/composer/config-toolbar/{use-composer-tuning,synthesize-draft-chat}.ts` — draft-aware composer (provider unlocked, tuning routed to draft-config).

We reuse all of it and add: a picker popover, a draft row, a Welcome/First-run surface, header/composer tweaks, and a suggestions hook + endpoint. This avoids re-implementing the slot-reuse / double-fire logic the team already hardened (see the `app-tauri-newthread-slot-reuse-draft-leak` fix).

Rejected: (B) a standalone first-class `draftSession` store — re-opens the slot-reuse bug class. (C) minimal reskin of the interstitial — violates the "draft row" and "no interstitial" goals.

## Changes

### Change 1 — "+" entry point & project-picker popover
**File:** `features/sessions/sidebar/SessionSidebar.tsx` (`SessionsGroupHeader`).

- **Pill active** → "+" starts the draft in that project directly (existing auto-config path via `use-new-thread-auto-config`). Tooltip `New session in <project>`.
- **"All" view** → "+" opens an anchored **project-picker popover** (shadcn `Popover`, below-right, gap 4, min-width 216, standard PopCard surface). Contents:
  - Section label `NEW SESSION IN…`.
  - One row per project: `projectColor(id)` identity dot · name (ellipsis) · trailing `N sessions` / `no sessions` (count derived from the live thread list, same source the rows render from — never a second count).
  - Divider · `Add project…` row (folder-plus) → existing `useAddProject`.
  - Picking a project: `setDraftConfig({ projectId, adapterId: 'claude' })` + `markReady` + `switchToNewThread`/`switchToThread(newThreadId)`, then close. ESC / outside-click dismiss.
- **Delete** `NewThreadConfigPicker.tsx` and its interstitial branch (see Change 4).
- **Testids:** `sessions-new-button` (existing), `sessions-new-picker` (popover root), `sessions-new-picker-project-<projectId>`, `sessions-new-picker-add-project`.

### Change 2 — draft sidebar row
**Files:** new `features/sessions/sidebar/DraftSessionRow.tsx`; `features/sessions/view-model/group-sessions.ts` (`arrangeSessions`); `features/sessions/sidebar/SessionListVirtuoso.tsx` / `SessionSidebar.tsx` wiring.

- The draft is prepended **above all time groups** as a synthetic leading group (or an explicit row rendered before `SessionListVirtuoso`). It respects the project filter: hidden when a *different* project's pill is active.
- Row anatomy (matches handoff): geometry equal to `SessionRow`; leading **8px hollow, 1.5px dashed** dot (accent when selected, `text3` otherwise); title `New Session` (13px, 600 selected / 500 muted); trailing `now` that swaps to a single **✕ discard** (20px hit target) on hover; meta line = project chip (All view only) + ghost text `draft — clears if you leave without sending`.
- **At most one** (aui reuses a single `newThreadId`). Re-"+" (any project) **retargets** via `patchDraftConfig({ projectId })`, never stacks.
- Select = `switchToThread(newThreadId)` and remember previous selection. Discard (✕, or selecting any other session while the draft is unsent) = `resetNewThreadDraft(newThreadId)` + restore previous selection.
- **Testids:** `sessions-draft-row`, `sessions-draft-row-discard`, `sessions-draft-row-title`.

### Change 3 — draft chat surface (header + composer)
**Files:** `features/sessions/new-thread/ChatSurface.tsx`; `features/chat/thread/ChatCardHeader.tsx`.

- `ChatSurface` renders, for a draft (`isNewLocal`): the header + the new `ChatEmptyState` (Change 4) — never the interstitial.
- `ChatCardHeader` draft variant: grip · chat icon · title `New Session` (not the `Untitled` fallback) · **project chip** (16px, `projectColor` recipe) · spacer · split/hide. Model chip, context meter, review, PR pills stay absent (`ChatSessionInline` already returns null without a loaded chat config; review is worktree-gated; no `detectedPrs` on a draft).
- Composer unchanged: `use-composer-tuning` already detects `isLocalDraft` and unlocks provider/model, routing setters to `draft-config`; locks on first message.

### Change 4 — Welcome / suggestions empty-state
**Files:** new `features/sessions/new-thread/ChatEmptyState.tsx`; new `features/sessions/new-thread/use-repo-suggestions.ts`; new daemon endpoint (below); `lib/api/` client.

Rendered by `ChatSurface` for a draft with a resolved project. Centered column, max-width 440, min-height 100%:
- **Context line:** project chip (18px, `projectColor`) + branch (branch icon + current branch name in mono, from git status).
- **Headline** `What should we take on?` + sub copy (per handoff).
- **`FROM THE REPO`** section — up to **3** suggestion rows from `useRepoSuggestions(projectId)`. Row = icon tile (26×26, tint@~8%) · title (imperative, ellipsis) · meta (`source · detail`) · trailing `⏎ insert` that fades in on hover. If the hook returns 0 rows (or errors), the section does not render — the welcome state still shows headline + composer.
- **Click = pre-fill only:** `aui.composer().setText(suggestion.prefill)` (existing API; precedent `features/tasks/use-start-todo-session.ts`). Nothing runs until send; re-click replaces the prefill.
- **Tint by kind:** churn/neutral → accent (`--primary`); TODO/warning → amber (`--mf-warning`). (PR→green deferred with the PR source.)
- **Testids:** `sessions-welcome`, `sessions-welcome-suggestion-<n>`, `sessions-welcome-suggestion-insert`.

**New daemon endpoint — `GET /api/projects/:id/suggestions`** (in `packages/core`):
- Aggregates cheap, real signals into ≤3 ranked `Suggestion { icon, tint, title, meta, prefill }`:
  - **Churn:** derive from existing git status/diff routes (recent activity on the default branch / working tree) → e.g. "Summarize what changed on `<branch>`" / "Review the working changes in `<path>`".
  - **TODO comments:** a **bounded** repo scan (ripgrep/`git grep` for `TODO`/`FIXME`, capped count + time budget, path-contained via the existing symlink-containment guard) → "Clean up the N TODO comments in `<area>`".
- Returns `[]` when nothing qualifies. Zod-validated response; typed in `@qlan-ro/mainframe-types`; async, non-blocking; client hook tolerates empty/error → renders no section.

### Change 5 — First-run (zero projects)
**File:** `features/sessions/new-thread/ChatEmptyState.tsx` (proj-less branch).

- When `useProjects().projects.length === 0`: render the hero — glyph tile (44×44, accent@~7%, folder-git icon), `Welcome to Mainframe`, sub copy, **primary CTA** `Add project…` (30px, accent bg, folder-plus → `useAddProject`), footnote. **No composer.** Header shows title + window controls only (no project chip).
- **Testids:** `sessions-firstrun`, `sessions-firstrun-add-project`.

## Data & types
- `Suggestion` type + Zod schema in `@qlan-ro/mainframe-types` (single canonical type). `icon` is a lucide name; `tint` an enum (`accent | amber`); `prefill` the composer text.
- Project identity color from existing `features/sessions/sidebar/project-color.ts` (`projectColor`).
- Branch name from the existing git status route.

## Testing
- **Unit (vitest, `packages/ui`):** `arrangeSessions` prepends the draft group and respects the filter; `DraftSessionRow` states (selected/unselected, All vs pill view, discard); `ChatEmptyState` welcome vs first-run branch; `useRepoSuggestions` empty/error → no section; picker popover project rows + counts.
- **Core:** `/api/projects/:id/suggestions` handler — churn + TODO aggregation, ≤3 cap, empty case, path containment; Zod contract.
- **E2E hooks:** every new interactive element carries a scoped `data-testid` (listed per change). Existing mock harness (`packages/e2e`) drives "+" → popover → draft row → welcome → suggestion prefill → first send commits.
- Run targeted vitest files (not whole-suite; app-tauri suites cross-pollute React.act — run sharded/isolated) and `pnpm --filter @qlan-ro/mainframe-ui typecheck` + core typecheck before completion. Changeset required.

## Out of scope (deferred)
- Open-PR and failing-CI-check suggestion rows (need GitHub API + auth) — later spec; the `/suggestions` endpoint is designed to grow these sources without a contract break.
- Any change to the committed-session row, tags/rename/archive, or the time-grouping logic beyond prepending the draft group.
