# Remote daemons paired over http — persist and honor the scheme (todo #305)

**Branch:** `todo/305-remote-daemon-http-scheme` · **Route:** no-spec (implements the approved Agent Brief on todo #305)

## Goal

A remote daemon paired over plain http today pairs successfully and is then permanently unreachable: every
reconstruction of its endpoint hardcodes `https://` in front of the stored bare host, so the HTTP client, the
WebSocket and the LSP client all target the wrong scheme. This plan persists the scheme the daemon was paired
with (`DaemonMeta.scheme?: 'http' | 'https'`, absent meaning https so existing registry files keep loading) and
reads it at all four reconstruction sites — the registry's remote-target builder plus the re-pair dialog's
locked URL chip, prefilled URL field, and confirm POST target. It also replaces "accept anything, fail later"
with an explicit endpoint policy: plain http is accepted only for loopback (`127.0.0.1`, `localhost`) and
refused everywhere else, checked at the reachability step *before* a pairing code is spent and re-checked at
confirm so a prefilled or pasted URL cannot bypass it. The shell's CSP grows the `localhost` loopback forms the
policy admits. The payoff beyond the bug: a loopback http remote becomes possible, which is what todo #219's two
blocked QA scenarios needed. They are not equally free: the 413 attachment-too-large scenario runs directly on
the loopback http remote, while the 401 auth-failure scenario additionally needs the daemon to classify the app
as a remote caller — loopback callers are never rejected — which QA arranges with a local `X-Forwarded-For`
proxy (task 25).

## Decisions made while planning

These were not spelled out in the brief. Each is a judgment call; flag any you disagree with.

1. **`::1` / `[::1]` is refused like any other non-loopback http host.** The CSP `host-source` grammar cannot
   express an IPv6 literal, so `http://[::1]:*` could not be granted reliably in WKWebView, and admitting a host
   the webview then blocks would just relocate the silent failure the brief exists to kill. The loopback set is
   exactly `127.0.0.1` and `localhost`, and the refusal copy names what *is* accepted.
2. **`localhost` → `127.0.0.1` normalization applies only when the scheme is http.** The PM's call was to
   normalize on persist; doing it unconditionally would rewrite the host of an `https://localhost` endpoint and
   break TLS hostname verification. Scoped to http, it is safe and keeps the existing CSP entry sufficient for
   the live connection.
3. **The existing normalizer test table is extended, not weakened.** `pair-daemon.test.ts` asserts
   `parseRemoteUrl` with `toEqual`, so adding `scheme` to `RemoteUrlParts` requires adding `scheme` to every
   expectation. Same inputs, same host/baseUrl pins, one field added — the http-preservation row keeps pinning
   http preservation.
4. **The refusal message is one exported constant** (`INSECURE_ENDPOINT_MESSAGE` in `endpoint-policy.ts`), read
   by both the step-0 and step-1 notices. Two dialog files are already near the 300-line cap (254 and 253), so
   new copy and mapping live in the policy module rather than being duplicated into markup.
5. **`applyPairing`'s label derivation is left alone.** `host.split('.')[0]` yields the label `"127"` for a
   loopback pairing. Renaming is a rename away in the UI and changing the derivation is scope the brief did not
   ask for; the plan does not touch it.
6. **The shell's `DaemonMeta.scheme` is `Option<String>`, the core-rs mirror gets a typed enum.** Each matches
   its neighbour: the shell struct already carries `kind: String`, the core-rs mirror already carries
   `kind: DaemonKind`.

## Constraints that shape the tasks

- **Serde ignores unknown fields by default.** If the shell's `DaemonMeta` struct lagged the UI, `daemons_upsert`
  would deserialize the payload, silently drop `scheme`, and write it back out missing — the bug would reappear
  as https with no error anywhere. The shell struct change is load-bearing, not parity hygiene.
- **A required new field would erase the registry.** `read_registry` maps a parse failure to "empty registry"
  and only logs. The field must be optional in all three mirrors (Zod, shell struct, core-rs mirror); serde
  deserializes a missing `Option` field as `None` without `#[serde(default)]`, and `skip_serializing_if` keeps
  it out of the file when absent.
- **The CSP only applies to the packaged webview.** `tauri:dev`, vitest and the Playwright harness do not
  enforce it, so the http path must be confirmed in a packaged or preview build.
- **A loopback caller is never rejected, so an http remote on loopback cannot produce a 401 by itself.**
  `auth_middleware` (`packages/core-rs/crates/mainframe-server/src/middleware/auth.rs`, ~L106-115) derives the
  client IP and short-circuits — "Loopback: never rejected" — and the WS upgrade skips auth entirely
  (`websocket.rs:74-79`: `is_ws_auth_required` is false for a loopback IP). The UI reaction todo #219 wants to
  see is driven only by an HTTP 401 (`packages/ui/src/lib/api/http.ts:94` —
  `if (res.status === 401) markAuthFailure(id);`). Daemon auth is out of scope, so QA reaches that state through
  the escape hatch the daemon already honors: `trust_proxy_client_ip` in
  `packages/core-rs/crates/mainframe-server/src/net.rs` accepts `x-forwarded-for` when the raw peer is loopback,
  so a proxy that appends a non-loopback hop makes the daemon treat the app as remote. The 413 needs none of
  this — `RequestBodyLimitLayer` (`http.rs:112-114`, 30 MB) fires before auth for every peer.
- **Repo rules:** max 300 lines per file / 50 per function; `data-testid` on every interactive element as
  `<surface>-<element>` kebab-case; no `@ts-ignore`; a changeset is required before commit.
- **Out of scope** (per the brief): `packages/mobile` (its own todo and PR — do not bump the submodule
  pointer), any daemon-side auth/pairing/token change, tunnel guidance, an E2E test for the http path, and
  anything the re-run QA scenarios uncover.

## Files touched

| File | Change |
|---|---|
| `packages/types/src/host/daemon-target.ts` | `scheme` optional in `DaemonMetaSchema` |
| `packages/types/src/host/__tests__/host-contract.test.ts` | schema table rows for `scheme` |
| `packages/core-rs/crates/mainframe-types/src/host/daemon_target.rs` | `DaemonScheme` enum + optional field + fixtures |
| `packages/app-tauri/src-tauri/src/commands/daemons.rs` | `scheme: Option<String>` + fixtures |
| `packages/ui/src/features/daemon/pair-daemon.ts` | `scheme` on `RemoteUrlParts`, `daemonOrigin()`, policy gates |
| `packages/ui/src/features/daemon/endpoint-policy.ts` | **new** — pure predicate + refusal copy |
| `packages/ui/src/features/daemon/use-daemon-registry.ts` | `buildRemoteTarget` composes from the stored scheme |
| `packages/ui/src/features/daemon/apply-pairing.ts` | persists `scheme`, normalizes loopback host |
| `packages/ui/src/features/daemon/AddRemoteDialog.tsx` | three `https://${target.host}` literals → `daemonOrigin`; refused phase |
| `packages/ui/src/features/daemon/pairing-shared.tsx` | `UrlPhase` gains `refused`; adornment |
| `packages/ui/src/features/daemon/pairing-steps.tsx` | refusal notices in step 0 and step 1 |
| `packages/app-tauri/src-tauri/tauri.conf.json` | `connect-src` gains the localhost loopback forms |
| `packages/ui/src/__tests__/tauri-config.test.ts` | asserts the new CSP entries |
| Test files under `packages/ui/src/features/daemon/__tests__/` | extended and added per task |

No change is needed in `ws-client.ts` or `lsp-client.ts`: both derive `ws`/`wss` by rewriting the leading
`http` of `target.baseUrl`, so they follow the corrected base URL. `isSeededTarget` only rejects port `0`, so a
loopback remote on an explicit port passes unchanged.

---

## Group A — shared schema (`types-scheme`)

### Task 1 — Test: `DaemonMetaSchema` accepts an optional scheme

- File: `packages/types/src/host/__tests__/host-contract.test.ts`
- Add rows to the existing `DaemonMetaSchema` table: accepts `scheme: 'http'`, accepts `scheme: 'https'`,
  accepts a payload with no `scheme` at all (the pre-change shape), rejects `scheme: 'ftp'`.
- Verify: `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/host/__tests__/host-contract.test.ts`
  fails on the two accept-scheme rows (unknown keys are stripped, so the reject row is the red one to watch —
  it must fail before task 2).

### Task 2 — Implement the optional scheme in the Zod schema

- File: `packages/types/src/host/daemon-target.ts`
- Add `scheme: z.enum(['http', 'https']).optional()` to `DaemonMetaSchema`.
- Update the block comment above the schema: `host` is the bare `host[:port]`; `scheme` is the scheme the
  daemon was paired with, and an absent `scheme` means https so pre-change entries keep resolving as before.
- Verify: the task-1 test file passes, then `pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit` and
  `pnpm --filter @qlan-ro/mainframe-types build` (the UI consumes the built output — later groups need it).

---

## Group B — Rust mirrors (`rust-mirrors`)

### Task 3 — Test: core-rs mirror round-trips the optional scheme

- File: `packages/core-rs/crates/mainframe-types/src/host/daemon_target.rs` (`mod tests`)
- Add: (a) a pre-change fixture — the exact JSON already used by `daemon_meta_omits_optionals_and_validates`,
  asserting it deserializes with `scheme: None` and re-serializes byte-identically (no `scheme` key);
  (b) a round-trip of `{"…","scheme":"http"}` → `Some(DaemonScheme::Http)` → same JSON back.
- Verify: `cargo test -p mainframe-types host::daemon_target` from `packages/core-rs` fails to compile
  (`DaemonScheme` does not exist yet). That is the red state.

### Task 4 — Implement the core-rs mirror field

- File: `packages/core-rs/crates/mainframe-types/src/host/daemon_target.rs`
- Add `DaemonScheme { Http, Https }` deriving the same set as `DaemonKind` with
  `#[serde(rename_all = "lowercase")]`; add
  `#[serde(skip_serializing_if = "Option::is_none")] pub scheme: Option<DaemonScheme>` to `DaemonMeta`.
- Fix the existing `daemon_meta_validate_rejects_empty_host` construction (it names every field) and extend the
  `PORT STATUS` footer note: optional `scheme`, absent = https, kept optional so old registry files load.
- Verify: `cargo test -p mainframe-types host::daemon_target` green from `packages/core-rs`.

### Task 5 — Test: the shell registry file carries the scheme and still reads the old shape

- File: `packages/app-tauri/src-tauri/src/commands/daemons.rs` (`mod tests`)
- Add: (a) `read_registry` on a hand-written pre-change file (a two-entry array with no `scheme` key) returns
  both entries with `scheme: None` — this is the "no entry silently vanishes" guarantee; (b) an upsert of a
  meta with `scheme: Some("http")` survives `write_registry` → `read_registry`; (c) the raw JSON of an entry
  with `scheme: None` contains no `scheme` key.
- Leave `registry_contains_no_token_field` untouched; it must keep passing.
- Verify: `cargo test -p app-tauri commands::daemons` from `packages/app-tauri/src-tauri` fails to compile
  (the struct has no `scheme`). Use the crate name from that `Cargo.toml` if it differs.

### Task 6 — Implement the shell struct field

- File: `packages/app-tauri/src-tauri/src/commands/daemons.rs`
- Add `#[serde(skip_serializing_if = "Option::is_none")] pub scheme: Option<String>` to `DaemonMeta`; update
  every test constructor in the file with `scheme: None`.
- One-line rationale comment on the field: serde drops unknown fields silently, so a struct that lags the UI
  would erase the paired scheme on every upsert.
- Verify: `cargo test -p app-tauri commands::daemons` green; `cargo check` clean from
  `packages/app-tauri/src-tauri`.

---

## Group C — URL parsing and the endpoint policy (`url-policy-core`)

### Task 7 — Test: `parseRemoteUrl` reports the scheme

- File: `packages/ui/src/features/daemon/__tests__/pair-daemon.test.ts`
- Extend the existing `parseRemoteUrl` table: add `scheme` to all six expectations (`'https'` except the
  `http://h:31600` row, which is `'http'`). Do not change any input or any existing `host`/`baseUrl` pin.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/daemon/__tests__/pair-daemon.test.ts`
  — all six rows fail on the missing field.

### Task 8 — Implement `scheme` on `RemoteUrlParts` and add `daemonOrigin`

- File: `packages/ui/src/features/daemon/pair-daemon.ts`
- Add `scheme: 'http' | 'https'` to `RemoteUrlParts`, returned from `u.protocol` (strip the trailing colon).
- Add `export function daemonOrigin(meta: Pick<DaemonMeta, 'host' | 'scheme'>): string` returning
  `` `${meta.scheme ?? 'https'}://${meta.host}` `` — the single place that encodes "absent means https".
- Update the doc comment to mention both.
- Verify: task-7 file green; `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### Task 9 — Test: the endpoint policy predicate

- File: `packages/ui/src/features/daemon/__tests__/endpoint-policy.test.ts` (new)
- Table over `checkEndpointPolicy(url: string)`:
  `http://127.0.0.1:31500` allowed · `http://localhost:31500` allowed · `HTTP://LocalHost:31500` allowed
  (case-insensitive) · `http://192.168.1.10:31415` refused `'insecure-host'` · `http://box.example.com` refused ·
  `http://[::1]:31500` refused (see decision 1) · `https://tunnel.example.com` allowed ·
  `tunnel.example.com` (no scheme) allowed and parsed as https · `not a url ##` refused `'invalid-url'`.
- Assert the allowed results carry the parsed `RemoteUrlParts`, and that `INSECURE_ENDPOINT_MESSAGE` is a
  non-empty string naming both `127.0.0.1` and `localhost`.
- Verify: the file fails to resolve `../endpoint-policy`.

### Task 10 — Implement `endpoint-policy.ts`

- File: `packages/ui/src/features/daemon/endpoint-policy.ts` (new, pure — no React, no fetch)
- Export:
  - `const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost']` (hostname compare, case-insensitive, any port);
  - `type EndpointRefusal = 'invalid-url' | 'insecure-host'`;
  - `type EndpointPolicyResult = { allowed: true; parts: RemoteUrlParts } | { allowed: false; reason: EndpointRefusal }`;
  - `function checkEndpointPolicy(url: string): EndpointPolicyResult` — parses via `parseRemoteUrl` (a throw
    maps to `'invalid-url'`), allows any https, allows http only when the hostname is in `LOOPBACK_HOSTS`;
  - `const INSECURE_ENDPOINT_MESSAGE` — the single refusal string, run through the
    `writing-clearly-and-concisely` skill. Proposed text: *"Plain http works only on this machine (127.0.0.1 or
    localhost). Use an https URL for any other server."*
  - `function loopbackCanonicalHost(parts: RemoteUrlParts): string` — returns `parts.host` with a `localhost`
    hostname rewritten to `127.0.0.1` **only when `parts.scheme === 'http'`** (decision 2), port preserved.
