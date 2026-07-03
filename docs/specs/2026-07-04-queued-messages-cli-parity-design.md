# Queued Messages: CLI Parity

**Date:** 2026-07-04
**Status:** Approved
**Branch:** feat/app-tauri-wt

## Problem

The 2026-06-27 refactor made the daemon hold messages sent while a chat is
`working` (`ChatManager.chatQueues`) and flush one per run-end. This bypasses
the Claude CLI's own queue and loses two behaviors the CLI provides natively:

- **Mid-turn drain** — the CLI injects queued messages into the *current* turn
  between tool calls (as a system-reminder attachment), so the model addresses
  a follow-up without waiting for the run to end. With the daemon queue, every
  queued message waits for the full run.
- **Batching** — the CLI merges N queued prompts into one follow-up turn. The
  daemon queue produces N serial runs, each blind to the later messages.

The refactor's rationale — "the CLI never implemented `cancel_async_message`" —
is wrong. The CLI implements it (`src/cli/print.ts:3011` in the leaked source:
removes the message by uuid, responds `{cancelled: boolean}`). The old
always-failing cancel had another cause, so the fix is to verify the control
request works and rebuild on it.

A secondary problem: the live transcript shows a queued bubble at *send* time,
but the CLI's JSONL records it at *consumption* time, so reloads reshuffle
message order.

## Design

### Architecture: the CLI owns the queue

`ChatManager.sendMessage` always writes to the CLI immediately
(`session.sendMessage(content, images, uuid)`), including while
`processState === 'working'`. Delete the hold path: `chatQueues`, `QueuedItem`,
`flushNextQueued`.

When the chat is working and the adapter `supportsReplayAck`, the daemon:

1. generates a uuid and passes it to the CLI (which dedups by uuid),
2. marks the transient bubble `metadata.queued` + `metadata.uuid`,
3. stores a `QueuedMessageRef` in a revived `queuedRefs: Map<uuid, ref>`,
4. emits `message.queued` (event contract unchanged).

The CLI queues, drains mid-turn or batches between turns, and — because we
spawn with `--replay-user-messages` — emits an `isReplay` user event per uuid
at the moment of consumption. That ack is the single "processed" signal.

`EventHandler.onResult` keeps `processState: 'working'` while `queuedRefs` is
non-empty (existing gate, retargeted from `chatQueues`), and its orphan
reconcile (stale flags ↔ refs) remains the safety net.

### Display: move on process

On each `isReplay` ack, the event-handler:

- strips `queued`/`uuid` from the cached message's metadata,
- **moves the message to the end of the chat's message list** — the ack fires
  when the CLI injects the message into context, so bottom-at-ack-time is the
  consumption point,
- emits `message.queued.processed` and a display delta,
- deletes the ref (via the chat-manager callback).

Live order now matches JSONL order, so reloads no longer reshuffle. Batched
messages relocate one-by-one in ack order and end up adjacent. The composer
banner (edit/cancel UI) is unchanged — it already keys off the queued events.

### Edit/cancel: CLI round-trip, silent reconcile

Revive `ClaudeSession.cancelQueuedMessage(uuid)`: send
`cancel_async_message {message_uuid}`, route the `control_response` back
(pendingCancelCallbacks + events.ts routing), 5s timeout → `false`.

- **Cancel, `cancelled: true`** → remove the bubble (`messages.removeById`),
  delete the ref, emit `message.queued.cancelled`.
- **Cancel, `false` or timeout** → do nothing, no toast. The message was (or is
  being) consumed; the imminent ack moves the bubble and clears the banner.
- **Edit** → cancel first. On success: update the same bubble's content,
  assign a fresh uuid, re-send, update the ref, emit `message.queued.snapshot`.
  On lost race: silently discard the edit — the original went through.

### Reload fidelity: unwrap the queued wrapper

Mid-turn-drained messages persist to JSONL as
`<system-reminder>The user sent a new message while you were working:\n<text>\n\nIMPORTANT: …</system-reminder>`.
`convertUserEntry` in `history.ts` detects exactly this shape and extracts the
original text. The regex is pinned against a real JSONL fixture captured by the
step-0 probe. Other wrapper origins (task-notification, channel) are untouched.
Between-turn batches stay one merged bubble on reload (unsplittable).

### Step 0: live probe (gate)

Before any daemon changes, a scripted probe against the installed CLI binary
(scratch session, long tool turn) must confirm:

1. mid-turn drain of a message sent during a running turn (wrapped attachment
   in JSONL + per-uuid `isReplay` replay over stream-json),
2. per-uuid replays for a between-turn batch,
3. `cancel_async_message` → `{cancelled: true}` while queued, `{cancelled:
   false}` after consumption, with the response arriving mid-run (not blocked
   until run-end).

Findings go to `docs/adapters/claude/QUEUE.md`. **If the probe fails, stop and
reassess** — do not ship a cancel that times out.

## Edge cases

- **CLI exits with pending refs**: `clearAllQueuedForChat` clears refs, strips
  `queued` badges from cached bubbles, emits `message.queued.cleared` + display
  delta. Messages stay visible but unsent (accepted loss).
- **Daemon restart**: refs and CLI die together; `recoverStaleWorkingState`
  resets `processState`. No queue persistence (non-goal).
- **Ack never arrives**: `onResult` reconcile prunes orphan flags/refs at turn
  end.
- **Duplicate sends**: CLI dedups by uuid and still acks the duplicate.

## Non-goals

- `priority: 'now'` interrupt-and-inject (protocol supports it; future work).
- Splitting merged batch entries on reload.
- Queue persistence across daemon restarts.
- Codex adapter changes (it consumes `sendMessage` synchronously; the
  `supportsReplayAck` gate keeps it off this path).

## Testing

- **Core unit**: immediate stdin write + ref creation while working; ack →
  move + strip + events + ref deletion; cancel true/false/timeout; edit
  success/lost-race; exit clearing; `onResult` gate + reconcile; history
  unwrap fixtures (wrapped mid-turn entry, merged batch entry,
  task-notification untouched).
- **UI**: bubble relocates on `.processed`, badge clears, banner add/remove.
- **Live**: step-0 probe script; manual dev-app pass (3 messages during a long
  turn → mid-turn response or one batched follow-up, bubbles moving as
  processed).

Changesets: `@qlan-ro/mainframe-core` minor, `@qlan-ro/mainframe-ui` patch.
