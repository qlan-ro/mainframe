# Todo #219 — Attachments on a remote daemon

Plan · 2026-07-30 · branch `todo/219-remote-daemon-attachments` · route `no-spec` (works from the approved Agent Brief)

## Goal

Sending a message with attachments to a **remote** daemon fails silently-ish: the upload `POST /api/chats/:id/attachments` is rejected (401 when the device token is stale, 413 when the body trips a limit), the composer has already been reset so the user's files are gone, and the failed bubble says only "Failed to send" — no reason, no route to recovery. This plan makes the failure legible and recoverable end to end: the shared REST layer keeps the HTTP status and turns a non-JSON error body into a human sentence; a remote 401 marks that daemon `needs-repair` in the footer (without touching the stored token) and the failed message says so; the attachments the send consumed are put back into the composer; completing a re-pair swaps the live token in place so the next send works without an app restart; and the daemon logs exactly one structured record per upload outcome with no file names, bytes, or tokens. The desktop leg (`packages/ui` + `packages/core-rs`) is the whole of this PR.

## Constraints

- Max 300 lines/file, 50 lines/function. `AddRemoteDialog.tsx` is **already at 308 lines** — task 20 extracts a helper so the file shrinks rather than grows. `routes/attachments.rs::upload` is already 48 lines — task 22 decomposes it before adding logging.
- Every interactive element gets a kebab-case `data-testid` keyed by domain id.
- No `@ts-ignore`; no silent catches; new logic gets tests; a changeset is required.
- Contract changes to WS/REST must stay additive (mobile co-owns the contract). Nothing here changes the wire contract.
- Never commit to `main`; all work stays in this worktree.

## Out of scope (explicit)

- **The mobile client.** `packages/mobile` is a git submodule and is *uninitialized in this worktree* — its half of the fix cannot be written or tested here. It needs its own todo and its own PR in the submodule repo. Do not bump the submodule pointer.
- **WebSocket token revalidation.** The WS carries the token as a connect-time query param and never revalidates it; a mid-session revocation is only observed on the next REST call. Out of scope, called out as a risk below.
- **`RepairPrompt.tsx`** stays unmounted. It exists and is exercised only by `daemon-dialogs.test.tsx`. The brief's decision is explicit: surface the state in the footer and in the failed message, do **not** steal focus with a modal mid-conversation. Leave the component alone (it is the surface a future "re-pair now" entry point would use).

## Change surface

| Area | Files |
|---|---|
| REST error layer | `packages/ui/src/lib/api/http.ts`, `packages/ui/src/lib/api/http-failure.ts` (new), `packages/ui/src/lib/api/projects.ts` |
| Auth-failure marker | `packages/ui/src/lib/daemon/auth-failure-store.ts` (new) |
| Chat send failure | `packages/ui/src/features/chat/composer/attachment-adapter.ts`, `controller/chat-thread-state.ts`, `controller/chat-thread-controller.ts`, `controller/describe-send-error.ts` (new), `controller/project-messages.ts`, `view-model/message-meta.ts`, `messages/UserMessage.tsx`, `runtime/use-chat-thread-runtime.ts` |
| Daemon repair | `packages/ui/src/features/daemon/DaemonFooterStatus.tsx`, `features/daemon/apply-pairing.ts` (new), `features/daemon/AddRemoteDialog.tsx`, `features/daemon/use-daemon-registry.ts`, `packages/ui/src/lib/daemon/active-daemon.ts` |
| Daemon (Rust) | `packages/core-rs/crates/mainframe-server/src/routes/attachments.rs`, `src/middleware/auth.rs`, `src/http.rs`, `Cargo.toml` (dev-dep) |

---

## Phase 0 — red tests (UI)

These are written and observed **failing** before any implementation exists. All are new files, so they collide with nothing.

### Task 1 — unit test: HTTP failure sentences