- Verify: task-9 file green; `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### Task 11 — Test: verify and confirm both enforce the policy

- File: `packages/ui/src/features/daemon/__tests__/pair-daemon.test.ts`
- Add: `verifyDaemon('http://192.168.1.10:31415')` resolves `{ ok: false, reason: 'refused-insecure' }` and
  `fetch` was never called; `verifyDaemon('http://127.0.0.1:31500')` still fetches
  `http://127.0.0.1:31500/health`; an unreachable https URL resolves `{ ok: false, reason: 'unreachable' }`;
  `confirmPairing('http://box.example.com', …)` rejects with `PairingError` `kind: 'insecure'` and no `fetch`.
- **Migrate the existing `verifyDaemon` assertions in the same edit**, or task 12 leaves the group red on
  typecheck: lines 53-55 and 63-64 read `result.version` / `result.ms` off a bare `result`, which stops
  compiling once `VerifyResult` becomes a union (TS2339 on the `{ ok: false }` arm), and
  `pnpm --filter @qlan-ro/mainframe-ui typecheck` includes tests. Rewrite them to narrow first — keep
  `expect(result.ok).toBe(true)`, then assert `version`/`ms` inside `if (result.ok) { … }`. Delete the two
  `toBeUndefined()` lines at 73-74 outright; the new `reason: 'unreachable'` case above owns that coverage.
  Both rewrites compile against the current implementation, so the red set stays exactly the four new cases.
  Nothing else in the suite needs touching: line 232 asserts only `result.ok`, and the `vi.fn()` mocks in
  `AddRemoteDialog-retoken.test.tsx` and `DaemonSwitcher.needs-repair.test.tsx` are untyped.
