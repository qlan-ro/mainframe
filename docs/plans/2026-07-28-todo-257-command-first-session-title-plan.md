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
first lines. The title derives from the caller's `content` (the typed `/name args`), so
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
- Todo #287 is in flight on `todo/287-title-generation-logging` and touches
  `lifecycle_manager.rs`, `chat_deps.rs`, `external_session_service.rs`,
  `test_support.rs`, and the claude adapter's `title_generator.rs`. It touches
  **neither** `chat_manager.rs` nor `chat_manager/tests.rs`. This plan stays inside
  those two files (plus a changeset) so the two branches cannot conflict.

## Constraints

- No new logging is owed (that is #287); do not regress its observability, and do not
  edit the files it owns.
- Title generation must stay off the send path (`tokio::spawn`, not awaited).
- The deterministic fallback format, its 50-char limit, and its truncation rule are
  frozen.
- `cargo fmt` + workspace clippy lints must pass; a changeset is required.
- File/function size: `chat_manager.rs` is 2351 lines and `send_message` is 295
  (lines 1789–2083); both already break the repo limits. Every extraction here is
  intra-file, so the **file grows** by roughly 25 lines of helper signatures and doc
  comments — only `send_message` shrinks, from 295 to ~97. Group B brings
  `dispatch_command` (~49) and `assign_initial_title` (~40) under the 50-line limit;
  `send_plain_text` (~132) and the file itself stay over it. Splitting the module is
  deferred to **todo #292**, filed alongside this plan. The reason is not a collision —
  no in-flight branch touches `chat_manager.rs`, #287 included (see Context) — but blast
  radius: a 2351-line module split rewrites every import in the chat crate and would bury
  this bug fix's actual behavior change in an unreviewable diff.

## Tasks

### Group A — red-phase tests (`chat_manager/tests.rs`)

All of Group A lands in
`packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs` and must be
committed and observed **failing** before Group B exists.

#### A1. Teach the `StoreDeps` fake to observe titles

File: `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs`

1. Add three fields to `struct StoreDeps` (line 17):
   - `generated_title: Mutex<Option<String>>` — what `generate_title` returns.
   - `generate_title_calls: Mutex<Vec<String>>` — the `content` of each call.
   - `title_gate: Mutex<Option<Arc<tokio::sync::Notify>>>` — when set,
     `generate_title` awaits `notified()` before returning.
2. In `impl ChatManagerDeps for StoreDeps`, extend `chats_update` (line 84) to apply
   `patch.title` to the stored chat, alongside the existing `process_state` and
   `transcript_missing` handling. Without this the store never reflects a title and
   "the chat row is titled" is untestable.
3. Replace `generate_title` (line 255) so it records the content, awaits the gate when
   one is installed, then returns `self.generated_title.lock().unwrap().clone()`.
   Clone the gate `Arc` out of the mutex **before** awaiting — never hold a
   `std::sync::MutexGuard` across an `.await`.
4. Add two test-module helpers next to `seed_active` (line 462):
   - `async fn settle()` — `for _ in 0..50 { tokio::task::yield_now().await; }`, so the
     spawned title task runs to completion on the current-thread test runtime.
   - `fn titles_written(deps: &StoreDeps) -> Vec<String>` — every `title` present in
     `deps.updates`. This is the **store-patch log**, not the event stream; assertions
     about broadcasts must read `deps.events()` instead.

Verify: `cd packages/core-rs && cargo test -p mainframe-chat` compiles and the
pre-existing tests still pass (no assertions changed yet).

#### A2. Red tests: a command-first message gets titled

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
     symptom — the phone only ever sees a title via the event): the titles carried by
     `DaemonEvent::ChatUpdated` in `deps.events()`, in order, are
     `["/compact", "Compact the session"]` — the fallback event first, the summarized
     event second. The second event is reachable in this fake: `LcDeps::emit_event`
     (`chat_manager.rs:555`) routes `do_generate_title`'s `ChatUpdated` through
     `enrich_and_emit` (`chat_manager.rs:395-412`) into `StoreDeps::emit_event`, so both
     land in `deps.events()`.
   - **the persistence**, as a separate check: `titles_written(&deps)` is
     `["/compact", "Compact the session"]` and
     `deps.chats_get("chat-1").unwrap().title == Some("Compact the session")`.

   `titles_written` reads `deps.updates` — the store-patch log, not the event stream — so
   it can never stand in for the broadcast assertion.
