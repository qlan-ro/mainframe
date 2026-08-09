# Codex image attachments — implementation plan (todo #300)

**Branch:** `todo/300-codex-image-attachments` · **Route:** no-spec (planner works from the approved Agent Brief)
**Runtime:** `packages/core-rs` only. The Node daemon is retired; do not add a parallel implementation anywhere else.

## Goal

An image attached to a Codex session must reach the model instead of being dropped into a daemon log. The
attachment store starts materializing image-kind attachments to the chat's `files/` directory exactly as it
already does for file-kind ones, the pure attachment→adapter transform copies that daemon-local path onto the
out-of-band `ImageInput`, and the Codex session builds a `turn/start` input array of `localImage` entries
followed by the text entry. Claude keeps delivering images inline as base64 and ignores the new path. When an
image cannot be delivered — no materialized path, or a media type the CLI will not accept — the turn still
sends with its text and the deliverable images, and one System message in the transcript names how many images
were dropped and why.

## Constraints from CLAUDE.md

- Max 300 lines per file, 50 per function. `codex/src/session.rs` (807) and `claude/src/session.rs` (1752) are
  already over; every new unit of logic in this plan goes into a new small module rather than growing them.
- Tests required for new core logic. Prefer `cargo test -p <crate> <filter>` over whole-suite runs.
- No silent catches: every swallowed error logs through `tracing`.
- A changeset accompanies the change (task 12).
- No leftovers: the obsolete `codex: image attachments not supported yet, skipping` warn is deleted in the same
  pass, not deprecated in place.

## Verified facts this plan is built on

| Fact | Evidence |
|---|---|
| Codex user input accepts `{"type":"localImage","detail"?,"path"}` | `codex app-server generate-ts --experimental` (CLI 0.144.3), `v2/UserInput.ts` |
| Codex accepts png / jpeg / gif / webp | `strings` on `codex-aarch64-apple-darwin` 0.144.3 contains the contiguous run `image/jpegimage/gifimage/webpimage/png` and no other `image/*` accept-list |
| `text_elements` is a required array on the text variant | same generated schema; today's `json!` already sends `[]` |
| The store materializes file-kind only | `attachment_store.rs:99` `if attachment.kind == AttachmentKind::File` |
| The transform already reads `materialized_path` for previews | `attachment_processor.rs:70` |
| `SessionSink::on_cli_message` renders a transient System message | `mainframe-chat/src/event_handler.rs:1174` |
| `ImageInput` never crosses the wire — no client contract to break | only constructed in `attachment_processor.rs:23` and `chat_manager/tests.rs:1262`; routes take `attachmentIds` |
| A session can be pointed at a fake `codex` binary | `SessionSpawnOptions::executable_path`, used by `codex/tests/list_models.rs` |

## Decisions made here (brief was silent or ambiguous)

1. **Image previews stay byte-identical.** Once images carry a `materialized_path`, the generic `build_preview`
   would start emitting `materializedPath` on image previews. The brief's acceptance criterion says the emitted
   preview objects are byte-identical to today, so `build_preview` gains a guard that emits `materializedPath`
   for file-kind only. This also keeps daemon-local paths out of persisted message metadata and out of the
   mobile-visible contract. **Flagged for review** — the alternative reading (leave `build_preview` untouched
   and accept the extra key) was rejected for those two reasons.
2. **The notice is emitted after `turn/start` returns `Ok`.** A notice sent before a failing request would
   strand a System message for a turn that never started. Exactly one `on_cli_message` per send.
3. **The text entry is always present**, as it is today, even when the message is empty. This preserves the
   no-image byte-identity criterion and matches "local-image entries followed by the text entry".
4. **No `stat()` at send time.** `path: None` is the undeliverable signal. A recorded path whose file was
   deleted out from under the daemon is Codex's error to surface; probing the filesystem on every send would put
   I/O into an otherwise pure builder.
5. **The new field is named `path`** on `ImageInput`, matching the Codex `localImage` field it feeds. Its doc
   comment states that it is the daemon-local materialized file and that inline adapters ignore it.
