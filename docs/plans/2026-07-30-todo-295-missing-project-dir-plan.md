# Todo #295 — Sending to a project whose directory is gone fails silently

**Route:** `no-spec` (works from the approved Agent Brief + the 2026-07-29 Design direction)
**Branch:** `todo/295-missing-project-dir` · **Worktree:** `.worktrees/todo-295-missing-project-dir`

## Goal

A registered project whose directory has vanished currently looks fully usable: it sits in the switcher
alongside live projects, a session can be created in it, and a send silently dies — `startChat` fails with a
precise reason that only reaches the daemon log, and the follow-up send returns a chat-less `"Internal error"`
frame that surfaces as a toast naming nothing. This change makes the dead directory a first-class, visible
state. The daemon derives a per-project availability signal on read and a per-chat `directoryMissing` signal
over the chat's *effective* working directory (worktree path when set, otherwise the owning project's path),
so the existing worktree-only machinery finally covers the standalone-project case. A failed chat start emits
a chat-scoped error carrying the daemon's real reason, and the WebSocket send-failure path stops substituting
`"Internal error"`. In the client, the recovery card moves out of the scrolling transcript into the thread's
sticky footer and takes the composer's slot when the directory is missing, gaining a
"Project directory missing" cause; the controller refuses every send path up front; and an unavailable
project's switcher row renders muted with an "Unavailable" chip while staying clickable and its history
readable. Nothing is pruned, archived, or repointed.

## Constraints

- Root `CLAUDE.md`: max 300 lines/file and 50 lines/function; `data-testid` on every interactive element,
  kebab-case `<surface>-<element>`, keyed by domain id; single canonical type in
  `@qlan-ro/mainframe-types`; no `@ts-ignore`; tests required for new routes/core logic; a changeset is
  mandatory; never commit to `main`.
- `packages/ui/CLAUDE.md`: read the `mainframe-design-system` skill before writing markup or class names;
  no feature imports `layout/`; files < 300 lines.
- The WS/REST contract is co-owned by the `packages/mobile` submodule — **all wire changes here are
  additive** (new optional fields only). Do not touch the submodule pointer.
- Rust daemon lives in `packages/core-rs` (its own cargo workspace). `packages/core` is the orphaned TS
  daemon and is **not** updated by this plan.

## Out of scope (from the brief)