4. `command_into_an_already_titled_chat_leaves_the_title_untouched` —
   `title_cmd_manager(Some("Test chat"))`, send the provider command, `settle().await`.
   Assert no entry in `deps.updates` carries `title: Some(_)`; no `ChatUpdated` event
   carries a title other than `"Test chat"`; `deps.generate_title_calls` is empty.
5. `title_generation_is_not_awaited_by_a_command_send` — install a `title_gate`
   `Notify`, then wrap the send in
   `tokio::time::timeout(Duration::from_secs(2), mgr.send_message(...))` and
   `.expect("send must not await title generation")`. Then `gate.notify_one()`
   (permit-storing, so it works whether or not the task has parked yet),
   `settle().await`, and assert the generated title landed.
6. `plain_text_first_message_still_titles_in_the_same_event_order` — regression guard,
   expected **green** before and after Group B. Untitled chat, send `"Hello world"`,
   no command. Assert the stored title is `"Hello world"`, and that in
   `deps.events()` the index of the `ChatUpdated` carrying a title is less than the
   index of the `ChatUpdated` carrying `process_state: Working`, and both precede
   nothing that reorders the turn (assert `send_message_calls.len() == 1`).
7. `command_first_fallback_survives_a_generation_that_returns_nothing` — covers todo
   #257 desired-behavior item 6. Leave `generated_title` at `None`, send the provider
   command, `settle().await`. Assert the stored title is still `Some("/compact")`, that
   `deps.generate_title_calls.len() == 1` (generation was attempted, not skipped), and
   that `titles_written(&deps) == ["/compact"]` (no second write clobbers the fallback
   with an empty title). Tests 1 and 2 cannot cover this: they assert the row without
   `settle()`, so the spawned task has not necessarily run and retention is untested.

Verify: `cd packages/core-rs && cargo test -p mainframe-chat command_first` — tests 1,
2, 3, 5, 7 fail; 4 and 6 pass. Record the failure output in the commit message body.
Commit as `test(chat): red command-first title tests (#257)`.

### Group B — lift the title work out and split the send path so both shapes reach it

#### B1. Extract the title block into a private helper

