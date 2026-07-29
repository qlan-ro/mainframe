# Implementation plan — #281 URL tabs: rework the tunnel-ownership state machine

**Spec:** [`docs/specs/2026-07-28-todo-281-preview-open-urls.md`](../specs/2026-07-28-todo-281-preview-open-urls.md) — the
contract at stake is **D10** (stop a tunnel on close only when this tab started it and no other URL tab
uses that port) and **AC12** (closing an exclusively-started tab stops the tunnel; an adopted or shared
one stays up).
**Branch:** `todo/281-preview-open-urls` · **Worktree:** `.worktrees/todo-281-preview-open-urls` · **HEAD when written:** `fadec137`
**Packages:** `@qlan-ro/mainframe-ui` only. No file under `packages/core-rs`, `packages/types`,
`packages/mobile`, or `packages/app-tauri/src-tauri` changes.

## Goal

Every user-visible part of #281 is built, tested, and committed (see *Landed work*). What is not settled is
the one piece of state behind AC12: whether a URL tab may stop the port tunnel it is looking at. Four review
rounds each patched that decision at a different call site, and each patch opened an adjacent hole, because
the decision has never had a model — it is spread across a `useState`, two refs, three effects, and a
promise callback, and it reads *client-produced* signals as if they were daemon truth. This plan replaces
that scatter with one explicit, pure state machine: a claim keyed by `(daemon, port)`, moved only by signals
that actually say something about what the daemon holds, with the watchdog, the resolved target, and
client-written error entries excluded by construction. The five ownership cases the four fix commits
defended stay green, and the two defects round 5 found are closed by the model rather than by another guard.

## Landed work — do NOT redo any of it

Every commit below is on this branch and needs no re-implementation. The implement stage re-enters at
**Group A** of this plan.

| Stage | Commits | Result |
|---|---|---|
| Spec | `ea663a48`, `59f697d9`, `cc4ebffd` | `docs/specs/2026-07-28-todo-281-preview-open-urls.md` |
| Plans | `687adebe`, `f61fb193`, `917d501b`, `8968443d` | this file and its predecessor |
| Red-phase pure tests | `736c6677`, `208df5cf`, `ee9a31a0`, `76288d95`, `be9e800d`, `114b4f56` | normalizer, tab model, persistence, store DNS flag, target resolution, ownership registry |
| Core (UI logic) | `22134eaa`, `fc64cfae`, `27e5fad2`, `d4c25ed0`, `a598b031`, `18b03c1e`, `3c4e6026`, `1c8c6476`, `af6c0e62` | `url` tab kind, dedup, persistence, `dnsVerified`, `resolve-url-target.ts`, `layout-placement.ts`, the ownership registry, `setUrlTabTarget`, **the changeset** |
| Rust | `a129e0de` | `capabilities/preview.json` widened + three `bridge_plugin.rs` tests |
| UI tab | `9d5bb5b7`, `67e5586b`, `df82a058`, `06467698`, `b6fd61c2`, `8289641b` | mount extraction, address bar, `use-url-tab-tunnel.ts`, body states, toolbar, instance, the `RunSurface` arm |
| UI entry points | `62d4498c`, `9858d7d0`, `a991b9cf`, `09527a40`, `fe3da1bd` | intent + subscriber, `RunUrlEntry`, `+` menu row, picker row, chip menu |
| Behavioural coverage (Groups A–F of the previous plan) | `0397ed01`, `32841dc7`, `8c18c340`, `acbc3771`, `dece270c`, `f2dcd072` | `RunSurface.url-tab`, `UrlTabBodyState`, entry points, toolbar/address bar, store creation + release, tunnel adoption/retry/DNS |
| Ownership fixes, rounds 1–4 | `68d1f1fd`, `16186c63`, `2dfc073c`, `fadec137` | the four point fixes this plan consolidates |

**`.changeset/preview-open-urls.md` already exists (`af6c0e62`). Do not add a second changeset.** This rework
is a correction inside the same unreleased feature; the existing entry covers it.

## The two defects this rework must close

Round 5, verbatim in the lane result, both in
`packages/ui/src/features/url-tab/use-url-tab-tunnel.ts`:

1. **`:130-136`** — the start POST's `.catch` revokes ownership without the `attemptRef.current === at`
   guard the `.then` at `:127` carries. A hung attempt-1 POST that rejects after attempt 2 has succeeded
   nulls attempt 2's live claim; `releaseUrlTunnelConsumers` then issues no stop and cloudflared leaks.
2. **`:144-146`** — the disown effect keys off `target.kind === 'failed'`, which the 120 s watchdog also
   produces. The daemon is still holding this tab's tunnel; the claim is dropped anyway; the tunnel comes up
   seconds later, the tab loads, the user never retries, and nothing re-claims. Same leak, different path.

**The reviewer's reading is confirmed by the code.** `UrlTabTarget.failed` has exactly two producers —
`resolve-url-target.ts:56` (`entry.state === 'error'`) and `:62` (`timedOut`, a client timer) — and the spec
makes the second one explicitly non-terminal: D11 calls the 120 s watchdog "non-terminal" and AC9 requires
that "a URL that arrives after the failure body replaces it with the loaded page, with no user action". A
signal the spec defines as non-terminal cannot be evidence that the daemon holds nothing.

**Do not implement the two point fixes the reviewer proposed.** They are locally correct and were the
fifth round of the same move. The ruling is that the model is underspecified; fix the model.

