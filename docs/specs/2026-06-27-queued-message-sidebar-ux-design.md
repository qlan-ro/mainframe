# Queued-Message & Sidebar UX — Bundled Design

**Date:** 2026-06-27
**Status:** Approved (design)
**Branch:** feat/app-tauri-wt

## Problem

Four related UX gaps observed in the app-tauri client:

1. **Breadcrumb tooltip** — the inspect-capture CSS-selector chip (e.g.
   `div > div.min-h-screen.bg-backgr…`) on a chat message is CSS-truncated with no
   way to read the full selector.
2. **Queued action buttons missing (2a)** — on a capture/attachment-only queued
   message (no text body), the Edit/Cancel actions are effectively invisible.
3. **Cancel never works (2b)** — clicking Cancel on a queued message reliably fails
   with "Couldn't cancel the queued message." Root cause confirmed below.
4. **Filter pills don't activate a session (3)** — clicking a project filter pill
   filters the list but does not open that project's most-recent session.

## Root cause — 2b (the load-bearing finding)

When a message is sent while a run is in progress, the daemon **writes it to the CLI's
stdin immediately** (`packages/core/src/chat/chat-manager.ts:350`,
`ClaudeSession.sendMessage`), then records a `QueuedMessageRef` and emits
`message.queued`. The CLI holds the message in its own async queue and replays it when
the current turn ends (`isReplay` ack).

Cancel calls `ClaudeSession.cancelQueuedMessage(uuid)`
(`packages/core/src/plugins/builtin/claude/session.ts:478`), which sends the CLI a
control request `{ subtype: 'cancel_async_message', message_uuid }` and waits up to 5s
for a `control_response { cancelled }`.

**The CLI does not implement `cancel_async_message`.** Verified against the authoritative
leaked CLI source (`~/Projects/qlan/claude-code/src`): the stdin transport handles
`can_use_tool`, `interrupt`, `set_model`, etc. — there is no `cancel_async_message`
subtype. The request is silently ignored → the 5s timer fires → `cancelled` resolves
`false` → `ChatManager.cancelQueuedMessage` emits `message.queued.cancel_failed`
(`chat-manager.ts:400`) → the UI shows the toast (`chat-event-router.ts:44`). The
`messageId → uuid` lookup is correct; the cancel **mechanism** targets a no-op. Cancel
can never succeed while the CLI owns the message.

The only correct fix is to stop forwarding the message to the CLI until it can no longer
be cancelled — i.e. **the daemon holds the queue and flushes on run-end**.

## Decisions

| Question | Decision |
|----------|----------|
| Scope | One bundled spec, four sections; 2b included (the real daemon fix, not a stop-gap). |
| 2a — Edit on capture-only queued messages? | **Yes** — Edit loads the composer so the user can add/replace text while keeping the capture. |
| 2b — approach | **Daemon owns the queue**; remove the `cancel_async_message` path. |
| 4 — fallback when project has no remembered session | Fall back to the project's **most-recent-by-time** session. |
| 4 — D12 | This deliberately **reverses D12** ("filter pill is view-only — no auto-activate"). |

## Section 1 — Breadcrumb tooltip

**File:** `packages/ui/src/features/chat/messages/UserAttachments.tsx`

Wrap the selector `<code className="truncate font-mono text-caption text-mf-code-fn">`
in the existing `TruncatedWithTooltip` primitive
(`packages/ui/src/components/ui/truncated-with-tooltip.tsx`, Radix-based, already used by
`SessionRow`/`FileTree`). Pass the full selector as both text and tooltip, with
`contentClassName="font-mono break-all"`. Add `data-testid="chat-capture-selector"` to the
chip. No new dependency.

**Testing:** unit — the selector element carries the testid and renders the full selector
text as the tooltip content/trigger. (Radix tooltip visibility on hover is integration-only;
assert the wiring + testid, not the portal.)

## Section 2 — Queued action buttons reliably visible (2a)

**File:** `packages/ui/src/features/chat/messages/QueuedUserTurn.tsx`

Today the actions row sits to the left of the text bubble inside the main row; when there
is no text body (`children` null), the bubble is skipped, `Edit` is suppressed
(`{content && …}`), and the lone Cancel renders in a detached hover row that reads as "no
buttons."

Change:
- Render the Edit/Cancel action group attached to the card in a consistent position
  whether or not a text bubble is present, so capture/attachment-only queued messages show
  the actions in the same place text ones do.
