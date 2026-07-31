# Todo #294 — Compress big payloads on the API (implementation plan)

Branch: `todo/294-compress-api-payloads`
Worktree: `/Users/doruchiulan/Projects/qlan/mainframe/.worktrees/todo-294-compress-api-payloads`
Route: no-spec (planned directly from the approved Agent Brief)

## Goal

Add negotiated response compression to the Rust daemon's HTTP API so the largest
responses it serves — chat history, git diffs, file contents, search results —
cross the wire compressed when a client asks for it. Today the axum app applies
only a 30 MB request-body limit and a hand-rolled CORS middleware, so every
response is raw JSON regardless of the caller's `Accept-Encoding`. The change is
one `tower-http` `CompressionLayer` scoped to the HTTP router (never the two
WebSocket upgrade routes), negotiating gzip and brotli by the client's stated
preference, passing responses below a size floor through untouched, and never
double-encoding a response that already carries `Content-Encoding`. Response
envelopes, status codes, and error bodies are byte-identical after decoding;
this is a transport-layer change only.

## What was verified in the code before planning

Every claim below was read, not assumed.

- **App assembly** — `packages/core-rs/crates/mainframe-server/src/http.rs`
  (172 lines). `build_app` builds an inner `http` router (health + ~30 merged
  route modules + the `/api/plugins` `nest_service`), applies
  `.fallback(not_found)` then the auth middleware, merges it into an outer
  router that adds `any(ws_handler)` at `/` and `any(lsp_ws_handler)` at
  `/lsp/{project_id}/{language}`, then layers `RequestBodyLimitLayer(30mb)` and
  finally `from_fn(cors_middleware)` as the outermost layer.
- **CORS** — a hand-rolled `from_fn` middleware (not `CorsLayer`), chosen for
  byte-exact parity with the TS `http.ts`. It answers `OPTIONS` with a bare 204
  and otherwise runs the inner stack and then inserts
  `access-control-allow-origin` / `-methods` / `-headers` and
  `x-content-type-options: nosniff` onto the finished response. It only inserts
  headers, so it composes with a compressed body without change.
- **Dependency** — `packages/core-rs/Cargo.toml` line 14:
  `tower-http = { version = "0.6", features = ["cors", "limit"] }`, resolved to
  0.6.11 in `packages/core-rs/Cargo.lock`. `crates/mainframe-server/Cargo.toml`
  takes it with `{ workspace = true }`.
- **tower-http 0.6.11 compression semantics** (read from
  `~/.cargo/registry/src/*/tower-http-0.6.11/src/compression/`):
  - `future.rs` never compresses a response that already has `content-encoding`
    or `content-range`; when it does compress it appends
    `vary: accept-encoding`, removes `content-length` and `accept-ranges`, and
    inserts `content-encoding`.
  - `predicate.rs` — `SizeAbove` reads `Body::size_hint().exact()` first, then
    the `content-length` header, and compresses when the size is unknown.
    `DefaultPredicate` is `SizeAbove(32) AND NotForContentType::GRPC AND
    ::IMAGES AND ::SSE` and is deliberately not configurable, so a custom floor
    means composing the predicate by hand out of the same public parts (`And`,
    `SizeAbove`, `NotForContentType` are all `pub`).
  - There is **no status-code check**. A 101 upgrade response has an empty body
    (`size_hint().exact() == Some(0)`), so it would fall below any floor and
    pass through — but the brief mandates keeping the layer off the WS routes,
    and that is also the design here.
  - `layer.rs` gates `.gzip()` behind `compression-gzip` and `.br()` behind
    `compression-br`; `.deflate()` / `.zstd()` do not exist unless their
    features are on, so the layer offers exactly the encodings compiled in.
  - `compression_utils.rs` — `CompressionLevel::Precise(i32)`, "implicitly
    clamped to the algorithm's maximum", is the only per-quality knob and it is
    global across encodings.
- **Chat history route** — `GET /api/chats/{id}/messages` in
  `crates/mainframe-server/src/routes/chats.rs:143`. It self-gates on
  `ctx.chat_manager`, which the integration harness leaves `None`
  (`crates/mainframe-server/tests/support/mod.rs:90`), so in tests it returns
  the small failure envelope. See "Decision D4".
- **A route that produces a large real payload through the production router** —
  `GET /api/projects/{id}/files?path=…` in
  `crates/mainframe-server/src/routes/files.rs:318` reads the file and returns
  `{ "path": …, "content": … }` inside the standard envelope, up to a 2 MB file
  cap for the non-base64 path. `tests/routes_files.rs` already builds a real
  project over a tempdir.