## The actual state space

### What a claim means

A claim is this tab's evidence that **the daemon currently holds a tunnel, on this daemon, on this port,
that this tab caused to exist**. It is the only input to `started` in
`registerUrlTunnelConsumer(tabId, { port, started, daemonHttpPort })`, and `started` is the only thing that
lets `releaseConsumers` stop a tunnel.

Creation evidence is a client-side inference: the daemon's `POST /api/tunnel/ports/start`
(`packages/core-rs/crates/mainframe-server/src/routes/tunnel_ports.rs:39`) answers `{ url, port }`
identically whether it created the tunnel or joined an existing one, and any daemon change is `declined` by
the spec. So "this tab created it" means **the store held no entry for the port at the moment this tab's
start POST went out** — the same inference the landed code makes, now stated once instead of implied in
three places.

### The signals, and which of them are authoritative

| Signal | Source | Authoritative about "the daemon holds this tab's tunnel"? |
|---|---|---|
| Start POST issued while `byPort[port] === undefined` | client inference over daemon state | **Yes** — the only creation evidence available |
| Start POST resolves `{ url }` | daemon | **No** — identical for a joined tunnel; presentation only (`flags.startUrl`) |
| Start POST rejects **with a daemon-reported failure** | daemon | **Yes, for its own attempt only** — the daemon removes the entry and stops the child on its own error paths (`port_tunnel_registry.rs:139-146`), so nothing was created for that request |
| Start POST rejects **at transport level** (daemon killed, socket dropped) | neither | **No** — a tunnel may well exist. `startPortTunnel` throws a bare `Error` (`lib/api/tunnel-ports.ts:24-28`), so the two are indistinguishable today; see *Risks* |
| `entry.state === 'starting' \| 'ready'` | daemon (`tunnel:status`, REST seed) | **Yes** — a tunnel exists on the port |
| `entry.state === 'error'` written by `applyPortTunnelEvent` | daemon | **Yes** — the daemon holds no live tunnel on the port |
| `entry.state === 'error'` written by a **rejected client start POST** | client | **No** — see below; the third producer the model must not confuse with the daemon |
| `entry === undefined` *after* an entry was seen | daemon (`stopped` → `clearEntry`) | **Yes** — the tunnel is gone |
| `entry === undefined` with none ever seen | nothing | **No** — the start may still be in flight |
| `clearPortTunnelEntry(port)` from `retry()`, **when it actually clears** | client | **No** — a local presentation reset; the daemon was told nothing |
| `timedOut` (the 120 s watchdog) | client timer | **No** — D11 non-terminal, AC9 requires recovery |
| `target.kind` (any value) | derived | **No** — a projection that folds locality, daemon-port availability, URL validity, port eligibility, the watchdog and the attempt flags together with the entry |
| Committed URL's port changes (retarget), or becomes `null` | user | **Yes about abandonment** — this tab stops being a consumer of the old port |
| Daemon switch (`httpPort` changes) | user | **Yes about abandonment** — a claim is against one daemon |
| Close / pane close / scope release / Run hidden | layout store | Outside the machine — handled by `releaseUrlTunnelConsumers` |

**An `error` entry has three producers, only one of them the daemon.** `reportPortTunnelError`
(`store/port-tunnels.ts:116`) is called by `applyPortTunnelEvent` (`:159`, daemon), by this hook's `.catch`
(`use-url-tab-tunnel.ts:135`, client), and by the **chat chip's** `.catch`
(`features/chat/smart-actions/use-url-tunnel.ts:85`, client). It refuses to overwrite only a `ready` entry
(`:117`), so while this tab's tunnel is `starting`, a chip's rejected start POST on the same port writes
`error`, and a model that reads `error` as daemon truth revokes a live claim — defect 2's failure mode
through a different door. A client-written error entry therefore has to carry a marker, and only unmarked
(daemon-sourced) errors may move the claim. Note the reverse case is now merely cosmetic: a foreign client
error can still flip *this* tab's body to `failed` while its own tunnel is `starting`, but AC9's
late-URL recovery replaces that body when the tunnel comes up, and the claim never moves.

### States and transitions

Three states. `sawEntry` exists only to tell "gone" from "not there yet".

- `null` — unclaimed.
- `{ httpPort, port, attempt, sawEntry: false }` — a start was issued for a port the store showed empty; the
  daemon has not yet been observed holding anything.
- `{ httpPort, port, attempt, sawEntry: true }` — the daemon has been observed holding a tunnel on the port
  since this claim was made.

| Signal | Matching claim (`httpPort` + `port` equal) | No matching claim |
|---|---|---|
| `rebind { httpPort, port }` | keep | drop any non-matching claim |
| `start-issued { attempt, entryExisted }` | `{ ...claim, attempt, sawEntry: entryExisted }` — an owner survives Retry (D10) | `entryExisted ? null : { httpPort, port, attempt, sawEntry: false }` — either way a stale other-port claim is dropped |
| `start-rejected { attempt }` | `claim.attempt === attempt ? null : claim` — **defect 1** | unchanged |
| `daemon-state 'starting' \| 'ready'` | `{ ...claim, sawEntry: true }` | unchanged |
| `daemon-state 'error'` | `null` | unchanged |
| `daemon-state 'absent'` | `claim.sawEntry ? null : claim` | unchanged |
| `daemon-state 'unknown'` (an entry exists, written by a client) | unchanged | unchanged |
| `local-clear` | `{ ...claim, sawEntry: false }` | unchanged |