File: `packages/ui/src/lib/api/__tests__/http-failure.test.ts` (new)

Test `describeHttpFailure(status: number): string` from `../http-failure`:
- 401 → `The daemon rejected this request as unauthorized (HTTP 401).`
- 403 → same shape with 403.
- 413 → `The daemon rejected this request as too large (HTTP 413).`
- 500 / 503 → `The daemon failed to handle this request (HTTP 503).`
- 418 (anything else) → `The daemon rejected this request (HTTP 418).`
- Every branch contains the numeric status and ends in a period; none is the bare `HTTP <n>`.

Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/api/__tests__/http-failure.test.ts` — fails with "cannot find module ../http-failure".

### Task 2 — unit test: auth-failure marker store

File: `packages/ui/src/lib/daemon/__tests__/auth-failure-store.test.ts` (new)

Test `markAuthFailure(id)`, `clearAuthFailure(id)`, `hasAuthFailure(id)`, `subscribeAuthFailures(cb)` from `../auth-failure-store`:
- unmarked id → `hasAuthFailure` is false.
- `markAuthFailure('d1')` → true for `d1`, still false for `d2` (per-daemon keying).
- `clearAuthFailure('d1')` → false again.
- subscribe fires on mark and on clear; the returned unsubscribe stops further calls.
- marking twice notifies **once** (no redundant notification when the value did not change) — protects `useSyncExternalStore` consumers.
- The module imports nothing from `@/lib/host`: assert via the test's module graph expectation that no keyring API is reachable (import the module and assert `getHost` was never called using a `vi.mock('@/lib/host')` spy). This is the "a 401 must not clear stored credentials" guard.

Verify: `vitest run src/lib/daemon/__tests__/auth-failure-store.test.ts` — fails (module missing).

### Task 3 — unit test: send-failure classifier

File: `packages/ui/src/features/chat/controller/__tests__/describe-send-error.test.ts` (new)

Test `describeSendError(error: unknown, opts: { hadAttachments: boolean }): string` from `../describe-send-error`:
- `ApiRequestError` with `status: 401` → `Not authorized on this daemon. Re-pair it from the daemon menu, then send again.`
- same with `hadAttachments: true` → the sentence above plus ` Your attachments are back in the composer.`
- `status: 403` → the same authorization sentence (one auth branch, two statuses).
- `status: 413` → `The attachment is too large. The daemon accepts files up to 5MB.`
- The composer pre-flight error (`new Error('"shot.png" is too large. Max file size is 5MB.')`, no status) is returned **verbatim** — it already names the offending file and the limit.
- `new TypeError('Failed to fetch')` → `The daemon is unreachable. Check the connection, then send again.`
- an arbitrary `Error('boom')` → `boom`; `undefined` → `Failed to send`.
- The function is pure: no imports from React or the API layer.

Verify: `vitest run src/features/chat/controller/__tests__/describe-send-error.test.ts` — fails (module missing).

### Task 4 — component test: failed-send copy and retry suppression

File: `packages/ui/src/features/chat/messages/__tests__/UserMessage-send-failure.test.tsx` (new — do not modify the existing `UserMessage.test.tsx`; mirror its mock setup)

- A pending message with `metadata.custom.mainframe = { pending: true, clientId: 'c1', error: '<auth sentence>' }` renders the existing `chat-user-message-send-failed` label **and** a new element `data-testid="chat-user-message-send-error"` whose text is the sentence.
- With `attachmentsRestored: true` in the same metadata, `chat-user-message-retry` is **absent** (retry is text-only and would silently drop the attachments that are now back in the composer).
- Without `attachmentsRestored`, `chat-user-message-retry` is still present and still calls `retryMessage(clientId)`.
- A message with no `error` renders neither testid.

Verify: `vitest run src/features/chat/messages/__tests__/UserMessage-send-failure.test.tsx` — fails on the missing `chat-user-message-send-error`.

### Task 5 — behavior test: attachments return to the composer

File: `packages/ui/src/features/chat/runtime/__tests__/use-chat-thread-runtime-restore.test.tsx` (new)

Mirror the mock harness of the existing `use-chat-thread-runtime-active.test.tsx` (it already mocks `@assistant-ui/react` and captures `onNew`); extend the `useExternalStoreRuntime` mock to return a fake runtime object exposing `thread.composer.addAttachment: vi.fn()`.

- `controller.sendMessage` rejects with an `ApiRequestError(401)`; the appended message carries two attachments whose `file` is a real `File`. Assert `addAttachment` is called once per file, in order, with those `File` objects.
- `onNew` still **rejects** with the original error (the controller's failed dispatch and the caller's error path must not be swallowed).
- `sendMessage` resolves → `addAttachment` is never called.
- An appended message with no attachments and a rejecting `sendMessage` → `addAttachment` never called, still rejects.

Verify: `vitest run src/features/chat/runtime/__tests__/use-chat-thread-runtime-restore.test.tsx` — fails (no restore path yet).

### Task 6 — component test: footer reports `needs-repair`

File: `packages/ui/src/features/daemon/__tests__/DaemonFooterStatus-needs-repair.test.tsx` (new — mirror the mocks in the existing `DaemonFooterStatus.test.tsx`)

- Active daemon is remote, connection state `connected`, and `markAuthFailure(<activeId>)` has run → `daemon-footer-trigger-status` reads `Re-pair` (the `needs-repair` word already defined in `DaemonRow.DAEMON_STATUS`).
- After `clearAuthFailure(<activeId>)` the status returns to `Connected` without a remount.
- A marker on a **non-active** daemon id does not change the active status.
- `needs-repair` wins over `connecting` (an authorization failure is not a transient reconnect) but a `disconnected` connection state still reads `Unreachable`.

Verify: `vitest run src/features/daemon/__tests__/DaemonFooterStatus-needs-repair.test.tsx` — fails (status never becomes `needs-repair`).

### Task 7 — component test: re-pair swaps the live token in place

File: `packages/ui/src/features/daemon/__tests__/AddRemoteDialog-retoken.test.tsx` (new)

- Open the dialog in `mode="repair"` for a remote target, enter a valid 6-char code, mock `confirmPairing` to resolve `{ token: 'new-token' }`. Assert, in order: `getHost().daemons.setToken(target.id, 'new-token')` was called, the active-daemon singleton's `token` is now `'new-token'`, and `clearAuthFailure(target.id)` ran.
- `ActiveDaemonProvider.switchTo` (the full teardown) is **not** called — the session survives the re-pair.
- A pairing failure (`PairingError('invalid')`) leaves the stored token and the marker untouched.

Verify: `vitest run src/features/daemon/__tests__/AddRemoteDialog-retoken.test.tsx` — fails (no token refresh path).

### Task 8 — unit test: a remote auth failure marks the daemon

File: `packages/ui/src/lib/api/__tests__/http-auth-failure.test.ts` (new — mirror `http-auth.test.ts`, which already drives `setActiveDaemon` plus `vi.spyOn(globalThis, 'fetch')`)

This is the causal link the whole fix rests on: a 401 from the attachment upload must be what makes the daemon read `needs-repair`. Task 2 tests the store alone and task 6 tests the footer *given* a marker; only this test joins them.

Drive `request('GET', apiBase() + '/api/projects')` from `../http` against a mocked `fetch` and assert `hasAuthFailure` from `../../daemon/auth-failure-store`. The store is module-level state, so `clearAuthFailure` both ids in `beforeEach`.

- Remote active (`{ id: 'studio', kind: 'remote', token: 'jwt' }`), response `401` → `hasAuthFailure('studio')` is true.
- Remote active, response `403` → true.
- **Local** active (`{ id: 'local', kind: 'local', token: null }`), response `401` → `hasAuthFailure('local')` stays false. A local target carries no token and can never legitimately need a re-pair, so it must never be marked.
- Remote active, response `500`, marker set beforehand via `markAuthFailure('studio')` → still true; with no marker set → still false. A server error is not an authorization statement, so it moves the marker in neither direction.
- Remote active, response `200` with `{"success":true,"data":null}`, marker set beforehand → cleared.
- Every failing case still rejects with the `ApiRequestError` `extractError` produced — marking must not swallow or replace the thrown error.

Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/lib/api/__tests__/http-auth-failure.test.ts` — fails (module `../../daemon/auth-failure-store` missing).

