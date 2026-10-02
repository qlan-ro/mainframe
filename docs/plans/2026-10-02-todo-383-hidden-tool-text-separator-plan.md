# Hidden tool calls keep a paragraph boundary (todo #383)

Size s, no spec. Base is `origin/main` at `8145d305`, which already has PR #735 (merged 2026-10-01), so no separate baseline branch is needed. Branch `todo/383-hidden-tool-text-separator`. There is one implementation group, and it works TDD inline. The lane owns independent review.

## Goal

When a hidden-category tool call sits between two visible text contributions in one container, the encoder emits them as separate paragraphs in the same message segment. It does this by appending a paragraph break to the open text. It emits no hidden item, creates no new segment and renumbers no IDs. Ordinary adjacent text fragments, with no hidden call between them, still concatenate byte-for-byte as they do today.

## Design

- `Accum` gets a `pending_break: bool`. In `content.rs::handle_node`, the tool arms (`ToolCall`, `ToolGroup`, `TaskProgress`) record `out.len()` before encoding. If they push nothing (a hidden call, or a group or progress list made only of hidden calls), they set `message.pending_break = true`. `TaskGroup` always pushes an item. `PermissionRequest` is a gate, not a tool, and stays out of scope.
- Text going into the message accumulator (the `Text` leaf and the `Error` node) goes through one Accum-level text push that uses the flag:
  - The break applies only when the flag is set, the open segment's last block is a `Text` with non-whitespace content, and the incoming text is non-empty.
  - The break is `"\n"` repeated `2 - (trailing newlines of the tail + leading newlines of the incoming text)`, saturating at 0. Existing breaks are therefore never doubled.
  - After applying the break, call `push_text` as before.
- The flag clears on any content contribution to the message accumulator (text, image or error) and whenever `claim` closes a segment. `claim_marker` (compaction or skill-loaded) leaves it alone. As a result:
  - Several hidden calls in a row give one boundary.
  - Hidden calls with no text before them give no leading break, because there is no text tail.
  - Hidden calls with no text after them give no trailing break, because the break is added only when the following text arrives.
  - `text, hidden, image` adds no separator. Image is its own block.
- `push_text` keeps its current behaviour. `thinking` leaves and the thought accumulator are unchanged.
- Nested `TaskGroup` content goes through the same recursive `encode_content` with its own `Accum`, so it follows the same rule automatically.

## Files touched

- `packages/core-rs/crates/mainframe-acp/src/encoder/accum.rs`: the flag, the boundary-aware text push, and clearing the flag in `claim`.
- `packages/core-rs/crates/mainframe-acp/src/encoder/content.rs`: the no-item detection in `handle_node`, and routing `Text` and `Error` through the new push.
- `packages/core-rs/crates/mainframe-acp/src/encoder/tests/segment_tests.rs`: rewrite `text_separated_only_by_a_hidden_tool_call_coalesces_into_one_message`. It currently locks in the bug by asserting `"first second"`.
- New `encoder/tests/hidden_break_tests.rs`, registered in `encoder/tests.rs`. This keeps `segment_tests.rs` under 300 lines.
- `.changeset/<name>.md`, a patch for `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui`. That is the fixed pair used for core-rs fixes, as in `long-chat-streaming.md`.

## Required behaviour (tests are written red first)

1. `text, hidden, text` produces one message item. Its ID is the bare container ID, the text is joined by a paragraph break, and no tool item is emitted.
2. Text fragments that are only adjacent still concatenate exactly (`"a" + "b"` gives `"ab"`).
3. If the tail already ends in `"\n\n"`, or the incoming text starts with newlines, the total stays at exactly one blank line. A single `"\n"` on either side gets topped up to two.
4. Two hidden calls in a row give one break. `hidden, text` and `text, hidden` add no leading or trailing separator.
5. A `TaskGroup` whose nested calls are `text, hidden, text` gives the same result under the agent container.
6. With a hidden call between texts, `encode_revision(..., Some(Text))` with streaming stripped equals `encode`. The final segment carries `streaming`. The encoded text of `[text, hidden]` is a strict prefix of the encoded text of `[text, hidden, text]`, so the diff engine still sees a chunk append and not a reset.
7. The existing visible-tool segmentation, marker and streaming tests pass unchanged.

## Risks

- **Prefix monotonicity under streaming.** A boundary inserted mid-text would force `session_state.rs::chunk_extension` into a full revision. Adding the break only when the following text arrives, and taking leading newlines into account, keeps every revision a pure suffix growth (behaviour 6 checks this).
- **Overreach.** Putting the separator inside `push_text` would change every streamed fragment. The flag keeps the change limited to hidden boundaries (behaviour 2 checks this).
- **Function and file limits.** `handle_node` has to stay under 50 lines. If adding the length check pushes it over, move the tool arms into a small helper.

## Established facts

- Hidden calls push no item, and nothing else in the encoder marks their position: `encoder/content.rs::handle_node` (`ToolCall` arm), `encoder/tool_call.rs::encode_tool_group`, `content.rs::handle_task_progress`.
- A segment closes only when another item was pushed after it: `encoder/accum.rs::Accum::claim` (`pos + 1 != out.len()`).
- `push_text` concatenates into the trailing text block without a separator. It is shared by Text, Thinking and Error: `encoder/content.rs::push_text`.
- A live diff becomes a chunk only when the new last text block `starts_with` the previous one and every earlier block is unchanged. Otherwise it is a full revision: `session_state.rs::chunk_extension`.
- Nested task content is encoded recursively, each with its own `Accum`, and is always non-streaming: `content.rs::handle_task_group`.
- Today's behaviour is locked in by `encoder/tests/segment_tests.rs::text_separated_only_by_a_hidden_tool_call_coalesces_into_one_message`.
- Rust-only fixes record the changeset against the fixed types and UI pair: `.changeset/config.json` (`fixed`) and `.changeset/long-chat-streaming.md`.

## Exit gates (the implementation group owns all of them)

- The new and rewritten encoder tests fail before the fix and pass after it. All `mainframe-acp` tests pass, including `session_state` and `stream`.
- `cargo fmt` and `clippy` are clean for the crate. Touched files stay at 300 lines or fewer, and functions at 50 lines or fewer.
- The changeset is committed and the repository's required checks pass.
