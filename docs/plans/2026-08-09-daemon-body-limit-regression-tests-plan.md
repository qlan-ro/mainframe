# Daemon body-limit regression tests — implementation plan (todo #299)

**Branch:** `todo/299-body-limit-tests`
**Route:** no-spec (planned directly from the approved Agent Brief)
**Date:** 2026-08-09

## Goal

The daemon's 30 MB request-body ceiling works only because `DefaultBodyLimit::disable()` sits above
`RequestBodyLimitLayer::new(BODY_LIMIT_BYTES)` in `build_app`. That ordering shipped without a test:
today, re-introducing axum's 2 MB per-extractor default, deleting the explicit limit layer, or swapping
the two layers all leave `cargo test` green. This plan adds one dedicated integration-test file that
drives the *assembled* router over a real loopback socket and pins both edges — a ~3 MB body (inside the
old 2–5 MB dead zone) must reach the attachments handler and get the route's success envelope, and a body
over `BODY_LIMIT_BYTES` must still be rejected with a bare `413`. It also makes `BODY_LIMIT_BYTES` public
so the tests track the constant instead of hardcoding 30 MB, and it verifies by sabotage that each test
actually fails when its half of the layer pair is broken.

## Prominent decisions (made unilaterally — flag to the user if wrong)

1. **`docs/plans/` is gitignored** (`.gitignore:53`). The lane's exit criteria require the plan committed
   under `docs/plans/`, so this file is committed with `git add -f` for this one path. The ignore rule is
   left alone — removing it would sweep in six other untracked plan files.
2. **`BODY_LIMIT_BYTES` changes from private to `pub`** (plus a `lib.rs` re-export). The brief says the
   constant is "unchanged by this work"; that means its *value and behavior*, and acceptance criterion 3
   ("tests reference the limit constant rather than hardcoding 30 MB") is unsatisfiable without exposing
   it. This is a visibility-only edit.
3. **The over-limit request transmits its whole body**, even though `tower-http` rejects on the
   `Content-Length` header alone (verified in `tower-http-0.6.11/src/limit/service.rs` — an over-limit
   `Content-Length` short-circuits to `payload_too_large()` without reading). A headers-only variant would
   be cheaper but breaks the sabotage check: with the limit layer removed, a server with no ceiling *waits
   for the body*, so a headers-only test would hang to timeout instead of failing crisply. Transmitting
   the body makes the sabotaged server read it and answer with the route's own 400 envelope, which fails
   the `413` assertion cleanly. Cost is one transient ~31 MB allocation in the test process.