- **Attachments** — `crates/mainframe-server/src/routes/attachments.rs`.
  `GET /api/chats/{chatId}/attachments/{attachmentId}` returns the stored
  attachment inside the JSON envelope (base64 data in a `data` field), i.e.
  `application/json`, **not** a raw image body, and nothing in the daemon sets
  `content-encoding` on any response. Double-encoding is therefore structurally
  impossible; the acceptance criterion is covered by an assertion, not a code
  change.
- **Nothing streams** — a repo-wide grep for `Body::from_stream`,
  `text/event-stream`, and `Sse` in `crates/mainframe-server/src/` returns
  nothing. The only non-JSON content type the daemon emits is
  `text/plain; charset=utf-8` from the background-task spool tail
  (`routes/background_tasks.rs:121`), which is a bounded `read_tail` string and
  is safe (and beneficial) to compress.
- **Non-browser HTTP clients of the daemon** — the only one is
  `packages/app-tauri/src-tauri/src/presence.rs:66`, a `ureq` agent declared as
  `ureq = { version = "2", default-features = false, features = ["json"] }`.
  Without the `gzip` feature ureq advertises no `Accept-Encoding`, so it keeps
  receiving identity bytes. Everything else is a `fetch`-family client.
- **E2E** — 16 `page.route()` handlers exist in `packages/e2e`. Thirteen either
  `fulfill` a synthetic body or `abort`. Three call `route.continue()`:
  `tests-tauri/sessions.spec.ts:574` (fulfills a synthetic 500 on the first GET,
  then continues), `tests-tauri/settings.spec.ts:228` (delays and aborts the
  `PUT`, continues everything else), and
  `tests-tauri/directory-picker.spec.ts:263` (delays, then continues). A
  continued request's response goes straight to the browser; none of the three
  handlers reads a response body, so no spec observes `Content-Encoding` or a
  decoded payload.
- **CI gate** — `.github/workflows/rust-port.yml` runs `cargo fmt --check`,
  `cargo clippy --all-targets -- -D warnings`, `cargo test`, and
  `tools/verify-gate.sh` for any change under `packages/core-rs/**`. The verify
  gate greps `crates/` only (never dependencies) and forbids `unsafe`, `todo!(`,
  `unimplemented!(`, `static mut`, `lazy_static`, `std::thread::spawn`,
  `anyhow`, and — outside `#[cfg(test)]` — `panic!(`, `.unwrap(`, `.expect(`.
- **Dependency allowlist** — `docs/rust-port/PORTING.md` §8 is the written
  authority for daemon crates and currently records
  `` `axum` (0.8, `ws`) + `tower-http` (`cors`, `limit`) ``. Adding features or
  dev-dependencies without updating that row leaves the doc stale.

## Constraints

- Max 300 lines per file, 50 per function (global CLAUDE.md + repo Code Rules).
  `http.rs` is at 172 lines; the layer's construction goes in its own module to
  keep `http.rs` about app assembly.
- No `unwrap`/`expect`/`panic!` outside `#[cfg(test)]`; test files keep the
  existing `#![allow(clippy::unwrap_used, clippy::expect_used)]` header. Modules
  that define helpers ahead of their callers also need `dead_code` in that allow
  list — `tests/support/mod.rs:5` carries it for exactly this reason.
- `cargo clippy --all-targets -- -D warnings` must stay clean.
- Every new daemon behavior gets a test (repo Code Rules); the brief requires
  the tests run against the router as assembled by `build_app`, not a bespoke
  test router — the existing `tests/support/mod.rs` harness already does this.
- A changeset is required before commit. Repo convention for Rust-daemon
  behavior changes is `'@qlan-ro/mainframe-core': patch` (see
  `.changeset/codex-quota-boot-warmup.md`,
  `.changeset/codex-history-unknown-item-types.md`).
- No leftovers: `docs/rust-port/PORTING.md` §8 and the `// PORT STATUS:` block
  at the foot of `http.rs` both describe the middleware stack and must be
  updated in this pass.
- Do not touch `packages/mobile` (git submodule) and do not change the payload
  shape of any route.

## Decisions

Recorded so implementers do not re-litigate them.

- **D1 — Encodings and preference.** Enable `compression-gzip` and
  `compression-br` only. Deflate and zstd stay off: their `.deflate()`/`.zstd()`
  builders do not even compile without their features, so leaving them off is
  self-enforcing. tower-http's `Encoding::from_headers` already honors client
  q-values, so "negotiated by the client's preference" needs no code.
