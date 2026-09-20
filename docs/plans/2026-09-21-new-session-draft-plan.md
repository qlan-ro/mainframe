# New session: chat-only workspace + inherited project (todo #354)

## Goal

Clicking "+" (sidebar button, sidebar New Thread row, session-tab strip, ⌘N) must open a draft that
looks new and lands where the user already was. Today the draft is invisible to the layout store, so
the previous session's Workspace arrangement stays lit, surface toggles made on the draft are written
onto the *previous* session's remembered layout, and the first send re-seeds a chat-only layout that
snaps the Workspace shut. And without a project filter pill the draft opens projectless, forcing a
"Choose a project" step whose list is ordered by when projects were added. This plan makes the layout
store follow the draft by its local id (fresh arrangement per New, never persisted, carried over to
the real chat on first send) and routes all four entry points through one target-project resolver
(pill → active session's project → none), with the welcome picker ordered by the recency ranking the
sessions sidebar already uses.

Everything is in `packages/ui`. No daemon, route, schema or types change.

## Established facts

Each verified while planning, with its receipt (paths relative to the repo root).

- `setActiveSession(id)` restores an existing entry or seeds a `structuredClone(INITIAL_LAYOUT)`
  (`top: ['chat']`, `bottom: null`) for an unknown id — `packages/ui/src/store/layout.ts:144-150`.
- Every mutation routes through `writeWorkspace`, which writes into `sessions[activeSessionId]`; with
  `activeSessionId` still pointing at the previous chat, a toggle made on a draft lands on that chat
  — `packages/ui/src/store/layout.ts:113-125`.
- Persistence already excludes drafts: `serializeSessions` skips ids starting with `__LOCALID_`
  — `packages/ui/src/store/layout-persist.ts:33-41`.
- The router's active-thread effect returns inside its draft branch **before**
  `rememberActiveSession` runs, so no draft ever reaches the layout store
  — `packages/ui/src/features/sessions/ws/use-session-list-router.ts:184-209` and `:227`.
- `rememberActiveSession` also writes `setLastSessionId` / `setLastForProject`; a `__LOCALID_*` id must
  never reach those (boot restore would target a dead draft)
  — `packages/ui/src/features/sessions/ws/use-session-list-router.ts:46-51`.
- The first-send handoff point — where the local id's `remoteId` is known and the router switches to
  the canonical item — is `packages/ui/src/features/sessions/ws/use-session-list-router.ts:190-194`.
- The layout GC builds its valid set from `remoteId` only, so a `__LOCALID_*` entry is pruned on the
  next thread-list change — `packages/ui/src/features/sessions/ws/use-session-list-router.ts:255-259`
  and `prunePersistedSessions` at `packages/ui/src/store/layout-persist.ts:49-56`.
- assistant-ui reuses ONE `newThreadId` slot for every New until a send commits it; the canonical
  "start a fresh New" reset point is `resetNewThreadDraft`
  — `packages/ui/src/features/sessions/new-thread/reset-new-thread-draft.ts:5-7,37-45`.
- `sortProjectsByRecentActivity(projects, items)` ranks by each project's newest session `updatedAt`,
  sends projects with no sessions last (`?? 0`) and tiebreaks by the incoming daemon order — exactly
  the ordering decision in the brief — `packages/ui/src/features/sessions/view-model/project-activity.ts:4-19`.
  Its only caller today is `packages/ui/src/features/sessions/SessionSidebar.tsx:102`.
- `useActiveIdentity().projectId` is draft-aware: `resolveActiveScope` prefers a live session's
  `custom.projectId` and falls back to the seeded draft config, returning `undefined` when neither
  exists — `packages/ui/src/features/sessions/use-active-identity.ts:41-72` and
  `packages/ui/src/features/sessions/view-model/draft-identity.ts:37-56`.
- `soleProjectId(ids)` returns `null` unless exactly one project is filtered
  — `packages/ui/src/store/session-filters.ts:25-29`.
- `initializeDraft` flips the ready-store status to `initializing` synchronously on entry (before its
  first `await`) — `packages/ui/src/features/sessions/new-thread/initialize-draft.ts:17-21` with
  `beginInitialization` at `packages/ui/src/features/sessions/runtime/new-thread-ready-store.ts:55-66`.
- `ChatSurface`'s "Initializing session…" gate only suppresses the choose-a-project welcome when a
  **pill** is active (`filterProjectId != null`)
  — `packages/ui/src/features/sessions/new-thread/ChatSurface.tsx:100,120-143`.
- `useNewThreadAutoConfig` seeds a draft only from the sole pill project, and already guards
  ready/existing-config/discarded and waits for adapters
  — `packages/ui/src/features/sessions/new-thread/use-new-thread-auto-config.ts:36-57`.
- Two near-identical bindings of the same sequence exist: `use-open-draft.ts` (sonner `toast.error`,
  called only by `SessionsNewButton.tsx:15,28` and `SidebarActions.tsx:16,27`) and
  `use-open-new-thread-draft.ts` (`mfToast`, called by
  `packages/ui/src/features/chat/thread/ChatSelectionToolbar.tsx:16,22`).
- `useNewChatHotkeyHandler(aui)` backs both ⌘N (`packages/ui/src/app/AppShell.tsx:31,69`) and the tab
  strip "+" — and is also the close-last-tab fallback at
  `packages/ui/src/features/session-tabs/SessionTabs.tsx:71,155,254`.
- `docs/plans/` is gitignored (`.gitignore:53`), so this plan is committed with `git add -f`.

## Design

**Layout follows the draft.** The draft becomes a first-class layout key: the router seeds/restores
`setActiveSession(localDraftId)` while a `__LOCALID_*` thread is active, so `activeSessionId` always
matches what is on screen and no draft toggle can write through to the previous session.
`resetNewThreadDraft` drops that entry, so each New starts chat-only even though the slot id is
reused. The first-send handoff renames the entry from the local id to the daemon chat id, so the
arrangement in effect survives the commit. Persistence is already draft-safe; the GC is not, and must
stop pruning the live draft entry.

**One target resolver.** A pure `resolveNewSessionProject(pillProjectId, activeProjectId)` returns the
pill's sole project, else the active session's (draft-aware) project, else `null`. A single
`useStartNewSession()` hook resolves it at click time and runs the existing, already-tested
`openNewThreadDraft` sequence (reset slot → return target → switch → `initializeDraft`) via the
`mfToast` binding; with no target it falls back to reset + switch, leaving the welcome picker in
charge. Seeding therefore stays imperative and no new seeding path is introduced.

**Why a pending-target store.** `ChatSurface` only suppresses the choose-a-project welcome while a
*pill* is active, so on the no-pill path the frame between `await switchToNewThread()` and
`initializeDraft`'s synchronous status flip would render "Choose a project" — the state the
acceptance criteria forbid. The action stashes the resolved target *before* the switch and clears it
in a `finally`; `ChatSurface`'s gate reads `pill ?? pending`. It is a short-lived render gate, not a
seeding input: nothing reads it to decide what project to create in, so an archive-induced or boot
draft can never inherit it.

**Picker ordering** is pure wiring: feed `sortProjectsByRecentActivity` into the welcome chip's
dropdown. No second ranking.

## Decisions taken while planning

1. **`useNewThreadAutoConfig` is left alone; the click seeds imperatively.** The brief lists
   auto-config among the entry points needing shared resolution, but it runs *after* the switch, when
   the active thread is already the draft — it cannot read "the project that was active at click
   time", and making it consume a click-time value is actively unsafe: its cleanup calls
   `cancelInitialization` on every dep change (`use-new-thread-auto-config.ts:54-56`), so clearing a
   pending value the effect depends on would cancel the initialization it just started
   (`initialize-draft.ts:29` then returns without seeding) and land the user back on
   choose-a-project. The shared resolution therefore lives at the click, and seeding reuses
   `openNewThreadDraft`. Auto-config stays the pill-only fallback it is today (⌘N with a pill still
   reaches it, harmlessly — `initializeDraft` is attempt-guarded and `openNewThreadDraft`'s reset
   runs first; this pill double-path already exists on `SessionsNewButton`).
2. **All four entry points now set a draft return target** (only the pill path did). Discard from any
   of them now returns to the session the user came from.
3. **Multi-project pill:** `soleProjectId` is `null` for more than one selected project, so the
   resolver falls through to the active session's project; if that project is outside the filter set,
   the action clears the filter — the same rule `openNewThreadDraft` applies today
   (`open-new-thread-draft.ts:46-48`), so the new draft row stays visible.
4. **`use-open-draft.ts` is deleted** once its last two callers move to the shared action; the
   `mfToast` binding (`use-open-new-thread-draft.ts`) stays for `ChatSelectionToolbar`'s prefill path.
   No leftovers.
5. **"Switch away from a draft and back keeps its arrangement"** is only reachable for a *projectless*
   draft: `useDraftRow`'s navigate-away effect treats leaving a configured draft as a discard and
   calls `resetNewThreadDraft` (`sidebar/use-draft-row.ts:60-73`), which now also drops the layout
   entry. Do not write a test for the unreachable case.
6. The pending-target store is module state, not persisted — a draft target must never survive a
   restart — and it is cleared only by the action that set it, so `resetNewThreadDraft` stays out of
   Group 2 and the two groups share no files.

## Groups

The two groups touch disjoint files and have no ordering constraint — they can run in parallel.

### Group 1 — draft-layout-follow (kind: ui)

Files: `packages/ui/src/store/layout.ts`, `packages/ui/src/store/layout-persist.ts`,
`packages/ui/src/features/sessions/ws/use-session-list-router.ts`,
`packages/ui/src/features/sessions/new-thread/reset-new-thread-draft.ts`, plus their tests.

**1.1 (red) Layout-store unit tests.** Extend `packages/ui/src/store/__tests__/layout-engine.test.ts`
(or add a sibling `layout.draft.test.ts`) for: `dropSession(id)` removes the entry and, when that id
is the active one, re-seeds a chat-only arrangement in place; `dropSession` disposes the entry's
terminals and URL tunnels; `adoptSession(from, to)` moves the entry (layout + run) under the new key
*without* disposing anything, deletes the source, and repoints `activeSessionId` when it was the
source; `pruneSessions` keeps the active `__LOCALID_*` entry while still dropping stale local ids and
unknown chat ids. *Verification intent:* these fail for the missing actions before 1.2 lands.

**1.2 Layout-store actions.** In `store/layout.ts` add `dropSession(sessionId)` and
`adoptSession(fromId, toId)` to `LayoutStore` and the returned object (both `structuredClone`
`INITIAL_LAYOUT` when re-seeding, matching `setActiveSession`). In `store/layout-persist.ts` export a
shared `isDraftSessionId(id)` (the `__LOCALID_` prefix test `serializeSessions` already performs) and
use it in `serializeSessions`; change `pruneSessions` in `store/layout.ts` to keep the entry whose id
is both a draft id and the current `activeSessionId`. `dropSession` must honour kill-before-remove:
a draft can own terminals and URL tabs once it has a launch scope, so mirror `closePane`
(`layout.ts:262-270`) and call `killAndDisposeCachedTerminals` + `releaseUrlTunnels` for the dropped
entry's tabs — both helpers are already imported, though the ids must be collected across ALL panes
of the entry (`tabIdsInPane` is per-pane). `adoptSession` moves the same tabs to a live
session and must NOT dispose; if the destination id somehow already has an entry, the draft's entry
(what is on screen) wins. *Verification intent:* 1.1 passes; the existing prune and persistence tests in
`store/__tests__/layout-persist.test.ts` still pass unchanged.

**1.3 (red) Router tests.** In `packages/ui/src/features/sessions/ws/__tests__/use-session-list-router.test.tsx`,
replace the existing `does not touch the layout store while the active thread is the __LOCALID_* draft`
case (it asserts the behavior this todo reverses) with: activating a `__LOCALID_*` thread makes it the
layout store's active session with a chat-only arrangement; a workspace toggle made while on the draft
leaves the previously active chat's remembered entry untouched; when the draft's `remoteId` appears
(the first-send handoff) the draft's entry is adopted under the remote id so the follow-up activation
restores it instead of re-seeding; a draft never writes `lastSessionId` / `lastForProject`.
*Verification intent:* the new cases fail before 1.4.

**1.4 Router wiring.** In `use-session-list-router.ts`: inside the draft branch, after the existing
`draftRemoteId` handoff check, call `useLayoutStore.getState().setActiveSession(mainThreadId)` guarded
on `mainThreadId` being a draft id and on `activeSessionId !== mainThreadId` (the effect re-runs on
every `items`/`threadItems` change — the guard keeps it a no-op), and set `lastLayoutSessionId` to the
same id so the split-member gate stays coherent. In the handoff block, call
`adoptSession(mainThreadId, draftRemoteId)` immediately before `threads.switchToThread(draftRemoteId)`.
Leave `rememberActiveSession` untouched. *Verification intent:* 1.3 passes and the rest of the router
suite (boot auto-select, archive fallback, split gate) is unchanged.

**1.5 Reset drops the draft's layout entry.** Add `useLayoutStore.getState().dropSession(newThreadId)`
to `resetNewThreadDraft`, alongside the config/ready/segments/references clears, and extend the file's
header comment by one line. Cover it in
`packages/ui/src/features/sessions/new-thread/__tests__/reset-new-thread-draft.test.ts`: after a reset,
the reused draft id has no layout entry, and when it was the active one the on-screen arrangement is
chat-only. *Verification intent:* the reset test file passes.

**Group exit:** the UI package typechecks and the touched test files pass.

### Group 2 — new-session-target (kind: ui, shares no files with Group 1)

Files: new `packages/ui/src/features/sessions/new-thread/resolve-new-session-project.ts`,
new `packages/ui/src/features/sessions/new-thread/pending-draft-project.ts`,
new `packages/ui/src/features/sessions/new-thread/use-start-new-session.ts`,
`packages/ui/src/features/sessions/new-thread/ChatSurface.tsx`,
`packages/ui/src/features/sessions/new-thread/WelcomeState.tsx`,
`packages/ui/src/features/sessions/SessionsNewButton.tsx`,
`packages/ui/src/features/sessions/SidebarActions.tsx`,
`packages/ui/src/features/sessions/SessionSidebar.tsx`,
`packages/ui/src/features/session-tabs/SessionTabs.tsx`, `packages/ui/src/app/AppShell.tsx`;
deleted: `packages/ui/src/features/sessions/use-open-draft.ts`,
`packages/ui/src/features/sessions/new-thread/use-new-chat-hotkey-handler.ts` (and its test).

**2.1 (red) Resolver test.** New
`packages/ui/src/features/sessions/new-thread/__tests__/resolve-new-session-project.test.ts`: the pill's
sole project wins over the active session's project; with no pill the active session's project is
returned; a projectless active thread (undefined project id) and no pill yields `null`; a
multi-project pill (sole id `null`) falls through to the active session's project.
*Verification intent:* fails until 2.2.

**2.2 Resolver + pending store.** `resolve-new-session-project.ts` exports the pure
`resolveNewSessionProject(pillProjectId: string | null, activeProjectId: string | undefined): string | null`.
`pending-draft-project.ts` exports a tiny zustand store (`projectId: string | null`,
`setPendingProject`, `clearPendingProject`) plus an imperative getter for non-React callers; it is
module state, never persisted, and only the action that sets it clears it. *Verification intent:*
2.1 passes.

**2.3 Shared action.** `use-start-new-session.ts` exports `useStartNewSession(): () => void`, which
reads `soleProjectId(filterProjectIds)` and `useActiveIdentity().projectId` and resolves the target.
With a target: `setPendingProject(target)`, then run the existing sequence through the `mfToast`
binding `useOpenNewThreadDraft()({ projectId: target })` — which already resets the slot, records the
return target, clears a mismatching filter (`open-new-thread-draft.ts:46-48`), switches and
initializes — and `clearPendingProject()` in a `finally` so an initialize failure cannot strand the
gate. Without a target: `resetNewThreadDraft(newThreadId)`, set the return target, then
`switchToNewThread()`, exactly as the projectless path does today. Cover the hook in
`packages/ui/src/features/sessions/new-thread/__tests__/use-start-new-session.test.tsx`: pill wins
over the active session; no pill inherits the active session's project; a projectless active draft
with no pill takes the no-target path; the pending target is set before the switch and cleared after
the sequence settles, including on failure. *Verification intent:* the new hook test passes.

**2.4 Close the choose-a-project flash.** In `ChatSurface.tsx`, use `filterProjectId ??
pendingProjectId` in the `isInitializing` idle branch (line 122) so the no-pill path shows
"Initializing session…" instead of the choose-a-project welcome between the switch and
`initializeDraft`'s synchronous status flip. `use-new-thread-auto-config.ts` is NOT touched (see
decision 1). Add the no-pill pending case to `ChatSurface.test.tsx`. *Verification intent:* the
ChatSurface suite passes with its existing pill and first-run cases unchanged.

