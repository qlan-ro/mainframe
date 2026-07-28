# Todo #257 — a session whose first message is a slash command never gets a title

## Goal

A chat whose first message carries command metadata is titled exactly like a chat
whose first message is plain text: the deterministic fallback title is derived from
the user's typed text, persisted, and broadcast immediately, and asynchronous LLM
summarization is started off the send path and overwrites the title on success.
Today the daemon's send path returns from the command branch before it reaches the
title block, so the chat row keeps a null title forever and every client renders its
own "Untitled" placeholder. The fix lifts the title work out of the plain-text tail
into a private `assign_initial_title` helper on `ChatManager` and splits the offending
function into two symmetric dispatch helpers — `dispatch_command` and
`send_plain_text` — so the early `return` is gone and both call the helper from their
first lines. Those helpers, the title helper, and the plain-text tail's own extracted
sub-helpers land in a new child module,
`packages/core-rs/crates/mainframe-chat/src/chat_manager/send.rs`, so the parent file
shrinks instead of growing and every function this plan creates is under 50 lines.
The title derives from the caller's `content` (the typed `/name args`), so
the mainframe wrapper envelope can never reach a title. No client changes: the existing
`chat.updated` fan-out already delivers to the phone.

## Context established before planning (do not re-verify)

- The Rust daemon is the only runtime (PR #510). `packages/core` is orphaned.
- `ChatManager::send_message` (`packages/core-rs/crates/mainframe-chat/src/chat_manager.rs:1789`)
  is the single entry point. The command branch begins at line 1880
  (`if let Some(cmd) = command`) and ends with `return Ok(());` at line 1920. The title
  block lives at lines 2007–2043 (`let title_empty = post` through the closing brace of
  `if title_empty`), below that return.
- `derive_title_from_message` is in `crates/mainframe-chat/src/title_generator.rs`;
  `do_generate_title` is `ChatLifecycleManager::do_generate_title`
  (`crates/mainframe-chat/src/lifecycle_manager.rs:752`). Neither changes here.
- `ChatLifecycleManager` shares the `active_chats` registry with `ChatManager`
  (`chat_manager.rs:1028` wiring), so a chat seeded via the tests' `seed_active`
  is visible to `do_generate_title`.
- `CommandMeta { name, source, args }` is defined at `chat_manager.rs:2195`; the WS
  handler builds it at `crates/mainframe-server/src/websocket.rs:516`. `content` is
  the user's full typed text including the leading `/name` (see the existing
  command-routing tests, `chat_manager/tests.rs:718-800`).