Auto-pruning/auto-archiving worktree-backed projects (split to its own todo); relocating a project to a new
path; the project-removal path (#291) beyond leaving it reachable; changing what `worktreeMissing` means or
the existing recreate-worktree / continue-in-project-root / continue-here actions; PR #520's worktree switch
offer.

## Decisions made while planning

These deviate from, or resolve gaps in, the brief and design direction. Each is called out for review.

- **D1 — The card replaces the composer only when `directoryMissing` is set; for a transcript-only
  degradation it sits above a working composer.** The design direction says the card "substitutes for
  `<Composer />`", written for the *blocked* state. Applying that to the transcript-deleted case would remove
  the only way to act on "Continue here" and regress a shipped flow (a transcript-missing chat sends fine
  today; the next send just starts a fresh session). So: the card always renders in the sticky footer; the
  composer is omitted only when `directoryMissing` is true. This satisfies both the design's blocked-state
  criterion and the brief's "renders in the sticky region directly above the composer".
- **D2 — Both paths in the card get `<code>` + `break-all`, not just the new one.** The design direction
  prescribes the code/`break-all` treatment for the project path because the card is now column-width
  constrained. The worktree path in the existing cause section has exactly the same overflow exposure in
  exactly the same slot; fixing one and leaving the other is a leftover. The e2e assertion
  `toContainText(worktreePath)` is unaffected.
- **D3 — The chat carries `missingDirectoryPath` alongside `directoryMissing`.** The card must *name* the
  path (acceptance criterion) and the controller's refusal toast must too, but a chat only carries
  `projectId`; the project path is not on the wire, and `useProjects` is a sessions-feature hook the chat
  feature cannot reach without a second fetch or prop-drilling across features. The enrichment already
  resolves the project path to compute the signal, so it stamps the absent directory next to it. Set only
  when `directoryMissing` is true.
- **D4 — `handle_permission_respond` gets the same real-error fix as `handle_message_send`.** The brief names
  only the send path, but the identical three-line `chat_id: None` / `"Internal error"` substitution sits ten
  lines below in the same file, and the criterion is "the string `Internal error` no longer replaces a known
  cause". Both call one shared helper.
- **D5 — The composer's own `worktreeMissing` guard is removed, not generalized.** Once `ChatThread` omits
  the composer for a missing directory, the in-composer disabled state is unreachable (`directoryMissing` is
  true whenever `worktreeMissing` is). Keeping it would be dead code. The refusal moves to
  `ChatThreadController.sendMessage`/`retryMessage`, where it covers every send path (queued mid-run Enter,
  restored draft, retry) rather than only the rendered composer.
- **D6 — `CHIP_BASE` is extracted to `components/ui/chip.ts`.** The design direction points the switcher chip
  at `CHIP_BASE` in `layout/MainToolbar.tsx`, but `packages/ui/CLAUDE.md` forbids a feature importing
  `layout/`. The recipe string moves verbatim to `components/ui/chip.ts`; `MainToolbar` imports it from
  there. The switcher chip overrides `font-mono` → `font-sans` (a word, not an identifier) and drops the
  `max-w-[230px]` cap via `cn`.
- **D7 — Availability is stamped on `GET /api/projects` and `GET /api/projects/:id` only, not on `POST`.**
  A just-registered path exists by construction, and the 409 branch returns the row for a path the caller
  just named. The UI reloads the list after a create.
- **D8 — Rust red-phase is limited to the HTTP-observable availability test.** A Rust test that calls a
  changed `enrich_chat` signature or a not-yet-existing helper does not fail, it fails *to compile*, which
  blocks `cargo test` for the whole crate rather than producing an observed red. Only
  `tests/routes_projects.rs` can be written black-box against today's API and observed failing; the other
  daemon tests ship in the same group as their implementation.

## Naming (fixed, do not vary)

| Concept | TS | Rust | Wire |
|---|---|---|---|
| Project directory resolves on disk | `Project.available?: boolean` | `Project.available: Option<bool>` | `available` |
| Chat's effective working dir is gone | `Chat.directoryMissing?: boolean` | `Chat.directory_missing: Option<bool>` | `directoryMissing` |
| The absent directory | `Chat.missingDirectoryPath?: string` | `Chat.missing_directory_path: Option<String>` | `missingDirectoryPath` |

`Chat.worktreeMissing` keeps its current, narrower meaning and its current derivation. Untouched.

---

# Task groups

## Group 1 — `shared-contract` (core)

Owns the wire/type contract and the filesystem-availability helpers everything else builds on.

### Task 1.1 — Add the three fields to the shared TypeScript types

**File:** `packages/types/src/chat.ts`

- On `interface Chat`, after `worktreeMissing?: boolean;`, add:
  - `directoryMissing?: boolean;` with a doc comment: derived per response over the chat's effective working
    directory (`worktreePath ?? project.path`); generalizes `worktreeMissing`, never persisted.
  - `missingDirectoryPath?: string;` — the absent directory, set only when `directoryMissing` is true.
- On `interface Project`, add `available?: boolean;` with a doc comment: derived on read by stat-ing `path`;
  never persisted, absent on responses that do not derive it.

**Verify:** `pnpm --filter @qlan-ro/mainframe-types build` succeeds.

### Task 1.2 — Mirror the fields in the Rust types and fix every construction site

**Files:**
- `packages/core-rs/crates/mainframe-types/src/chat.rs` — add to `struct Chat` (next to `worktree_missing`,
  same `#[serde(skip_serializing_if = "Option::is_none")]` treatment):
  `pub directory_missing: Option<bool>` and `pub missing_directory_path: Option<String>`. Add
  `pub available: Option<bool>` to `struct Project` with `#[serde(default, skip_serializing_if = "Option::is_none")]`.
- `packages/core-rs/crates/mainframe-db/src/chats.rs` — lines ~285 and ~737 construct a `Chat` with
  `worktree_missing: None`; add `directory_missing: None, missing_directory_path: None` at both.
- `packages/core-rs/crates/mainframe-db/src/projects.rs` — `row_to_project` (~line 20) and `create` (~line 83)
  construct a `Project`; add `available: None` at both. Do **not** add a column or touch the schema.
- Fix any other construction sites the compiler flags (e.g. `mainframe-chat/src/test_support.rs`).

**Verify:** `cd packages/core-rs && cargo check --workspace` passes with no errors.

### Task 1.3 — Add the directory-presence helpers

**File:** `packages/core-rs/crates/mainframe-services/src/workspace/worktree.rs`

Next to the existing `is_worktree_present` (line 67), add:

- `pub fn is_directory_present(path: &str) -> bool` — `Path::new(path).is_dir()`. A project directory need
  not be a git checkout, so this must **not** require `.git`, unlike `is_worktree_present`.
- `pub async fn is_directory_present_async(path: &str) -> bool` —
  `tokio::fs::metadata(path).await.is_ok_and(|m| m.is_dir())`.

One-line doc comment above the pair explaining why both exist: `enrich_chat` is synchronous by construction
(it runs under a held lock, like the existing `is_worktree_present` call), while the projects route is async
and the repo bans sync I/O in async daemon paths.

Add `#[cfg(test)] mod` tests in the same file: an existing tempdir returns true for both variants, a
non-existent path returns false for both, and a *file* path (not a directory) returns false for both.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-services is_directory_present` — 6 assertions pass.

---

## Group 2 — `daemon-availability-tests` (test, red phase)

Black-box HTTP assertions written against today's API. They must be observed **failing** before Group 4 runs.

### Task 2.1 — Assert project availability on the list and single-project responses

**File:** `packages/core-rs/crates/mainframe-server/tests/routes_projects.rs`

Add two `#[tokio::test]`s using the existing `spawn_test_server` harness and `tempfile::TempDir`:

- `list_marks_a_project_whose_directory_is_gone_unavailable` — create one project at a live tempdir path and
  one at a path under a tempdir that is then removed (or a path that never existed). `GET /api/projects`;
  assert `data[]` carries `available: true` for the live one and `available: false` for the dead one, matched
  by `path`, not by array index.
- `get_one_carries_availability` — create a project at a nonexistent path;
  `GET /api/projects/{id}` returns `data.available == false`. Create one at a live tempdir; it returns
  `data.available == true`.

Do not weaken `list_starts_empty` — it asserts the whole body against `{"success":true,"data":[]}` and stays
valid.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-server --test routes_projects` — the two new tests
FAIL (`available` is absent from the JSON), every pre-existing test in the file still passes. Record the
failure output.

---

## Group 3 — `daemon-chat-signals` (core)

### Task 3.1 — Derive `directoryMissing` / `missingDirectoryPath` in the chat enrichment

**Files:** `packages/core-rs/crates/mainframe-chat/src/chat_manager.rs`

- Change the signature to
  `fn enrich_chat(chat: &mut Chat, has_pending: bool, live_tasks: &[BackgroundTask], project_path: Option<&str>)`
  and update its doc comment (currently `/// enrichChat — set displayStatus/isRunning/backgroundActivity/worktreeMissing`).
- Leave the `worktree_missing` derivation exactly as it is.
- After it, derive the generalized signal:
  - when `chat.worktree_path` is `Some(wt)` → missing = `!is_worktree_present(wt)`, absent path = `wt`;
  - when it is `None` → missing = `project_path.map(|p| !is_directory_present(p))`, absent path = that project
    path. When `project_path` is `None` (project row gone), set `directory_missing = Some(false)` and leave
    `missing_directory_path` as `None` — a vanished *row* is not a vanished *directory*, and #291 owns removal.
  - `chat.missing_directory_path` is set only when the signal is true; otherwise `None`.
- Update the five call sites so each supplies the project path via
  `deps.projects_get_path(&chat.project_id)`: `enrich_and_emit` (~line 410) and the four direct calls
  (~1170, ~1185, ~1202, ~1419). In the loop call sites (~1185, ~1202, ~1419) resolve the path per chat; these
  loops already run per chat and `projects_get_path` is an in-process DB read.

**Verify:** `cd packages/core-rs && cargo check -p mainframe-chat`.

### Task 3.2 — Unit-test the derivation

**File:** `packages/core-rs/crates/mainframe-chat/src/chat_manager/tests.rs`

Extend the existing enrichment test block (the `super::enrich_chat(...)` cases around lines 1499–1562; all
existing calls need the new fourth argument). Add cases:

1. worktree set and present → `worktree_missing == Some(false)`, `directory_missing == Some(false)`,
   `missing_directory_path == None`.
2. worktree set and gone → both flags `Some(true)`, `missing_directory_path == Some(worktree path)`.
3. **no worktree, project path gone** → `worktree_missing == Some(false)` (unchanged meaning),
   `directory_missing == Some(true)`, `missing_directory_path == Some(project path)`. This is the todo's
   headline case.
4. no worktree, project path present (tempdir) → both `Some(false)`.
5. no worktree, `project_path == None` → `directory_missing == Some(false)`, no path.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat enrich` — all pass, no pre-existing
enrichment test regresses.

### Task 3.3 — Fail chat start loudly when the project directory is gone

**File:** `packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs`

- In `do_start_chat` (~line 879), immediately after `projects_get_path` resolves `project_path` and before
  `create_session`, mirror the existing worktree guard — **scoped to the no-worktree branch**:
  ```
  if chat.worktree_path.is_none() && !self.deps.path_exists(&project_path) {
      return Err(LifecycleError::Message(format!(
          "Project directory does not exist or is not accessible: {project_path}")));
  }
  ```
  The scoping is load-bearing, not defensive. The spawn runs in
  `chat.worktree_path.clone().unwrap_or(project_path)` (line 918), so a chat with a live worktree does not
  need the project path to exist — and Task 3.1 derives `directoryMissing` over that same effective
  directory, so such a chat reports `directoryMissing: false` and renders a working composer. An
  unconditional guard would refuse a start that works today and that the UI shows as available. The
  worktree branch is already covered by the pre-existing guard at lines 904–909.

  The wording matches what `mainframe-adapter-claude/src/session.rs:525` and
  `mainframe-adapter-codex/src/session.rs:325` already emit, so the message is identical whether the guard or
  the adapter catches it — but it is now adapter-independent and reached before a process spawn.
- In `start_chat` (~line 491), the `if let Err(err) = result { warn!(...) }` tail must also emit the failure to
  the client. Keep the `warn!`, then
  `self.deps.emit_event(DaemonEvent::Error { chat_id: Some(chat_id.to_string()), error: err.to_string() });`
  A chat-scoped `error` event reaches only that chat's subscribers (`fanout` in `websocket.rs` gates on
  `chatId`), which is exactly the attribution the client needs.

### Task 3.4 — Test the start-failure event

**File:** `packages/core-rs/crates/mainframe-chat/src/lifecycle_manager.rs` (`#[cfg(test)] mod tests`)

The in-file `FakeDeps` (~line 1074) already implements `emit_event` (~1106) and `path_exists` (~1178). Give
`path_exists` a per-instance answer (e.g. a `HashSet<String>` of present paths, or a bool flag) instead of its
current fixed return, keeping the existing tests' behavior unchanged by defaulting to today's value.

Add tests:
- `start_chat_emits_a_chat_scoped_error_when_the_project_directory_is_gone` — a chat with no worktree whose
  project path is absent; drive `start_chat`; assert the captured events contain
  `DaemonEvent::Error { chat_id: Some("<chat id>"), error }` where `error` contains both
  `"Project directory does not exist or is not accessible"` and the project path, and that no
  `ProcessStarted` was emitted.
- `start_chat_emits_a_chat_scoped_error_when_the_worktree_is_gone` — same shape via the pre-existing worktree
  guard; asserts the error is chat-scoped and names the worktree path.
- `start_chat_proceeds_when_the_worktree_is_live_and_the_project_path_is_gone` — worktree path present,
  project path absent; assert the new guard does not fire (no `Error` event naming the project directory).
  This pins the `worktree_path.is_none()` scoping from Task 3.3.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-chat lifecycle` — new tests pass, existing pass.

---

## Group 4 — `daemon-server-surfaces` (core)

### Task 4.1 — Stamp availability on the project responses

**File:** `packages/core-rs/crates/mainframe-server/src/routes/projects.rs`

- Add a private `async fn stamp_availability(project: &mut Project)` that sets
  `project.available = Some(is_directory_present_async(&project.path).await)`, importing the helper from
  `mainframe_services::workspace`.
- `list` — after the db call returns `Vec<Project>`, stamp each in sequence before `ok(projects)`. A handful
  of `metadata` calls per request; no caching, no watcher (the brief's decision — a stale liveness flag is
  worse than a cheap fresh one).
- `get_one` — stamp the single project before `ok(project)`.
- Leave `create` and its 409 branch alone (D7). Add a one-line comment on `stamp_availability` saying the flag
  is derived per response and never persisted.

Keep `list`/`get_one` under the 50-line function cap; extract if the stamping loop pushes them over.

**Verify:** `cd packages/core-rs && cargo test -p mainframe-server --test routes_projects` — Group 2's two
tests now PASS; the rest of the file still passes.

### Task 4.2 — Forward the real error and the chat id on a WebSocket handler failure

**File:** `packages/core-rs/crates/mainframe-server/src/websocket.rs`

- Add `fn send_failure_event(chat_id: &str, err: &dyn std::fmt::Display) -> DaemonEvent` returning
  `DaemonEvent::Error { chat_id: Some(chat_id.to_string()), error: err.to_string() }`.
- `handle_message_send` (~line 530): replace the `chat_id: None` / `"Internal error"` literal with
  `send(out_tx, &send_failure_event(&chat_id, &err))`. Keep the `tracing::error!` line.
- `handle_permission_respond` (~line 563): same replacement (D4).
- Update the two doc comments that currently promise an `Internal error` frame (the block above
  `handle_message_send` at ~line 500 and the `handle_permission_respond` note at ~line 538) to describe the
  new behavior; a stale comment here is a leftover.

Add a unit test in the file's existing `#[cfg(test)] mod` (~line 780):
`send_failure_event_carries_the_chat_id_and_the_real_message` — serialize the event, assert
`chatId == "c1"` and `error == "Chat c1 not running"`, and assert the payload does not contain
`"Internal error"`. (An end-to-end ws test is not available: `spawn_test_server` builds `AppCtx` with
`chat_manager: None`, so `handle_message_send` returns before the failure path.)

**Verify:** `cd packages/core-rs && cargo test -p mainframe-server websocket` and
`cargo clippy -p mainframe-server -- -D warnings`.

---

## Group 5 — `ui-red-tests` (test, red phase)

New/extended vitest specs written against the not-yet-changed client. Every one must be observed failing.
Run each file alone (`pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`) — large batches hit the
known cross-file `React.act` failure.

### Task 5.1 — Card placement and composer absence

**File (new):** `packages/ui/src/features/chat/thread/__tests__/ChatThread-degraded-placement.test.tsx`

Mirror the *mocking style* of the existing `ChatThread-compacting.test.tsx` (mock
`../runtime/use-chat-thread-runtime`'s `useChatExtras`, mock the `@assistant-ui/react` primitives, stub the
heavy children) — but **not** its two mocks for the components under test. That file mocks `DegradedChatCard`
to `null` (line 33) and stubs the composer as `data-testid="composer-stub"` (line 41), which would make both
assertions below unobservable. In this spec:

- render the **real** `DegradedChatCard` (no `vi.mock('../DegradedChatCard', ...)`), stubbing only what it
  reaches outside the tree under test (`@/lib/api/chats`, `daemon-port-context`);
- stub the composer as `<div data-testid="chat-composer" />`, matching the real `Composer`'s testid
  (`Composer.tsx:108`), so `chat-composer` counts mean what they say.

Assert:

- `directoryMissing: true` → `chat-degraded-card` is present, and it is a descendant of the sticky footer
  element, **not** of `chat-thread-viewport`'s message column. Assert placement structurally (the card's
  closest `[data-testid="chat-thread-footer"]` ancestor exists) — add that `data-testid` on the
  `ThreadPrimitive.ViewportFooter` wrapper in Task 6.1 so the assertion is not class-name-coupled.
