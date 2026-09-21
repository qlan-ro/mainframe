# Todo #342 — attachment-only user turns must render

## Goal

A send whose only payload is **file** attachments (no typed text) currently vanishes from the
transcript, live and after reload: the daemon stores a user message with an empty content list
whose attachment evidence lives only in metadata, and two independent daemon guards then erase it —
the display-shaping seam suppresses empty user messages, and the ACP encoder emits no message item
when no content leaf claimed the accumulator. Fix both daemon gates so a user message carrying
attachment evidence survives as a user turn with zero content blocks and its metadata intact. The
client already renders this correctly (pills, no empty bubble) and the optimistic-send reconciler
already keys attachment-only sends on a sentinel, so no client source change is needed — only
tests. Image-only sends, text+attachment sends and text-only sends must be unchanged, and the
`<command-name>` echo suppression that gate 1 exists for must keep firing.

## Files touched

| File | Change |
| --- | --- |
| `packages/core-rs/crates/mainframe-types/src/display.rs` | New shared predicate `has_attachment_evidence(Option<&HashMap<String, Value>>) -> bool`: true when metadata carries a non-empty `attachments` **or** `attachedFiles` array. Both consuming crates already depend on `mainframe-types`. |
| `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_pipeline.rs` | **Gate 1**, in the `ChatMessageType::User` arm of `convert_grouped_to_display`: the `display_content.is_empty() && extra_meta.is_empty()` suppression gains `&& !has_attachment_evidence(msg.base.metadata.as_ref())`. Plus the two Rust tests below. |
| `packages/core-rs/crates/mainframe-acp/src/encoder/content.rs` | **Gate 2**, in `encode_content`, after the block loop and **before** `message.finish(container, out)`: when `role == ItemRole::User` and `has_attachment_evidence(container.message_meta)`, call `message.claim_marker(out, container)` so the accumulator opens an empty slot and `finish` builds a `Message` item with empty content and full `ItemMeta`. |
| `packages/core-rs/crates/mainframe-acp/src/encoder/tests/meta_tests.rs` | Encoder test (container/meta bucket). |
| `packages/ui/src/features/chat/view-model/__tests__/convert-acp-user.test.ts` | Client test: empty block list + `attachments` metadata → one file attachment, content backfilled to a single empty text part. |
| `.changeset/<name>.md` | `'@qlan-ro/mainframe-types': patch` + `'@qlan-ro/mainframe-ui': patch` (the `fixed` lockstep group in `.changeset/config.json`), one user-facing sentence. Daemon-only fixes use this pair by precedent. |

## Established facts

- `send.rs::prepare_outgoing` pushes file attachments into `text_prefix` only, never into
  `message_content` — so an attachment-only send stores a user message with an **empty** content
  vector. Images do push a `LeafContent::Image`, which is why image-only sends already render.
  Receipt: `packages/core-rs/crates/mainframe-chat/src/chat_manager/send.rs:98-131`.
- The live attachment previews land in the stored message's metadata under the key `attachments`.
  Receipt: `packages/core-rs/crates/mainframe-chat/src/chat_manager/send_queue.rs:28-31`.
- That transient metadata reaches `ChatMessage.metadata` directly (no side channel) via
  `create_transient_message`. Receipt:
  `packages/core-rs/crates/mainframe-chat/src/chat_manager/send.rs:63-86`.
- On the replay/history path the previews are absent; `convert_user_content` instead parses the
  `<attached_file_path …/>` tags out of the stored text and writes metadata key `attachedFiles`
  (a list of `{name}`). Receipt:
  `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_helpers.rs:299-307`.
  That value arrives through `extra_meta`, so the history path already clears gate 1 today — gate 1
  is a **live-path-only** defect, gate 2 breaks both paths.
- Both the live emission and the history read route through `prepare_messages_for_client`, so one
  fix covers both. Receipts: `packages/core-rs/crates/mainframe-chat/src/event_handler.rs:306`
  (live shape) and `packages/core-rs/crates/mainframe-chat/src/chat_manager/history.rs:68`
  (history), both dispatching to `mainframe-server/src/chat_deps.rs:240-246`, which calls the
  adapter-claude function.
- `Accum::finish` returns early when `pos.is_none()` — an accumulator that never claimed writes no
  item. That early return is gate 2. Receipt:
  `packages/core-rs/crates/mainframe-acp/src/encoder/accum.rs:141-144`.
- `claim_marker` only opens a slot when `pos.is_none()`; for a user container that already produced
  a segment the new call is a no-op, so **no second guard is needed**. Receipt:
  `packages/core-rs/crates/mainframe-acp/src/encoder/accum.rs:125-131`.
- Task-group child containers are built with `message_meta: None`, so the new condition can never
  fire for them. Receipt: `packages/core-rs/crates/mainframe-acp/src/encoder/content.rs:153-159`.
- The wire create for a message item always ships `content`, empty vector included — the
  `is_empty()` omission at `updates.rs:96` applies to `ToolCall` only. Receipt:
  `packages/core-rs/crates/mainframe-acp/src/session_state/updates.rs:63-76` and `:96`.
- The client accumulator treats `content.length === 0` as a **clear frame only when `_meta` is also
  explicitly `null`**. Our item carries non-null meta, so it is kept, not dropped. Receipt:
  `packages/ui/src/features/chat/view-model/acp-item-accumulator.ts:164-186`.