- **Enable Edit for capture-only queued messages** — `Edit` opens the composer edit mode
  (loads any existing text, empty allowed) so the user can add/replace text while keeping
  the capture. Remove the `{content && …}` suppression; `Edit` is always present, `Cancel`
  always present.
- Keep hover/focus reveal (existing opacity/translate animation), but ensure the
  `group/queued` hover target spans the whole `chat-queued-message` card including the
  `extrasSlot` row, so hovering the capture chip reveals the actions.

Preserve `data-testid` `chat-queued-edit` / `chat-queued-cancel` / `chat-queued-message`.

**Testing:** unit — render a queued turn with `children=null` + an `extrasSlot`; assert both
`chat-queued-edit` and `chat-queued-cancel` are present and clicking each fires the edit /
cancel handlers; render with a text body and assert the same.

## Section 3 — Daemon owns the queue (2b)

**Files:** `packages/core/src/chat/chat-manager.ts`,
`packages/core/src/chat/event-handler.ts`, and the queued-event plumbing they use;
remove the `cancel_async_message` path in
`packages/core/src/plugins/builtin/claude/session.ts`.

### Model change

When a send would be queued (`postStart.session.supportsReplayAck === true &&
chat.processState === 'working'`), the daemon **does not** call `session.sendMessage`.
Instead it appends the message to a per-chat FIFO queue held in `ChatManager`
(`private chatQueues = new Map<string, QueuedItem[]>` where `QueuedItem` carries
`messageId`, `uuid`, `content`, `attachmentIds?`, images, `timestamp`). It still:
- creates the transient display message (`message.added` + `emitDisplay`) so the queued
  card renders, and
- emits `message.queued` with the `QueuedMessageRef`.

The existing `queuedRefs` map is replaced by (or folded into) `chatQueues` — the daemon is
now the single source of truth for not-yet-sent messages.

### Cancel (now reliable)

`ChatManager.cancelQueuedMessage(chatId, messageId)`:
- find the item in `chatQueues[chatId]` by `messageId`; if absent, no-op;
- remove it, remove the transient message (`messages.removeById`), emit
  `message.queued.cancelled` + `emitDisplay`.
No CLI round-trip; cannot time out. Delete `ClaudeSession.cancelQueuedMessage`, the
`cancel_async_message` control request, and the `pendingCancelCallbacks` response routing
(now dead).

### Edit (now reliable)

`ChatManager.editQueuedMessage(chatId, messageId, content)`:
- mutate the held item's `content` (and the transient message text) in place;
- emit a `message.queued.snapshot` so the renderer converges.
Still reliable because the message has not been sent.

### Flush on run-end

In `event-handler.onResult`, when a turn completes and the chat would transition to
`idle` (`processState`) but `chatQueues[chatId]` is non-empty:
- dequeue the head item, call `session.sendMessage(content, images, /* no uuid */)` to send
  it as the next run, emit `message.queued.processed` for that item, and keep
  `processState='working'`.
- When the queue is empty, transition to `idle` as today.
This preserves FIFO and the "sends after the current run" semantics; flushed messages
become normal in-flight turns. Because held items are never written to the CLI before
flush, they produce no `isReplay` acks — the orphan-reconciliation block in `onResult`
(built around CLI replay races) shrinks to handle only genuinely-sent turns.

### Unaffected

Codex and Claude-SDK adapters consume `sendMessage` synchronously
(`supportsReplayAck !== true`) and never queue — their path is unchanged.

### Risk