- `directoryMissing: true` → `chat-composer` has count 0.
- `directoryMissing: false, transcriptMissing: true` → card present in the footer **and** `chat-composer`
  present (D1).
- `directoryMissing: false, transcriptMissing: false` → card absent, composer present.
- The card's placement does not depend on scroll: it is rendered outside `ThreadPrimitive.Messages`.

### Task 5.2 — The card's new cause section and geometry

**File:** `packages/ui/src/features/chat/thread/__tests__/DegradedChatCard.test.tsx`

Add a `describe('DegradedChatCard — project directory missing')`:

- `directoryMissing: true`, `worktreePath: undefined`, `missingDirectoryPath: '/gone/proj'` → the card renders
  a "Project directory missing" section naming `/gone/proj`; `chat-degraded-delete` is offered;
  `chat-degraded-recreate-worktree`, `chat-degraded-project-root` and `chat-degraded-continue` are absent
  (nothing in scope can recover a vanished project root).
- `directoryMissing: true, worktreeMissing: true` **with** a `worktreePath` → the existing "Worktree deleted"
  section renders and the new project-directory section does **not** (the worktree is the missing directory,
  not the project root). The fixture must set `worktreeMissing: true` as well: that section is gated on
  `worktreeMissing` (`DegradedChatCard.tsx:66`) and Task 6.2 leaves the gate alone, so `directoryMissing`
  on its own renders neither section. This pairing is exactly what the daemon produces — Task 3.1 sets both
  flags true for a gone worktree.