- Verify: the four new cases fail; the five migrated assertions still pass.

### Task 12 — Implement the gates in `verifyDaemon` and `confirmPairing`

- File: `packages/ui/src/features/daemon/pair-daemon.ts`
- `VerifyResult` becomes a discriminated union:
  `{ ok: true; version?: string; ms?: number } | { ok: false; reason: 'refused-insecure' | 'unreachable' }`.
  Both functions call `checkEndpointPolicy` first and use its returned `parts` instead of re-parsing.
  `checkEndpointPolicy`'s `'invalid-url'` maps to `reason: 'unreachable'` — the union has no arm for it, and
  that preserves today's behavior, where an unparseable URL returns `{ ok: false }` and the dialog shows the
  unreachable notice.
- `PairingErrorKind` gains `'insecure'`, with `INSECURE_ENDPOINT_MESSAGE` as the error message.
- Keep each function under 50 lines; if `verifyDaemon` grows past it, split the fetch into a private helper.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/daemon/__tests__/pair-daemon.test.ts`
  and `.../endpoint-policy.test.ts` green; `pnpm --filter @qlan-ro/mainframe-ui typecheck` clean — the union's
  only production consumer, `AddRemoteDialog.tsx:162-168`, already branches on `if (result.ok)` and narrows
  cleanly, and task 11 carried the test-assertion migration. Group C ends green on its own.

---

## Group D — registry and pairing dialog (`registry-dialog-ui`)

### Task 13 — Test: the remote target honors the stored scheme

- File: `packages/ui/src/features/daemon/__tests__/use-daemon-registry.test.tsx`
- Add cases against the existing harness: a remote with `scheme: 'http'` and `host: '127.0.0.1:31500'` resolves
  `target.baseUrl === 'http://127.0.0.1:31500'`; a remote with no `scheme` still resolves
  `https://studio.example.com` (the existing assertion stays as the legacy-shape pin); the derived socket URL
  for the http entry starts with `ws://` (assert via the same `new URL(target.baseUrl)` derivation the file
  already uses at its port-derivation test, plus the `replace(/^http/, 'ws')` rule).