There is no timeout signal in the union — **defect 2 is closed by the type**, not by a condition.

Four consequences to state, not to discover later:

- **`claim.sawEntry` and `AttemptFlags.everHadEntry` stay separate.** They look alike and are not: `everHadEntry`
  is per *attempt* and drives the `stopped` presentation body (D14); `sawEntry` is per *claim* and survives
  Retry. Merging them re-creates the presentation/truth conflation this rework removes.
- **`local-clear` is dispatched only when `clearPortTunnelEntry` actually cleared.** It is why Retry never
  blinks: without it the entry-observation effect reads the local clear as `absent` after `sawEntry`,
  revokes, and only re-claims a render later — a window in which a close would leak the tunnel. But
  `clearPortTunnelEntry` no-ops on a `ready` entry (`store/port-tunnels.ts:99`), and Retry **is** reachable
  with one: `resolveEntryTarget` returns `failed` on `timedOut` whenever a `ready` entry carries no URL and
  the gate is closed (`resolve-url-target.ts:58-62`). Dispatching `local-clear` unconditionally would zero
  `sawEntry` while the daemon still holds the tunnel, so a later real `stopped` would not revoke — and the
  next foreign tunnel on that port would be stopped by this tab.
- **The claim is keyed by `(httpPort, port)`**, which states the invariant that a claim is against one
  daemon. Today's `ownedPort` does not carry it; in practice `disposeDaemonSession` drives a keyed remount,
  so the reducer state goes away on a switch regardless — the field makes the rule explicit rather than
  incidental.
- **Signal order inside a commit is pinned, and the table does not depend on it.** `useTunnelClaim` is
  called before `useTunnelAttempt`, so its `rebind`/`daemon-state` effects are registered — and therefore
  run — ahead of the same commit's `start-issued`; and `start-issued` drops a non-matching claim in both
  branches, so the reducer is correct even if that ordering is ever disturbed.

### Ordering rules that must survive the rewrite

- **Registration reads the claim against this render's port.** On the render where `port` flips, the claim
  still names the old port, so `started` computes `false` immediately — this is `16186c63`'s stale-proof
  property. Do not "fix" it by dispatching `rebind` before the render; the release of the abandoned port is
  `addConsumer`'s job and is already correct.
- **The `.catch` keeps an attempt guard as well.** The reducer's attempt check protects the claim; the guard
  protects `reportPortTunnelError` from writing a stale attempt's error over the live attempt's state. They
  cover different concerns, and with error provenance in place the reducer is genuinely correct without the
  guard — Task 2's pure test proves it.

## The five ownership cases that must stay green

All five live in `packages/ui/src/features/url-tab/__tests__/UrlTabInstance.tunnel-retarget-ownership.test.tsx`
and run the **real** consumer registry with only `startPortTunnel`/`stopPortTunnel` mocked. Enumerated from
the file, not from the commit messages:

1. *"retarget onto an already-tunnelled port never adopts as owner"* — retarget 5173 → 4000 stops 5173 and
   never stops 4000 on release (`68d1f1fd`, `16186c63`).
2. *"an externally-restarted tunnel on the owned port is never this tab's to stop"* — owned entry goes
   `ready`, then disappears, then someone else's `ready` lands; release stops nothing (`2dfc073c`).
3. *"a port abandoned via retarget is never re-adopted as owned on return"* — retarget away, a foreign tunnel
   appears, retarget back; release stops nothing (`2dfc073c`).
4. *"a start POST that itself fails never leaves this tab owning the port"* — the POST rejects, the chip
   starts its own tunnel; release stops nothing (`fadec137`).
5. *"a live tunnel that dies with a daemon-side error is never this tab's to stop once restarted"* — entry
   goes `error`, someone else restarts; release stops nothing (`fadec137`).

Case 5 writes its `error` entry with a raw `usePortTunnelsStore.setState`, i.e. with no provenance marker at
all — **which is why a daemon error must carry no marker.** Provenance is recorded as the *exception*
(`errorOrigin: 'client'`), so an unmarked error entry, from the daemon or from a raw test `setState`, keeps
revoking claims and case 5 stays green for the right reason. Marking daemon errors instead would both invert
this default and break three `toEqual` assertions in the store's own suite (Task 1).

Two more, in `__tests__/UrlTabInstance.tunnel.test.tsx`, pin the positive side and must also stay green:
*"a fresh start owns the tunnel"* (`started: true`) and *"adopting a mid-start tunnel issues its own start
but does not own it"* (`started: false`).

The pure registry tests in `__tests__/url-tunnel-ownership.test.ts` stay green untouched — `addConsumer`,
`releaseConsumers`, and `clearConsumers` keep their current semantics. **This rework changes no behaviour in
`url-tunnel-ownership.ts`.**

## Constraints

- Max **300 lines/file**, 50 lines/function. `UrlTabInstance.tunnel-retarget-ownership.test.tsx` is already
  262 lines, so the new regressions go in a **new sibling file** — appending would breach the limit.
- Tests sit in `__tests__/` beside their subject. `.test.tsx` runs under jsdom, `.test.ts` under node. A
  non-`*.test.*` helper file in `__tests__/` is **not** collected by either project (`vitest.config.ts`
  includes only `src/**/*.test.tsx` and `src/**/*.test.ts`), so a shared harness is safe there.
- Run single files: `pnpm --filter @qlan-ro/mainframe-ui exec vitest run <file>`. Large batches hit the known
  cross-file `React.act` failure.