- Geometry: the card root (`chat-degraded-card`) has `w-full` and does **not** carry `max-w-md`, `mx-auto`, or
  `my-8` — it is now sized by the footer's message column.
- Both rendered paths (worktree and project) sit in a `<code>` element carrying `break-all` (D2).

### Task 5.3 — The controller refuses every send path

**File (new):** `packages/ui/src/features/chat/controller/__tests__/chat-thread-controller-send-guard.test.ts`

Model it on `chat-thread-controller-send.test.ts` (same fake ws client + mocks) and on
`chat-event-router-error-toast.test.ts` for the `@/lib/toast` mock. With the controller's `chatConfig` carrying
`directoryMissing: true, missingDirectoryPath: '/gone/proj'`:

- `sendMessage(...)` sends nothing on the ws client, queues no optimistic pending message, and fires one
  `mfToast.error` whose description contains `/gone/proj`.
- `retryMessage(clientId)` likewise sends nothing and leaves the pending in its prior state.
- With `directoryMissing: false`, both still send exactly as today (regression guard).

**File:** `packages/ui/src/features/chat/controller/__tests__/chat-thread-state-config.test.ts`

- A `chat.updated` that flips only `directoryMissing` (or only `missingDirectoryPath`) produces a new
  `chatConfig` reference — i.e. `sameComposerConfig` must not treat the two chats as equal. Without this the
  footer never re-renders when the daemon reports recovery.

