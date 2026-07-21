# Provider quota indicator — an ambient view of Claude & Codex rate-limit headroom

Source: todo #268 (spec). Derived from Wayfinder map #248, decision tickets #249–#259. This document is the buildable plan.

## Problem Statement

When I work in Mainframe with Claude or Codex, I can't tell how much of my provider plan's rate-limit allowance is left. These are account-wide *plan* limits — Claude's 5-hour rolling window plus weekly allowances, Codex's equivalent windows — and they are burned not only by this app but by the terminal CLI and claude.ai/ChatGPT too. Today I only discover I'm near a wall when the provider warns me or rejects a request in the middle of a task. I want to glance and know "can I keep going right now?" before committing to a long run — without opening a browser or running a CLI command myself.

This is **not** context-window usage. Mainframe already shows a per-chat context meter (`ContextUsage`, `SessionResult.contextTokens`, `MessageMetadata.usage`); that is how full the current conversation is. Plan quota is a different concept that happens to share the word "usage" — do not conflate the two.

## Solution

An ambient, always-visible indicator in the **sidebar footer, directly above the daemon switcher**. It shows one row per quota-capable provider (Claude, Codex — always both, even when one has no data), each rendering that provider's *tightest* active window as a small ring + percentage + relative reset ("resets in 3h"). Clicking the row opens a popover listing **every** window for that provider — Claude's session, weekly-all-models, and its variable-length set of model-scoped weekly windows; Codex's session and weekly — with absolute reset timestamps.

The displayed numbers are always the provider's own authoritative figures, **never a locally computed estimate**: quota is account-wide, so any local count is wrong in the optimistic direction. A provider that reports nothing (API-key auth, non-subscriber) shows a designed **"quota unknown"** state — visible silence, never blank. As a window approaches its wall the ring turns **amber (≥75%)** then **red (≥90%)** (thresholds tunable). When data is stale, or the account behind the numbers can't be identified, the indicator **fails closed to "unknown"** rather than show a possibly-wrong figure — the guarantee is *never show the wrong account's headroom*, not *always show the right one*.

Freshness is per-provider. Claude is kept always-fresh at rest by a cheap focus-gated timer pull; Codex refreshes passively as you use it and shows last-known + a staleness hint when idle. The state survives app restarts.

## User Stories