This is the highest-risk section: it moves queue ownership and changes the run-lifecycle
flush. Mitigation = heavy ChatManager unit coverage (below) and keeping the change inside
`packages/core` (clean of the concurrent session's edits, which are all in `packages/ui`).

**Testing (unit, ChatManager / event-handler):**
- Send while working → message held in `chatQueues`, `message.queued` emitted, **CLI
  `sendMessage` NOT called**.
- Cancel a held message → removed from `chatQueues`, `message.queued.cancelled` emitted,
  **no CLI control request**.
- Edit a held message → content updated, snapshot emitted.
- Run-end with a non-empty queue → head item sent to CLI (`sendMessage` called once),
  `message.queued.processed` emitted, `processState` stays `working`.
- Multi-item queue → drains in FIFO across successive run-ends; empties → `idle`.
- Send while idle → sent immediately, never queued (unchanged).

## Section 4 — Project-scoped filter selection (3)

**Files:** `packages/ui/src/store/last-session.ts` (extend additively),
`packages/ui/src/features/sessions/sidebar/ProjectFilterPillBar.tsx` +
`SessionSidebar.tsx` (wire activation), reading the activation seam from the existing
`setSessionNavigator` / `runtime.threads.switchToThread`.

### Store extension (coordinate with in-flight work)

`last-session.ts` is currently being edited by a concurrent session. Extend it
**additively**: add `lastByProject: Record<string, string>` (projectId → daemon chatId)
plus `setLastForProject(projectId, chatId)`. Update it wherever `setLastSessionId` is
already called on session activation (`use-session-list-router.ts`), using the active
session's `custom.projectId` + `remoteId`. Persist under the same `mf:last-session` key
(bump the persisted `version` and provide a migration that defaults `lastByProject` to
`{}`).

### Filter-pill activation

When `ProjectFilterPillBar` selects a non-null project (not the "All" pill, not a toggle-
off), after setting `filterProjectId`, resolve the target session:
1. `lastByProject[projectId]` if it maps to a live, non-archived session in the list;
2. else `pickInitialSession(items.filter(i => i.custom.projectId === projectId))`
   (most-recent-by-time);
3. if the project has no sessions, do nothing (just filter).
Then activate it via the existing navigator (`switchToThread`). Lift this logic to
`SessionSidebar` (which already has the items + filter setter), passing a single
`onSelectProject(projectId)` callback into the pill bar rather than reaching into the
runtime from the pill. Toggling a pill **off** (back to "All") does not change the active
session.

This reverses D12 (view-only). The existing cross-project-filter-clear in
`use-session-list-router` (clears the filter when the user activates a session in a
different project) remains and is consistent with this change.

**Testing:** unit —
- `last-session` store: `setLastForProject` writes the per-project entry; persistence
  migration yields `lastByProject={}` from a v1 blob.
- selection resolver: returns the remembered session when live; falls back to
  most-recent-by-time when the remembered one is archived/missing; returns null when the
  project has no sessions.
- pill activation: selecting a project calls the navigator with the resolved id; toggling
  off does not.

## Cross-cutting

- **Changeset:** `@qlan-ro/mainframe-core` (minor — queue ownership), `@qlan-ro/mainframe-ui`
  (minor — tooltip + queued buttons + filter activation), `@qlan-ro/mainframe-types`
  (patch — any `QueuedItem`/event shape touch-ups).
- **Plan sequencing:** Section 3 (core) is independent and lands first/parallel; Sections
  1, 2, 4 are UI. Section 4 coordinates with the in-flight `last-session.ts` (additive
  edits, explicit-pathspec commits — shared worktree).
- **Shared-worktree hygiene:** a concurrent session edits `packages/ui` (chat/controller,
  sessions, `last-session.ts`). All commits stage only their own files by explicit
  pathspec. Run UI tests isolated (`cd packages/ui && pnpm exec vitest run <path>`); the
  `--filter` form runs the whole suite.

## Files Touched (summary)

- `packages/ui/src/features/chat/messages/UserAttachments.tsx` — selector tooltip.
- `packages/ui/src/features/chat/messages/QueuedUserTurn.tsx` — action visibility + Edit on
  capture-only.
- `packages/core/src/chat/chat-manager.ts` — daemon queue ownership, cancel/edit, flush.
- `packages/core/src/chat/event-handler.ts` — run-end flush hook.
- `packages/core/src/plugins/builtin/claude/session.ts` — remove `cancel_async_message`.
- `packages/ui/src/store/last-session.ts` — `lastByProject` + migration.
- `packages/ui/src/features/sessions/sidebar/ProjectFilterPillBar.tsx`,
  `SessionSidebar.tsx` — project-scoped activation.
- `packages/ui/src/features/sessions/ws/use-session-list-router.ts` — write per-project last.
- Tests alongside each; a changeset.

## Risks

- **Section 3 lifecycle:** the run-end flush must fire exactly once per run-end and only
  send the next item; double-flush would double-send. Covered by the multi-item drain test
  and an explicit "flush sends exactly one per run-end" assertion.
- **Reconciliation regression:** removing the replay-ack-driven queued path must not strand
  the `metadata.queued` flag on genuinely-sent turns. Keep the snapshot-on-result emit.
- **Section 4 store collision:** `last-session.ts` is co-edited; additive shape + explicit
  pathspec commits reduce but don't eliminate merge friction.