### Task 5.4 — The unavailable project row

**File:** `packages/ui/src/features/sessions/sidebar/__tests__/ProjectFilterPillBar.test.tsx`

- A project with `available: false` renders `sessions-filter-pill-unavailable-<id>` with the text
  "Unavailable"; a project with `available: true` and one with `available` undefined do not.
- The unavailable row's name element carries `text-muted-foreground` and carries neither `text-foreground` nor
  an `opacity-` class — including when the row has an unread badge and when it is the active row (muted wins,
  per the design direction).
- The unavailable row's select button (`sessions-filter-pill-<id>`) is still present and not disabled, and
  clicking it calls `onSelect` with the project id (nothing about liveness gates history).

**Verify (all of 5.1–5.4):** each file run alone FAILS for the asserted reason (not a mock/import error), and
the failure output is recorded. `pnpm --filter @qlan-ro/mainframe-ui typecheck` must still pass — the new
fields land in Group 1, so the specs typecheck against real types.

---

## Group 6 — `ui-thread-composer` (ui)

Read the `mainframe-design-system` skill before touching markup or class names.

### Task 6.1 — Move the card into the sticky footer and drop the composer when blocked

**File:** `packages/ui/src/features/chat/thread/ChatThread.tsx`

- Remove `<DegradedChatCard />` from the message column (line 99).
- Add `data-testid="chat-thread-footer"` to the `<div className="mx-auto w-full max-w-3xl px-5 pb-4">`
  wrapper inside `ThreadPrimitive.ViewportFooter` (line 121).