---

## Phase 0b — red tests (Rust)

### Task 9 — integration test: one log record per upload outcome

Files: `packages/core-rs/crates/mainframe-server/tests/routes_attachments_logging.rs` (new), `packages/core-rs/crates/mainframe-server/Cargo.toml` (add `tracing-subscriber = { workspace = true }` to `[dev-dependencies]`)

Each `tests/*.rs` is its own binary, so a capturing subscriber installed here affects only this file. Install it once via a `OnceLock` + a `MakeWriter` that appends lines to a `Mutex<Vec<String>>`; tests run in parallel threads inside the binary, so **every test uses a unique chat id** and filters the captured lines by it.

- Successful upload of two attachments emits exactly one record containing the chat id, `count=2`, and a total byte count; it contains **neither** file name (`a.png`) **nor** any base64 payload.
- A rejected upload (declared size > 5 MB) emits exactly one record naming the rejection reason, and still no file name.
- A non-loopback request (`X-Forwarded-For: 203.0.113.44`) with no bearer token against a server started with an auth secret returns 401 **and** emits exactly one record carrying the request path; the record must not contain the word `Bearer` or any token substring.
- A file-kind upload (`text/plain`) still returns `kind: "file"` with an id — the materialization contract is unchanged by the logging work.

Verify: `cd packages/core-rs && cargo test -p mainframe-server --test routes_attachments_logging` — fails (no records emitted).