**2.5 Entry points.** `SessionsNewButton` and `SidebarActions` call `useStartNewSession()` instead of
their local pill-vs-projectless branch (`SessionsNewButton` keeps `filterProjectName` for its label;
`SidebarActions`' now-unused `filterProjectId` prop goes, with `SessionSidebar.tsx:147` updated).
`SessionTabs` and `AppShell` use `useStartNewSession()` in place of `useNewChatHotkeyHandler(aui)` —
including the close-last-tab fallback in `SessionTabs`. Delete
`use-new-chat-hotkey-handler.ts` + `__tests__/use-new-chat-hotkey-handler.test.tsx` and
`use-open-draft.ts` (plus any test) once they have no callers; update the three
`SessionTabs.*.test.tsx` mocks that currently stub `useNewChatHotkeyHandler`. Existing
`data-testid`s (`sessions-new-button`, `sidebar-action-new-thread`, `session-tabs-new`) stay.
*Verification intent:* a grep finds no remaining reference to `useNewChatHotkeyHandler` or
`useOpenDraft`; the session-tabs and sessions suites pass.

**2.6 Picker ordering.** In `WelcomeState.tsx`'s `ProjectPicker`, order the dropdown with
`sortProjectsByRecentActivity(projects, threadItemsToSessionItems(threadItems))` — `threadItems` from
`useAuiState((s) => s.threads.threadItems)`, memoized. Per-item `data-testid="welcome-project-${id}"`
stays. Add a case to `__tests__/WelcomeState.test.tsx` asserting the rendered order puts the
most-recently-active project first and a session-less project last. *Verification intent:* the
WelcomeState suite passes.

**Group exit (also the lane's exit):** `pnpm --filter @qlan-ro/mainframe-ui typecheck` and lint are
clean, the touched UI test files pass, and a changeset for `@qlan-ro/mainframe-ui` accompanies the PR
(see `docs/guides/development.md` for the commands).

## Risks

- **Effect churn on the draft.** The router's draft branch runs on every `items`/`threadItems` change;
  the `activeSessionId` guard in 1.4 is what keeps `setActiveSession` from re-`set`ting and
  re-rendering the shell each reload. Drop the guard and the draft becomes a render loop.
- **Adopted run state.** `adoptSession` moves the draft's `run` (terminal/URL tabs opened while
  composing) onto the new chat id. That is the intended carry-over, and those tabs' launch scope is
  re-derived from the now-real session; watch for a tab whose scope key still names the draft.
- **Pending-target lifetime.** The store is a render gate held only across the `openNewThreadDraft`
  sequence and cleared in its `finally`. Miss the `finally` on the error path and the draft sits on
  "Initializing session…" with no way back — the error branch of `ChatSurface` never shows.
- **Silent project inheritance is a behavior change.** Clicking "+" from a session in project A now
  creates in A without asking. The welcome chip shows A and is one click to change (brief decision).
- **Existing router test reversal.** `use-session-list-router.test.tsx`'s
  "does not touch the layout store while … draft" case encodes today's bug; 1.3 replaces it rather
  than adding alongside.