- Inside that wrapper the order becomes `BackgroundActivityBar` → `WorktreeSwitchBanner` → *(card or
  composer)*. Extract a small local component (keeping `ChatThread` under the 50-line function cap):
  ```tsx
  function ThreadFooterInput() {
    const directoryMissing = useChatExtras()?.state.chatConfig?.directoryMissing ?? false;
    return (
      <>
        <DegradedChatCard />
        {!directoryMissing && <Composer />}
      </>
    );
  }
  ```
  `DegradedChatCard` already returns `null` when nothing is degraded, so the healthy path is unchanged (D1).
- Update the file's header comment: it currently says the composer sits in a `ViewportFooter` so its height
  registers as scroll inset; note that the recovery card takes that slot when the working directory is gone,
  and that the swap is what keeps it visible at any scroll position.

### Task 6.2 — Give the card its footer geometry and the new cause

**File:** `packages/ui/src/features/chat/thread/DegradedChatCard.tsx`

- Root className: `mx-auto my-8 flex w-full max-w-md ...` → `flex w-full min-w-0 flex-col gap-4 rounded-lg
  border border-border bg-card px-5 py-5`. Keep the border/bg/padding/radius tokens exactly as they are; the
  width now comes from the footer's `max-w-3xl` column wrapper, never from the card's own cap.
- Widen `CauseSection`'s `body` prop from `string` to `ReactNode` so a path can be a `<code>` element. Add
  `min-w-0` to the section wrapper so `break-all` can take effect.
- Add a `MissingPath` helper in the same file rendering
  `<code className="font-mono text-label break-all">{path}</code>`, and use it for **both** the worktree path
  in the existing "Worktree deleted" body and the new section's path (D2).
- New cause section, rendered when `directoryMissing && chat.worktreePath == null`:
  - title: `Project directory missing`
  - body: names the project directory via `chat.missingDirectoryPath` and states that Mainframe kept the
    session and its history, and that sending is impossible until the directory is back. Copy is
    human-facing — apply the `writing-clearly-and-concisely` skill: plain, specific, no puffery, no
    exclamation.
  - Fall back to prose without a path when `missingDirectoryPath` is absent, exactly as the worktree section
    already does for `worktreePath`.
- Extend the early return: `if (!chat || (!worktreeMissing && !transcriptMissing && !directoryMissing)) return null;`
- Offer no new action. The only action for this cause is the existing `chat-degraded-delete`; relocate and
  remove-project are out of scope.
- Update the file header comment to say the card renders in the thread's sticky footer (it currently says
  "rendered in the thread area") and lists three causes.

Keep the file under 300 lines; if the cause sections push it over, extract them into a sibling
`DegradedChatCauses.tsx`.

### Task 6.3 — Remove the composer's dead worktree guard

**Files:** `packages/ui/src/features/chat/composer/Composer.tsx`,
`packages/ui/src/features/chat/composer/__tests__/Composer.test.tsx`,
`packages/ui/src/features/chat/composer/__tests__/composer-states.test.tsx`

- Drop the `worktreeMissing` read (line 74), the `SendOrCancelButton` prop and its `disabled` term, the
  `AttachmentDropzone` and `ComposerPrimitive.Input` `disabled` props, and the `worktreeMissing` term in
  `handleInputKeyDown` plus its dependency-array entry. The composer is no longer mounted when the directory
  is missing (D5); the refusal lives in the controller (Task 7.1).