File: `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

Add a private method on `impl ChatManager`, directly above `set_working` (line 2085):

```rust
/// First-message titling: the deterministic fallback, then LLM summarization.
/// No-op once the chat has a title.
fn assign_initial_title(&self, cell: &Arc<Mutex<ActiveChat>>, chat_id: &str, content: &str)
```

Move lines 2007–2043 verbatim into it, substituting `cell` for `post`, including the
existing comment explaining why `do_generate_title` is spawned rather than awaited.
Keep the emission order: mutate `guard.chat.title` → `deps.chats_update` → clone chat
→ emit `ChatUpdated` → `tokio::spawn(do_generate_title)`. The helper must stay under
50 lines.

#### B2. Split `send_message` into a preamble and two symmetric dispatch helpers

File: same.

Relocating 37 lines inside a 295-line function is not enough: the mid-body
`return Ok(());` at line 1920 is what caused this bug, and leaving it there keeps the two
`assign_initial_title` call sites 120 lines apart. Decompose instead, so `send_message`
reads as preamble plus a visible two-way dispatch and each call site sits at the top of
its helper. Both helpers stay in `chat_manager.rs`, which no other in-flight branch
touches.

1. Extract the command branch (lines 1880–1920) into

   ```rust
   /// Command dispatch: store and emit the user's text, title the chat, hand the
   /// command to the adapter (wrapped for mainframe-source commands), mark working.
   async fn dispatch_command(
       &self,
       cmd: CommandMeta,
       post: &Arc<Mutex<ActiveChat>>,
       session: &Arc<dyn AdapterSession>,
       chat_id: &str,
       content: &str,
   ) -> Result<(), SendError>
   ```

   The body is lines 1881–1919 verbatim, with `self.assign_initial_title(post, chat_id, content);`
   inserted immediately after `self.event_handler.emit_display(chat_id);` (line 1902) and
   before `if cmd.source == "mainframe"`, and the trailing `return Ok(());` becoming
   `Ok(())`. `content` is the user's typed text; the wrapper built below it is never
   passed to the helper.

2. Extract the plain-text tail (lines 1923–2082) into the sibling

   ```rust
   /// Plain-text send: attachments, the (possibly queued) user message, titling,
   /// working state, dispatch, and the queued-ref bookkeeping.
   async fn send_plain_text(
       &self,
       post: &Arc<Mutex<ActiveChat>>,
       session: &Arc<dyn AdapterSession>,
       chat_id: &str,
       content: &str,
       attachment_ids: Option<&[String]>,
   ) -> Result<(), SendError>
   ```

   Its body is that range verbatim except that the title block (2007–2043) is replaced by
   `self.assign_initial_title(post, chat_id, content);` from B1, keeping its position
   between the mentions check and `set_working` so the plain-text event order is
   byte-for-byte what it was.

3. `send_message` keeps its signature and its preamble (lines 1789–1879) and ends with the
   dispatch:

   ```rust
   if let Some(cmd) = command {
       return self.dispatch_command(cmd, &post, &session, chat_id, content).await;
   }
   self.send_plain_text(&post, &session, chat_id, content, attachment_ids)
       .await
   ```

Verify:

- `cd packages/core-rs && cargo test -p mainframe-chat` — all Group A tests green.
- `cargo clippy -p mainframe-chat --all-targets` — clean.
- `cargo fmt --check`.
- Line counts, measured after `cargo fmt` and stated in the commit body:
  `send_message` 295 → ~97; `dispatch_command` ~49; `assign_initial_title` ~40;
  `send_plain_text` ~132; `chat_manager.rs` 2351 → ~2375. Only `send_plain_text` and the
  file itself remain over the repo limits, both deferred to **#292** per Constraints.
  If `cargo fmt` pushes `dispatch_command` past 50, extract its
  `create_transient_message` / `append` / `emit(MessageAdded)` / `emit_display` sequence
  (lines 1881–1902) into `fn emit_user_text(&self, chat_id: &str, text: &str)` and call it
  from `dispatch_command`; that lands it near 30.

Commit as `fix(chat): title a session whose first message is a slash command (#257)`.

### Group C — changeset

The only task here that shares no file with Groups A and B, so it is the only one that
can genuinely run in parallel.

#### C1. Changeset

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
| `command-title-red-tests` | A1, A2 | `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs` | test | `false` | — |
| `lift-title-out-of-plain-text-tail` | B1, B2 | `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs` | core | `false` | `command-title-red-tests` |
| `command-first-title-changeset` | C1 | `.changeset/command-first-session-title.md` | core | `true` | — |

Both A and B are marked `parallel_safe: false` because their own tasks are strictly
serial and share a file: A2 consumes the fake fields and helpers A1 adds
(`generated_title`, `generate_title_calls`, `title_gate`, `settle()`,
`titles_written()`) in the same test file, and B2 calls the `assign_initial_title`
helper B1 adds, in the same file and the same region of the same function. Only C is
independent.

## Acceptance-criteria map

| Criterion (todo #257) | Covered by |
|---|---|
| Command-first chat ends up with a non-empty title | A2.1, B2.1 |
| Fallback `chat.updated`, then generated `chat.updated` | A2.3 (asserts over `deps.events()`) |
| Title derives from and is summarized from typed text; no wrapper leak | A2.2 (title **and** `generate_title_calls`) |
| Both command sources covered | A2.1 (provider), A2.2 (mainframe) |
| Already-titled chat is a no-op | A2.4 |
| Fallback retained when generation cannot run | A2.7 |
| Plain text unchanged, same event order | A2.6, B2.2 |
| Message still stored/emitted, command still dispatched, chat still working | A2.1 |
| Chat-manager-level, transport-independent regression tests | Group A (calls `send_message` directly) |
| Generation still off the send path | A2.5, B1 |
| Functions under 50 | B2 (`dispatch_command`, `assign_initial_title`); `send_plain_text` and the file deferred to #292 |
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
- **B2 moves 200 lines.** Splitting `send_message` is a larger diff than the bug fix
  itself. It is mechanical — the bodies move verbatim, `post` and `session` become
  borrowed parameters — but the guard is behavioral, not visual: the 15 existing
  `send_message` call sites in `chat_manager/tests.rs` plus A2.6's event-order assertion
  must stay green with no test edits. If any needs editing, the move was not verbatim.