1. As a Claude Max subscriber, I want to see how much of my 5-hour window I've used, so that I can decide whether to start a big task now or wait for the reset.
2. As a Claude subscriber, I want to see my weekly all-models allowance, so that I can pace my week and not get walled on a Friday.
3. As a Claude subscriber on a plan with model-scoped weekly limits, I want to see each model-scoped weekly window separately, so that I know which specific model I'm running low on.
4. As a Codex ChatGPT-plan user, I want to see my 5-hour and weekly Codex windows, so that I have the same headroom awareness I have for Claude.
5. As a user of both providers, I want both providers shown side by side in one place, so that I can compare headroom at a glance and pick where to route work.
6. As a user glancing at the sidebar, I want the tightest (closest-to-wall) window surfaced on the collapsed row, so that the single number I see is the one that will actually stop me.
7. As a user who wants detail, I want to click a provider row and see all of its windows with exact reset times, so that I can plan around a specific window's rollover.
8. As a user approaching a limit, I want the indicator to turn amber then red as I near the wall, so that the warning is pre-attentive and I don't have to read the number.
9. As a user whose provider reports no quota (I use an API key), I want a clear "quota unknown" state instead of a blank or a fake zero, so that I understand the app isn't hiding a real number.
10. As a user who just launched the app, I want Claude's numbers to refresh within a second or two, so that the first glance after opening is trustworthy.
11. As a user who leaves the app open, I want Claude's numbers to stay current without me doing anything, so that a mid-day glance is accurate.
12. As a Codex user, I want my Codex numbers to update as I send turns, so that the display tracks my actual usage without extra polling.
13. As a Codex user who hasn't sent a turn recently, I want to see my last-known numbers with a staleness hint rather than a spinner or a blank, so that I still get a useful (if slightly old) read.
14. As a user who closed the app over a weekend, I want a window whose reset time has passed to show as "unknown" rather than a stale percentage, so that I'm never misled by an expired number.
15. As a user, I want the numbers to persist across a daemon restart, so that reopening the app doesn't blank my headroom until the next turn.
16. As a user who switches between a personal and a work Claude account, I want the indicator to show the account I'm currently logged into — or "unknown" until it re-reads — never the previous account's headroom, so that I'm never given an optimistically wrong number for the wrong account.
17. As a user who switches Codex accounts, I want the same guarantee: after a swap the indicator re-resolves to the new account or fails to "unknown," never showing the old account's numbers.
18. As a user on a keyless auth mode (Codex API key / Bedrock) where the account can't be identified, I want the provider to simply show "unknown," so that the app degrades safely instead of guessing.
19. As a user whose provider config file is briefly locked when the app reads it, I don't want a healthy gauge to flicker to "unknown" — I want it to keep showing the last-known value and retry, so that transient hiccups don't create false alarms.
20. As a user, I want a manual refresh affordance in the popover, so that I can force an update when I want the freshest possible read.
21. As a user, I want the reset time shown as a friendly relative string on the row ("resets in 2h 10m") and as an absolute timestamp in the popover, so that I get quick reading and precise planning from the same control.
22. As a user on either desktop shell (Tauri or Electron), I want the indicator to look and behave identically, so that the experience is consistent regardless of shell.
23. As a Mainframe developer, I want the same quota behavior whether the daemon runs the Node or the Rust implementation, so that flipping the `MAINFRAME_DAEMON_IMPL` canary doesn't change what the user sees.
24. As a Mainframe developer, I want the format-drift of Claude's `/usage` output to redden CI via a committed fixture test, so that a provider changing its output is caught before it ships as a silent "unknown."
25. As a user, I don't want the quota feature to spend model tokens or touch my OAuth credentials, so that checking my headroom is free and safe.
26. As a screen-reader user, I want each provider row and window to be labeled with its provider, percentage, and reset, so that the ambient information is available non-visually.
27. As a user, I want the indicator to be keyboard-reachable and its popover dismissible like the daemon switcher, so that it fits the existing interaction model.

## Implementation Decisions

### Shared type (single canonical type)