4. **These tests are green from birth.** They cover behavior that already shipped (PR #549), so there is
   no red phase. Group C's sabotage pass is the substitute for red. If either test fails on its first
   run, that is a regression on `main`, not expected TDD red — stop and report rather than "fixing" the
   test.

## Constraints from CLAUDE.md

- Max 300 lines/file, 50 lines/function. The new test file lands well under both.
- No `@ts-ignore` equivalents; no silent catches. The one deliberate exception is the raw-TCP writer task,
  which ignores write errors *by design* (the server closes the connection early) — it carries a one-line
  `why` comment.
- Tests required for new logic; do not lower coverage thresholds. This change is test-only plus a
  visibility tweak.
- A changeset is mandatory on every PR. This one is `pnpm changeset --empty` (test-only, nothing
  user-visible to log).
- Rust formatting is a CI gate; run `cargo fmt` and `cargo clippy` before finishing any group.

## Code map (verified, not assumed)

All paths relative to the worktree root
`/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-299-body-limit-tests`.

| Path | Role |
|---|---|
| `packages/core-rs/crates/mainframe-server/src/http.rs` | `BODY_LIMIT_BYTES` (line 30, currently private), `build_app`, the `DefaultBodyLimit::disable()` / `RequestBodyLimitLayer` pair (lines 113–114) |
| `packages/core-rs/crates/mainframe-server/src/lib.rs` | `pub use http::build_app;` (line 33) — the re-export site |
| `packages/core-rs/crates/mainframe-server/src/routes/attachments.rs` | Target route. `MAX_ATTACHMENT_SIZE_BYTES = 5 MB` (line 28); `validate` computes `data.len() * 3 / 4` (line 58); handler extracts `body: Bytes` — the extractor that the 2 MB default used to cap |
| `packages/core-rs/crates/mainframe-server/src/respond.rs` | `ok(data)` → `{"success":true,"data":…}`; `fail(status, msg)` → `{"success":false,"error":…}` |
| `packages/core-rs/crates/mainframe-server/tests/support/mod.rs` | 397 lines. `spawn_test_server`, `TestServer { addr, ctx }`, `http_url(path)`, and hand-rolled raw-TCP WS client (the precedent for raw sockets in this harness) |
| `packages/core-rs/crates/mainframe-server/tests/http_compression.rs` | The layer-contract precedent: proves a router-level layer through a real spawned app |
| `packages/core-rs/crates/mainframe-server/tests/routes_attachments.rs` | Holds `returns_400_when_base64_payload_exceeds_5mb` (the 8 MB test, line 95) and `saves_a_valid_attachment_and_returns_metadata` (line 111) — **both stay untouched** |
| `packages/core-rs/crates/mainframe-server/tests/http_body_limit.rs` | **New file** |

Sizing arithmetic, from `validate`: a `data` string of `3 * 1024 * 1024` base64 chars (a multiple of 4, so
no mid-string padding) yields `computed = 2_359_296` bytes = 2.25 MB, under the route's 5 MB per-item cap.
The serialized request body is that string plus ~110 bytes of JSON scaffolding — comfortably above the old
2 MiB (`2_097_152`) default and far below 30 MB.

## Explicit non-tasks

- Do not modify, rename, shrink, or delete `returns_400_when_base64_payload_exceeds_5mb`. It covers the
  route's own 5 MB rule and is not a substitute for the new accept-path test.
- Do not change `BODY_LIMIT_BYTES`'s value, the layer stack, or any route's size rules.
- Do not add a fixture file. All payloads are generated in-process from a repeated character run.

---

## Group A — `core-expose-limit-constant`

**Kind:** core. Run first: Group B imports the constant and will not compile without it.

### Task A1 — make `BODY_LIMIT_BYTES` public and re-export it

**File:** `packages/core-rs/crates/mainframe-server/src/http.rs`

Change line 30 from `const BODY_LIMIT_BYTES: usize = 30 * 1024 * 1024;` to
`pub const BODY_LIMIT_BYTES: usize = 30 * 1024 * 1024;`. Extend the existing doc comment with one
sentence naming why it is public: integration tests assert both edges of the limit against this value.
Do not change the value, the layer order, or the `disable()` comment above it.

**File:** `packages/core-rs/crates/mainframe-server/src/lib.rs`

Change line 33 from `pub use http::build_app;` to `pub use http::{BODY_LIMIT_BYTES, build_app};`.

**Verify:**
1. From `packages/core-rs`: `cargo check -p mainframe-server` succeeds.
2. From `packages/core-rs`: `cargo clippy -p mainframe-server --all-targets -- -D warnings` succeeds
   (a newly-public item can trip `missing_docs`-style lints; the doc comment already exists).
3. From `packages/core-rs`: `cargo fmt --check` is clean.
4. `git diff --stat` shows exactly two files and no more than four changed lines.

---

## Group B — `body-limit-integration-tests`

**Kind:** test. Depends on Group A (compile-time import of `BODY_LIMIT_BYTES`).

### Task B1 — add a raw-TCP over-limit request helper to the shared harness

**File:** `packages/core-rs/crates/mainframe-server/tests/support/mod.rs`

Add one public async helper, e.g.

```rust
pub struct RawResponse { pub status: u16, pub headers: Vec<(String, String)>, pub body: Vec<u8> }

pub async fn post_raw(addr: SocketAddr, path: &str, body: Vec<u8>) -> RawResponse
```

`reqwest` cannot be used for this case: the server answers `413` and closes without draining the request,
so a `reqwest` send races between returning the response and failing mid-write with `EPIPE` — an
either-or outcome that acceptance criterion 6 forbids. Raw TCP already has precedent here (the WS client
in this same module). Requirements, all load-bearing:

- Connect a `TcpStream` to `addr`, then `tokio::io::split` it.
- Write `POST {path} HTTP/1.1`, `Host: {addr}`, `Content-Type: application/json`,
  `Content-Length: {body.len()}`, `Connection: close`, blank line, then the body.
- Run the writer in a spawned task that writes the body in chunks (e.g. 64 KiB) and **ignores every write
  error**. The server closing early is the expected behavior, not a failure. One `why` comment; no
  `unwrap` on writes.
- Read concurrently on the calling task: parse the status line and headers, then read exactly
  `Content-Length` body bytes (0 for the `413`). **Never read to EOF** — after the server's early close
  the socket delivers an RST, and a read past the buffered response returns `ECONNRESET`. Parsing and
  stopping at the declared length is what makes the assertion deterministic. Treat a missing
  `Content-Length` on the response as an empty body.
- Wrap the whole read in `tokio::time::timeout(Duration::from_secs(10), …)` and `expect` a clear message
  on elapse ("no response before the body finished sending" — the signature of a removed limit layer).
- Keep the helper under 50 lines; split header parsing into a small private fn if needed. The file must
  stay within the 300-line limit — if it would exceed it, put the helper in a sibling
  `tests/support/raw_http.rs` and `pub mod raw_http;` from `mod.rs` instead, and say so in the PR.

**Verify:** `cargo check -p mainframe-server --tests` from `packages/core-rs` succeeds; `cargo fmt --check`
clean. (The helper has no test of its own yet — B3 exercises it.)

### Task B2 — accept-path test: a dead-zone body reaches the handler

**File:** `packages/core-rs/crates/mainframe-server/tests/http_body_limit.rs` (new)

Module doc comment: this file pins the *ordering* of `DefaultBodyLimit::disable()` above
`RequestBodyLimitLayer` in `build_app`; it asserts against the assembled router so a limit relocated into
a different layer is still covered; it is green from birth and its red evidence is the sabotage pass
recorded in the PR description.

Test `a_three_megabyte_body_reaches_the_attachments_handler`:

- `const DEFAULT_EXTRACTOR_LIMIT_BYTES: usize = 2 * 1024 * 1024;` — a named local for axum's old default,
  with a one-line comment saying this is the ceiling that used to shadow the explicit layer.
- Build `data = "A".repeat(3 * 1024 * 1024)` and the body
  `{"attachments":[{"name":"dead-zone.bin","mediaType":"application/octet-stream","data":data}]}`.
  Serialize it once with `serde_json::to_vec` so the test can measure the real wire size.
- Static guards, asserted before the request so a future constant change fails loudly instead of silently
  mis-testing:
  - `assert!(body.len() > DEFAULT_EXTRACTOR_LIMIT_BYTES)` — the request is inside the old dead zone.
  - `assert!(body.len() < mainframe_server::BODY_LIMIT_BYTES)` — this is how the accept test *references
    the constant*; if `BODY_LIMIT_BYTES` ever drops below 3 MB the test fails rather than drifting.
  - `assert!(3 * 1024 * 1024 * 3 / 4 < 5 * 1024 * 1024)` (or an equivalent named `DECODED_BYTES` local) —
    the payload clears the route's own 5 MB per-item rule, so a 400 here means the limit layer, not the
    route.
- POST it to `/api/chats/c1/attachments` on `spawn_test_server(None)` via `reqwest` with `.body(bytes)` +
  `Content-Type: application/json` (`.json()` would re-serialize a second 3 MB copy).
- Capture status and raw bytes *before* parsing. Assert `status == 200` with a message naming the likely
  cause on failure ("413 here means the default extractor limit is back"). Then parse and assert
  `success == true`, `data.attachments[0].name == "dead-zone.bin"`,
  `data.attachments[0].mediaType == "application/octet-stream"`, `data.attachments[0].sizeBytes ==
  2_359_296`, and that `data.attachments[0].id` is a non-empty string — mirroring
  `saves_a_valid_attachment_and_returns_metadata`. A bare `413` with an empty body fails both the status
  assertion and the parse.

**Verify:** `cargo test -p mainframe-server --test http_body_limit
a_three_megabyte_body_reaches_the_attachments_handler` passes from `packages/core-rs`.

### Task B3 — reject-path test: over `BODY_LIMIT_BYTES` is still `413`

**File:** `packages/core-rs/crates/mainframe-server/tests/http_body_limit.rs`

Test `a_body_over_the_configured_limit_is_rejected_with_413`:

- Size the payload from the constant, never from a literal: build a `data` string long enough that the
  serialized body exceeds `BODY_LIMIT_BYTES + 1024 * 1024`. Compute the padding from
  `mainframe_server::BODY_LIMIT_BYTES` so a change to the constant moves the test with it.
- Keep the same valid attachments JSON shape. If the limit layer is later removed (Group C's second
  sabotage), a shape-valid body makes the server answer with the route's own 400 "Attachment exceeds 5MB
  limit" envelope — a legible failure — instead of a malformed-body 400.
- Assert `body.len() > mainframe_server::BODY_LIMIT_BYTES` before sending.
- Send with `support::post_raw(server.addr, "/api/chats/c1/attachments", body)`.
- Assert `status == 413`; assert the response body is empty (`resp.body.is_empty()`), i.e. no envelope —
  and specifically that it does not parse into JSON carrying a `success` key. Add a comment: the daemon's
  envelope helpers never emit a `413`, so an envelope here would mean the rejection came from a route
  rather than the layer.

**Verify:**
1. `cargo test -p mainframe-server --test http_body_limit` — both tests pass.
2. Run the file three times in a row; all three runs pass (determinism check for the raw-TCP path).
3. `cargo test -p mainframe-server --test routes_attachments` — unchanged and green, including
   `returns_400_when_base64_payload_exceeds_5mb`.
4. `cargo fmt --check` clean; `cargo clippy -p mainframe-server --all-targets -- -D warnings` clean.
5. `wc -l` on both touched test files: each under 300.

---

## Group C — `mutation-verification-and-changeset`

**Kind:** test. Depends on Groups A and B — it sabotages A's file and measures B's tests.
Not parallel-safe: its temporary edits touch `src/http.rs`, the same file Group A owns.

### Task C1 — sabotage check 1: re-introduce the default extractor limit

**File (temporarily):** `packages/core-rs/crates/mainframe-server/src/http.rs`

Delete the `.layer(DefaultBodyLimit::disable())` line. Run
`cargo test -p mainframe-server --test http_body_limit`. Record the exact failing test name and the
observed status. **Expected:** `a_three_megabyte_body_reaches_the_attachments_handler` fails on a `413`;
`a_body_over_the_configured_limit_is_rejected_with_413` still passes.

Restore the line with `git checkout -- crates/mainframe-server/src/http.rs` (or `git restore`) and confirm
`git status` is clean for `src/` before moving on. If the accept test does *not* fail, the test is not
pinning the disable — stop and report; do not proceed to C3.

**Verify:** `git diff -- crates/mainframe-server/src/http.rs` is empty afterwards; both tests pass again.

### Task C2 — sabotage check 2: remove the explicit limit layer

**File (temporarily):** `packages/core-rs/crates/mainframe-server/src/http.rs`

Delete the `.layer(RequestBodyLimitLayer::new(BODY_LIMIT_BYTES))` line (silence the resulting unused-import
warning however is quickest — this edit is thrown away). Run the same command. Record the failing test and
the observed status. **Expected:**
`a_body_over_the_configured_limit_is_rejected_with_413` fails because the request now reaches the handler
and comes back `400` with the route's `success:false` envelope — *not* a hang. A timeout here means the
helper is reading to EOF or the body is not being transmitted; fix B1 rather than accepting the timeout as
evidence.

Restore the file and re-run both tests green.

**Verify:** `git diff -- crates/mainframe-server/src/http.rs` empty; `cargo test -p mainframe-server --test
http_body_limit` passes.

### Task C3 — changeset and PR description

**Files:** a new `.changeset/*.md` (generated), plus the PR body.

Run `pnpm changeset --empty` from the repo root — this PR is test-only plus a visibility change, with
nothing user-visible to log.

Write the PR description to include, verbatim, the two recordings from C1 and C2: which layer was removed,
which test failed, and with what status. Acceptance criterion 4 requires both checks on the record. Also
state that `returns_400_when_base64_payload_exceeds_5mb` is untouched and still passing.

**Verify:**
1. `.changeset/` contains a new empty changeset file; `git status` shows it.
2. From `packages/core-rs`: `cargo test -p mainframe-server` — the whole crate is green.
3. `cargo fmt --check` and `cargo clippy -p mainframe-server --all-targets -- -D warnings` clean.
4. `git status` shows no leftover sabotage edits anywhere under `src/`.

---

## Risks

- **Raw-TCP flakiness under CI load.** Mitigated by reading exactly `Content-Length` bytes with a 10 s
  timeout and by the three-consecutive-runs check in B3. If it still flaps, the fallback is to keep the
  concurrent writer but assert on the status line alone.
- **The ~31 MB allocation** in the reject test is transient and loopback-local. If CI memory ever becomes
  a constraint, the body can be streamed from a repeated chunk rather than materialized — but do not trade
  away full transmission (see decision 3).
- **`docs/plans/` being gitignored** means a future `git add -A` will not pick this plan up. It is
  force-added once and then tracked normally.