6. **Changeset bumps `@qlan-ro/mainframe-ui` (patch).** No npm package contains the Rust daemon, and
   `mainframe-ui` is the package the release pipeline tags from; `types` rides along through the `fixed` group.
7. **The upload route's response now carries `materializedPath` on image items** (it returns the saved metas
   verbatim). This is additive and mobile ignores unknown fields — no client change is needed.

## Files this plan touches

| File | Change |
|---|---|
| `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs` | `ImageInput` gains `path: Option<String>` |
| `packages/core-rs/crates/mainframe-services/src/attachment/attachment_store.rs` | materialize both kinds; tests |
| `packages/core-rs/crates/mainframe-chat/src/attachment_processor.rs` | propagate the path; preview guard; tests |
| `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs` | one `ImageInput` literal gains the field |
| `packages/core-rs/crates/mainframe-adapter-codex/src/user_input.rs` | **new** — input builder, format gate, notice copy |
| `packages/core-rs/crates/mainframe-adapter-codex/src/lib.rs` | declare the new module |
| `packages/core-rs/crates/mainframe-adapter-codex/src/session.rs` | use the builder; delete the skip-warn; emit the notice |
| `packages/core-rs/crates/mainframe-adapter-claude/src/user_payload.rs` | **new** — extracted stdin payload builder |
| `packages/core-rs/crates/mainframe-adapter-claude/src/lib.rs` | declare the new module |
| `packages/core-rs/crates/mainframe-adapter-claude/src/session.rs` | call the extracted builder |
| `packages/core-rs/crates/mainframe-adapter-codex/tests/common/mod.rs` | `Recorder` records `on_cli_message` |
| `packages/core-rs/crates/mainframe-adapter-codex/tests/send_message_input.rs` | **new** — fake app-server integration test |
| `.changeset/codex-image-attachments.md` | **new** |

All work is in `packages/core-rs`. No UI change: the notice renders through the existing System-message path.

---

## Group A — attachment pipeline (tasks 1-4, 12)

### Task 1 — `ImageInput` carries a daemon-local path

**File:** `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs`

Add to `ImageInput` (after `data`):

```rust
    /// Daemon-local file holding the decoded bytes, when the attachment store
    /// materialized one. Adapters that deliver images inline (Claude) ignore it;
    /// adapters whose CLI takes a filesystem path (Codex) need it. `None` for any
    /// call site with no materialized file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
```

Update the two existing literals so the workspace compiles:

- `packages/core-rs/crates/mainframe-chat/src/attachment_processor.rs:23` → `path: None` (task 4 replaces it).
- `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs:1262` → `path: None`.

**Verify:** `cargo check --workspace` from `packages/core-rs` succeeds with no other construction site failing.

### Task 2 — store tests for image materialization (red)

**File:** `packages/core-rs/crates/mainframe-services/src/attachment/attachment_store.rs` (`mod tests`)

Add four tests. They must fail before task 3.

1. `materializes_image_bytes_and_records_the_path` — save one `AttachmentKind::Image` with `data: b64("fake-image-data")`; assert the returned meta's `materialized_path` is `Some`, that the file exists on disk, and that its bytes are `b"fake-image-data"`.
2. `stored_image_metadata_carries_the_materialized_path` — after the save above, `store.get(chat, id)` returns a `StoredAttachment` whose `materialized_path` equals the meta's.
3. `strips_path_traversal_from_image_file_name` — the image-kind twin of the existing `strips_path_traversal_from_file_name`: name `"../../etc/passwd"`, assert the path contains no `..` and stays under the temp base dir.
4. `delete_chat_removes_materialized_images` — save an image, capture its `materialized_path`, `delete_chat`, assert `tokio::fs::metadata(path)` is `Err` and `list` is empty.

**Verify:** `cargo test -p mainframe-services attachment_store` — the four new tests fail, the existing ones pass.

### Task 3 — materialize both kinds (green)

**File:** `packages/core-rs/crates/mainframe-services/src/attachment/attachment_store.rs`