- **D2 — Size floor of 1024 bytes.** `DefaultPredicate`'s 32-byte floor would
  compress `/health` (~130 bytes) and most small config/state endpoints, which
  the brief explicitly rules out. 1024 clears every small envelope the daemon
  serves while catching every payload worth compressing. `SizeAbove::new` takes
  a `u16`, so 1024 is representable.
- **D3 — `CompressionLevel::Precise(4)`, not `Default`.** tower-http's quality
  is global across encodings and `Level::Default` maps to each codec's own
  default — for brotli that is quality 11, which is an order of magnitude slower
  than gzip and would put a visible stall on the response path for a multi-
  hundred-KB history payload. Quality 4 is a fast brotli setting with roughly
  gzip-6 output size, and is a reasonable gzip level too. `Precise` is clamped
  to each algorithm's range by async-compression, so one value is safe for both.
- **D4 — How the chat-history acceptance criterion is tested.** The brief's
  first acceptance criterion names `GET /api/chats/{id}/messages`. That route
  self-gates on `ctx.chat_manager`, which the HTTP integration harness leaves
  `None`; producing a large real history payload would mean wiring a full
  `ChatManager` plus a mock adapter session with a seeded transcript into the
  harness — a large, unrelated test-infrastructure change for a layer that is
  content- and route-agnostic. **Resolution:** the negotiation, byte-identity,
  and threshold criteria are proven against the production `build_app` router
  using `GET /api/projects/{id}/files?path=big.txt`, which returns an
  arbitrarily large *real* payload through the same layer; and
  `/api/chats/{id}/messages` gets its own dedicated assertion that the route's
  response is byte-identical with and without `Accept-Encoding`. This is called
  out in the plan, in the test module's doc comment, and in the final report so
  the lane can override it if it disagrees.
- **D5 — Layer placement.** The layer is applied to the inner `http` router
  (outside the auth middleware, inside CORS and the body limit), so it never
  sees the two WS upgrade routes on the outer router. This satisfies the brief's
  "positioned so it does not wrap the WebSocket upgrade routes" literally rather
  than relying on tower-http's empty-body behavior for 101 responses.
- **D6 — Test decoders.** Dev-dependencies `flate2` and `brotli`, decoding by
  hand. Enabling reqwest's `gzip`/`brotli` features instead would be worse on
  both counts: reqwest strips `Content-Encoding` and `Content-Length` from the
  response after auto-decoding (making the header assertions impossible), and
  the feature would unify into the production build graph. Keeping reqwest
  feature-free also makes the "no `Accept-Encoding` → identity" case trivially
  expressible, because reqwest then sends no such header at all. Both crates
  are already pulled into the graph by `async-compression`'s gzip and brotli
  backends, so as dev-dependencies they cost no additional compilation provided
  the versions match.
- **D7 — Dependency ownership.** All manifest and lockfile edits
  (`packages/core-rs/Cargo.toml`, `Cargo.lock`,
  `crates/mainframe-server/Cargo.toml`) plus the `PORTING.md` §8 allowlist row
  belong to the test group, so the implementation group and the test group share
  no files. Turning the `tower-http` features on without wiring the layer
  changes no behavior, so the red-phase tests still fail for the right reason.

## Out of scope (from the brief)

- Paginating, windowing, or truncating chat history.
- WebSocket frame compression (permessage-deflate).
- Compressing request bodies.
- Changing the 30 MB request-body limit.
- Any change inside `packages/mobile`.

---

## Group A — dependencies and red-phase tests (`rust-test`)

Owns: `packages/core-rs/Cargo.toml`, `packages/core-rs/Cargo.lock`,
`packages/core-rs/crates/mainframe-server/Cargo.toml`,
`packages/core-rs/crates/mainframe-server/tests/support/mod.rs`,
`packages/core-rs/crates/mainframe-server/tests/http_compression.rs` (new),
`docs/rust-port/PORTING.md`.

A2 is scaffolding. A3 and A4 carry the red-phase evidence, but only some of
their tests are red: A3.1, A3.3, A3.4, A4.1, and A4.3 must be observed **failing**
before Group B exists, while A3.2, A3.5, A3.6, A4.2, and all of A5 are identity
and regression guards that pass in both phases. Each task states which of its
tests are which, so nobody reports a false red or chases a guard that "won't
fail".

### Task A1 — turn on the compression features and add the test decoders

Files: `packages/core-rs/Cargo.toml`,
`packages/core-rs/crates/mainframe-server/Cargo.toml`,
`packages/core-rs/Cargo.lock`.

1. In `packages/core-rs/Cargo.toml` `[workspace.dependencies]`, change line 14
   to:
   ```toml
   tower-http = { version = "0.6", features = ["cors", "limit", "compression-gzip", "compression-br"] }
   ```