- If `useChatExtras` becomes unused in `Composer.tsx`, drop the import.
- Update the `SendOrCancelButton` doc comment, which currently says "disabled while empty or
  worktree-missing".
- Delete the two now-meaningless describes in `Composer.test.tsx` —
  `Composer — worktreeMissing=true disables input/send (...)` (line 161) and the
  `does NOT call append() when isRunning=true but worktreeMissing=true` case (line 281) — and rename
  `Composer — worktreeMissing=false has no banner and enabled input` to drop the flag from its name. Keep the
  "no old banner" assertions by folding them into a single case that renders the composer with a plain chat
  config. Update the file header comment, which describes the fixture matrix in terms of `worktreeMissing`.
- In both test files, strip `worktreeMissing` from the `__extrasReturn` fixture type and its assignments.
  Nothing should reference the flag in the composer tree afterwards
  (`grep -rn worktreeMissing packages/ui/src/features/chat/composer` returns nothing).

**Verify:**
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/thread/__tests__/ChatThread-degraded-placement.test.tsx`,
then the same for `DegradedChatCard.test.tsx`, `ChatThread.test.tsx`, `ChatThread-compacting.test.tsx`,
`Composer.test.tsx`, `composer-states.test.tsx` — all green.
`pnpm --filter @qlan-ro/mainframe-ui typecheck`.

---

## Group 7 — `ui-controller-guard` (ui)

### Task 7.1 — Refuse the send in the controller

**File:** `packages/ui/src/features/chat/controller/chat-thread-controller.ts`

- Add a private guard used by both `sendMessage` (line 257) and `retryMessage`:
  ```ts
  private refuseIfDirectoryMissing(): boolean {
    const chat = this.state.chatConfig;
    if (chat?.directoryMissing !== true) return false;
    mfToast.error('Can’t send — the working directory is missing', {
      description: chat.missingDirectoryPath ?? 'The directory this session runs in no longer exists.',
    });
    return true;
  }
  ```
  Both methods return early when it returns `true`, before any optimistic pending is queued and before any
  upload. Copy goes through the `writing-clearly-and-concisely` skill.
- Import `mfToast` from `@/lib/toast` (`chat-event-router.ts` in the same directory already does; use the
  same import path). Do **not** use `sonner` directly.
- Size gate: **add no new violation**. `chat-thread-controller.ts` is already 376 lines — over the 300-line
  cap before this change. Keep `refuseIfDirectoryMissing` and both call sites under 50 lines each and do not
  grow the file beyond what the guard needs; refactoring the pre-existing overage is out of scope for this
  todo.

### Task 7.2 — Let the new signals through the config-equality gate

**File:** `packages/ui/src/features/chat/controller/chat-thread-state.ts`

Add `a.directoryMissing === b.directoryMissing && a.missingDirectoryPath === b.missingDirectoryPath` to
`sameComposerConfig` (line ~201). Without this a `chat.updated` that only reports recovery is dropped and the
composer never comes back.

**Verify:**
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/chat/controller/__tests__/chat-thread-controller-send-guard.test.ts`,
then `chat-thread-controller-send.test.ts`, `chat-thread-controller-retry.test.ts`,
`chat-thread-state-config.test.ts` — all green. `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

---

## Group 8 — `ui-project-switcher` (ui)

Read the `mainframe-design-system` skill first.

### Task 8.1 — Extract the shared chip recipe

**Files (new):** `packages/ui/src/components/ui/chip.ts` — `export const CHIP_BASE = '...'` with the string
moved verbatim from `packages/ui/src/layout/MainToolbar.tsx` line 36, plus a one-line comment naming it the
shared chip recipe.
**File:** `packages/ui/src/layout/MainToolbar.tsx` — delete the local const, import from
`@/components/ui/chip`. No visual change; the class string is byte-identical (D6).

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/layout/__tests__` (whichever MainToolbar
specs exist) plus `typecheck`.

### Task 8.2 — Mark an unavailable project row

**File:** `packages/ui/src/features/sessions/sidebar/ProjectPillContextMenu.tsx`

- In `ProjectRowBody`, read `const unavailable = project.available === false;` (strictly `=== false` — an
  absent `available` means "not derived", not "gone").
- Name ink: when `unavailable`, force `text-muted-foreground font-medium`, overriding both the unread
  (`text-foreground font-bold`) and active (`text-primary`) branches. Change the ink token; do **not** apply
  an `opacity-*` to it (design direction).
- Between the name span and the `CountBadge`, render when `unavailable`:
  ```tsx
  <span
    data-testid={`sessions-filter-pill-unavailable-${project.id}`}
    className={cn(CHIP_BASE, 'h-[16px] max-w-none flex-shrink-0 px-[4px] font-sans text-caption text-muted-foreground')}
  >
    Unavailable
  </span>
  ```
  `CHIP_BASE` from `@/components/ui/chip`; the overrides drop the toolbar-specific `max-w-[230px]`,
  `font-mono` and 22px height so the chip fits the 28px sidebar row (D6). `cn` from `@/lib/utils`.