One provider-agnostic quota type lives in `@qlan-ro/mainframe-types`, co-located with `ContextUsage`. Claude and Codex populate it; the `api` adapter emits nothing. Shape (from prototype/decision #251, encodes the model more precisely than prose):

```ts
type QuotaWindow = {
  kind: 'session' | 'weekly' | 'weekly-model';
  usedPercent: number;          // 0–100, provider-authoritative
  resetsAt: number | null;      // epoch ms; null when a best-effort parse failed
  label?: string;               // e.g. the model name for a weekly-model window
};

type ProviderQuota = {
  status: 'ok' | 'unknown';     // provider-level; any untrusted window fails the WHOLE provider
  session?: QuotaWindow;        // the two universal windows
  weekly?: QuotaWindow;
  modelWindows: QuotaWindow[];  // Claude's variable-length model-scoped weekly windows; [] for Codex
  observedAt: number;           // epoch ms; durable merged state is mandatory
  accountIdentity?: string;     // resolved identity, or 'unknown' (see keying)
};
```

There is **no per-window status**: any untrusted window fails the whole provider to `unknown` (fail-closed, #251). `unknown` means "a quota-capable provider with no trustworthy data" — the `api` adapter emits nothing at all rather than an `unsupported` state.

### Provider-specific harvesting & normalization (lives in each provider's module)

Each provider's own code converts its raw sources into the shared `ProviderQuota` shape and emits it via a **new `onProviderQuota` sink callback** (added to the adapter `SessionSink` surface and its Rust trait peer, alongside `onContextUsage`). This mirrors how every other adapter event reaches the daemon today. Provider code stays in the existing per-provider modules — the Claude plugin module (Rust `mainframe-adapter-claude`) and the Codex plugin module (Rust `mainframe-adapter-codex`) — not in a shared engine.

**Claude** (three sources, one normalized output):
- **Primary PULL:** a stateless `claude -p "/usage"` spawn, mirroring the existing one-shot title-generator spawn (`--no-session-persistence`, stdin closed, no session). Zero model tokens, ~1s, no credential handling. Its prose is parsed into windows.
- **Free PUSH:** the stream-json `rate_limit_event` (currently unhandled in the Claude event mapper) is merged as a change-triggered escalation. It carries `utilization` only when warning/rejected, so it cannot drive a healthy ambient gauge — it is an extra, not the primary source.
- **Parsing (#255):** anchor-based window identification — `session` / `week` + `(all models)` / `week` + `(<model>)` capturing the parenthetical as the model label; 0..n model lines; an unclassifiable line ⇒ `unknown`. **Percent is load-bearing** (a parse failure fails the whole provider closed); **reset is best-effort** (a reset-parse failure nulls that window's `resetsAt`, keeps the percent, logs loudly). Never parse the local "What's contributing" breakdown. Recognized no-data ⇒ info log; unclassifiable non-empty ⇒ WARN + raw line.
- **Unit trap:** the prose gives percent + a relative/absolute reset; the stream-json gives a 0–1 fraction + epoch **seconds**. Both normalize to percent 0–100 + epoch **ms**.

**Codex** (push-primary, pull on demand):
- **Primary PUSH:** handle `account/rateLimits/updated` at the exact silent-ignore arm that currently drops it in both the TS and Rust Codex event mappers. Payload is a `RateLimitSnapshot` with up to two nullable percent windows identified by `windowDurationMins` (300 = 5h ⇒ `session`, 10080 = weekly ⇒ `weekly`), account-wide, delivered as a **sparse rolling merge** (null = keep previous, never clear). Fires once per model API response; never at rest.
- **PULL on demand only:** `account/rateLimits/read` over the existing temp-app-server spawn — used only when a session's app-server is already up or on manual refresh. **Never spawn purely to poll.**
- **Unit trap:** Codex gives percent 0–100 + epoch **seconds** ⇒ normalize to epoch **ms**.

**Account identity (#258/#259):** identity is a separate cheap read, never on the quota surface. Claude: read `~/.claude.json` → `oauthAccount.accountUuid` (fallback `emailAddress`) — plaintext, no keychain, extends the existing `~/.claude.json` trust-store reader. Codex: `account/read` → `email` (fallback `~/.codex/auth.json` → `tokens.account_id`; final fallback synthetic `apiKey`/`bedrock` bucket), via a new Codex identity reader. No OAuth token or undocumented endpoint is ever touched (#254).

### Shared quota-lifecycle engine (provider-agnostic, the one shared core piece)

Pure functions over `ProviderQuota` in core (mirrored in Rust), consumed by the daemon's in-memory merge state:
- **Sparse merge** — apply a partial update over the prior blob (null window = keep previous).
- **Compound keying (#259)** — persist and look up by `(adapterId, accountIdentity)`. A same-provider swap yields a new key ⇒ no blob ⇒ naturally `unknown` until re-pull; no explicit invalidation path required for correctness. Keyless auth ⇒ fixed synthetic `identity:unknown` bucket (carries no quota anyway). A **transient identity-read failure** reuses the last-known identity held in memory and keeps the last-known quota under the keep-last-known+retry backoff (below) — a healthy gauge never flickers to `unknown` on a momentary file lock. Detection signals (Claude file mtime + uuid compare; Codex `account/updated` push) are an *optimization* that triggers an earlier re-pull, never a correctness dependency.
- **Lifecycle / expiry (#256)** — a window is trusted until its own `resetsAt` passes; then that window ⇒ `unknown`. A null `resetsAt` (#255) gets a synthesized `effectiveReset = observedAt + KIND_DURATION` (session 5h, weekly/weekly-model 7d) so it can't display forever. The whole provider ⇒ `unknown` when all its windows are (fail-closed, #251). A separate ~10–15m staleness *indicator* (from `observedAt`) shows before the expiry ceiling trips.
- **Backoff** — on a pull failure, keep last-known + retry; fail closed to `unknown` only when the expiry/staleness rules trip.

### Freshness & cadence (#252)

Per-adapter, unified only at the type/UI layer:
- **Claude:** trigger + focus-gated ~5-minute timer pull of `claude -p "/usage"`; the warning push merges as an escalation ⇒ always-fresh at rest.
- **Codex:** passive per-turn push is primary; pull `rateLimits/read` only when an app-server is already up or on manual refresh ⇒ at rest with no session it shows last-known + staleness, or `unknown`.
- Accepted asymmetry: Claude always-fresh; Codex may be stale at a fresh-app glance. Staleness is shown only past the ~10–15m threshold, never estimated.

### Persistence (#256)

The merged `ProviderQuota` blob persists in the existing account-wide `settings` KV (`category='quota'`, `key=<adapterId>:<accountIdentity>`, `value = JSON`), reloaded into the in-memory merge state on daemon boot. No dedicated table, no migration. On boot, Codex shows last-persisted + staleness (it won't spawn to poll at rest); Claude re-pulls cheaply and refreshes almost immediately. Expiry is the resetsAt-relative rule above.

### Transport (daemon emit + read)

- A new `provider.quota.updated` arm on the `DaemonEvent` union (both arms), broadcast account-wide — added to the connection-global event set so it reaches every client regardless of chat subscription (it has no `chatId`).
- A REST read, `GET /api/providers/:id/quota`, following the existing settings/adapters route shape and the `ok`/`okEmpty`/`fail` envelope, so the UI can seed on load.

### UI surface (#253)

- A quota card mounts in the sidebar footer, above the daemon switcher, inside the footer's existing vertical stack (no layout change). It **mirrors the daemon switcher button**: a full-width trigger with a per-provider row (provider glyph + tightest-window ring + `%` + relative reset), opening a `side="top"` popover that lists all windows (relative reset in the card, absolute in the popover). Claude's variable model-scoped windows are listed there.
- Data flows through a **new zustand slice** (modeled on the account-wide adapters store), seeded from the REST read and kept fresh by a `provider.quota.updated` subscriber installed once at the app root. Components subscribe via selector hooks. This is pure UI wiring — no quota logic in React.
- **Designed states:** normal; near-wall amber (≥75%) / red (≥90%), thresholds tunable; **quota-unknown (dashed, required state)**; mixed + stale. Provider iconography reuses the existing adapter→logo mapping (`codex → openai`); status colors map to the existing `--mf-warning` (amber), `--destructive` (red), `--mf-success` (healthy), and a muted `--mf-text-3` + `border-dashed` for unknown. No progress/ring primitive exists today — the ring is built new (the connection-dot spinner is the only ring-shaped precedent). Every interactive element carries a `provider-quota-*` `data-testid`.
- Prototype reference: branch `proto/quota-indicator-253`.

### Node ↔ Rust parity

Full parity, threaded per-component rather than as one route: the shared `ProviderQuota` type is single-canonical; the Codex event-mapper hook exists in both arms; the `settings` KV and its repository are already mirrored (no new route, no migration); the new `onProviderQuota` sink method, `provider.quota.updated` event, quota-lifecycle functions, and the read route each get a Rust peer. Any quota code must land in both arms so a `MAINFRAME_DAEMON_IMPL` flip doesn't change behavior.

## Testing Decisions

Good tests here assert **external behavior** — a raw provider input (prose, RPC payload, prior blob, clock) maps to a specific `ProviderQuota`, or a `ProviderQuota` renders a specific UI state — with **hardcoded** expected values, never by re-running the production normalization inside the test.

- **Seam 1 — provider normalizers, tested inside each provider module (both arms).** Claude: a **committed golden-fixture test** of real `claude -p "/usage"` output → expected windows, which reddens CI on format drift (#255, story 24); plus table cases for the stream-json `rate_limit_event` fraction→percent/epoch-sec→ms normalization and the unclassifiable-line ⇒ `unknown` path. Codex: `RateLimitSnapshot` (incl. sparse null-window) → expected windows, `windowDurationMins` → `kind` mapping, percent + epoch-sec → epoch-ms. Identity readers: fixture `~/.claude.json` / `account/read` / `~/.codex/auth.json` inputs → expected identity, including the keyless ⇒ synthetic-bucket and read-failure paths. Prior art: the existing Codex event-mapper tests and Claude event tests.
- **Seam 2 — the shared quota-lifecycle engine (pure, both arms).** Hardcoded-input table tests for sparse merge (null = keep), compound-keying (swap ⇒ new key ⇒ `unknown`; transient read failure ⇒ keep last-known), resetsAt expiry + synthesized null-reset ceiling, staleness flag, and whole-provider fail-closed. A fixed injected clock (no wall-clock reads) drives expiry/staleness. Prior art: existing pure core-logic unit tests.
- **Seam 3 — daemon emit + read (thin).** With an injected command-runner / RPC client, assert that a harvested quota produces the `provider.quota.updated` event (reaching a non-subscribed client, since it's account-wide) and that `GET /api/providers/:id/quota` returns the persisted blob in the standard envelope. Prior art: the existing settings/adapters route tests.
- **Seam 4 — UI quota surface.** Component tests (vitest + RTL, `packages/ui`) that render the card + popover from a `ProviderQuota` fixture in the store and assert each designed state — normal / amber ≥75% / red ≥90% / unknown-dashed / stale / mixed — the tightest-window selection on the collapsed row, the all-windows popover, and `provider-quota-*` testids. Prior art: existing sidebar/daemon-footer component tests.

Seam 1 (module-scoped) and Seam 2 (shared) carry the correctness; Seams 3 and 4 verify the glue and the render. Prefer single-file test runs (`vitest run <file>`) per the repo's cross-file `React.act` caveat.

## Out of Scope

- **Context-window usage** — already covered by the existing per-chat context meter; a different concept.
- **Retrospective "where did my week go" history** and per-session/per-project quota breakdown — the job is ambient, not accounting.
- **`api` adapter spend/budget** — pay-per-token is a bill, not a rate limit; different question, different UI. The `api` adapter emits nothing.
- **Quota-aware routing / auto-switching** provider based on headroom.
- **Proactive alerting** — notifying (rather than only displaying) when nearing a wall. Display-only for now.
- **Concurrent multi-account / per-session account selection** — not buildable today; sequential swaps are handled by the compound key.
- **Gemini / OpenCode** quota — these appear in terminology but ship no plugin or crate.
- **Reading the CLI's keychain OAuth token or any undocumented usage endpoint** — explicitly rejected (#254).

## Further Notes

- The whole feature spends **zero model tokens** and touches **no credentials**: Claude quota comes from a `/usage` slash-spawn + a plaintext identity file; Codex from app-server RPCs it already speaks + a plaintext auth field.
- Research detail lives in `docs/research/` (`claude-quota-source.md`, `codex-ratelimits-payload.md`, `quota-account-identity.md`) on their respective `research/*` branches.
- Build order suggested by the seams: shared `ProviderQuota` type first (blocks all), then the two provider harvesters + the shared lifecycle engine in parallel, then transport, then the UI surface last.