2. In the same `[workspace.dependencies]` block, add the two test decoders next
   to the existing `# Test-only:` entries, each with a one-line comment in the
   same style:
   ```toml
   # Test-only: decode the daemon's gzip/brotli responses in the compression
   # integration tests (use as dev-dependencies). Versions must match what
   # async-compression already pulls in, so no second copy compiles.
   flate2 = "1"
   brotli = "<resolved>"
   ```
   Determine `<resolved>` empirically, do not guess: run
   `cargo tree -p mainframe-server -e normal -i brotli` after step 1 and pin the
   major version async-compression resolved.
3. In `crates/mainframe-server/Cargo.toml` `[dev-dependencies]`, add
   `flate2 = { workspace = true }` and `brotli = { workspace = true }`.
4. Run `cargo build -p mainframe-server` from `packages/core-rs` to refresh
   `Cargo.lock`.

Verification (all from `packages/core-rs`):
- `cargo tree -d` reports no duplicate `flate2`, `brotli`, or
  `async-compression` versions.
- `cargo clippy --all-targets -- -D warnings` is clean (features alone add no
  warnings; nothing uses them yet).
- `git diff --stat packages/core-rs/Cargo.lock` shows added entries for
  `async-compression`, `flate2`, and `brotli` and no unrelated version churn.

### Task A2 — the compression test module and its harness helpers

Files: `packages/core-rs/crates/mainframe-server/tests/http_compression.rs`
(new), `packages/core-rs/crates/mainframe-server/tests/support/mod.rs`.

1. Create `tests/http_compression.rs` with the crate's standard test header —
   a `//!` doc comment,
   `#![allow(clippy::unwrap_used, clippy::expect_used, dead_code)]`, and
   `mod support;`. The doc comment states what the module covers and records
   Decision D4 verbatim in two sentences, so the next reader knows why the large
   payload comes from the file-content route.

   `dead_code` is required at this task's boundary, not optional style: all four
   helpers below are defined here and first called in Task A3, so without the
   allow, `cargo clippy --all-targets -- -D warnings` fails on this task's own
   verification. `tests/support/mod.rs:5` carries the same three-lint allow for
   the same reason. Task A3 gives every helper a caller and **must** delete
   `dead_code` from the list when it does — leaving it behind is a leftover that
   would mask a genuinely unused helper later.
2. Add these private helpers to the test module:
   - `async fn spawn_project_with_big_file() -> (support::TestServer, String, TempDir)`
     — mirror `project_server()` in `tests/routes_files.rs`: make a tempdir,
     write `big.txt` containing a highly repetitive ~200 KB string (e.g. a
     JSON-ish line repeated until the file exceeds 200 000 bytes; it must stay
     well under the route's 2 MB cap), `spawn_test_server(None)`, then
     `server.create_project(...)`.
   - `async fn get(server: &TestServer, path: &str, accept_encoding: Option<&str>, origin: Option<&str>) -> (StatusCode, HeaderMap, Vec<u8>)`
     — one `reqwest::Client::new()` request that sets `accept-encoding` and
     `origin` only when `Some`, returning the status, a clone of the response
     headers, and the **raw** body bytes via `resp.bytes()`. reqwest is
     feature-free here, so it neither advertises nor decodes an encoding.
   - `fn gunzip(bytes: &[u8]) -> Vec<u8>` using `flate2::read::GzDecoder`.
   - `fn unbrotli(bytes: &[u8]) -> Vec<u8>` using
     `brotli::BrotliDecompress(&mut &bytes[..], &mut out)`.
3. In `tests/support/mod.rs`, add an extra-headers seam to the WS client so
   Task A5 can advertise an encoding on the upgrade, without touching the
   existing call sites: rename the body of `WsClient::connect` into
   `pub async fn connect_with(addr: SocketAddr, target: &str, forwarded_for: Option<&str>, extra_headers: &[(&str, &str)]) -> Result<Self, u16>`,
   appending each `name: value\r\n` after the existing `X-Forwarded-For` line,
   and make `connect` delegate with an empty slice. No other change to the file.

Verification:
- `cargo test -p mainframe-server --test http_compression` compiles and runs
  (zero tests at this point is fine).
- `cargo test -p mainframe-server --test ws_integration` still passes — the
  `connect` signature is unchanged for existing callers.
- `cargo clippy --all-targets -- -D warnings` is clean.

### Task A3 — red-phase: negotiation, byte-identity, and the size floor

File: `packages/core-rs/crates/mainframe-server/tests/http_compression.rs`.

First delete `dead_code` from the module's `#![allow(...)]` header (Task A2
added it because the helpers had no callers yet; these tests are the callers).