- Verify: the http case fails with an `https://` base URL.

### Task 14 — Implement `buildRemoteTarget` from the stored scheme

- File: `packages/ui/src/features/daemon/use-daemon-registry.ts`
- Replace `parseRemoteUrl(\`https://${meta.host}\`)` with `parseRemoteUrl(daemonOrigin(meta))`, importing
  `daemonOrigin` from `./pair-daemon`.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/daemon/__tests__/use-daemon-registry.test.tsx`
  green.

### Task 15 — Test: pairing persists the scheme and canonicalizes loopback

- File: `packages/ui/src/features/daemon/__tests__/apply-pairing.test.ts` (new)
- Cases: pairing `http://localhost:31500` persists `{ host: '127.0.0.1:31500', scheme: 'http' }`; pairing
  `http://127.0.0.1:31500` persists the same; pairing `https://tunnel.example.com` persists
  `{ host: 'tunnel.example.com', scheme: 'https' }`; pairing `https://localhost:8443` keeps the host
  `localhost:8443` (decision 2); repair mode still writes no meta and calls `setToken` + `retoken`.
- Verify: the loopback and scheme cases fail.

### Task 16 — Implement scheme persistence in `applyPairing`

- File: `packages/ui/src/features/daemon/apply-pairing.ts`
- Parse once, write `host: loopbackCanonicalHost(parts)` and `scheme: parts.scheme` into the new `DaemonMeta`.
- Leave the label derivation untouched (decision 5).
- Verify: task-15 file green.