- `chat_manager` is already a **directory module**: `chat_manager.rs` declares
  `#[cfg(test)] mod tests;` (line 2292) and `chat_manager/tests.rs` opens with
  `use super::*;` and freely names the parent's private items (`ActiveChat`,
  `ChatUpdate`, `HashMap`, …). The crate already ships a non-test child module carrying
  an inherent `impl` block for its parent's type: `worktree_offer/rescan.rs`
  (`mod rescan;` at `worktree_offer.rs:27`, `impl WorktreeOfferRegistry`, pulling the
  parent's private `resolved_event` in through `use super::{…}`). So a child module can
  hold `impl ChatManager` methods and reach `self.deps`, `self.messages`,
  `self.emit`, `self.set_working` — all private to `chat_manager`, all visible to a
  descendant module.
- CI runs `cargo clippy --all-targets -- -D warnings` (`.github/workflows/rust-port.yml:31`).
  `clippy::unwrap_used`/`expect_used` are workspace-deny, exempted under `cfg(test)` by
  `lib.rs:13`, so Group A's `.unwrap()`/`.expect()` are fine and Group B's moved code
  (which uses `unwrap_or_else(|e| e.into_inner())`) is unaffected.
- Todo #287 is in flight on `todo/287-title-generation-logging` and touches
  `lifecycle_manager.rs`, `chat_deps.rs`, `external_session_service.rs`,
  `test_support.rs`, and the claude adapter's `title_generator.rs`. It touches
  **neither** `chat_manager.rs` nor `chat_manager/tests.rs`. This plan stays inside
  those two files, one new file under `chat_manager/`, and a changeset, so the two
  branches cannot conflict.

## Constraints

- No new logging is owed (that is #287); do not regress its observability, and do not
  edit the files it owns.
- Title generation must stay off the send path (`tokio::spawn`, not awaited).
- The deterministic fallback format, its 50-char limit, and its truncation rule are
  frozen.
- `cargo fmt` + `cargo clippy --all-targets -- -D warnings` must pass; a changeset is
  required.
- **No new size violations.** `chat_manager.rs` is 2351 lines and `send_message` is 295
  (lines 1789–2083); both already break the repo limits. Group B moves the whole dispatch
  half of the send path into `chat_manager/send.rs`, so the parent file **shrinks**
  (2351 → ~2155) and the new file lands at ~260, under 300. Every function this plan
  creates is under 50 lines — including `send_plain_text`, which reaches ~30 by
  extracting the tail's three existing seams (see B2).
- Two pre-existing violations survive, deferred to **todo #292** (filed alongside this
  plan): `chat_manager.rs` stays over 300, and `send_message` keeps its 91-line preamble
  (295 → ~98). Decomposing that preamble would mean moving `send_message` itself into
  `send.rs` — pushing that file past 300 — and would turn a mechanical move into a
  rewrite of the crate's busiest entry point. Shrinking a 295-line function to ~98 while
  minting nothing new over 50 is this pass's share of the debt.
- The child-module split is the cheap one, not the expensive one. Moving an inherent
  `impl ChatManager` block into `chat_manager/send.rs` changes **no import anywhere in
  the crate and no call site at all** — `ChatManager::send_message`'s path is identical,
  and the precedent is `worktree_offer/rescan.rs` (see Context). Only moving *types* out
  of `chat_manager.rs` would rewrite imports crate-wide; that is #292's job. The reason
  #292 is deferred is blast radius, not collision — no in-flight branch touches
  `chat_manager.rs`, #287 included (see Context).

## Tasks

### Group A — red-phase tests and B2 move guards (`chat_manager/tests.rs`)

All of Group A lands in
`packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs` and must be committed
before Group B exists. Five of the nine new tests are red-phase tests for the bug and
must be observed **failing**; four (A2.4, A2.6, A2.8, A2.9) are guards that pin behavior
B2 must not change and are green on both sides of the move. Group A is the only group
that touches a test file, which is what lets B2 forbid test edits outright.

#### Task 1 — A1. Teach the fakes to observe titles, attachments, mentions, and images

File: `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs`

The first three fields serve the #257 title tests. The last two exist because the fake
is currently blind to most of what Group B moves: `process_attachments` (line 186)
returns `ProcessedAttachments::default()` and `extract_mentions_from_text` (line 278)
hardcodes `false`, so the attachment, prefix, image and mention branches of the
plain-text tail are unreachable in every existing test. Tests 8 and 9 need them
reachable before B2 may claim a behavioral guard.

1. Add five fields to `struct StoreDeps` (line 17). All are `Default`-friendly, so
   `StoreDeps::default()` keeps today's behavior for every existing test:
   - `generated_title: Mutex<Option<String>>` — what `generate_title` returns.
   - `generate_title_calls: Mutex<Vec<String>>` — the `content` of each call.
   - `title_gate: Mutex<Option<Arc<tokio::sync::Notify>>>` — when set,
     `generate_title` awaits `notified()` before returning.
   - `attachments: Mutex<Option<ProcessedAttachments>>` — when set,
     `process_attachments` returns a clone of it (`ProcessedAttachments` is `Clone`,
     `chat_manager.rs:55`); `None` keeps today's `::default()`.
   - `mentions_found: Mutex<bool>` — what `extract_mentions_from_text` returns.
2. In `impl ChatManagerDeps for StoreDeps`, extend `chats_update` (line 84) to apply
   `patch.title` to the stored chat, alongside the existing `process_state` and
   `transcript_missing` handling. Without this the store never reflects a title and
   "the chat row is titled" is untestable.
3. Replace `generate_title` (line 255) so it records the content, awaits the gate when
   one is installed, then returns `self.generated_title.lock().unwrap().clone()`.
   Clone the gate `Arc` out of the mutex **before** awaiting — never hold a
   `std::sync::MutexGuard` across an `.await`.
4. Replace `process_attachments` (line 186) with

   ```rust
   fn process_attachments<'a>(
       &'a self,
       _chat_id: &'a str,
       _attachment_ids: &'a [String],
   ) -> BoxFuture<'a, ProcessedAttachments> {
       let p = self.attachments.lock().unwrap().clone().unwrap_or_default();
       Box::pin(async move { p })
   }
   ```

   Clone out of the mutex **before** the async block, for the same reason as step 3.
   Replace `extract_mentions_from_text` (line 278) with
   `*self.mentions_found.lock().unwrap()`.
5. Add `images_calls: Mutex<Vec<usize>>` to `struct RecSession` (line 315) and push
   `images.len()` from `send_message` (line 389), renaming its `_images` parameter to
   `images`. `RecSession` is not `Default`: initialize the field in **both**
   constructors, `new` (line 326) and `with_order` (line 338). Do not widen the
   existing `send_message_calls` tuple — 15 call sites read `.0`/`.1` and this plan
   edits no existing assertion.
6. Add two test-module helpers next to `seed_active` (line 462):
   - `async fn settle()` — `for _ in 0..50 { tokio::task::yield_now().await; }`, so the
     spawned title task runs to completion on the current-thread test runtime.
   - `fn titles_written(deps: &StoreDeps) -> Vec<String>` — every `title` present in
     `deps.updates`. This is the **store-patch log**, not the event stream; assertions
     about broadcasts must read `deps.events()` instead.

Verify: `cd packages/core-rs && cargo test -p mainframe-chat` compiles and the
pre-existing tests still pass (no assertions changed yet).

#### Task 2 — A2. Red tests: a command-first message gets titled

File: same.

Add a section `// ── command-first title (#257) ───` after the existing
command-routing block (line 846, before `// ── remove-project-kills-tasks.test.ts ──`
at line 848). Add one builder — leave the existing `cmd_chat()` / `cmd_manager()`
(lines 702, 709) untouched so the current command-routing tests keep passing:

```rust
fn title_cmd_manager(title: Option<&str>) -> (ChatManager, Arc<StoreDeps>, Arc<RecSession>)
```

It builds `test_chat("chat-1")` with `title: title.map(str::to_string)` and
`process_state: Some(Some(ProcessState::Idle))`, puts it in `StoreDeps::with_chats`,
constructs the manager, and `seed_active`s the same chat with
`RecSession::new("chat-1", false, true)`. It returns the deps so tests can assert on
the stored row and on `updates`.

Tests:

1. `provider_command_first_message_sets_the_fallback_title` — send `"/compact"` with
   `CommandMeta { name: "compact", source: "claude", args: None }`. Assert:
   `deps.chats_get("chat-1").unwrap().title == Some("/compact")`; a `ChatUpdated`
   event exists whose `chat.title` is `Some("/compact")`; `send_command` was still
   called once with `"compact"`; a `process_state: Working` update was still written.
2. `mainframe_command_first_message_titles_from_typed_text_not_the_wrapper` — send
   `"/greet Say hello to the team"` with
   `CommandMeta { name: "greet", source: "mainframe", args: Some("Say hello") }`, then
   `settle().await` so the spawned title task has run. Assert:
   - the stored title equals the typed text verbatim and contains neither
     `"<mainframe-command"` nor `"<mainframe-command-response"`;
   - `deps.generate_title_calls == ["/greet Say hello to the team"]` — the summarizer
     receives the typed text, and no entry contains `"<mainframe-command"`. Without this
     the test proves nothing about "summarized from": with `generated_title` left at
     `None` the wrapper envelope could be handed to `generate_title` and the stored
     fallback would still look right. This assertion is the whole reason A1 adds
     `generate_title_calls`;
   - `send_message_calls[0].0` still contains `"<mainframe-command name=\"greet\""`, so
     the CLI still gets the wrapper.
3. `command_first_message_generated_title_overwrites_the_fallback` — set
   `*deps.generated_title.lock().unwrap() = Some("Compact the session".into())`, send
   the provider command, `settle().await`. Assert:
   - **the broadcasts** (todo #257 AC #2, and the load-bearing behavior for the reported
     symptom — the phone only ever sees a title via the event). Collect the titles:

     ```rust
     let mut titles: Vec<Option<String>> = deps
         .events()
         .iter()
         .filter_map(|e| match e {
             DaemonEvent::ChatUpdated { chat, .. } => Some(chat.title.clone()),
             _ => None,
         })
         .collect();
     titles.dedup();
     assert_eq!(titles, vec![Some("/compact".into()), Some("Compact the session".into())]);
     ```

     `Vec::dedup` collapses **consecutive** equal titles, which is what makes this
     assertion an ordering/transition check rather than a count. The raw sequence is
     three events, not two: after B2 the command path emits `ChatUpdated` from
     `assign_initial_title` *and* from the existing post-`set_working` emission
     (`chat_manager.rs:1917-1919` today, carried verbatim into `dispatch_command`),
     whose cloned chat already carries the fallback title because `set_working` runs
     after titling and `enrich_and_emit` (`chat_manager.rs:394-411`) does not strip it.
     So the raw titles are `["/compact", "/compact", "Compact the session"]` and the
     deduped ones are `["/compact", "Compact the session"]`.

     **Do not make this test pass by moving or deleting the post-`set_working`
     broadcast.** That emission is shipped behavior this todo freezes (AC: "the chat
     still transitions to working"); the only correct way to green this assertion is
     B1 + B2. Guard it with two more assertions that pin the transition without
     counting: `titles.first() == Some(&Some("/compact".to_string()))`,
     `titles.last() == Some(&Some("Compact the session".to_string()))`, and no
     `ChatUpdated` carries a title outside those two (in particular none carries
     `None`).

     The summarized event is reachable in this fake: `LcDeps::emit_event`
     (`chat_manager.rs:555`) routes `do_generate_title`'s `ChatUpdated` through
     `enrich_and_emit` into `StoreDeps::emit_event`, so all three land in
     `deps.events()`.
   - **the persistence**, as a separate check: `titles_written(&deps)` is
     `["/compact", "Compact the session"]` and
     `deps.chats_get("chat-1").unwrap().title == Some("Compact the session")`.

   `titles_written` reads `deps.updates` — the store-patch log, not the event stream — so
   it can never stand in for the broadcast assertion. (`set_working` patches only
   `process_state`/`updated_at`, so the patch log stays at two entries and needs no
   dedup.)
4. `command_into_an_already_titled_chat_leaves_the_title_untouched` —
   `title_cmd_manager(Some("Test chat"))`, send the provider command, `settle().await`.
   Assert no entry in `deps.updates` carries `title: Some(_)`; no `ChatUpdated` event
   carries a title other than `"Test chat"`; `deps.generate_title_calls` is empty.
5. `title_generation_is_not_awaited_by_a_command_send` — set
   `*deps.generated_title.lock().unwrap() = Some("Compacted session".into())` **before
   the send**, and install a `title_gate` `Notify`. Without the generated title this
   test degenerates into a timeout-only check that is already green before Group B
   (`do_generate_title` writes nothing when `generate_title` returns `None` —
   `lifecycle_manager.rs:777`), which would leave the load-bearing off-the-send-path
   guard unobserved in the red phase.

   Wrap the send in `tokio::time::timeout(Duration::from_secs(2), mgr.send_message(...))`
   and `.expect("send must not await title generation")` — with the gate held, a send
   that awaited generation could not return. Then `gate.notify_one()` (permit-storing,
   so it works whether or not the task has parked yet), `settle().await`, and assert
   `deps.chats_get("chat-1").unwrap().title == Some("Compacted session".to_string())` —
   generation did run, just not on the send path.
6. `plain_text_first_message_still_titles_in_the_same_event_order` — regression guard,
   expected **green** before and after Group B. Untitled chat, send `"Hello world"`,
   no command. Assert the stored title is `"Hello world"`, and that in `deps.events()`

   ```rust
   let title_idx = updated
       .iter()
       .position(|c| c.title.as_deref().is_some_and(|t| !t.is_empty()))
       .expect("a ChatUpdated carried the title");
   let working_idx = updated
       .iter()
       .position(|c| c.process_state == Some(Some(ProcessState::Working)))
       .expect("a ChatUpdated carried Working");
   assert!(title_idx < working_idx);
   ```

   where `updated` is the chats carried by the `ChatUpdated` events in order.
   **Both `.expect()`s are mandatory — never compare the raw `Option<usize>`s.** Rust orders
   `None < Some(_)`, so `Some(x) < None` is false but `None < Some(y)` is true: an
   implementation that persists the title through `deps.chats_update` but drops the
   in-memory `guard.chat.title` write and the `ChatUpdated` emit would leave `title_idx` at
   `None`, pass the raw comparison, and still pass the companion `stored title ==
   "Hello world"` check. Persisted but never broadcast is exactly the failure todo #257 is
   about — the phone only learns a title from the event — so the guard has to fail loudly
   when no event carries one.
   **`position()` — first match — is load-bearing here.** Once the chat is titled every
   subsequent `ChatUpdated` carries *both* a title and a `process_state`, including the
   post-`set_working` one, so "the index of the `ChatUpdated` carrying a title" is only
   well defined under first-match semantics; `rposition` would compare the same event
   against itself and the assertion would collapse. Also assert
   `send_message_calls.len() == 1`, so nothing else in the turn was reordered.
7. `command_first_fallback_survives_a_generation_that_returns_nothing` — covers todo
   #257 desired-behavior item 6. Leave `generated_title` at `None`, send the provider
   command, `settle().await`. Assert the stored title is still `Some("/compact")`, that
   `deps.generate_title_calls.len() == 1` (generation was attempted, not skipped), and
   that `titles_written(&deps) == ["/compact"]` (no second write clobbers the fallback
   with an empty title). Tests 1 and 2 cannot cover this: they assert the row without
   `settle()`, so the spawned task has not necessarily run and retention is untested.

Tests 8 and 9 are not about titling. They exist because B2 moves roughly a third of the
plain-text tail through code no existing test reaches, and B2's only claimed guard is
"the existing tests stay green". Expect both **green before and after Group B**, like
test 6. Write them first anyway: a guard added after the move guards nothing.

8. `plain_text_with_attachments_keeps_prefix_images_and_transient_metadata` — covers
   `prepare_outgoing` (B2.2) and the attachment half of `store_user_message` (B2.1),
   including the `std::mem::take` that is the one non-verbatim edit in the move.

   Setup: `deps = StoreDeps::arc()`, then install a non-default fixture —
   `text_prefix: vec!["prefix".into()]`,
   `message_content: vec![MessageContent::Leaf(LeafContent::Text { text: "[Image: shot.png]".into(), parent_tool_use_id: None })]`,
   `images: vec![ImageInput { media_type: "image/png".into(), data: "AAA".into() }]`,
   `attachment_previews: vec![serde_json::json!({ "id": "att-1" })]`. Seed
   `working_chat("c1", Some("t"), true)` with `RecSession::new("c1", true, true)`, so
   the chat is already titled (no title work in play) and the replay-ack + `Working`
   combination takes the queued branch. Send
   `mgr.send_message("c1", "hello", Some(&ids), None)` where
   `let ids = vec!["att-1".to_string()];`.

   Assert:
   - `session.send_message_calls.lock().unwrap()[0].0 == "prefix\n\nhello"` — the
     `text_prefix.join("\n")` + `format!("{prefix}\n\n{content}")` composition
     (`chat_manager.rs:1934-1942`) survived the move;
   - `session.images_calls.lock().unwrap()[0] == 1` — the image reached
     `session.send_message`. `send_message_calls` records only `(message, uuid)`, so
     without `images_calls` a dropped image is unobservable;
   - the `MessageAdded` event's `message.content` is exactly
     `["[Image: shot.png]", "hello"]` in that order — the processed nodes precede the
     typed text, which is what `std::mem::take(&mut processed.message_content)` must
     preserve;
   - that message's `metadata` is `Some` and carries all three keys: `queued == true`,
     `attachments` an array of one element equal to `{"id":"att-1"}`, and `uuid` equal
     to `send_message_calls[0].1`;
   - `deps.events()` contains exactly one `ContextUpdated` — the attachment one
     (`chat_manager.rs:1990-1995`). `mentions_found` is `false` here and the preamble
     emits none, so the count is unambiguous.
9. `mentions_in_plain_text_still_emit_context_updated` — covers the mentions
   `ContextUpdated` (`chat_manager.rs:2000-2005`), which B2.6 moves "verbatim" into
   `send_plain_text` and which no existing test reaches.

   Set `*deps.mentions_found.lock().unwrap() = true`, seed
   `working_chat("c1", Some("t"), false)` with `RecSession::new("c1", false, true)`,
   send `"look at @src/main.rs"` with no attachments. Assert `deps.events()` contains
   exactly one `ContextUpdated`, and that flipping the flag is what produces it — a
   companion run is unnecessary, because test 8's fixture already pins the count at one
   with `mentions_found` false and attachments present.

Verify: `cd packages/core-rs && cargo test -p mainframe-chat` — **no name filter.**
Cargo filters by substring against the full test path (`chat_manager::tests::<name>`),
and five of the nine names carry no shared token: tests 4, 5, 6, 8 and 9 do not contain
`command_first`. A filtered run would silently drop test 5 — the off-the-send-path guard
whose red state is the load-bearing evidence for this stage.

Expected: exactly five failures out of the nine new tests, and every other test in the
crate green.

- fail: `provider_command_first_message_sets_the_fallback_title`
- fail: `mainframe_command_first_message_titles_from_typed_text_not_the_wrapper`
- fail: `command_first_message_generated_title_overwrites_the_fallback`
- fail: `title_generation_is_not_awaited_by_a_command_send`
- fail: `command_first_fallback_survives_a_generation_that_returns_nothing`
- pass: `command_into_an_already_titled_chat_leaves_the_title_untouched` (today the
  command path writes no title at all, so "the title is untouched" already holds)
- pass: `plain_text_first_message_still_titles_in_the_same_event_order`
- pass: `plain_text_with_attachments_keeps_prefix_images_and_transient_metadata` (a
  B2 move guard, green on both sides of the move by construction)
- pass: `mentions_in_plain_text_still_emit_context_updated` (same)

Paste cargo's `failures:` list verbatim into the commit body. A sixth failure, or a
different set, means a test asserts something other than this bug. In particular, a
red test 8 or 9 means the new fake fields changed existing behavior rather than
exposing it — fix the fake, not the assertion.
Commit as `test(chat): red command-first title tests (#257)`.

### Group B — lift the title work out and split the send path so both shapes reach it

Both tasks are one commit: B1's helper only compiles once B2 calls it, and the module
declaration lands with the module.

#### Task 3 — B1. Create `chat_manager/send.rs` and move the title block into a helper

Files: `packages/core-rs/crates/mainframe-chat/src/chat_manager/send.rs` (new),
`packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

1. Create `chat_manager/send.rs` with a module doc comment ("the dispatch half of
   `send_message`: command vs plain text, and the first-message titling both share"),
   `use super::*;`, and a single `impl ChatManager { … }` block. `use super::*;` is what
   `chat_manager/tests.rs` already does; it pulls in the parent's private `use` bindings
   (`Arc`, `Mutex`, `HashMap`, `DaemonEvent`, `LeafContent`, `derive_title_from_message`,
   …) and the parent's private types (`ActiveChat`, `ChatUpdate`, `ProcessedAttachments`,
   `CommandMeta`, `SendError`). Add no other `use` — a duplicate import under
   `-D warnings` fails CI.
2. Declare it in `chat_manager.rs` as `mod send;` on its own line after the final `use`
   statement (line 50), mirroring `worktree_offer.rs:27`. It is not `#[cfg(test)]` and
   not `pub`: nothing outside `chat_manager` names the module.
3. **Visibility.** A method defined in `impl ChatManager` inside `mod send` is private to
   `send` unless marked otherwise. The two methods `send_message` calls —
   `dispatch_command` and `send_plain_text` — must be `pub(super)`. Everything else in
   the file stays private, since it is only called from within `send.rs`. Going the other
   way needs nothing: `self.deps`, `self.messages`, `self.emit`, `self.event_handler`,
   `self.queued_refs`, `self.lifecycle` and `self.set_working` are private to
   `chat_manager`, and a descendant module sees its ancestors' private items.
4. Move `chat_manager.rs` lines 2007–2043 verbatim into

   ```rust
   /// First-message titling: the deterministic fallback, then LLM summarization.
   /// No-op once the chat has a title.
   fn assign_initial_title(&self, cell: &Arc<Mutex<ActiveChat>>, chat_id: &str, content: &str)
   ```

   substituting `cell` for `post` and keeping the existing comment that explains why
   `do_generate_title` is spawned rather than awaited. Keep the order: mutate
   `guard.chat.title` → `deps.chats_update` → clone chat → emit `ChatUpdated` →
   `tokio::spawn(do_generate_title)`. ~40 lines.

No standalone verify: until B2 calls it, `assign_initial_title` is an unused private
method, which `-D warnings` rejects. B2's verify covers both tasks.

#### Task 4 — B2. Split `send_message` into a preamble and two symmetric dispatch helpers

Files: same two.

Relocating 37 lines inside a 295-line function is not enough: the mid-body
`return Ok(());` at line 1920 is what caused this bug, and leaving it there keeps the two
`assign_initial_title` call sites 120 lines apart. Decompose instead, so `send_message`
reads as preamble plus a visible two-way dispatch and each call site sits at the top of
its helper. Every function below is under 50 lines; each moves an existing contiguous
range with no reordering, so the behavioral guard is the 15 existing `send_message`
tests plus A2.6, A2.8 and A2.9 — the last two being what make that guard reach the
attachment, prefix, image and mention branches at all (see Risks).

All of these live in `send.rs`.

1. **`store_user_message`** — both dispatch shapes store and emit the user's text, so
   they share one helper.

   ```rust
   fn store_user_message(
       &self,
       chat_id: &str,
       message_content: Vec<MessageContent>,
       transient_metadata: HashMap<String, serde_json::Value>,
       attachment_ids: Option<&[String]>,
   ) -> ChatMessage
   ```

   Body: `chat_manager.rs` lines 1970–1998 verbatim (create the transient message →
   `append` → emit `MessageAdded` → `emit_display` → the attachment `ContextUpdated`),
   returning `message`. It subsumes the command branch's lines 1881–1902 exactly: that
   path passes one `LeafContent::Text` node, an empty `HashMap` (which the existing
   `if transient_metadata.is_empty()` turns back into the `None` metadata it passed
   before), and `None` attachment ids (so the `ContextUpdated` branch is skipped, as
   before). The command path discards the returned message; only `send_plain_text` needs
   it, for the queued ref. ~39 lines.

2. **`prepare_outgoing`** — lines 1923–1942.

   ```rust
   async fn prepare_outgoing(
       &self,
       chat_id: &str,
       content: &str,
       attachment_ids: Option<&[String]>,
   ) -> (ProcessedAttachments, Vec<MessageContent>, String)
   ```

   One mechanical change to the moved code: `let mut processed = …` and
   `let mut message_content = std::mem::take(&mut processed.message_content);` — moving
   the field out wholesale (`processed.message_content`, line 1927) would partially move
   a value the helper still returns. Nothing reads `processed.message_content` after this
   point; the later reads are `.attachment_previews` (1959) and `.images` (2053).
   Returns `(processed, message_content, outgoing_content)`. ~29 lines.

3. **`queued_message_metadata`** — lines 1944–1969, the replay-ack/queued decision and
   the transient metadata it drives.

   ```rust
   fn queued_message_metadata(
       &self,
       post: &Arc<Mutex<ActiveChat>>,
       session: &Arc<dyn AdapterSession>,
       attachment_previews: &[serde_json::Value],
   ) -> (HashMap<String, serde_json::Value>, Option<String>)
   ```

   Verbatim except that line 1959's `processed.attachment_previews` becomes the
   `attachment_previews` parameter. Returns `(transient_metadata, message_uuid)`.
   ~35 lines.

4. **`record_queued_ref`** — the body of `if let Some(uuid) = message_uuid` (lines
   2059–2080), unchanged including its `info!`.

   ```rust
   fn record_queued_ref(
       &self,
       chat_id: &str,
       message: &ChatMessage,
       uuid: String,
       content: &str,
       attachment_ids: Option<&[String]>,
   )
   ```

   ~32 lines.

5. **`dispatch_command`** — the command branch, lines 1880–1920.

   ```rust
   /// Command dispatch: store and emit the user's text, title the chat, hand the
   /// command to the adapter (wrapped for mainframe-source commands), mark working.
   pub(super) async fn dispatch_command(
       &self,
       cmd: CommandMeta,
       post: &Arc<Mutex<ActiveChat>>,
       session: &Arc<dyn AdapterSession>,
       chat_id: &str,
       content: &str,
   ) -> Result<(), SendError>
   ```

   Body: `store_user_message` with the single text node (replacing 1881–1902), then
   `self.assign_initial_title(post, chat_id, content);`, then lines 1904–1919 verbatim
   (the `cmd.source == "mainframe"` wrap-or-`send_command` split, `set_working`, the
   `ChatUpdated` emit), then `Ok(())` in place of the `return Ok(());`. The title call
   sits where the emit_display used to end and before the wrapper is built, so `content`
   — the user's typed text — is the only thing titling ever sees. ~37 lines.

6. **`send_plain_text`** — the plain-text tail, lines 1923–2082, assembled from the
   helpers above.

   ```rust
   /// Plain-text send: attachments, the (possibly queued) user message, titling,
   /// working state, dispatch, and the queued-ref bookkeeping.
   pub(super) async fn send_plain_text(
       &self,
       post: &Arc<Mutex<ActiveChat>>,
       session: &Arc<dyn AdapterSession>,
       chat_id: &str,
       content: &str,
       attachment_ids: Option<&[String]>,
   ) -> Result<(), SendError>
   ```

   In order: `prepare_outgoing` → `queued_message_metadata` → `store_user_message` → the
   mentions check (2000–2005, verbatim) → `self.assign_initial_title(post, chat_id, content);`
   in place of the title block (2007–2043) → `set_working` + the `ChatUpdated` emit
   (2045–2048, verbatim) → `session.send_message(outgoing_content, processed.images.clone(), message_uuid.clone()).await?`
   → `if let Some(uuid) = message_uuid { self.record_queued_ref(…); }` → `Ok(())`. The
   event order is byte-for-byte what it was. ~30 lines.

7. `send_message` (staying in `chat_manager.rs`) keeps its signature and its preamble
   (lines 1789–1879) and ends with the dispatch:

   ```rust
   if let Some(cmd) = command {
       return self.dispatch_command(cmd, &post, &session, chat_id, content).await;
   }
   self.send_plain_text(&post, &session, chat_id, content, attachment_ids)
       .await
   ```

Verify:

- `cd packages/core-rs && cargo test -p mainframe-chat` — the whole crate green,
  including all seven Group A tests and the 15 pre-existing `send_message` tests. **No
  test file may be edited in this task.** If one needs editing, the move was not verbatim.
- `cargo clippy --all-targets -- -D warnings` — clean (this is the CI invocation).
- `cargo fmt --check`.
- Sizes, measured after `cargo fmt` and stated in the commit body. Every new function is
  under 50 and the new file is under 300:
  `assign_initial_title` ~40, `dispatch_command` ~37, `send_plain_text` ~30,
  `store_user_message` ~39, `prepare_outgoing` ~29, `queued_message_metadata` ~35,
  `record_queued_ref` ~32; `send.rs` ~260; `chat_manager.rs` 2351 → ~2155;
  `send_message` 295 → ~98. The two survivors — the parent file over 300 and
  `send_message` over 50 — are the pre-existing violations deferred to **#292** per
  Constraints. If `send.rs` overshoots 300, move items 1–4 (the four plain-text assembly
  helpers, which no other module names) into a sibling `chat_manager/send_parts.rs` with
  the same `mod` + `use super::*;` shape; do not solve it by re-inlining a helper.

Commit as `fix(chat): title a session whose first message is a slash command (#257)`.

### Group C — changeset

A standalone group: it shares no file with A or B and reads nothing they produce.

#### Task 5 — C1. Changeset

File: `.changeset/command-first-session-title.md`

```
---
'@qlan-ro/mainframe-app-tauri': patch
---
```

Body: a session started with a slash command now gets a title. The daemon skipped its
whole title path when the first message was a command, so the session stayed
"Untitled" on every client, including the phone. It now derives the same fallback
title from what you typed and replaces it with the generated summary moments later.

Verify: `git status` shows the changeset; `pnpm changeset status` does not error.

## Task groups

| Group | Tasks | Files | Kind | `parallel_safe` | `depends_on` |
|---|---|---|---|---|---|
| `command-title-red-tests` | 1 (A1), 2 (A2) | `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs` | test | `true` | — |
| `lift-title-out-of-plain-text-tail` | 3 (B1), 4 (B2) | `packages/core-rs/crates/mainframe-chat/src/chat_manager/send.rs` (new), `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs` | core | `true` | `command-title-red-tests` |
| `command-first-title-changeset` | 5 (C1) | `.changeset/command-first-session-title.md` | core | `true` | — |

`parallel_safe` is a file-collision flag between groups: true when the group shares no
file with any other group. No two groups here share a file — A owns `chat_manager/tests.rs`,
B owns `chat_manager.rs` and the new `chat_manager/send.rs`, C owns the changeset — so all
three are `true`. It says nothing about the tasks inside a group, which run in listed
order.

The A-before-B ordering is carried entirely by B's `depends_on`: B's verify step runs
Group A's tests and must see them go green, so A's red-phase commit has to exist first.
C depends on nothing.

## Acceptance-criteria map

| Criterion (todo #257) | Covered by |
|---|---|
| Command-first chat ends up with a non-empty title | A2.1, B2.5 (`dispatch_command`) |
| Fallback `chat.updated`, then generated `chat.updated` | A2.3 (asserts over `deps.events()`) |
| Title derives from and is summarized from typed text; no wrapper leak | A2.2 (title **and** `generate_title_calls`) |
| Both command sources covered | A2.1 (provider), A2.2 (mainframe) |
| Already-titled chat is a no-op | A2.4 |
| Fallback retained when generation cannot run | A2.7 |
| Plain text unchanged, same event order | A2.6, B2.6 (`send_plain_text`); A2.8/A2.9 pin the attachment, prefix, image and mention branches the move otherwise carries untested |
| Message still stored/emitted, command still dispatched, chat still working | A2.1 |
| Chat-manager-level, transport-independent regression tests | Group A (calls `send_message` directly) |
| Generation still off the send path | A2.5, B1 |
| Functions under 50 | B1 + B2 — every function this plan creates; `send_message`'s remaining 91-line preamble and `chat_manager.rs`'s length deferred to #292 |
| Files under 300 | B1 (`send.rs` ~260; `chat_manager.rs` 2351 → ~2155, still over, deferred to #292) |
| Project rules: tests, no `console.*`/`println!`, no sync I/O, changeset | C1, verification steps |

Not owed here: new logging (#287), Codex title support (#275b), backfilling existing
null-title chats, any mobile change, any WS/HTTP schema change (no endpoint or event
shape moves, so the existing Zod/serde validation and the `ok`/`fail` envelope are
untouched).

## Risks

- **Concurrent branch.** #287 rewrites `do_generate_title`'s body. This plan calls it
  but does not edit it, and touches no file #287 touches. If #287 lands first, rebase
  is a no-op; verify by re-running `cargo test -p mainframe-chat` after the rebase.
- **Spawned-task timing in tests.** `settle()` relies on `yield_now` rather than
  sleeping. If a future fake makes `generate_title` genuinely block on I/O, tests 3
  and 5 need the gate pattern from A1.3 instead of more yields.
- **Empty `content` with attachments only.** `derive_title_from_message("")` returns
  `""`, so a chat can still end up with an empty-string title. Pre-existing on the
  plain-text path, unchanged here, and outside the todo's scope.
- **B2 moves 200 lines into a new file, and the test suite does not cover all of it.**
  Splitting `send_message` is a larger diff than the bug fix itself. It is mechanical —
  the bodies move verbatim, `post` and `session` become borrowed parameters — and the
  intended guard is behavioral, not visual: the 15 existing `send_message` call sites in
  `chat_manager/tests.rs` must stay green with no test edits. But that guard is uneven,
  and Group A has to close the gap before B2 may lean on it. What the suite covers as it
  stands today:
  - **Covered.** The queued/replay-ack path and the queued-ref bookkeeping —
    `chat_manager/tests.rs:486-604` drives `is_queued`, the `uuid` metadata,
    `MessageQueued`, and `record_queued_ref`. Plain-text first-message titling and its
    event order — A2.6.
  - **Not covered before Group A.** `StoreDeps::process_attachments` (`tests.rs:186-191`)
    returns `ProcessedAttachments::default()` and no existing test passes
    `attachment_ids`, so the whole of `prepare_outgoing` (B2.2) is unreachable in the
    fake: the `text_prefix.join` / `format!("{prefix}\n\n{content}")` composition, the
    `std::mem::take` this plan flags as its one non-verbatim edit, and the `images`
    handoff — which `RecSession::send_message` (`tests.rs:391-401`) could not observe
    anyway, since it records only `(message, uuid)`. The `attachments` transient-metadata
    branch and the attachment `ContextUpdated` inside `store_user_message` (B2.1) are
    equally unreachable, and `StoreDeps::extract_mentions_from_text` (`tests.rs:280-282`)
    hardcodes `false`, so the mentions `ContextUpdated` that B2.6 moves "verbatim
    (2000-2005)" is untested too.
  - **The fix, in Group A.** A1 gives the fakes `attachments`, `mentions_found` and
    `RecSession::images_calls`; A2.8 and A2.9 exercise every branch listed above. Both
    are green before and after B2 — they are move guards, not red-phase tests — and both
    land in the Group A commit, which keeps B2's "no test file may be edited" invariant
    intact. Group A owns `tests.rs`; Group B never touches it.

  Reviewing the move is easier than the line count suggests: `git diff -M
  --find-copies-harder` renders most of `send.rs` as a move.
- **Two mechanical changes hide inside the "verbatim" moves.** `prepare_outgoing` needs
  `std::mem::take` for `message_content` (B2.2) and `store_user_message` reaches the
  command path's `None` metadata through an empty `HashMap` (B2.1). Both are called out
  in the task; neither changes an emission. They are the two places to look first if a
  pre-existing test goes red.
