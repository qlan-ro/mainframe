# Todo #257 — a session whose first message is a slash command never gets a title

## Goal

A chat whose first message carries command metadata is titled exactly like a chat
whose first message is plain text: the deterministic fallback title is derived from
the user's typed text, persisted, and broadcast immediately, and asynchronous LLM
summarization is started off the send path and overwrites the title on success.
Today the daemon's send path returns from the command branch before it reaches the
title block, so the chat row keeps a null title forever and every client renders its
own "Untitled" placeholder. The fix lifts the title work out of the plain-text tail
into a private helper on `ChatManager` and calls it from both branches, deriving the
title from the caller's `content` (the typed `/name args`) so the mainframe wrapper
envelope can never reach a title. No client changes: the existing `chat.updated`
fan-out already delivers to the phone.

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
- File/function size: `chat_manager.rs` (2351 lines) and `send_message` (~280 lines)
  already exceed the repo limits. This change **reduces** both by extracting ~35 lines
  into a helper that is itself under 50 lines. Splitting either file is out of scope
  and would collide with unrelated in-flight work.

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
     `deps.updates`.

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
   `CommandMeta { name: "greet", source: "mainframe", args: Some("Say hello") }`.
   Assert the stored title equals the typed text verbatim, contains neither
   `"<mainframe-command"` nor `"<mainframe-command-response"`, and that
   `send_message_calls[0].0` still contains `"<mainframe-command name=\"greet\""`.
3. `command_first_message_generated_title_overwrites_the_fallback` — set
   `*deps.generated_title.lock().unwrap() = Some("Compact the session".into())`, send
   the provider command, `settle().await`. Assert the stored title is
   `"Compact the session"`, and that `titles_written(&deps)` is
   `["/compact", "Compact the session"]` in that order (fallback broadcast first,
   summary second).
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

Verify: `cd packages/core-rs && cargo test -p mainframe-chat command_first` — tests 1,
2, 3, 5 fail; 4 and 6 pass. Record the failure output in the commit message body.
Commit as `test(chat): red command-first title tests (#257)`.

### Group B — lift the title work so both dispatch shapes reach it

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

#### B2. Call it from both branches

File: same.

1. Command branch: insert `self.assign_initial_title(&post, chat_id, content);`
   immediately after `self.event_handler.emit_display(chat_id);` (line 1902) and
   before `if cmd.source == "mainframe"`. `content` is the user's typed text; the
   wrapper built below is never passed to the helper.
2. Plain-text tail: replace the moved block at line 2007 with
   `self.assign_initial_title(&post, chat_id, content);`, leaving its position
   between the mentions check and `set_working` unchanged so the plain-text event
   order is byte-for-byte what it was.

Verify:

- `cd packages/core-rs && cargo test -p mainframe-chat` — all Group A tests green.
- `cargo clippy -p mainframe-chat --all-targets` — clean.
- `cargo fmt --check`.

Commit as `fix(chat): title a session whose first message is a slash command (#257)`.

#### B3. Changeset

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

## Acceptance-criteria map

| Criterion (todo #257) | Covered by |
|---|---|
| Command-first chat ends up with a non-empty title | A2.1, B2.1 |
| Fallback `chat.updated`, then generated `chat.updated` | A2.3 |
| Title derives from typed text; no wrapper leak | A2.2 |
| Both command sources covered | A2.1 (provider), A2.2 (mainframe) |
| Already-titled chat is a no-op | A2.4 |
| Plain text unchanged, same event order | A2.6, B2.2 |
| Message still stored/emitted, command still dispatched, chat still working | A2.1 |
| Chat-manager-level, transport-independent regression tests | Group A (calls `send_message` directly) |
| Generation still off the send path | A2.5, B1 |
| Project rules: tests, no `console.*`/`println!`, no sync I/O, changeset | B3, verification steps |

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