- The row stays clickable and the remove affordances stay exactly as they are — an unavailable project is
  selectable and its sessions still open (brief decision: only new sends are gated).
- Update the file header comment to mention the unavailable state.

**File:** `packages/ui/src/features/sessions/sidebar/ProjectFilterPillBar.tsx` — no logic change needed
(`project` is already passed whole); update the header comment only if the row contract changed. Do not
reorder, hide, or auto-collapse unavailable projects.

**Verify:**
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/sidebar/__tests__/ProjectFilterPillBar.test.tsx`
— green. `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

---

## Group 9 — `e2e-and-changeset` (test)

### Task 9.1 — Update the e2e degraded-chat expectations

**File:** `packages/e2e/tests-tauri/composer.spec.ts`

The test `shows the degraded-chat card with recovery actions and locks the input + send button` (line 435)
asserts `chat-composer-input` and `chat-composer-send` are *disabled*. With the composer gone, those locators
resolve to nothing and `toBeDisabled()` fails.

- Rename the test to reflect the new behavior (the card replaces the composer).
- Replace the two `toBeDisabled()` assertions with `await expect(page.getByTestId('chat-composer')).toHaveCount(0)`.
- Keep the card/section/action assertions and the `chat-composer-worktree-missing` count-0 assertion as they
  are.
- Add one assertion that the card is inside `chat-thread-footer` (the testid added in Task 6.1), which is the
  point of the move.
- Update the stale comment at line 422 — it cites `packages/core/src/workspace/worktree.ts`, the orphaned TS
  daemon; the live check is `is_worktree_present` in
  `packages/core-rs/crates/mainframe-services/src/workspace/worktree.rs`, now joined by the generalized
  directory check in `enrich_chat`.

**Verify:** `pnpm test:e2e --grep "degraded"` (or the suite's equivalent filter) passes. If the Tauri e2e
environment cannot come up in this worktree, record that and leave the edit in place — the assertions are
mechanical and the file must not be left asserting removed behavior.

### Task 9.2 — Changeset

Run `pnpm changeset`: patch bumps for `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui` (and
`@qlan-ro/mainframe-core` if the release pipeline requires it for a daemon change — follow the repo's existing
changeset entries for Rust-daemon work). Summary in one or two sentences: a project whose directory is gone is
now marked unavailable, its sessions refuse to send with the real reason, and the recovery card sits above the
composer instead of at the top of the transcript.

**Verify:** a new file exists under `.changeset/`.

---

## Final verification (before handing the branch to review)

1. `cd packages/core-rs && cargo test --workspace` — green.
2. `cd packages/core-rs && cargo clippy --workspace -- -D warnings` and `cargo fmt --check`.
3. `pnpm --filter @qlan-ro/mainframe-types build`.
4. `pnpm --filter @qlan-ro/mainframe-ui typecheck` (it includes test files).
5. Each touched vitest file run individually — never one large batch.
6. `grep -rn "Internal error" packages/core-rs/crates/mainframe-server/src/websocket.rs` returns nothing.
7. `grep -rn "worktreeMissing" packages/ui/src/features/chat/composer` returns nothing.
8. No new size violation. Every file this plan *creates* is under 300 lines and every function it *adds*
   is under 50. Several touched files are already over the caps and stay out of scope:
   `chat-thread-controller.ts` (376 lines), `ChatThread()` (58 lines — the `ThreadFooterInput` extraction in
   Task 6.1 is line-neutral), and every touched Rust file (429–2158 lines). Do not refactor them here; do
   not let a touched file that is currently under a cap cross it (`DegradedChatCard.tsx` is the one at risk —
   Task 6.2 already names `DegradedChatCauses.tsx` as its escape hatch).
9. A changeset exists.

## Manual QA (the design direction's verify list)

With a project registered at a path that is then deleted:

- The switcher row is muted with an "Unavailable" chip, is still clickable, and its sessions list and open
  with readable history.
- Opening one of its sessions shows the recovery card in the sticky footer with the composer gone; the card
  stays visible when the transcript is scrolled to the top of a long session.
- A long project path wraps inside the card instead of blowing out the footer; check at a narrow chat column,
  in light and dark, and at UI scale 0.92.
- Recreating the directory and letting the daemon broadcast `chat.updated` unmounts the card and brings the
  composer back in the same slot.
- A send attempted through a non-composer path (mid-run Enter, retry on a failed message) raises a toast
  naming the missing path and sends nothing.
- No project and no chat is removed, archived, or altered by any of the above.