- No `@ts-ignore`, no silent catches, no dead code left behind; comments say *why*.
- `vi.mock(...)` calls are hoisted per module — they **cannot** move into a shared harness. Only the handle
  stub, host setup, store seeding, and the render wrapper can.

---

## Group A — `claim-model`

**kind:** ui · **parallel_safe:** yes (no file overlaps another group) · **depends_on:** —

### Task 1 — Give an error entry its provenance

**Files (edited):** `packages/ui/src/store/port-tunnels.ts`,
`packages/ui/src/store/__tests__/port-tunnels.test.ts`

Write the two store cases first (they fail), then make them pass:

- `PortTunnelEntry` gains `errorOrigin?: 'client'` — a marker, not an enum, documented as "set only when a
  client `.catch` wrote this `error`; its absence means the daemon did, and only a daemon-sourced error is
  evidence about what the daemon holds".
- `reportPortTunnelError(port, message, origin: 'daemon' | 'client' = 'daemon')` writes the key **only when
  `origin === 'client'`**. A daemon-origin error must keep producing the exact entry it produces today —
  `{ state: 'error', error }` and nothing more — because `store/__tests__/port-tunnels.test.ts` asserts whole
  error entries with `toEqual` in three places (`:80`, `:85`, `:248`), and stamping `errorOrigin: 'daemon'`
  on every error would break all three. Those assertions are the contract; do not relax them.
- New cases: a client-origin call stores `errorOrigin: 'client'`; a daemon-origin call stores **no such key**
  (`expect(entry).toEqual({ state: 'error', error: … })`). Everything else in that file — the `ready`
  no-downgrade guard (`:117`), the 1 s toast dedupe — is unchanged, and its existing cases must stay green.
- The doc comment on `reportPortTunnelError` states the invariant for future callers: **the default is
  `'daemon'`, so any new client-side `.catch` caller must pass `'client'` explicitly.** A client error that
  silently defaults to daemon origin revokes live claims — the exact conflation this rework removes.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/store/__tests__/port-tunnels.test.ts` green.

### Task 2 — Red: the claim reducer's state table

**File (new):** `packages/ui/src/features/url-tab/__tests__/tunnel-claim.test.ts` (node env)

Write the transition table above as tests against a module that does not exist yet; it fails to resolve,
which is the red phase. One case per row, plus the sequences that matter:

- `start-issued` with `entryExisted: false` and no claim creates `{ httpPort, port, attempt, sawEntry: false }`;
  with `entryExisted: true` it creates nothing.
- `start-issued` on an existing matching claim keeps it and rebinds `attempt` (D10 across Retry).
- `start-issued` for port B while a claim names port A returns `null` — in both `entryExisted` branches, so
  the table holds independently of effect ordering.
- `start-rejected` with `claim.attempt === attempt` revokes; **with a lower `attempt` it does not** — the
  round-5 defect 1 sequence at the model level: issue attempt 0, `local-clear`, issue attempt 1, observe
  `ready`, then reject attempt 0 → the claim survives with `sawEntry: true`.
- `daemon-state 'error'` revokes; `'absent'` revokes only after `sawEntry`; `'absent'` before any entry keeps
  the claim; `'starting'`/`'ready'` set `sawEntry`.
- `daemon-state 'unknown'` is a no-op in every state, and `entryDaemonState({ state: 'error', errorOrigin: 'client' })`
  returns `'unknown'` while an unmarked `{ state: 'error' }` returns `'error'`. Name the case for what it
  defends: a chip's rejected start POST must not revoke this tab's live claim.
- `local-clear` clears `sawEntry` and keeps the claim; a following `'absent'` therefore does not revoke.
- `rebind` to a different `port` or a different `httpPort` drops the claim; to the same pair keeps it.
- Every signal for a non-matching `(httpPort, port)` that the table calls "unchanged" returns the **same
  reference**.
- `claimOwns(null, …)` is false; `claimOwns(claim, httpPort, port)` is true only on an exact match.
- `entryDaemonState(undefined) === 'absent'`; `'starting'` and `'ready'` map to themselves.
- **No watchdog case exists** — add a comment stating that defect 2 is closed by the signal union having no
  timeout member, so a future reader does not add one.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/url-tab/__tests__/tunnel-claim.test.ts`
fails with an unresolved import of `../tunnel-claim`.

### Task 3 — Green: the pure reducer

**File (new):** `packages/ui/src/features/url-tab/tunnel-claim.ts`

Exports, exactly:

```ts
export type DaemonPortState = 'absent' | 'starting' | 'ready' | 'error' | 'unknown';
export interface TunnelClaim { httpPort: number; port: number; attempt: number; sawEntry: boolean }
export type ClaimSignal =
  | { type: 'rebind'; httpPort: number; port: number | null }
  | { type: 'start-issued'; httpPort: number; port: number; attempt: number; entryExisted: boolean }
  | { type: 'start-rejected'; httpPort: number; port: number; attempt: number }
  | { type: 'daemon-state'; httpPort: number; port: number; state: DaemonPortState }
  | { type: 'local-clear'; httpPort: number; port: number };
export function entryDaemonState(entry: PortTunnelEntry | undefined): DaemonPortState;
export function claimReducer(claim: TunnelClaim | null, signal: ClaimSignal): TunnelClaim | null;
export function claimOwns(claim: TunnelClaim | null, httpPort: number, port: number | null): boolean;
```