In `save`, drop the `if attachment.kind == AttachmentKind::File` branch and always call the materializer;
rename `materialize_file` → `materialize` and update its doc reference. Keep the existing per-item
warn-and-continue shape exactly: on error, log the same `tracing::warn!` and leave `materialized_path = None`
rather than failing the save. Update the `PORT STATUS` note at the bottom of the file to say materialization is
kind-agnostic.

**Verify:** `cargo test -p mainframe-services attachment_store` — all green, including the pre-existing
file-kind sanitization and traversal tests.

### Task 4 — transform propagates the path, previews unchanged

**File:** `packages/core-rs/crates/mainframe-chat/src/attachment_processor.rs`

Tests first (they fail before the impl edit in the same task):

1. `image_input_carries_the_materialized_path` — a `StoredAttachment` image with
   `materialized_path: Some("/tmp/chat/files/abc-shot.png")` produces `out.images[0].path ==
   Some("/tmp/chat/files/abc-shot.png")`, with `media_type` and `data` unchanged.
2. `image_input_path_is_none_without_materialization` — `materialized_path: None` → `path: None`.
3. `image_preview_omits_materialized_path` — the preview for a materialized image equals
   `json!({"name":"shot.png","mediaType":"image/png","sizeBytes":128,"kind":"image"})`, with no
   `materializedPath` key.
4. `file_preview_still_includes_materialized_path` — a file-kind attachment with a materialized path keeps the
   `materializedPath` key.

Then the implementation:

- In the `AttachmentKind::Image` arm, add `path: attachment.materialized_path.clone()` to the `ImageInput`.
  The `MessageContent::Leaf(LeafContent::Image { .. })` block stays exactly as it is.
- In `build_preview`, gate the `materializedPath` insert on `attachment.kind == AttachmentKind::File`, with a
  one-line why: the materialized image path is a daemon-local delivery detail, not part of the client preview.
- Leave the `AttachmentKind::File` arm and `build_attached_file_path_tag` untouched.

**Verify:** `cargo test -p mainframe-chat attachment_processor` — all green, including the five pre-existing
tests.

### Task 12 — changeset

**File:** `.changeset/codex-image-attachments.md`

```markdown
---
'@qlan-ro/mainframe-ui': patch
---

Codex sessions now receive image attachments. The daemon writes every image attachment to the chat's files
directory and hands Codex the resulting path; when an image can't be delivered, the turn still sends and the
transcript says how many images were dropped and why.
```

**Verify:** the file exists and `pnpm changeset status` runs without error.

---

## Group B — Codex delivery (tasks 5-7)

### Task 5 — `user_input.rs` tests (red)

**File:** `packages/core-rs/crates/mainframe-adapter-codex/src/user_input.rs` (new, `#[cfg(test)] mod tests`)

Write the tests against this intended surface:

```rust
pub enum UndeliverableReason { UnsupportedFormat, MissingFile }
pub struct TurnInput { pub input: Vec<UserInput>, pub undeliverable: Vec<UndeliverableReason> }
pub fn build_turn_input(message: &str, images: &[ImageInput]) -> TurnInput;
pub fn undeliverable_notice(reasons: &[UndeliverableReason]) -> Option<String>;
```

Tests:

1. `no_images_produces_the_same_text_only_input_as_before` — `serde_json::to_value(build_turn_input("hi",
   &[]).input)` equals `json!([{ "type": "text", "text": "hi", "text_elements": [] }])`, key order included.
2. `one_image_serializes_to_local_image_then_text` — equals
   `json!([{ "type": "localImage", "path": "/tmp/a.png" }, { "type": "text", "text": "hi", "text_elements": [] }])`.
3. `multiple_images_keep_input_order`.
4. `image_without_a_path_is_undeliverable_as_missing_file` — no `localImage` entry, `undeliverable ==
   [MissingFile]`, the text entry still present.
5. `unsupported_media_type_is_undeliverable_even_with_a_path` — `image/heic` with a path →
   `[UnsupportedFormat]`.
6. `accepted_media_types_are_png_jpeg_gif_webp` — all four deliver; `IMAGE/PNG` and `image/png; charset=binary`
   also deliver (case-insensitive, parameters stripped).