### Task 17 — Test: re-pair displays and posts the stored scheme

- File: `packages/ui/src/features/daemon/__tests__/AddRemoteDialog.test.tsx`
- Add a repair-mode case with a target carrying `scheme: 'http'`, `host: '127.0.0.1:31500'`: the locked URL chip
  renders `http://127.0.0.1:31500`, and the confirm POST goes to `http://127.0.0.1:31500/api/auth/confirm`
  (assert on the `fetch` spy). Add a repair-mode case with no `scheme` that still shows and posts `https://`.
- Verify: the http case fails on both the chip text and the POST URL.

### Task 18 — Implement the three re-pair sites

- File: `packages/ui/src/features/daemon/AddRemoteDialog.tsx`
- Replace all three `https://${target.host}` literals (`lockedUrl`, `initialUrl`, `handleConfirm`'s `targetUrl`)
  with `daemonOrigin(target)`.
- Update `handleVerify` for the new `VerifyResult` union: `reason === 'refused-insecure'` → `setUrlPhase('refused')`,
  `'unreachable'` → the existing unreachable phase.
- In `handleConfirm`, map a caught `PairingError` with `kind: 'insecure'` to the new step-1 refusal phase
  (`'insecure'`) rather than `'unreachable'`.
- Keep the file under 300 lines — extract the phase mapping into a small module-level helper if needed.
- Verify: task-17 file green; `pnpm --filter @qlan-ro/mainframe-ui typecheck`.

### Task 19 — Test: the refusal states render with testids

- File: `packages/ui/src/features/daemon/__tests__/pairing-steps.test.tsx`
- Step 0 with `phase="refused"`: a notice with `data-testid="daemon-add-insecure"` renders
  `INSECURE_ENDPOINT_MESSAGE`, the `daemon-add-unreachable` notice is absent, and the footer still shows
  `daemon-add-verify` (never `daemon-add-continue`) so no pairing code can be requested.
- Step 1 with `phase="insecure"`: a notice with `data-testid="daemon-pair-insecure"` renders the same message.
- Verify: both cases fail (the phases do not exist).

### Task 20 — Implement the refusal UI

- Files: `packages/ui/src/features/daemon/pairing-shared.tsx`, `packages/ui/src/features/daemon/pairing-steps.tsx`
- `UrlPhase` gains `'refused'`; `UrlAdornment` renders the destructive alert icon for it (same treatment as
  `unreachable`).
- `Step1Phase` gains `'insecure'`.
- `Step0Body` renders an error `NoticeCard` with `testId="daemon-add-insecure"` and no Retry action (retrying
  the same URL cannot succeed — the user must change it); `Step1Body` renders one with
  `testId="daemon-pair-insecure"`. Both read `INSECURE_ENDPOINT_MESSAGE`; do not restate the copy inline.
- `FooterStep1` treats `'insecure'` like `'invalid'` for button enablement (Confirm stays clickable after the
  user re-pairs a corrected entry; nothing else changes).
- Verify: task-19 file green, plus
  `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/daemon/__tests__/AddRemoteDialog.test.tsx`
  and `.../AddRemoteDialog-retoken.test.tsx` and `.../DaemonSwitcher.needs-repair.test.tsx` still green.

---

## Group E — webview CSP (`csp-config`)

### Task 21 — Test: the CSP admits every loopback form the policy allows

- File: `packages/ui/src/__tests__/tauri-config.test.ts`
- Extend `allows loopback daemon ports configured at runtime` with `http://localhost:*` and `ws://localhost:*`
  alongside the existing `127.0.0.1` assertions, and add a comment tying the list to `LOOPBACK_HOSTS` in
  `endpoint-policy.ts` so the two never drift.
- Verify: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/__tests__/tauri-config.test.ts` fails on the
  two new entries.

### Task 22 — Implement the CSP change

- File: `packages/app-tauri/src-tauri/tauri.conf.json`
- `connect-src` becomes
  `'self' http://127.0.0.1:* ws://127.0.0.1:* http://localhost:* ws://localhost:* https: wss:`. Nothing else in
  the policy changes; no wildcard http host is added.
- Verify: task-21 file green.

---

## Group F — verification, changeset, QA (`qa-verification`)

### Task 23 — Full static and unit verification

- `pnpm --filter @qlan-ro/mainframe-types exec tsc --noEmit` and `pnpm --filter @qlan-ro/mainframe-types build`
- `pnpm --filter @qlan-ro/mainframe-ui typecheck` (it includes tests)
- Every touched UI suite, run file by file (batched runs hit the cross-file `React.act` failure):
  `pair-daemon.test.ts`, `endpoint-policy.test.ts`, `apply-pairing.test.ts`, `use-daemon-registry.test.tsx`,
  `AddRemoteDialog.test.tsx`, `AddRemoteDialog-retoken.test.tsx`, `pairing-steps.test.tsx`,
  `DaemonSwitcher.needs-repair.test.tsx`, `src/__tests__/tauri-config.test.ts`
- `pnpm --filter @qlan-ro/mainframe-types exec vitest run src/host/__tests__/host-contract.test.ts`
- `cargo check` and `cargo test -p app-tauri commands::daemons` from `packages/app-tauri/src-tauri`
- `cargo test -p mainframe-types host::daemon_target` from `packages/core-rs`

### Task 24 — Changeset

- `pnpm changeset` — patch for `@qlan-ro/mainframe-ui`, `@qlan-ro/mainframe-types` and
  `@qlan-ro/mainframe-app-tauri` (bugfix: remote daemons paired over http now connect over http). Commit it
  with the implementation.

### Task 25 — Packaged-build QA: the http remote, the refusal, and the 413 scenario

The webview CSP is not enforced by `tauri:dev`, vitest or the Playwright harness, so this runs against a
packaged or preview build.

- Start a second daemon on its own port and its own `MAINFRAME_DATA_DIR` (never touch `:31415` or
  `~/.mainframe` — the production app the session runs inside owns them).
- Pair it at `http://127.0.0.1:<port>`, then confirm: the registry entry resolves to that http origin, the
  WebSocket connects over `ws://` carrying the bearer token, daemon switching works, and the entry survives a
  restart.
- Confirm the refusal: verifying `http://<LAN-ip>:<port>` shows the `daemon-add-insecure` notice and does not
  advance to the code step.
- Run todo #219's scenario (b), the 413 attachment-too-large copy, against this remote. It needs nothing
  special: the 30 MB `RequestBodyLimitLayer` (`http.rs:112-114`) sits outside auth and answers every peer.
- Report the outcome on todo #305; file anything it uncovers as a separate todo (fixing it is out of scope).

### Task 26 — Packaged-build QA: the 401 auth-failure scenario behind an `X-Forwarded-For` proxy

Scenario (a) cannot be produced by a plain loopback remote — see the loopback-bypass constraint above. The
daemon does treat the app as remote when a trusted loopback peer forwards a non-loopback hop, so QA inserts one.
**This is a manual QA rig, not a durable harness**: it rides the `x-forwarded-for` trust that the open security
audit already tracks (`docs/security/2026-07-11-security-audit.md`), so it is written ad hoc, used once, and not
committed.

- Put a small local forward proxy on `127.0.0.1:<proxyPort>` in front of the task-25 QA daemon. It must append a
  non-loopback `X-Forwarded-For` (e.g. `203.0.113.7`) to HTTP requests **and** to the WebSocket upgrade — the
  upgrade path reads the header separately (`websocket.rs`, `client_ip`). Verify the classification with
  `curl -H 'X-Forwarded-For: 203.0.113.7' http://127.0.0.1:<proxyPort>/api/projects` before involving the app:
  no bearer token must now yield a 401, where the same call straight to the daemon port returns 200.
- Pair the app at `http://127.0.0.1:<proxyPort>` (a second registry entry — expected). Pairing itself still
  works through the proxy: `/api/auth/confirm`, `/api/auth/status` and `/api/auth/pair-status` are in
  `UNAUTHENTICATED_PATHS`, so they never reach the IP check.
- With the app connected through the proxy, revoke the paired device on the QA daemon (use its isolated data
  dir — whatever revocation surface exists, or delete the device record). The next request 401s through the
  app's real http path, which is exactly what `markAuthFailure` keys on.
- Observe and record the reaction: composer restore, the error copy, and the needs-repair footer.
- If the proxy route does not come up (upgrade not forwarded, revocation surface missing, or the app never
  reaches a 401), stop rather than improvising a daemon-side change — auth is out of scope. Report the specific
  blocker on todo #305 and file a follow-up to cover the 401 reaction another way.
- Either branch closes this task: the 401 reaction is observed and reported, or the blocker is reported and the
  follow-up filed.

---

## Acceptance-criteria trace

| Criterion (todo #305) | Tasks |
|---|---|
| http pairing yields an http base URL and a `ws://` socket | 8, 14, 16, 13, 25 |
| https pairing unchanged | 13, 17, 23 |
| Pre-change registry file still loads in TS and Rust | 1, 3, 5, 13 |
| Non-loopback http refused at verify, no code consumed, kebab testid | 9, 11, 19, 20 |
| Same policy enforced at confirm | 11, 12, 18 |
| Re-pair displays and posts http | 17, 18 |
| Unit tests: scheme round-trip + policy table; normalizer test still passes | 7, 9, 13, 15 |
| Rust tests: optional field round-trip, no-token assertion intact | 3, 4, 5, 6 |
| CSP permits every admitted loopback form; config test extended | 21, 22 |
| Todo #219's two scenarios run for real | 25 (413, directly), 26 (401, via the `X-Forwarded-For` proxy) |
| Typecheck, touched suites, `cargo check`, changeset | 23, 24 |