`'unknown'` means "an entry exists but says nothing about the daemon" — today, only a client-written error.
No React import; `PortTunnelEntry` comes in via `import type` (this module is imported by a **node**-project
test, and a value import would drag zustand, `lib/daemon/ws-client`, and sonner into it). The module header
states what a claim means, names D10/AC12, and records the three facts a reader must not undo: the union
carries no timeout signal, `start-rejected` is attempt-scoped, and a client-written error is `'unknown'`.

**Verify:** the Task 2 file passes; `pnpm --filter @qlan-ro/mainframe-ui typecheck` is clean.

---

## Group B — `claim-regressions-red`

**kind:** test · **parallel_safe:** yes (one new harness + one new test file; touches nothing else) · **depends_on:** —

### Task 4 — Red: the round-5 sequences and the Retry-on-`ready` rule

**Files (new):**
`packages/ui/src/features/url-tab/__tests__/url-tab-tunnel-harness.tsx`,
`packages/ui/src/features/url-tab/__tests__/UrlTabInstance.tunnel-claim-lifecycle.test.tsx`

The harness exports what the third copy of this scaffolding would otherwise duplicate (the
"extract at 3+ duplications" rule): a `makeFakeHandle()` returning the `PreviewHandle` stub with
`compositesAboveDom: false`, an `installFakeHost()` returning `{ fakeHost, fakeHandle }`, `seedStores()`
(sandbox + `usePortTunnelsStore` at `{ byPort: {}, daemonPort: 31415, generation: 0 }` + a fresh layout),
`setPortEntry`, and `renderTab(url, { tabId })` with the `HostProvider` wrapper. It exports **no** `vi.mock`
calls; those stay in each test file (hoisting).

The new test file mocks `@/features/sessions/use-active-identity`,
`@/features/sessions/runtime/daemon-port-context`, `@/lib/daemon/use-daemon-is-local`, and
`@/lib/api/tunnel-ports` exactly as the retarget-ownership file does, runs the **real**
`tunnel-consumers` registry, and calls `clearUrlTunnelConsumers()` in `beforeEach`.

**Case (a) — a hung attempt-1 POST rejects after a successful retry.** RED at `fadec137`.

- `startPortTunnel` is `mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }))`
  then `mockResolvedValue({ url: 'https://abc.trycloudflare.com' })`.
- Render on `http://localhost:5173/`; the daemon reports `{ state: 'error', error: 'boom' }` for 5173; the
  body is `url-tab-body-failed`.
- `await act(async () => { fireEvent.click(screen.getByTestId('url-tab-retry')); })` — the second start's
  `.then` needs a microtask flush before the next step. Assert `startPortTunnel` has now been called twice.
- The daemon reports `{ state: 'ready', url, dnsVerified: true }`; the body is `url-tab-body-loaded`.
- Reject attempt 1's promise inside `await act(async () => …)`.
- Assert: the body is still `url-tab-body-loaded`, and after `releaseUrlTunnelConsumers(['t1'])`,
  `stopPortTunnel` **was** called with `(31415, 5173)`.

**Case (b) — the watchdog fires, then the tunnel becomes ready.** RED at `fadec137`.

- `vi.useFakeTimers()` before `render` (the watchdog is a `setTimeout`), `vi.useRealTimers()` in `afterEach`.
- `startPortTunnel` returns a promise that never settles.
- Render; the daemon reports `{ state: 'starting' }`; advance by `URL_TAB_TUNNEL_TIMEOUT_MS` (imported from
  `../resolve-url-target`, never hardcoded) inside `act`; assert `url-tab-body-failed`.
- The daemon then reports `{ state: 'ready', url, dnsVerified: true }`; assert `url-tab-body-loaded`.
- Assert that after `releaseUrlTunnelConsumers(['t1'])`, `stopPortTunnel` **was** called with `(31415, 5173)`.

**Case (c) — Retry pressed while the entry is `ready`, then a real teardown.** Green at `fadec137` and green
after; it pins the conditional `local-clear` rule, and it is red against an unconditional one. Say so in the
commit body so nobody deletes it as redundant.

- Fake timers as in (b); `startPortTunnel` returns a **never-settling** promise, as in (b). It must not
  resolve: a resolved start sets `flags.startUrl`, which opens `resolveEntryTarget`'s gate
  (`resolve-url-target.ts:59`) and renders `tunnelled`, so `url-tab-retry` would never appear and the case
  would assert nothing.
- Render; the daemon reports `{ state: 'ready', url: 'https://abc.trycloudflare.com' }` with **`dnsVerified`
  absent** — a `ready` entry the closed DNS gate keeps out of `tunnelled`; advance
  `URL_TAB_TUNNEL_TIMEOUT_MS`; assert `url-tab-body-failed`.
- Click `url-tab-retry` inside `await act(async () => …)` — `clearPortTunnelEntry` no-ops on the `ready`
  entry (`store/port-tunnels.ts:99`), so no `local-clear` fires and `sawEntry` stays `true`.
- The daemon then reports the tunnel stopped (delete the 5173 entry), and a foreign `ready` entry appears on
  5173.
- Assert that after `releaseUrlTunnelConsumers(['t1'])`, `stopPortTunnel` was **not** called with
  `(31415, 5173)`.