### Task 10 — un-ignore the >2 MB upload test

File: `packages/core-rs/crates/mainframe-server/tests/routes_attachments.rs`

Delete the `#[ignore = "http.rs applies RequestBodyLimitLayer(30mb) but not DefaultBodyLimit::disable() …"]` attribute (and its stale reasoning) on `returns_400_when_base64_payload_exceeds_5mb`. This test documents a real, currently-shipping bug: axum's default 2 MB extractor limit shadows the 30 MB layer, so **any attachment over ~1.5 MB is rejected with an empty-bodied 413** — on local *and* remote daemons — even though the composer's own gate allows 5 MB. Task 24 fixes it.

Verify: `cargo test -p mainframe-server --test routes_attachments returns_400_when_base64_payload_exceeds_5mb` — fails with 413 instead of 400.

---

## Phase 1 — REST error layer (`core`)

### Task 11 — human sentences + a status on `ApiRequestError`

Files: `packages/ui/src/lib/api/http-failure.ts` (new), `packages/ui/src/lib/api/http.ts`

- New module exports the pure `describeHttpFailure(status: number): string` (table from task 1). Keep it under 20 lines; it holds the only copy of the fallback wording.
- `ApiRequestError` gains `readonly status: number` (default `0` for non-HTTP failures) as a third constructor argument, after `details`.
- `extractError(res)` passes `res.status` into both constructions and replaces **both** `HTTP ${res.status}` literals with `describeHttpFailure(res.status)` — the JSON path's missing-`error`-field fallback and the non-JSON catch path.

Verify: `vitest run src/lib/api/__tests__/http-failure.test.ts` passes (task 1 goes green).

### Task 12 — mark and clear the remote auth failure

Files: `packages/ui/src/lib/daemon/auth-failure-store.ts` (new), `packages/ui/src/lib/api/http.ts`