- `coerceUserMeta` reads the raw metadata key `attachments` into `mf.attachmentPreviews`, and
  `fileAttachmentsFrom` merges those (`kind === 'file'`) with the replay `attachedFiles` names,
  deduped. Receipts: `packages/ui/src/features/chat/view-model/convert-acp-user.ts:44-59` and
  `:84-105`.
- `ensureNonEmpty` backfills a single empty text part, so assistant-ui never sees an empty content
  array. Receipt: `packages/ui/src/features/chat/view-model/content.ts:13-15`.
- `UserMessage` renders no bubble when `cleanText` is empty (`body` is `null`) while still rendering
  `<UserAttachments />` in `extras`; each file pill carries
  `data-testid="chat-user-attachment-<name>"`. Receipts:
  `packages/ui/src/features/chat/messages/UserMessage.tsx:161-172` and `:184-189`;
  `packages/ui/src/features/chat/messages/UserAttachments.tsx:40-47`.
- Reconcile needs no change: `userItems()` joins a message item's text blocks, yielding `''` for an
  empty block list, and `reconcileKey('')` returns the `ATTACHMENT_KEY` sentinel — the same key the
  pending built from an empty text gets. Receipts:
  `packages/ui/src/features/chat/controller/acp-session-plane.ts:170-176` and
  `packages/ui/src/features/chat/controller/chat-reconcile.ts:27-33`.
- `is_internal_user_message`, the step-1 filter that runs BEFORE the suppression gate, is
  `.any()`-based over text leaves — an **empty** content vector returns `false`, so the
  attachment-only message is not dropped there and gate 1 is genuinely the live-path culprit.
  Receipt: `packages/core-rs/crates/mainframe-adapter-claude/src/messages/display_helpers.rs:40-45`.
  `group_messages` likewise passes user messages through untouched (only system turn-duration
  markers, tool results and consecutive assistant turns are folded). Receipt:
  `packages/core-rs/crates/mainframe-adapter-claude/src/messages/message_grouping.rs:33-80`.
- `docs/plans/` is gitignored (`.gitignore:53`), so this plan is committed with `git add -f`.

## Implementation group (single group, `core`)

One agent, TDD inline — write each failing test and its fix in the same turn.

1. **Shared predicate** in `mainframe-types/src/display.rs`, matching both metadata keys.
2. **Gate 1** + two Rust tests in `display_pipeline.rs`, using the existing `raw_msg`/`txt` fixture
   helpers in that file's `mod tests`:
   - user message, **empty** content vector, metadata `{"attachments": [{"name": "notes.txt",
     "kind": "file", …}]}` → exactly one display message survives, carrying that metadata.
   - regression guard: user message whose only content is a bare
     `<command-name>…</command-name>` echo with empty metadata → still suppressed, zero messages.
3. **Gate 2** + one Rust test in `encoder/tests/meta_tests.rs` (the `dmsg` fixture plus a metadata
   override, as `queued_messages_are_not_encoded_as_items` does): a `DisplayMessageType::User`
   message with zero content and attachment metadata encodes to exactly one
   `EncodedItem::Message` with an empty content vector whose `ItemMeta.messageMeta` still carries
   the attachment metadata. Add the mirror negative — a user message with zero content and **no**
   attachment metadata still encodes to zero items.
4. **Client test** in `convert-acp-user.test.ts`: `convertUserContainer([], { attachments:
   [{ name: 'notes.txt', kind: 'file', sizeBytes: 10 }] }, BASE)` returns one file attachment named
   `notes.txt` and content backfilled to a single empty text part. No client source change.
5. **Changeset** as specified above.

## Risks

- **File-size cap.** `display.rs` is 282 lines against the 300-line project cap; the predicate plus
  its doc comment must stay under ~15 lines or it needs a different home (a duplicated 4-line
  predicate per crate is the fallback, at the cost of two copies). `encoder/tests/meta_tests.rs` is
  in the same bucket — check it before adding. `display_pipeline.rs` (941) and `display_helpers.rs`
  (846) already exceed the cap; a size:s fix does not restructure them.
- **Over-broad gate 2.** Keying the new emission on `role == User` plus attachment evidence is what
  keeps empty assistant containers, hidden-tool-only containers and task-group children from
  sprouting phantom items. Do not relax it to "any empty container".
- **Golden fixtures.** `packages/core-rs/crates/mainframe-types/tests/acp_golden_fixtures.rs`
  round-trips the vendored ACP grammar; a message item with an empty content list is already
  representable, but run that suite.
- **Queued attachment-only sends stay broken** (out of scope per the brief): the queued projection
  is built from the queue snapshot, and `is_queued` messages are dropped by the encoder before
  either gate runs.

## Exit gates

- The two new Rust tests on the display seam and the one (plus its negative) on the encoder pass,
  and the pre-existing suppression test for bare `<command-name>` echoes still passes.
- The new client test passes; no client source file changed.
- `mainframe-types`, `mainframe-adapter-claude`, `mainframe-acp` and the ACP golden-fixture suite
  are green, as is the `packages/ui` unit suite; Rust fmt/clippy and the UI typecheck (which
  includes tests) are clean.
- A changeset naming both lockstepped packages exists.
- Manual confirmation in the test environment launched via `.agents/launch-test-*.sh` (a bare
  Tauri launch hijacks port 31415 and `~/.mainframe`, killing the production app): sending file attachments with no text shows a right-
  aligned pill row and no empty bubble, and the turn is still there after reloading the session.