Add these `#[tokio::test]`s. They split into two kinds, and mistaking one for
the other is the easy way to waste an hour here:

- **Red-phase evidence — tests 1, 3, and 4.** Each must fail against `main`'s
  uncompressed daemon, and the failure must be the missing `content-encoding`,
  not a panic in the harness. Run them and record the failure message.
- **Identity guards — tests 2, 5, and 6.** These assert that a response is
  *not* compressed, which is already true today, so they pass in both phases by
  design. They exist to catch Group B over-reaching (compressing when nothing
  was advertised, compressing below the floor, or altering the chat-history
  bytes). Do not contort them into failing.

1. `gzip_negotiation_returns_a_body_identical_to_the_identity_response` — fetch
   `/api/projects/{id}/files?path=big.txt` twice, once with
   `Accept-Encoding: gzip` and once with none. Assert the compressed response
   has `content-encoding: gzip`, has no `content-length`, carries a `vary`
   value containing `accept-encoding` (ASCII-case-insensitive), and that
   `gunzip(compressed) == identity_bytes`. Also assert the compressed body is
   materially smaller than the identity body (`compressed.len() * 4 <
   identity.len()` — repetitive JSON compresses far past 4:1, so this is a
   generous floor, not a ratio guarantee).
2. `identity_is_returned_when_the_client_advertises_nothing` — same path, no
   `Accept-Encoding`. Assert no `content-encoding` header at all and that the
   body parses to `success == true` with a `data.content` string.
3. `brotli_is_selected_when_the_client_prefers_it` —
   `Accept-Encoding: br;q=1.0, gzip;q=0.5`. Assert `content-encoding: br` and
   `unbrotli(body) == identity_bytes`.
4. `gzip_is_selected_when_the_client_prefers_it_over_brotli` —
   `Accept-Encoding: gzip;q=1.0, br;q=0.5`. Assert `content-encoding: gzip` and
   `gunzip(body) == identity_bytes`. (3 and 4 together are what proves the
   negotiation follows the client's stated preference rather than a server
   ranking.)
5. `small_responses_pass_through_uncompressed` — `GET /health` with
   `Accept-Encoding: gzip, br`. Assert no `content-encoding`, and assert the
   body is shorter than the 1024-byte floor so the test documents *why* it is
   exempt rather than silently depending on it.
6. `chat_history_route_is_byte_identical_through_the_layer` — `GET
   /api/chats/c1/messages` with `Accept-Encoding: gzip, br` and again with no
   header. Assert both statuses match, that the effective bodies are equal
   (decode with `gunzip`/`unbrotli` when `content-encoding` is present,
   otherwise use the raw bytes), and that the decoded body is the route's
   envelope. A one-line comment records that this harness leaves
   `chat_manager: None`, so the envelope here is below the floor and the test's
   job is byte-identity, not compression (Decision D4).

Verification:
- Pre-implementation, `cargo test -p mainframe-server --test http_compression`
  reports exactly three failures — tests 1, 3, and 4 — each on the missing
  `content-encoding` header. Tests 2, 5, and 6 pass. Any other split is a
  defect: a fourth failure means a harness bug, and a passing test 1/3/4 means
  the assertion is not actually reading the header.
- `cargo clippy --all-targets -- -D warnings` is clean with `dead_code` removed
  from the header, which also proves every A2 helper now has a caller.
- Record the pre-implementation test output in the task's completion note.

### Task A4 — red-phase: CORS and attachments under compression

File: `packages/core-rs/crates/mainframe-server/tests/http_compression.rs`.

1. `cors_headers_are_present_on_a_compressed_response` — GET
   `/api/projects/{id}/files?path=big.txt` with `Origin:
   http://localhost:5173` and `Accept-Encoding: gzip`. Assert
   `content-encoding: gzip` **and** all four CORS-side headers the middleware
   sets: `access-control-allow-origin: http://localhost:5173`,
   `access-control-allow-methods`, `access-control-allow-headers`, and
   `x-content-type-options: nosniff`.
2. `preflight_still_answers_204_when_an_encoding_is_advertised` — `OPTIONS` on
   the same path with `Origin` and `Accept-Encoding: gzip, br`. Assert 204, no
   `content-encoding`, and the same four headers.