- New store: a `Set<string>` of daemon ids plus a listener set; exports `markAuthFailure`, `clearAuthFailure`, `hasAuthFailure`, `subscribeAuthFailures`, and `getAuthFailureSnapshot()` returning a stable reference for `useSyncExternalStore` (bump a version counter, do not allocate a new set per read). Under 60 lines. No host/keyring imports — a 401 never touches stored credentials.
- In `http.ts`, add one private `async function fetchChecked(url, init): Promise<Response>` that all six wrappers (`request`, `requestEmpty`, `requestNoContent`, `requestPlugin`, `requestPluginNoContent`, and `fetchInit`'s callers) route through. It calls `fetch`, then, **only when the active daemon is remote**: on `res.status === 401 || res.status === 403` calls `markAuthFailure(activeId)`; on `res.ok` calls `clearAuthFailure(activeId)`. Any other status leaves the marker alone (a 500 is not an authorization statement).
- Do **not** add this store to `resetDaemonScopedStores` — the markers are keyed *by* daemon id, so switching daemons must not erase another daemon's state. Add a one-line comment in the store saying so.

Verify: `vitest run src/lib/api/__tests__/http-auth-failure.test.ts` passes (task 8 goes green — this is the marking path's only coverage); `vitest run src/lib/daemon/__tests__/auth-failure-store.test.ts` passes; `vitest run src/lib/api/__tests__/http-auth.test.ts` still passes.

### Task 13 — one canonical fallback sentence

Files: `packages/ui/src/lib/api/projects.ts`, `packages/ui/src/lib/api/__tests__/http-plugin.test.ts`, `__tests__/projects.test.ts`, `__tests__/http-envelope.test.ts`

- `createProject` uses a raw `fetch` (409 is a success for it) and carries its own `HTTP ${res.status}` copy at line 36. Replace it with `describeHttpFailure(res.status)` so there is exactly one fallback wording in the codebase.
- Update the three existing assertions that pin the old bare string: `http-plugin.test.ts:154` (`'HTTP 503'`), `projects.test.ts:209` (`'HTTP 500'`), `http-envelope.test.ts:86` (`'HTTP 503'`) to the new sentences.

Verify: `vitest run src/lib/api/__tests__/http-plugin.test.ts src/lib/api/__tests__/projects.test.ts src/lib/api/__tests__/http-envelope.test.ts` all green.

---

## Phase 2 — chat send failure (`ui`)

### Task 14 — keep the `File` on a completed attachment

File: `packages/ui/src/features/chat/composer/attachment-adapter.ts`

`toCompleteAttachment` drops `file`. `CompleteAttachment` declares `file?: File` (verified in `@assistant-ui/core@0.2.21` `types/attachment.d.ts`), so carry it through: `...(attachment.file ? { file: attachment.file } : {})`. This is what lets the restore in task 18 re-add the exact files without re-reading them from a stash. Extend the function's docstring with that one reason.

Verify: `vitest run src/features/chat/composer/__tests__/attachment-adapter.test.ts` (existing) plus a new case asserting `file` survives the status flip — add it to that existing file.

### Task 15 — record which stage failed

Files: `packages/ui/src/features/chat/controller/chat-thread-state.ts`, `controller/chat-thread-controller.ts`

- `PendingUserMessage` gains `stage?: 'upload' | 'send'`; the `local.message.failed` action gains the same optional field; the reducer branch writes it onto the pending alongside `status: 'failed'`.
- `sendMessage`'s catch dispatches `stage: uploadItems.length > 0 && attachmentIds === undefined ? 'upload' : 'send'`. Compute it by hoisting `let attachmentIds: string[] | undefined` above the `try` so the catch can tell an upload rejection from a WS-send throw.
- `retryMessage`'s catch keeps `stage: 'send'` (it never uploads).

Verify: `vitest run src/features/chat/controller/__tests__/chat-thread-controller-send.test.ts src/features/chat/controller/__tests__/chat-thread-controller-retry.test.ts` — both still green (the existing assertion `expect(pendingValues[0]!.error).toBe(uploadError)` must keep passing: the controller still stores the **raw** error, classification happens at projection time).

### Task 16 — classify at projection time

Files: `packages/ui/src/features/chat/controller/describe-send-error.ts` (new), `controller/project-messages.ts`, `view-model/message-meta.ts`

- New pure module with `describeSendError(error, { hadAttachments })` per task 3. It reads `status` off an `ApiRequestError` structurally (`typeof (error as {status?: unknown}).status === 'number'`) so it needs no import from the API layer and stays trivially testable.
- `projectPendingMessage` replaces the raw `error.message` passthrough with `describeSendError(pending.error, { hadAttachments: pending.stage === 'upload' })`, and adds `attachmentsRestored: pending.stage === 'upload'` to the mainframe metadata.
- `MainframeMessageMeta` gains `readonly attachmentsRestored?: boolean` next to the existing `error`/`clientId` pending fields.

Verify: `vitest run src/features/chat/controller/__tests__/describe-send-error.test.ts src/features/chat/controller/__tests__/project-messages.test.ts`.

### Task 17 — render the sentence, suppress the misleading retry

File: `packages/ui/src/features/chat/messages/UserMessage.tsx`

Inside the existing `sendError != null` block: keep the `chat-user-message-send-failed` label exactly as it is ("Failed to send" — existing tests pin it), gate the Retry button additionally on `!meta.attachmentsRestored`, and render the classified sentence beneath the row as `<p data-testid="chat-user-message-send-error" className="text-label text-mf-text-3">{sendError}</p>`. Wrap the label row and the sentence in a single `flex flex-col gap-1` container so the existing layout is unchanged when the sentence is short.

Verify: `vitest run src/features/chat/messages/__tests__/UserMessage-send-failure.test.tsx src/features/chat/messages/__tests__/UserMessage.test.tsx` — task 4 goes green and the pre-existing suite stays green.

### Task 18 — put the attachments back

File: `packages/ui/src/features/chat/runtime/use-chat-thread-runtime.ts`

- Hold the runtime in a ref: `const runtimeRef = useRef<AssistantRuntime | null>(null)`, assign it from the `useExternalStoreRuntime(...)` result before returning.
- Wrap the `await controller.sendMessage(message)` call in `onNew` with a try/catch. On failure, call a small local `restoreAttachments(runtime, message.attachments)` that awaits `runtime.thread.composer.addAttachment(file)` for each attachment carrying a `file`, then **rethrows** the original error. Failures of the restore itself are logged with a tagged `console.warn` and never mask the send error.
- Ordering is load-bearing and must be stated in a one-line comment: `append()` drops the `onNew` promise and `use-submit-composition.ts` calls `composer.reset()` synchronously right after, while `sendMessage` cannot reject before its first `await` (the upload `fetch`). The restore therefore always lands after the reset.
- This catch also removes today's floating unhandled rejection from the fire-and-forget `append()`.

Verify: `vitest run src/features/chat/runtime/__tests__/use-chat-thread-runtime-restore.test.tsx src/features/chat/runtime/__tests__/use-chat-thread-runtime-active.test.tsx`.

---

## Phase 3 — daemon repair (`ui`)

### Task 19 — refresh the active token without a teardown

Files: `packages/ui/src/lib/daemon/active-daemon.ts`, `packages/ui/src/features/daemon/use-daemon-registry.ts`

- `active-daemon.ts` gains `updateActiveDaemonToken(id: string, token: string): void` — a no-op unless `active.id === id`; otherwise it replaces the singleton with `{ ...active, token }` and notifies listeners. It must **not** go through `switchTo` (that disposes the WS, controllers, PTYs and remounts the subtree).
- `useDaemonRegistry` gains `retoken(id: string): Promise<void>` on `UseDaemonRegistryResult`: reads the freshly stored token via `getHost().daemons.getToken(id)`, calls `updateActiveDaemonToken(id, token)`, and `clearAuthFailure(id)`. Missing token → tagged `console.warn`, no throw.

Verify: `vitest run src/lib/daemon/__tests__/active-daemon.test.ts src/features/daemon/__tests__/use-daemon-registry.test.tsx` (extend both with the new cases in the same pass).

### Task 20 — extract the pairing-apply step and call `retoken`

Files: `packages/ui/src/features/daemon/apply-pairing.ts` (new), `features/daemon/AddRemoteDialog.tsx`

`AddRemoteDialog.tsx` is at 308 lines — over the 300 limit before this change. Move the inner "persist the pairing result" try-block (lines ~227–249) into `apply-pairing.ts` as `applyPairing({ mode, target, targetUrl, device, token, registry }): Promise<{ addedId?: string }>` (throws on storage failure so the dialog keeps its `storage` phase). The repair branch there becomes: `setToken` → `registry.retoken(target.id)`. The dialog shrinks below 300 lines and keeps only state-machine code.

Verify: `vitest run src/features/daemon/__tests__/AddRemoteDialog-retoken.test.tsx src/features/daemon/__tests__/AddRemoteDialog.test.tsx`; `wc -l packages/ui/src/features/daemon/AddRemoteDialog.tsx` under 300.

### Task 21 — surface `needs-repair` in the footer

File: `packages/ui/src/features/daemon/DaemonFooterStatus.tsx`

Subscribe to the marker store with `useSyncExternalStore(subscribeAuthFailures, getAuthFailureSnapshot)` and extend `statusOf` — precedence: `disconnected → 'unreachable'`, else `hasAuthFailure(id) → 'needs-repair'`, else the current connected/connecting mapping. Applies to inactive rows too (their marker is real even though their connection is assumed). The `Re-pair…` row (`daemon-row-${id}-repair`) and the `needs-repair` presentation already exist in `DaemonRow.tsx`/`DaemonPicker.tsx` — no new UI is needed there.

Verify: `vitest run src/features/daemon/__tests__/DaemonFooterStatus-needs-repair.test.tsx src/features/daemon/__tests__/DaemonFooterStatus.test.tsx`.

---

## Phase 4 — daemon (`core`, Rust)

### Task 22 — one structured record per upload outcome

File: `packages/core-rs/crates/mainframe-server/src/routes/attachments.rs`

`upload` is already 48 lines; decompose first, then log:
- Extract `fn validate(attachments: &[UploadAttachmentItem]) -> Result<(), &'static str>` holding the count and size checks.
- Extract `fn log_upload(chat_id: &str, count: usize, total_bytes: usize, outcome: &str)` emitting a single `tracing::info!` for success and `tracing::warn!` for a rejection, with fields `chat_id`, `count`, `total_bytes`, `outcome`. **Never** log `name`, `data`, `original_path`, or any header.
- Call it on exactly three paths: malformed body, validation rejection, and save success/failure. `serve`'s 404 gets its own one-line `tracing::warn!(chat_id, attachment_id, "attachment not found")`.
- Keep every function under 50 lines and update the trailing `PORT STATUS` note to mention the added observability.

Verify: `cargo test -p mainframe-server --test routes_attachments_logging`; `cargo test -p mainframe-server --test routes_attachments`.

### Task 23 — log the 401 the middleware issues

File: `packages/core-rs/crates/mainframe-server/src/middleware/auth.rs`

A rejected upload never reaches the route, so the route log alone leaves a 401 invisible. Change `unauthorized()` to `fn unauthorized(path: &str, reason: &str) -> Response`, emitting `tracing::warn!(path, reason, "request rejected: unauthenticated")` before `fail(StatusCode::UNAUTHORIZED, "Unauthorized")`. Call sites pass `"missing bearer"` and `"invalid token"`. Never log the token, the header, or the client IP's forwarded chain. `auth_middleware` stays under 50 lines.

Verify: `cargo test -p mainframe-server --test routes_auth --test routes_automations_auth --test routes_attachments_logging`.

### Task 24 — stop axum's default 2 MB limit from shadowing the 30 MB layer

File: `packages/core-rs/crates/mainframe-server/src/http.rs`

Add `.layer(DefaultBodyLimit::disable())` immediately inside the existing `RequestBodyLimitLayer::new(BODY_LIMIT_BYTES)` layer so the explicit 30 MB limit is the only one in force. Today a 2 MB attachment (≈2.7 MB base64) is rejected with an **empty-bodied 413** before the handler runs — that is the "non-JSON error body" case the brief calls out, and it breaks 2–5 MB attachments on every daemon, local or remote. Update the `// notes:` block at the bottom of the file to record why the default limit is disabled.

Verify: `cargo test -p mainframe-server --test routes_attachments` (task 10's un-ignored test goes green); `cargo test -p mainframe-server --test http_integration`.

---

## Phase 5 — close out

### Task 25 — changeset and full verification

- `pnpm changeset` → patch for `@qlan-ro/mainframe-ui`; describe the user-visible change (a stale remote token now reads "Re-pair" in the footer, the failed message says why, attachments come back, uploads above 2 MB work again). Mention the Rust daemon's upload logging and body-limit fix in the body — `packages/core-rs` is not a changeset package, so it rides in the prose.
- Run: `pnpm --filter @qlan-ro/mainframe-ui typecheck`; the vitest files touched by tasks 1–21 (run them file-by-file, not as one batch — large batches hit the cross-file `React.act` failure); `cd packages/core-rs && cargo fmt --all -- --check && cargo clippy --all-targets -- -D warnings && cargo test -p mainframe-server`.
- Confirm no file exceeds 300 lines and no new function exceeds 50: `wc -l` on every file in the change surface.

---

## Decisions taken while planning

1. **Mobile is a separate PR.** The submodule is uninitialized in this worktree; its attachment path cannot be built or verified here.
2. **The size sentence names a file only when the pre-flight gate produced it.** The daemon's 5 MB rejection and the 413 have no per-file attribution, so the daemon-sourced sentence names the limit but not the file. This is a deliberate deviation from the literal wording of the brief's size criterion.
3. **Retry is hidden for upload-stage failures.** `retryMessage` is text-only; leaving it visible next to attachments that are now back in the composer would silently send a message without them.
4. **`DefaultBodyLimit::disable()` is in scope.** It is one line, it un-ignores an existing test, and without it the human sentence would tell a user their 2 MB file was "too large" while the composer's own gate allows 5 MB. Flagged for the lane in case it reads as scope creep against the earlier "not body limits" gate note.
5. **The marker store is not reset on daemon switch.** It is keyed by daemon id, so it belongs outside `resetDaemonScopedStores`.
6. **`RepairPrompt.tsx` stays unmounted.** The brief forbids a mid-conversation modal; the component is left as-is rather than deleted, since it is the natural surface for a future explicit re-pair entry point.

## Risks

- **Mid-session WS revocation stays invisible.** The socket authenticates once at connect and is never revalidated, so a token revoked mid-session is only discovered on the next REST call (which is exactly the attachment upload — the path this plan covers). Anything WS-only keeps working until reconnect.
- **Restore ordering depends on `sendMessage` not rejecting synchronously.** It cannot today (its first statement before an `await` is a pure parse), but a future refactor that throws synchronously in `sendMessage` would re-add the attachments *before* `composer.reset()` wipes them. Task 18's comment and task 5's test guard this.
- **Log-capture flakiness.** The Rust capture subscriber is process-global within its test binary; tests must filter by a unique chat id rather than asserting on the whole buffer.