**Verify:**
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/url-tab/__tests__/UrlTabInstance.tunnel-claim-lifecycle.test.tsx`
→ (a) and (b) fail, (c) passes. Then
`… vitest run src/features/url-tab/__tests__/UrlTabInstance.tunnel-retarget-ownership.test.tsx` and
`… vitest run src/features/url-tab/__tests__/UrlTabInstance.tunnel.test.tsx` → both fully green (this task
adds no shared state, so they must be untouched).

---

## Group C — `claim-rewire`

**kind:** ui · **parallel_safe:** yes (no file overlaps Group A or B) · **depends_on:** `claim-model`, `claim-regressions-red`

`use-url-tab-tunnel.ts` is 180 lines with a 121-line hook body today, and the rework leaves it around 84 —
still over the project's hard **50 lines/function** rule, which Task 9 gates on. So the rewire is also a
decomposition: the hook ends up as composition plus registration, and each extracted piece has one job. The
budgets below are targets to hit, not estimates to report; if any lands over 50, decompose further rather
than shipping a known violation.

| Function | Home | Body budget |
|---|---|---|
| `useUrlTabTunnel` | `use-url-tab-tunnel.ts` | ~30 — resolve inputs, compose, register |
| `useTunnelAttempt` | `use-tunnel-attempt.ts` | ~40 — attempt counter, flags, target, watchdog, `retry` |
| `useStartRequest` | `use-tunnel-attempt.ts` (module-private) | ~25 — the start POST and its two claim signals |
| `useTunnelClaim` | `use-tunnel-claim.ts` | ~20 |
| `useDnsReload` | `use-dns-reload.ts` | ~18 |

### Task 5 — Extract the two hooks the rework needs

**Files (new):** `packages/ui/src/features/url-tab/use-tunnel-claim.ts`,
`packages/ui/src/features/url-tab/use-dns-reload.ts`

`useTunnelClaim`:

```ts
export function useTunnelClaim({ httpPort, port, entry }: {
  httpPort: number;
  port: number | null;
  entry: PortTunnelEntry | undefined;
}): { owns: boolean; note: (signal: ClaimSignal) => void };
```

- `const [claim, note] = useReducer(claimReducer, null)`.
- One effect on `[httpPort, port]` dispatching `{ type: 'rebind', httpPort, port }`.
- One effect on `[httpPort, port, entry]` dispatching
  `{ type: 'daemon-state', httpPort, port, state: entryDaemonState(entry) }` when `port !== null`.
- `owns = claimOwns(claim, httpPort, port)`.
- `note` is the raw dispatch on purpose: every caller stamps the `httpPort`/`port`/`attempt` it is *acting
  on*, so a late promise callback carries its issue-time identity instead of the current render's. Say that
  in the header.

`useDnsReload({ targetKind, dnsVerified }): number` lifts `use-url-tab-tunnel.ts:153-172` verbatim —
`reloadNonce`, `loadedBeforeDnsRef`, and the effect. Nothing else in the hook reads that state, so the seam
is clean. Behaviour is unchanged: exactly one reload when DNS verifies after the tab already loaded (D11),
covered by the existing `UrlTabInstance.tunnel.test.tsx` case.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` clean (both modules are unreferenced at this
point, which is expected — Task 6 wires them).

### Task 6 — Extract the attempt lifecycle onto the claim

**Files:** `packages/ui/src/features/url-tab/use-tunnel-attempt.ts` (new),
`packages/ui/src/features/url-tab/use-url-tab-tunnel.ts` (edited)

Move the per-attempt machinery out of the hook and put the claim signals in it as it moves. One task, not
two: the move and the rewire cannot be separated without leaving a state that does not compile.

`use-tunnel-attempt.ts` exports one hook and keeps a second module-private:

```ts
export function useTunnelAttempt(args: {
  url: string; isLocal: boolean; daemonPort: number | null;
  httpPort: number; chatId: string | null; port: number | null;
  entry: PortTunnelEntry | undefined; active: boolean;
  note: (signal: ClaimSignal) => void;
}): { target: UrlTabTarget; retry: () => void };
```

- It owns `attempt`, `AttemptFlags` (moved verbatim, `FRESH` included), `attemptRef`, the attempt-reset
  effect, the `everHadEntry` effect, the `target` memo, `isPending`, the watchdog, and `retry`. Computing
  `target` here is what breaks the circularity — `isPending` derives from the flags this hook owns, so
  nothing has to be threaded back in from the caller.
- The reset effect loses its retarget branch: `prevPortRef`/`setOwnedPort(null)` are gone, because a
  retarget is now `rebind`, dispatched by `useTunnelClaim`.
- `retry()`: `if (port !== null && clearPortTunnelEntry(port)) note({ type: 'local-clear', httpPort, port })`
  — **conditional**, for the reason in *States and transitions*; `setAttempt` still runs unconditionally.
- `useStartRequest` (module-private, same file) holds the start effect. It takes values and callbacks only —
  `{ enabled, port, httpPort, daemonPort, chatId, entry, attempt, note, onStartUrl }` — and keeps its own
  `startedForAttemptRef` and a ref mirroring the latest `attempt`. No `setFlags` and no ref from the caller
  crosses the boundary; a stale-attempt resolution reaches the caller only through `onStartUrl`, which the
  hook calls after its own guard. Inside:
  - `note({ type: 'start-issued', httpPort, port, attempt, entryExisted: entry !== undefined })` replaces
    `if (entry === undefined) setOwnedPort(port)`.
  - `.catch` guards its **whole** body on the attempt being current (matching the `.then`), then
    `note({ type: 'start-rejected', httpPort, port, attempt: at })` and
    `reportPortTunnelError(port, message(err), 'client')`.