3. `attachment_responses_are_not_double_encoded` — POST an attachment to
   `/api/chats/c1/attachments` following the request shape in
   `tests/routes_attachments.rs` (`{ "attachments": [{ "name", "mediaType",
   "data" }] }`), using a base64 `data` string long enough that the served
   envelope clears the 1024-byte floor (~4 KB of base64 is ample and stays far
   under the 5 MB cap). Read the id from
   `data.attachments[0].id`, then GET
   `/api/chats/c1/attachments/{id}` with `Accept-Encoding: gzip`. Assert
   `headers.get_all(CONTENT_ENCODING).iter().count() == 1`, that the single
   value is `gzip`, and that `gunzip(body)` parses to the same envelope the
   identity request returns.

Verification: run the module; tests 1 and 3 fail pre-implementation (no
`content-encoding`), test 2 passes in both phases.

### Task A5 — guard test: the WebSocket upgrade is unaffected

File: `packages/core-rs/crates/mainframe-server/tests/http_compression.rs`.

`websocket_upgrade_completes_when_the_client_advertises_an_encoding` — use
`support::WsClient::connect_with(server.addr, "/", None, &[("Accept-Encoding",
"gzip, br")])`, assert the handshake returns `Ok` (101), then drive one
round-trip that already exists in `tests/ws_integration.rs` (send the same
first frame that suite sends and `wait_for` the same acknowledgement type) to
prove frames still flow.

This test passes before and after Group B by design — it is the regression guard
for Decision D5, not red-phase evidence. State that in a one-line comment above
the test so a future reader does not mistake it for a broken red phase.

Verification: `cargo test -p mainframe-server --test http_compression` — this
test passes; `cargo test -p mainframe-server --test ws_integration` still
passes.

### Task A6 — update the dependency allowlist

File: `docs/rust-port/PORTING.md`.

1. In the §8 table, change the `tower-http` row's crate cell to
   `` `axum` (0.8, `ws`) + `tower-http` (`cors`, `limit`, `compression-gzip`,
   `compression-br`) `` and extend its "Used for" cell to mention negotiated
   gzip/brotli response compression alongside CORS, the 30 mb body limit, and
   the WS upgrade.
2. Add one row for the decoders, following the `tempfile` row's phrasing:
   `` `flate2`, `brotli` `` | **dev-dependency only** — decode compressed
   responses in the server compression tests | in workspace.

Verification, scoped to the two rows this task touches:
- The `tower-http` row lists all four features exactly as
  `packages/core-rs/Cargo.toml:14` declares them after A1.
- The new `flate2` / `brotli` row exists, is marked dev-dependency-only, and
  names the same two crates A1 added to `[workspace.dependencies]`.

Do **not** attempt a full table-to-manifest reconciliation as part of this task.
§8 has drifted independently of this change and fixing it is separate work:
the manifest declares `tokio-util`, `toml`, `croner`, `chrono-tz`, `wiremock`,
`ignore`/`grep-searcher`/`grep-regex`/`grep-matcher`, and 16 internal path
crates that the table never mentions, while the table still lists `serde_yaml`,
`cron`, `jsonata-rs`, and `futures` as deferred though the manifest declares
none of them. Record that drift in the completion note so it can be filed as its
own todo; leave it in place here.

---

## Group B — the compression layer (`rust-impl`, depends on Group A)

Owns: `packages/core-rs/crates/mainframe-server/src/middleware/compression.rs`
(new), `packages/core-rs/crates/mainframe-server/src/middleware/mod.rs`,
`packages/core-rs/crates/mainframe-server/src/http.rs`,
`.changeset/compress-api-payloads.md` (new).

Do not start until Group A's red phase has been observed failing.

### Task B1 — the compression middleware module

File: `packages/core-rs/crates/mainframe-server/src/middleware/compression.rs`
(new, ~40 lines).

Write exactly this shape:

```rust
//! Negotiated response compression for the HTTP API (todo #294).
//!
//! Scoped to the HTTP router in `http.rs`, never the WS upgrade routes.

use tower_http::compression::predicate::{And, NotForContentType, Predicate, SizeAbove};
use tower_http::compression::{CompressionLayer, CompressionLevel};

/// Below this, the compressor costs more than the bytes it saves — `/health`
/// and the small config/state envelopes stay raw.
const MIN_COMPRESS_BYTES: u16 = 1024;

/// Brotli's own default is quality 11, an order of magnitude slower than gzip;
/// tower-http applies one quality to every encoding, so pin a fast level that
/// suits both.
const COMPRESSION_QUALITY: i32 = 4;

/// `DefaultPredicate` with a larger floor — it takes no configuration, so the
/// same three content-type exclusions are recomposed here by hand.
type ApiCompressionPredicate =
    And<And<And<SizeAbove, NotForContentType>, NotForContentType>, NotForContentType>;

fn api_compression_predicate() -> ApiCompressionPredicate {
    SizeAbove::new(MIN_COMPRESS_BYTES)
        .and(NotForContentType::GRPC)
        .and(NotForContentType::IMAGES)
        .and(NotForContentType::SSE)
}

/// gzip + brotli, chosen by the client's `Accept-Encoding` preference.
pub fn compression_layer() -> CompressionLayer<ApiCompressionPredicate> {
    CompressionLayer::new()
        .gzip(true)
        .br(true)
        .quality(CompressionLevel::Precise(COMPRESSION_QUALITY))
        .compress_when(api_compression_predicate())
}
```

