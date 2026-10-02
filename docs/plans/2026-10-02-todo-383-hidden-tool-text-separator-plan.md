# Hidden tool calls keep a paragraph boundary (todo #383)

Size s, no spec. Base is `origin/main` at `8145d305`, which already has PR #735 (merged 2026-10-01), so no separate baseline branch is needed. Branch `todo/383-hidden-tool-text-separator`. There is one implementation group, and it works TDD inline. The lane owns independent review.

## Goal

When a hidden-category tool call (Claude: `TodoWrite`, `AskUserQuestion`, `EnterPlanMode`, `ToolSearch`, ...) sits between two visible text contributions of one display message, the client receives them as separate paragraphs in the same message segment. No hidden item is emitted, no new segment is created, and no ID is renumbered. Ordinary adjacent text fragments, with no hidden call between them, still concatenate byte-for-byte as they do today.

## Where the boundary is lost (revision r1)

On the real Claude path the encoder never sees a hidden call. `mainframe-server/src/chat_deps.rs::DaemonChatDeps::prepare_messages_for_client` passes the adapter's `ToolCategories`, and `mainframe-adapter-claude/src/messages/display_pipeline.rs::convert_grouped_to_display` then runs `display_helpers.rs::apply_tool_grouping`. Its `mainframe-display/src/tool_grouping.rs::group_tool_call_parts` drops a hidden call outright (the `is_hidden_tool_part` branch) and `collect_explore_run` skips hidden calls inside an explore run. Without categories, `categorize_tool_call` never yields `Hidden`. Either way the `DisplayMessage` reaching `encode`/`encode_revision` carries two adjacent `Text` leaves, which the encoder correctly concatenates as ordinary fragments.

The fix therefore lives at the grouping step, where the call is dropped. The encoder is not changed. Its `ToolCategory::Hidden` arms stay a defensive filter, and the existing encoder test `encoder/tests/segment_tests.rs::text_separated_only_by_a_hidden_tool_call_coalesces_into_one_message` (hand-built input that production never produces) stays as it is.

## Design

- New module `packages/core-rs/crates/mainframe-display/src/hidden_boundary.rs` (declared in `lib.rs`; `tool_grouping.rs` is already far over 300 lines, so new logic goes here). It holds a small tracker, for example `HiddenBoundary { pending: Option<Option<String>> }`, which records the `parent_tool_use_id` of the last dropped hidden call, plus a pure `paragraph_break(tail: &str, incoming: &str) -> usize` that returns the number of `\n` to prepend.
- `group_tool_call_parts` uses the tracker:
  - The hidden-skip branch marks the boundary with the call's parent.
  - When a `PartEntry::Text` arrives (the non-tool-call branch), the tracker may prepend a break to that text before it is pushed. The break applies only when all of these hold:
    - a boundary is pending, and its parent equals the incoming text's parent;
    - the last entry in `result` is a `PartEntry::Text` with the same parent and non-whitespace content;
    - no progress bucket will be spliced at the current position (no bucket has `insert_index == result.len()`), because a spliced `_task_progress` item already splits the segment;
    - the incoming text is non-empty.
  - The break is `"\n"` repeated `2 - (trailing newlines of the tail + leading newlines of the incoming text)`, saturating at 0, prepended to the incoming text. Existing breaks are never doubled.
  - Pushing any entry other than a hidden drop clears the pending boundary: text (applied or not), passthrough (thinking, image, ...), a visible tool call, and the entry pushed by `collect_explore_run`. An empty incoming text leaves it pending.
- Hidden calls inside an explore run (`collect_explore_run`) need no boundary. The run always pushes a visible explore item, so text on either side is already in separate segments. The run's push clears any pending boundary, so it never leaks to later text.
- The break goes on the following text when that text arrives, not on the tail. So:
  - `[text, hidden]` produces no trailing separator;
  - `[hidden, text]` produces no leading separator, because there is no text tail;
  - several hidden calls in a row produce one boundary;
  - `text, hidden, image` produces no separator.
- Streaming stays prefix-monotonic. The partial overlay (`mainframe-chat/src/event_handler/partial_overlay.rs`) joins the pipeline as a raw tail `ChatMessage` before grouping. The tail text before the hidden call is already complete, and the prepended newline run is `max(needed, leading newlines)`, which never shrinks as the incoming text grows. Every revision of the encoded text therefore extends the previous one, and `session_state.rs::chunk_extension` keeps emitting chunk appends. Cold reload goes through the same pipeline and gets the same bytes.
- Nested subagent content: hidden calls and texts under a subagent carry that subagent's parent, so the boundary forms with matching parents. `group_task_children` then moves the texts (with their prepended break) into the task group, and the encoder's recursive `encode_content` concatenates them as usual.
- The encoder, `push_text`, thinking and thought coalescing, `PermissionRequest`, item IDs and segment numbering are unchanged.

## Files touched

- `packages/core-rs/crates/mainframe-display/src/hidden_boundary.rs` (new): the tracker, `paragraph_break`, and unit tests (or a sibling `hidden_boundary/tests.rs` if the file would pass 300 lines).
- `packages/core-rs/crates/mainframe-display/src/lib.rs`: declare the module.
- `packages/core-rs/crates/mainframe-display/src/tool_grouping.rs`: wire the tracker into `group_tool_call_parts`. If that pushes it past 50 lines, move the per-part dispatch into a helper. `collect_explore_run` keeps its skip.
- `packages/core-rs/crates/mainframe-server/tests/hidden_tool_paragraph_boundary.rs` (new): production-path regression through `prepare_messages_for_client(.., Some(&ClaudeAdapter::default().get_tool_categories()))` followed by `encode` / `encode_revision`. `mainframe-server` already depends on both `mainframe-adapter-claude` and `mainframe-acp`; `tests/live_vs_cold_reload_golden.rs` is the precedent.
- `.changeset/<name>.md`: a patch for `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui`, the fixed pair used for core-rs fixes (as in `long-chat-streaming.md`).