In `use-url-tab-tunnel.ts`, what remains is: `isLocal`/`httpPort`/`daemonPort`/`chatId`/`port`/`entry`,
`useTunnelClaim({ httpPort, port, entry })` **declared before** `useTunnelAttempt` (the ordering pinned in
*States and transitions*), `useTunnelAttempt(…, note)`, `useDnsReload`, the registration effect, and the
return. Delete `ownedPort`, `setOwnedPort`, `prevPortRef`, the `stopped || failed` disown effect, and the
DNS-reload block. Rewrite the module header: ownership lives in `tunnel-claim.ts`, the attempt lifecycle in
`use-tunnel-attempt.ts`, and this file composes them. Keep `flags.everHadEntry` where it moved and say there
why it is not `sawEntry`.

Registration effect: `started: owns`, deps `[active, tabId, port, owns, httpPort]`, plus a `port === null`
arm calling `releaseUrlTunnelConsumers([tabId])` under the same `active` gate. The effect returns early
today, which leaves a stale `{ port, started: true }` record behind and contradicts "the claim is the only
input to `started`". Which transitions actually reach that arm: `useDaemonIsLocal` reads
`useActiveDaemon().target.kind` (`lib/daemon/use-daemon-is-local.ts:11`), so it flips only on a real daemon
switch — and that path already calls `clearUrlTunnelConsumers()` before the keyed remount, so the arm is
belt-and-braces there. The live trigger is a retarget to a URL that no longer classifies as loopback (the
address bar accepts any URL), where stopping the abandoned tunnel is exactly right.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui typecheck` clean; `grep -rn "ownedPort" packages/ui/src`
returns nothing.

### Task 7 — The chip's error origin, and the comments that still name `ownedPort`

**Files (edited):** `packages/ui/src/features/chat/smart-actions/use-url-tunnel.ts`,
`packages/ui/src/features/url-tab/url-tunnel-ownership.ts` (comment only),
`packages/ui/src/features/url-tab/__tests__/url-tunnel-ownership.test.ts` (comment only)

In `features/chat/smart-actions/use-url-tunnel.ts:85`, pass `'client'` as the third argument, with a
one-line reason: a rejected start POST from the chip is not evidence about a tunnel another surface owns.

The header of `url-tunnel-ownership.ts` and the comment at `url-tunnel-ownership.test.ts:68-71` both name
`ownedPort`, which no longer exists; retarget them at the claim reducer. No behaviour change in either file,
and no assertion in the test file changes.

**Verify:** `pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/url-tab/__tests__/url-tunnel-ownership.test.ts`
and each file under `src/features/chat/smart-actions/__tests__/` green.

### Task 8 — Green sweep of the url-tab suite, and fold the two older files onto the harness

**Files (edited):**
`packages/ui/src/features/url-tab/__tests__/UrlTabInstance.tunnel-retarget-ownership.test.tsx`,
`packages/ui/src/features/url-tab/__tests__/UrlTabInstance.tunnel.test.tsx`

First run all nine url-tab test files and confirm green, Group B's included. Only then replace the
duplicated handle/host/store scaffolding in the two older files with the Task 4 harness — **no assertion, no
case name, and no seeded value may change**, and both files must be green before and after the swap. If the
swap turns anything red, revert the swap (not the model) and report it.

**Verify:** each of
`tunnel-claim.test.ts`, `url-tunnel-ownership.test.ts`, `resolve-url-target.test.ts`, `url-tab-id.test.ts`,
`UrlTabBodyState.test.tsx`, `UrlTabInstance.test.tsx`, `UrlTabInstance.tunnel.test.tsx`,
`UrlTabInstance.tunnel-retarget-ownership.test.tsx`, `UrlTabInstance.tunnel-claim-lifecycle.test.tsx`
runs green individually under
`pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/url-tab/__tests__/<file>`, plus
`src/store/__tests__/port-tunnels.test.ts` and the chip's own tests under
`src/features/chat/smart-actions/__tests__/`.

---

## Group D — `verify`

**kind:** test · **parallel_safe:** yes (edits nothing) · **depends_on:** `claim-rewire`

### Task 9 — Verification sweep

Record every result in the group's commit body or the lane result.

1. `pnpm --filter @qlan-ro/mainframe-ui typecheck` — clean.
2. `pnpm --filter @qlan-ro/mainframe-ui test` — full suite. If the known cross-file `React.act` batch failure
   appears, re-run the affected files individually and say so; do not "fix" it here.
3. `git diff --name-only origin/main...HEAD` — no path under `packages/core-rs/`, `packages/types/`,
   `packages/mobile`, or `packages/app-tauri/src-tauri/` is added by *this rework* (the Rust arm landed
   earlier in `a129e0de` and is untouched), and `.changeset/` still contains exactly one file for this
   branch, `preview-open-urls.md`.
4. `grep -rn "target.kind === 'failed'\|target.kind === 'stopped'" packages/ui/src/features/url-tab` — the
   only hits are presentation (`UrlTabBodyState`, the body-state tests). No ownership decision reads
   `target`.
5. Size audit: every file added or edited here is under 300 lines and **every function under 50**
   (`git diff --name-only --diff-filter=d origin/main...HEAD -- '*.ts' '*.tsx' | xargs wc -l` for the files,
   then read the five hooks in Group C's budget table). This is a hard project rule with no allowance: a
   function over 50 lines is decomposed here, not reported as a known deviation.
6. Re-read the two round-5 findings against the new code and state, in one line each, which construct closes
   them (`start-rejected` attempt scoping; the absence of a timeout signal in `ClaimSignal`), plus the third
   error producer the model now separates (`errorOrigin: 'client'` → `'unknown'`).
7. `grep -rn "reportPortTunnelError(" packages/ui/src` — exactly three production call sites
   (`store/port-tunnels.ts`'s own `applyPortTunnelEvent`, the url-tab start request, the chat chip), of which
   the two client ones pass `'client'`. A fourth caller, or a client caller without the argument, is a
   defect: the default is daemon origin and silently revokes claims.

**Exit:** all seven recorded, everything green.

---

## Execution groups

| Group | Tasks | Kind | parallel_safe | depends_on |
|---|---|---|---|---|
| `claim-model` | 1–3 | ui | yes | — |
| `claim-regressions-red` | 4 | test | yes | — |
| `claim-rewire` | 5–8 | ui | yes | `claim-model`, `claim-regressions-red` |
| `verify` | 9 | test | yes | `claim-rewire` |

`parallel_safe` is a file-collision flag only: no two groups write the same file. Actual concurrency is
`claim-model` alongside `claim-regressions-red`; the other two are gated by `depends_on`. TDD order is
task order — the reducer's table (2) precedes the reducer (3), and the component regressions (4) precede
the rewire (5–8) and are red until it lands.

## Decisions taken in this plan

- **The `.catch` keeps its attempt guard even though the reducer no longer needs one.** The guard's job is
  the store write; the reducer's is the claim. Task 2 proves the reducer stands alone.
- **The claim carries `httpPort`.** It costs one field and turns "a claim is against one daemon" from an
  incidental property of the remount into a stated rule.
- **Provenance goes on the entry, not on the call site.** `entryDaemonState` is a pure function of the
  entry; making the *reader* guess who wrote an error would put the conflation back where it was.
- **Provenance is a marker (`errorOrigin?: 'client'`), not a two-valued field.** Recording only the exception
  keeps a daemon error byte-identical to today's entry, which is what the store suite's three whole-entry
  `toEqual` assertions pin, and makes "unmarked means daemon" the type's statement rather than a convention.
- **The rewire is also a decomposition.** `useUrlTabTunnel` would land at ~84 lines even after the ownership
  state leaves it, against a hard 50-line rule. Rather than ship a known violation or ask for an exception,
  Task 6 lifts the attempt lifecycle into `use-tunnel-attempt.ts` (with the start request module-private
  beside it) and leaves the hook as composition plus registration. The seam is callbacks and values only —
  no setter and no ref crosses it — so the extraction cannot become a new place for ownership to leak into.

## Risks

- **A transport-level start rejection is treated as a daemon failure.** `startPortTunnel` throws a bare
  `Error`, so "the daemon refused" and "the socket died" are indistinguishable; `start-rejected` revokes in
  both cases. The failure mode is a *missed* stop, never a wrongful one, which is the direction D10 says to
  err in. Typing the API error is the real fix and is out of scope here.
- **Creation evidence is inferred, not reported.** If `seedPortTunnels` skips its snapshot (a WS event
  overtook the fetch, `store/port-tunnels-seed.ts:23`) while `daemonPort` is set anyway, a tab can start
  against an empty `byPort` and claim a tunnel the daemon already held. Narrow, pre-existing, and unfixable
  client-side; the daemon's start route returns no created/joined flag.
- **The daemon-state effect observes entry *values*, not every write.** It reacts to `entry` changing, so two
  store writes inside one React batch are seen as one value: a WS `stopped` (entry deleted) followed in the
  same tick by a chip's client error on the same port is observed only as `'unknown'`, and the `'absent'`
  revocation is missed until the next real transition. The window is one tick and needs two producers writing
  the same port in it; it applies to every transition equally, and the failure mode is a missed stop rather
  than a wrongful one. Widening the model to a write log would mean subscribing to store events instead of
  state — a larger change than this rework, and not one the two defects call for.
- **Two daemons on the same HTTP port number are indistinguishable to the claim.** Accepted, not fixed —
  fixing it needs a daemon identity the client does not have, and the spec declines daemon changes.
- **Fake timers in cases (b) and (c) are the only ones in this suite.** Enable them before `render` and
  restore in `afterEach`, or the watchdog either never fires or leaks into a neighbouring test.
- **A test that fails against the reworked code is a finding, not a nuisance.** Never weaken an assertion to
  get green; the five prior cases are the regression contract for four rounds of review.

## Manual verification (unchanged, not automatable)

The Tauri automation bridge stops answering once a child webview exists. Run `pnpm tauri:dev` from
`packages/app-tauri` with an isolated `MAINFRAME_DATA_DIR` **and** `DAEMON_PORT` — never the defaults.
Against a remote daemon, the three sequences this rework is about:

1. Open a URL tab on a fresh eligible port, wait past the pending state until it loads, then close the tab —
   the port disappears from `GET /api/tunnel/ports` (AC12).
2. Open a URL tab whose tunnel is slow enough to trip the 120 s watchdog, let it load afterwards, then close
   the tab — the port must still disappear. That is defect 2, by hand.
3. With a URL tab tunnelling port N, click the chat chip for the same port and let its start fail. The tab
   must keep its claim: close it and the port must disappear.