Notes for the implementer:
- `And`, `SizeAbove`, `NotForContentType`, and `Predicate` are all public in
  `tower_http::compression::predicate`; `Predicate` must be in scope for the
  `.and()` calls.
- `CompressionLevel` re-exports from `tower_http::compression`.
- If the concrete `ApiCompressionPredicate` alias proves awkward against the
  resolved tower-http version, the fallback is
  `pub fn compression_layer() -> CompressionLayer<impl Predicate>` — but try the
  alias first, it keeps the type nameable at the call site.
- Do not call `.no_deflate()` / `.no_zstd()`: those builders do not exist
  without their features, and the features stay off.

Verification:
- `cargo clippy -p mainframe-server --all-targets -- -D warnings` is clean.
- `cargo fmt --check` is clean.
- The file is under 300 lines and every function under 50.

### Task B2 — export the module

File: `packages/core-rs/crates/mainframe-server/src/middleware/mod.rs`.

Add `pub mod compression;` above `pub mod auth;` (alphabetical), and update the
trailing `// PORT STATUS:` block: its `notes:` line currently reads "auth.ts is
the only middleware in the TS tree" — extend it to say that `compression.rs` has
no TS counterpart and is a Rust-side transport addition (todo #294), so the
port-status comment does not read as stale.

Verification: `cargo build -p mainframe-server` succeeds.

### Task B3 — wire the layer into the HTTP router

File: `packages/core-rs/crates/mainframe-server/src/http.rs`.

1. Add `use crate::middleware::compression::compression_layer;` next to the
   existing `use crate::middleware::auth::auth_middleware;`.
2. In `build_app`, extend the `let http = http` chain (currently lines 87–92) so
   compression is the outermost layer of the **inner** router:
   ```rust
   let http = http
       .fallback(not_found)
       .layer(from_fn_with_state(Arc::clone(&ctx), auth_middleware))
       // Outermost layer of the HTTP router only: the WS upgrades merged below
       // must never pass through the compressor.
       .layer(compression_layer());
   ```
   Leave the outer router — the two `any(...)` WS routes, the body limit, and
   the CORS `from_fn` — exactly as it is. Layer order matters: `.layer()`
   applied later is outermore, so requests flow compression → auth → routes and
   responses flow back routes → auth → compression, with CORS still outside
   everything.
3. Update the module doc comment at the top of the file (lines 1–5) to list the
   compression layer among the stack it describes.
4. Update the `// PORT STATUS:` block at the foot of the file: append a sentence
   recording that negotiated gzip/brotli compression (todo #294) is a Rust-side
   addition with no TS counterpart, scoped to the HTTP router so the WS upgrade
   routes are untouched.

Verification:
- `cargo test -p mainframe-server --test http_compression` — all of Group A's
  tests pass.
- `cargo test -p mainframe-server` — the whole server suite passes, in
  particular `http_integration`, `ws_integration`, `routes_attachments`, and
  `routes_files`.
- `http.rs` stays under 300 lines.
- **Do not gate on `build_app` being under 50 lines, and do not decompose it.**
  It already spans `http.rs:33–106` — 72 lines of body — before this change, so
  the 50-line rule is violated on arrival; this task adds roughly four more.
  The body is a flat 30-route `.merge()` assembly with no branching, splitting
  it is scope expansion inside a transport-layer todo, and the Codex reviewer
  concurred on both points. Record the pre-existing violation in the completion
  note as known and out of scope.

### Task B4 — full daemon verification

No file changes. Run from `packages/core-rs`:

- `cargo fmt --check`
- `cargo clippy --all-targets -- -D warnings`
- `cargo test`
- `tools/verify-gate.sh`

Then confirm the two cross-package facts this change depends on, and record the
result in the completion note. Both are read-only, and both run **from the
repository root**, not from `packages/core-rs` — the paths are root-relative:

- `packages/app-tauri/src-tauri/Cargo.toml` still declares
  `ureq = { version = "2", default-features = false, features = ["json"] }` — no
  `gzip` feature — so `presence.rs`'s `POST /api/device/activity` keeps
  advertising nothing and keeps receiving identity bytes.
- `grep -rn "route.continue()" packages/e2e --include="*.ts"` still returns
  exactly the three known handlers — `tests-tauri/sessions.spec.ts`,
  `tests-tauri/settings.spec.ts`, `tests-tauri/directory-picker.spec.ts` — and
  none of them reads a response body. A fourth continuing handler, or one of
  these three growing a `route.fetch()` / body read, is the only way an E2E spec
  could start observing a compressed payload; that is what this check guards.

### Task B5 — changeset

File: `.changeset/compress-api-payloads.md` (new).

```markdown
---
'@qlan-ro/mainframe-core': patch
---

The daemon now compresses HTTP responses when the client asks for it. Requests
advertising gzip or brotli get a compressed body and a matching
`Content-Encoding`; requests advertising nothing get exactly the bytes they got
before. Chat history is the biggest win — a long session's transcript is highly
repetitive JSON, re-fetched on every WebSocket subscribe acknowledgement, and it
crosses the cloudflared tunnel uncompressed today. Responses under 1 KB, such as
the health check, are sent raw, and the WebSocket upgrade is deliberately left
outside the compressor.
```

Write the prose by hand — `pnpm changeset` is interactive and this is a
single-package patch. Then verify the file parses:
`pnpm changeset status --since=main` runs without error.

---

## Task index

| Task | Group | Files | Kind |
|---|---|---|---|
| A1 | A | `core-rs/Cargo.toml`, `crates/mainframe-server/Cargo.toml`, `Cargo.lock` | deps |
| A2 | A | `tests/http_compression.rs` (new), `tests/support/mod.rs` | test scaffold |
| A3 | A | `tests/http_compression.rs` | red-phase |
| A4 | A | `tests/http_compression.rs` | red-phase |
| A5 | A | `tests/http_compression.rs` | guard |
| A6 | A | `docs/rust-port/PORTING.md` | docs |
| B1 | B | `src/middleware/compression.rs` (new) | impl |
| B2 | B | `src/middleware/mod.rs` | impl |
| B3 | B | `src/http.rs` | impl |
| B4 | B | — | verification |
| B5 | B | `.changeset/compress-api-payloads.md` (new) | changeset |

Group A and Group B share no files. Group B depends on Group A: the tower-http
features it calls into are declared by A1, and its red-phase evidence is A3/A4.

## Acceptance-criteria trace

| Brief criterion | Covered by |
|---|---|
| gzip request → `Content-Encoding: gzip`, body decodes to the identity bytes | A3.1 (large real payload), A3.6 (the chat-history route itself, byte-identity) — see Decision D4 |
| No `Accept-Encoding` → uncompressed, no `Content-Encoding` | A3.2 |
| Below the minimum size → uncompressed even when advertised | A3.5, and B1's `MIN_COMPRESS_BYTES` |
| WS upgrade still completes and streams | A5, plus D5's placement in B3 |
| CORS unchanged: 204 preflight, allow-origin/methods/headers + nosniff on compressed responses | A4.1, A4.2 |
| Attachment/binary responses not double-encoded | A4.3, plus `future.rs`'s `content-encoding` guard and `NotForContentType::IMAGES` in B1 |
| Tests run against the production-assembled router | The whole module uses `support::spawn_test_server`, which calls `build_app` |
| Changeset accompanies the change | B5 |

## Risks

- **Decision D4 is the one place the plan does not follow the brief literally.**
  The chat-history endpoint is exercised, but the compression evidence comes
  from a different route through the same layer. If the lane wants the literal
  criterion, the added work is wiring a `ChatManager` plus a seeded mock-adapter
  transcript into `tests/support/mod.rs` — a separate task, not a tweak.
- **Brotli quality.** D3 pins `Precise(4)` on reasoning about async-compression's
  defaults rather than a measurement. If a reviewer wants numbers, the cheap
  check is timing A3.1 and A3.3 against a 1 MB payload; the fix if it is wrong
  is a one-constant change in `compression.rs`.
- **`Vary: accept-encoding` is a new response header** on compressed responses.
  Nothing in the repo caches daemon responses by URL, so this is correct
  behavior rather than a hazard, but it is a wire-visible addition worth naming.
- **`Content-Length` disappears** from compressed responses (tower-http removes
  it). Every consumer is a `fetch`-family client that reads the stream to
  completion, and no code in `packages/ui` or `packages/app-tauri` reads
  `Content-Length`, but a future progress indicator would need chunked-aware
  handling.
- **`flate2` / `brotli` version drift.** If A1 pins a major that
  `async-compression` did not resolve, `cargo tree -d` will show duplicates and
  build time grows. A1's verification step catches this.