7. `empty_message_still_carries_a_text_entry`.
8. `notice_is_none_when_nothing_was_dropped`.
9. `notice_singular` — `[UnsupportedFormat]` →
   `"1 image couldn't be attached (unsupported format) — the rest of your message was sent."`
10. `notice_plural_same_reason` — two `UnsupportedFormat` →
    `"2 images couldn't be attached (unsupported format) — the rest of your message was sent."`
11. `notice_mixed_reasons` — two `UnsupportedFormat` + one `MissingFile` →
    `"3 images couldn't be attached (2 unsupported format, 1 missing file) — the rest of your message was sent."`

**Verify:** `cargo test -p mainframe-adapter-codex user_input` fails to compile or fails outright before task 6.

### Task 6 — `user_input.rs` implementation (green)

**Files:** `packages/core-rs/crates/mainframe-adapter-codex/src/user_input.rs`,
`packages/core-rs/crates/mainframe-adapter-codex/src/lib.rs`

- Build on the existing `crate::types::UserInput` enum so the wire shape is typed rather than hand-rolled JSON.
  Always construct the text variant with `text_elements: Some(Vec::new())` — the generated schema marks the
  field required, and `skip_serializing_if` would otherwise drop it.
- Images first, in input order, then exactly one text entry.
- `const DELIVERABLE_MEDIA_TYPES: [&str; 4] = ["image/png", "image/jpeg", "image/gif", "image/webp"];` with a
  one-line why citing the CLI 0.144.3 accept list. The check takes the substring before `;`, trims it, and
  compares ASCII-case-insensitively.
- Classification order per image: unsupported media type wins over a missing path, so a `.heic` with no path
  reports `UnsupportedFormat`.
- `undeliverable_notice` returns `None` for an empty slice. Otherwise it counts per reason in the fixed order
  `UnsupportedFormat`, `MissingFile`, and renders
  `"{n} image{s} couldn't be attached ({reasons}) — the rest of your message was sent."`, where `{s}` is `s`
  when `n > 1` and `{reasons}` is the bare label when a single reason group is present, or `"{count} {label}"`
  segments joined by `", "` when both are.
- Declare `pub(crate) mod user_input;` in `lib.rs`, alphabetically between `unified_diff` and
  `web_search_history`.
- Keep every function under 50 lines and the file under 300.

**Verify:** `cargo test -p mainframe-adapter-codex user_input` — all eleven green.

### Task 7 — wire the Codex session

**File:** `packages/core-rs/crates/mainframe-adapter-codex/src/session.rs`

In `send_message`, replace the `if !images.is_empty() { tracing::warn!(...) }` block and the hand-rolled
`let input = json!([...])` with:

```rust
let crate::user_input::TurnInput { input, undeliverable } =
    crate::user_input::build_turn_input(&message, &images);
let input = serde_json::to_value(&input).map_err(|e| AdapterError::Message(e.to_string()))?;
```

After the `turn/start` request returns `Ok` and before the status flips to `Running`, emit the notice once:

```rust
if let Some(notice) = crate::user_input::undeliverable_notice(&undeliverable) {
    tracing::warn!(
        module = "codex:session",
        session_id = %self.id,
        count = undeliverable.len(),
        "codex: images not delivered"
    );
    self.sink
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .clone()
        .on_cli_message(&notice);
}
```

Successful delivery logs nothing per image. The old skip-warn string must not survive anywhere.

**Verify:** `cargo test -p mainframe-adapter-codex` green;
`rg "image attachments not supported" packages/core-rs` returns nothing.

---

## Group C — Claude regression guard (tasks 8-9)

### Task 8 — `user_payload.rs` tests (red)

**File:** `packages/core-rs/crates/mainframe-adapter-claude/src/user_payload.rs` (new, `#[cfg(test)] mod tests`)

Target surface:

```rust
pub fn build_user_payload(
    chat_id: &str,
    message: &str,
    images: &[ImageInput],
    uuid: Option<&str>,
) -> Value;
```

Tests:

1. `image_block_precedes_the_text_block` — one image (`media_type: "image/png"`, `data: "AAA"`,
   `path: Some("/tmp/a.png")`) plus text `"hi"` produces
   `content == json!([{ "type": "image", "source": { "type": "base64", "media_type": "image/png", "data": "AAA" } }, { "type": "text", "text": "hi" }])`.
   The assertion pins that the new `path` is absent from the Claude payload.
2. `empty_message_with_an_image_emits_no_text_block`.
3. `empty_message_without_images_still_emits_one_empty_text_block`.
4. `uuid_is_attached_when_present_and_absent_otherwise`.
5. `envelope_keeps_type_session_id_and_null_parent_tool_use_id`.

**Verify:** `cargo test -p mainframe-adapter-claude user_payload` fails before task 9.

### Task 9 — extract and call the builder (green)

**Files:** `packages/core-rs/crates/mainframe-adapter-claude/src/user_payload.rs`,
`packages/core-rs/crates/mainframe-adapter-claude/src/lib.rs`,
`packages/core-rs/crates/mainframe-adapter-claude/src/session.rs`

Move the payload construction out of `ClaudeSession::send_message` (currently `session.rs:902-920`) verbatim —
same image-then-text order, same `!message.is_empty() || content.is_empty()` guard, same `uuid` handling. The
`is_spawned()` guard and `write_stdin` stay in `send_message`, which becomes:

```rust
let payload = crate::user_payload::build_user_payload(&chat_id, &message, &images, uuid.as_deref());
self.write_stdin(payload.to_string());
```

Declare `pub(crate) mod user_payload;` in `lib.rs`. Do not touch `send_text` (line ~875); it has no images and
is out of scope.

**Verify:** `cargo test -p mainframe-adapter-claude` green; `cargo check -p mainframe-adapter-claude` clean.

---

## Group D — integration and close-out (tasks 10-11, 13)

### Task 10 — `Recorder` records CLI messages

**File:** `packages/core-rs/crates/mainframe-adapter-codex/tests/common/mod.rs`

Add `pub cli_messages: Vec<String>` to `Recorded`, record it in `RecordingSink::on_cli_message`, and add a
`pub fn cli_messages(&self) -> Vec<String>` accessor next to the existing ones.

**Verify:** `cargo test -p mainframe-adapter-codex` still compiles and passes (the field is unused until task
11; `#![allow(dead_code)]` at the top of the module already covers that).

### Task 11 — `turn/start` integration test against a fake app-server

**File:** `packages/core-rs/crates/mainframe-adapter-codex/tests/send_message_input.rs` (new)

Model it on `tests/list_models.rs`: `#![cfg(unix)]`, a `tempdir`, a `0o755` shell script named `codex`, and a
`CodexSession` spawned with `SessionSpawnOptions { executable_path: Some(<fake>), .. }` and the recorder's sink.
The script reads `initialize`, `initialized`, `thread/start` and `turn/start` line by line, writes the
`turn/start` line to a capture file, and replies:

- `{"id":1,"result":{"userAgent":"codex/0.144.3","codexHome":"/tmp/.codex"}}`
- `{"id":2,"result":{"thread":{"id":"thread-1"}}}`
- `{"id":3,"result":{"turn":{"id":"turn-1","status":"inProgress"}}}`

**The capture path is inlined into each case's own script, never passed through the environment.** Two reasons.
`build_app_server_command` (`codex/src/session.rs:194-212`) hard-codes its env overrides and offers no seam for
a test-supplied variable, so the environment would mean the process env — and the workspace is `edition =
"2024"` (`packages/core-rs/Cargo.toml:6`), under which `std::env::set_var` is `unsafe`; the repo routes around
it everywhere (`mainframe-runtime/src/spawn_env.rs:11-15`, `mainframe-runtime/src/config.rs:241`,
`mainframe-lsp/src/lsp_registry/tests.rs:123-124`, `mainframe-daemon/src/main.rs:880`). And a process-global
variable would race: the three cases share one test binary, the repo sets no `test-threads` limit, so libtest
runs them concurrently and each fake `codex` would read whichever value won.

So each case builds its own script text before `fs::write`. Keep the const a template with a `__CAPTURE__`
placeholder and substitute with `str::replace` rather than `format!` — the script body is full of JSON braces,
which `format!` would require doubling:

```rust
const FAKE_APP_SERVER: &str = r#"#!/bin/sh
IFS= read -r _initialize
printf '{"id":1,"result":{"userAgent":"codex/0.144.3","codexHome":"/tmp/.codex"}}\n'
IFS= read -r _initialized
IFS= read -r _thread_start
printf '{"id":2,"result":{"thread":{"id":"thread-1"}}}\n'
IFS= read -r turn_start
printf '%s\n' "$turn_start" > '__CAPTURE__'
printf '{"id":3,"result":{"turn":{"id":"turn-1","status":"inProgress"}}}\n'
cat >/dev/null
"#;

let capture = dir.path().join("turn-start.json");
fs::write(&fake, FAKE_APP_SERVER.replace("__CAPTURE__", capture.to_str().unwrap())).unwrap();
```

Each case gets its own `tempdir`, so its `capture` path — and its fake `codex` — belong to that case alone and
concurrent execution cannot cross them. Factor the script write and the session spawn into one helper in the
test file to keep all three cases under the file's line budget.

Three cases:

1. `sends_local_image_entries_before_the_text_entry` — one `ImageInput` with
   `path: Some(<an existing temp file>)` and `media_type: "image/png"`; parse the captured line and assert
   `params.input` equals
   `[{"type":"localImage","path":<that path>},{"type":"text","text":"look","text_elements":[]}]`, and that
   `recorder.cli_messages()` is empty.
2. `sends_the_same_text_only_input_when_there_are_no_images` — `params.input` equals
   `[{"type":"text","text":"hi","text_elements":[]}]`.
3. `an_undeliverable_image_still_sends_and_emits_exactly_one_notice` — one image with `path: None`; the
   captured `params.input` has no `localImage` entry, `send_message` returns `Ok`, and
   `recorder.cli_messages()` has exactly one entry equal to
   `"1 image couldn't be attached (missing file) — the rest of your message was sent."`

The session's `project_path` must be an existing directory (`spawn` stats it), so use the tempdir.

**Verify:** `cargo test -p mainframe-adapter-codex --test send_message_input` — all three green.

### Task 13 — close-out

Run, from `packages/core-rs`:

- `cargo test -p mainframe-services -p mainframe-chat -p mainframe-adapter-codex -p mainframe-adapter-claude`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo fmt --check`

Then confirm the acceptance criteria by hand:

- no file added by this change exceeds 300 lines, no function 50;
- `rg "image attachments not supported" packages/core-rs` is empty;
- the changeset exists.

**Verify:** all three commands exit zero.

---

## Task-to-group map

| Group | Tasks | Kind | Depends on | Shares files with another group |
|---|---|---|---|---|
| A — attachment pipeline | 1, 2, 3, 4, 12 | core | — | no |
| B — codex delivery | 5, 6, 7 | core | A (reads `ImageInput.path`) | no |
| C — claude regression guard | 8, 9 | core | A (asserts the `path` field is ignored) | no |
| D — integration and close-out | 10, 11, 13 | test | A, B, C | no |

Rust's compile-unit coupling means a red-phase test in group B or C that references `ImageInput.path` cannot
even build until group A lands, so B and C depend on A rather than racing it. Group D depends on C as well as
on A and B: its close-out task runs the Claude suite that group C creates, and would otherwise pass without the
regression guard existing. Within each group the tests are written and observed failing before the
implementation task that satisfies them.

## Risks

- **The Codex accept-list is inferred, not documented.** The `image/jpeg image/gif image/webp image/png` run in
  the 0.144.3 binary is strong but indirect evidence. If a future CLI accepts more, widening the const is a
  one-line change; until then an unaccepted type produces the clear notice instead of an opaque CLI error.
- **Disk cost doubles for images** — base64 in the JSON blob plus decoded bytes in `files/`. Bounded at 5 MB per
  attachment and removed with the chat, which is the deal file-kind attachments already accept.
- **The integration test spawns a shell script.** It is `#![cfg(unix)]` like `list_models.rs`; on a
  non-Unix runner it compiles out.