## Required behaviour (tests are written red first)

Production path (`mainframe-server/tests/hidden_tool_paragraph_boundary.rs`). Raw messages are built the way the CLI produces them: assistant text, assistant `tool_use`, the user `tool_result`, assistant text.

1. `text, TodoWrite, text` and `text, AskUserQuestion, text` produce one message item whose ID is the bare container ID. Its text is `"<first>\n\n<second>"`, and no tool item is emitted. The test must be red on the base commit. If the four raw messages do not land in one `DisplayMessage`, the test does not reproduce the bug; stop and report instead of adjusting the fix.
2. Streaming: `[text, TodoWrite]` followed by an overlay tail with the second text growing over several revisions (including a revision that is only `"\n"`). Each `encode_revision(.., Some(Text))` text is a prefix of the next. The final revision with streaming stripped equals `encode` of the completed messages, and the final segment carries `streaming`.
3. `text, Read, TodoWrite, Read, text` (hidden inside an explore run) and `text, TodoWrite, Read, text`: the output is the same as today. Both texts are unmodified, and they are separated by the explore item.

Grouping unit tests (`mainframe-display`):

4. Text fragments that are only adjacent still concatenate exactly. `group_tool_call_parts` leaves them unmodified, and the full output equals today's for inputs with no hidden call.
5. If the tail already ends in `"\n\n"`, or the incoming text starts with newlines, the result has exactly one blank line. A single `"\n"` on either side is topped up to two.
6. Two hidden calls in a row give one break. `hidden, text` and `text, hidden` add no leading or trailing separator. `text, hidden, image, text` and `text, hidden, thinking, text` add no separator, because the passthrough clears the boundary.
7. `text, TaskCreate (progress), TodoWrite, text` adds no break, because a `_task_progress` item is spliced between the texts.
8. Parent mismatch: a hidden call from a different `parent_tool_use_id` than the texts adds no break. Subagent `text, hidden, text` under one parent gets the break, and after `group_task_children` the texts sit in the task group's children.
9. All existing `mainframe-display`, `mainframe-adapter-claude` display-pipeline, `mainframe-acp` encoder/`session_state`/`stream` tests and `live_vs_cold_reload_golden` pass unchanged.

## Risks

- **Prefix monotonicity under streaming.** A break inserted into already-sent text would force a full revision. Prepending only to the following text, and taking its leading newlines into account, keeps every revision a pure suffix growth. Behaviour 2 checks this.
- **Overreach.** The boundary is set only by a hidden drop in `group_tool_call_parts`, so other adjacent text is untouched. Behaviours 4 and 9 check this.
- **Other `DisplayMessage` consumers** (REST chat history in `mainframe-server/src/routes/chats.rs`, legacy display events, `task_subject_backfill`, tool-call timing) see a text leaf with leading newlines. That is valid markdown and is the same improvement, so no consumer needs changes.
- **Function and file limits.** `group_tool_call_parts` must stay at 50 lines or fewer. New code goes in the new module, not in the oversized `tool_grouping.rs`.

## Established facts

- Hidden calls are dropped with no marker in `mainframe-display/src/tool_grouping.rs::group_tool_call_parts` (the `is_hidden_tool_part` branch) and skipped inside `collect_explore_run`. Progress tools are checked first and spliced later by `splice_progress_entries` at each bucket's `insert_index`.
- Production passes categories: `mainframe-server/src/chat_deps.rs` (`DaemonChatDeps::prepare_messages_for_client`, `get_tool_categories`) → `display_pipeline.rs::convert_grouped_to_display` → `display_helpers.rs::apply_tool_grouping`. `convert_grouped_parts_to_display` drops empty text parts.
- Claude's hidden set includes `TodoWrite` and `AskUserQuestion`; `TaskCreate`/`TaskUpdate` are both hidden and progress: `mainframe-adapter-claude/src/adapter.rs::get_tool_categories`.
- The partial overlay is merged as a raw `ChatMessage` before `prepare_messages_for_client`: `mainframe-chat/src/event_handler/partial_overlay.rs`.
- The encoder concatenates adjacent text leaves with no separator (`mainframe-acp/src/encoder/content.rs::push_text`) and opens a new segment only after another item is pushed (`encoder/accum.rs::Accum::claim`).
- A live diff becomes a chunk only when the new last text block `starts_with` the previous one: `session_state.rs::chunk_extension`.
- Rust-only fixes record the changeset against the fixed types and UI pair: `.changeset/config.json` (`fixed`) and `.changeset/long-chat-streaming.md`.

## Out of scope

- The thought accumulator: `thinking, hidden, thinking` still runs together. Mention this in the PR.
- Showing hidden tools, changing tool categories, renumbering segments, and markdown renderer changes.

## Exit gates (the implementation group owns all of them)

- The new tests fail on the base and pass after the fix. All `mainframe-display`, `mainframe-adapter-claude`, `mainframe-acp` and `mainframe-server` tests pass.
- `cargo fmt` and `clippy` are clean for the touched crates. New and touched production functions are 50 lines or fewer, and new files are 300 lines or fewer.
- The changeset is committed and the repository's required checks pass.
