# Compact idle chats before the prompt cache expires

Todo #408. Behavior specification, 2026-11-10.

## Purpose and limits

An opt-in daemon setting compacts a long, idle, top-level chat shortly before
its assumed provider cache expires. A returning user then sends the summary
instead of the full previous context. Cache lifetime is a scheduling assumption,
not a guarantee that a provider will serve cached tokens or reduce the bill.

Only already spawned Claude and Codex sessions qualify. Never start, resume,
or reload a dormant session to perform this work. ACP and other providers,
mobile settings UI, savings displays, configurable thresholds, and changes to
manual or provider-initiated compaction are outside this feature.

## Settings contract

General settings expose `idleCompaction: { enabled: boolean }`. The persisted
general key is `idleCompaction.enabled`. Missing values resolve to false,
including existing installations. GET returns a JSON boolean, never a storage
string. Partial PUT preserves omitted values and unrelated settings.

Rust validates the nested patch before writing. TypeScript adds the field to
`GeneralConfig`, its defaults, and a Zod schema used by the settings boundary.
Strings, numbers, null, arrays, and objects supplied as `enabled` fail with the
existing settings failure envelope and status, without partially saving a patch.
An acknowledged toggle change survives daemon restart. A failed save restores
the acknowledged value and uses the existing settings error presentation.

Settings > General gains a Chats section between Worktree directory and Updates.
Use the existing `ToggleRow` and `Switch` with label "Compact idle chats" and
helper "Summarize long idle chats before the provider's prompt cache expires,
so returning is cheaper." The switch test id is `idle-compaction-enabled`.
Keep the existing keyboard, focus, disabled, and screen-reader behavior.
There is no extra scope note and no control under Appearance.

Disabling takes effect at the final dispatch check. An already dispatched request
finishes normally; disabling does not interrupt it or create further requests.

## Clock and scheduling

Keep the offload scanner's five-minute cadence and two-hour threshold. Add a
separate one-minute compaction sweep and evaluate again on normal run completion.
Neither evaluation starts a provider request outside the eligibility window.
Use a captured clock value in pure window and eligibility functions.

Let elapsed be now minus the latest real run's normal completion timestamp.
For TTL T, a run is due when `0.9 * T <= elapsed <= T`. Negative elapsed,
missing completion, or elapsed greater than T is ineligible. Recheck immediately
before dispatch, so a candidate selected before expiry cannot fire after expiry.
At exactly T it is due; any later timestamp is cold and skipped.

| Provider | Named TTL constant | Inclusive due window |
| --- | --- | --- |
| Claude, confirmed 1h | 60 minutes | 54 through 60 minutes |
| Codex | 30 minutes | 27 through 30 minutes |

Codex's 30 minutes is product policy, not a published provider guarantee.
App suspension, clock jumps, or a missed sweep never cause catch-up after expiry.
A new successful real run replaces the completion anchor. Idle maintenance does
not become a real run, reset its anchor, or rearm itself.

`MAINFRAME_IDLE_COMPACTION_DELAY_MS` is a daemon-only test override, not a setting.
A positive integer D substitutes a test TTL of `D / 0.9`, so its window starts at
D. While set, sweep at the smaller of 60 seconds and 5% of that test TTL, rounded
up to whole milliseconds. This prevents a one-minute test delay from missing its
short window. Invalid, zero, negative, or overflowing values fail startup with a
configuration error. The override changes timing only, never eligibility,
provider support, the 20k floor, or offload timing. QA uses about 60,000 ms.

## Claude cache classification

Remember a session-local classification of 1h, 5m, or unknown. Inspect reported
`usage.cache_creation.ephemeral_1h_input_tokens` and
`ephemeral_5m_input_tokens`, including the provider's nested usage representation.
Positive 1h with no positive 5m confirms 1h; positive 5m classifies as 5m.
Mixed positive durations conservatively classify as 5m. Missing or all-zero
breakdowns retain the last observed classification, rather than interpreting a
cache hit as a cache-policy change.

Before any decisive usage observation, use recognized init `apiKeySource` or
`account.subscriptionType` evidence. An explicit API-key source wins conflicting
subscription evidence and classifies as 5m. A recognized direct subscription can
classify as 1h only without API-key or proxy routing. Unknown values remain
unknown; do not infer subscription from an adapter name, model name, or login
presence. Usage evidence supersedes init fallback. Routed CLIProxy sessions
without explicit 1h usage evidence stay unknown. Reset classification on session
replacement or routing/account change. Only confirmed 1h Claude sessions qualify.

## Eligibility and serialization

Selection is advisory. Under the same per-chat lifecycle exclusion used by sends,
re-read settings, the current session, run identity, and every condition below.
Dispatch requires all of them simultaneously:

- The setting is enabled and the current run is in its due window.
- No real turn is running; the latest real run completed normally.
- Last reported context usage is known and at least 20,000 tokens.
- A live adapter session is present and reports spawned.
- The chat is not archived, delegated, or a child chat.
- There is no pending permission, queued user message, pending or running
  background task, tool work, or subagent.
- The latest transcript item is not any kind of compaction.
- The adapter supports native compaction and is Claude or Codex.
- Claude has a confirmed 1h classification.
- No request is in flight or durably claimed for this completed run.

Unknown eligibility data fails closed. Do not use cumulative token consumption
as context size. In-flight compaction excludes offload and other compactions,
without exposing a Working state. A user send that wins the guard cancels the
candidate. A compaction that wins reserves the session until terminal completion;
new user messages join the existing delivery queue in order, without steering or
interrupting the maintenance request. They retain normal persistence and error
handling and send after success or failure releases the reservation.

## Dispatch, persistence, and failures

Add a default-unsupported compaction capability and trigger to `AdapterSession`.
Claude uses the existing command writer for `/compact`, with an internal idle
origin. Codex sends `thread/compact/start` with `{ threadId }` for the current
session. Its empty RPC response acknowledges dispatch, not completion. Both use
existing `on_compact_start` and `on_compact` completion signals.

Identify a request as `idle-compact:<chatId>:<realRunId>`. If run IDs are unavailable,
use a persisted unique run generation, not an ambiguous wall-clock timestamp.
Persist the claimed run on the chat record before provider I/O, using an atomic
conditional write under the guard. Failure to persist means no dispatch. Keep
that claim after an accepted request, a send error, timeout, or crash. There is
at most one attempt per completed run, including ambiguous provider outcomes.
A crash between persistence and sending can therefore skip one compaction. This
tradeoff avoids spending tokens twice when provider acceptance is unknown.

A new normally completed real run supplies a new identity and may qualify later.
Restart never respawns a session just to compact. Tests may recreate a live
session to prove the persisted claim still rejects the old run.

Scope idle origin to the specific request and session generation until terminal
completion, failure, interruption, or session exit. Clear it before draining user
messages. Do not leak it into a following manual or automatic compaction. Define
and test a bounded completion wait using the existing adapter request timeout
policy; failure releases local exclusion and preserves the claim. If the provider
is still busy after timeout, normal send readiness must prevent overlapping input.
No fabricated success row appears on request failure. Report failures through
sanitized daemon diagnostics, without user notification or provider payloads.

Codex must reset its existing `compaction_emitted` gate for an explicit request,
even without `turn/started`. Deduplicate canonical contextCompaction items and
legacy thread/compacted notifications into one completed row. Correlate late or
duplicate completions so a released request cannot relabel a newer compaction.

## Transcript and activity contract

Persist `origin: "idle"` or equivalent on the compaction message and carry it
through live events, stored history, normalized display metadata, and reload.
Retain any provider-reported before/after context counts. Never invent counts
from cumulative billing usage. Store enough command provenance to hide only the
internal Claude command and its echo on reload; real user `/compact` messages
retain their current behavior.

The sole visible result is the existing separator marker with its icon,
hairlines, and muted ink. Its label is "Compacted while idle". If both counts
are reported, append quieter text on the same line, for example
"· 197k → 19k tokens". Otherwise show the label alone. Use the existing `Hint`
pattern from `ProviderSwitchMarker` for the tooltip "Compacted before the prompt
cache expired, so returning to this chat is cheaper." Use test id
`idle-compaction-<messageId>`. Preserve light/dark tokens and normal marker layout.
The approved design overrides the brief's longer inline sentence.

Idle start, progress, command echoes, completion, and failure must not cause:

- A `/compact` user bubble or a transient Working/Compacting indicator.
- Unread changes, running/turn-status changes, or delegated-parent status changes.
- Desktop notifications, mobile push, completion sounds, or title regeneration.
- A `lastUsedAt`, send-guard touch, adapter activity, or idle-clock reset.
- Fork-from-message or rewind actions targeting the idle row or hidden command.

Preserve real user activity during this interval. Never restore an old timestamp
on completion, which would erase newer activity. Suppress maintenance-origin
updates at their source, including Claude stdin and stdout activity bumps.
Offload remains due two hours after the last real activity; maintenance can block
an offload while in flight but cannot move its deadline. Ordinary manual and
automatic compaction behavior remains unchanged.

## Acceptance and verification

Implementation includes a changeset, files under 300 lines, and functions under
50 lines. Cover these contracts with focused unit/integration/component checks:

1. Fresh and existing defaults, typed GET, successful toggle persistence after
   restart, partial PUT preservation, invalid Rust/Zod inputs and atomic failure.
2. Disabled setting never dispatches, including a disable between selection
   and dispatch. Pure boundary tests cover 53, 54, 60, 61 minutes for Claude;
   26, 27, 30, 31 for Codex; exact expiry, one millisecond after, and clock rollback.
3. Each eligibility rejection independently, including interrupted/error run,
   exactly 20k versus below, missing usage, pending and running work, child and
   delegated chats, dead/unspawned sessions, and Claude 5m/unknown classifications.
4. Usage and init cache classification, mixed/zero evidence, proxy routing,
   session reset, and override validation/cadence with a controlled clock.
5. Concurrent sweeps and completion-triggered checks dispatch once; persisted
   claims survive restart, persistence failure dispatches nothing, ambiguous
   outcomes do not retry, and a new successful real run rearms eligibility.
6. Recorded/mock Codex exchange asserts request method/thread id, empty-response
   handling, deduplication of both event paths, and requests without turn/started.
7. Claude command dispatch hides only internal commands live and after reload.
   Assert persisted idle origin/counts and exactly one completed marker.
8. Assert every activity suppression listed above, adapter and lifecycle clocks,
   offload deadline, fork/rewind exclusion, failure cleanup, and unchanged normal
   compaction. A user send racing selection wins or queues; queued sends arrive
   exactly once in order after the reservation clears.
9. Component checks assert switch test id, save failure behavior, marker label,
   optional counts, tooltip, message-keyed test id, and no transient indicator.

Live QA uses the delay override on an isolated daemon with its own
`MAINFRAME_DATA_DIR` and free `DAEMON_PORT`. At most once per provider, use a small
throwaway Claude chat and Codex chat padded just past 20k context tokens. Confirm
one idle row, absence of all activity effects, queue delivery, and lower input
context on the next real turn versus a matched no-compaction baseline when
provider usage permits comparison. Record unavailable usage comparisons honestly.
Do not make extra paid compaction attempts to obtain measurements. Missing
provider login means BLOCKED for that scenario, without production access.

Capture the Settings toggle on/off and the idle row in light and dark themes,
combining states into 2–3 captures if useful. Report tested SHA and PASS/FAIL/
BLOCKED per scenario. Do not run local Playwright or Tauri e2e suites.

Never kill, restart, or reconfigure `/Applications/Mainframe.app` or port 31415.
Never write `~/.mainframe` except the lane owner's authorized tracker mechanism.
Stop only processes this lane started, by their isolated ports. Preserve other
lanes' servers and browsers. No simulated global keystrokes. Stop for free disk
below 15 GB or critical memory pressure; run at most one owned Cargo build.

## Current source anchors

- `mainframe-chat/src/idle_scanner.rs` defines existing offload timing and
  `idle_since`; `lifecycle_manager/flight_claims.rs` touches activity on both
  entry and exit of `begin_send`. Reuse exclusion without those activity effects.
- `mainframe-adapter-claude/src/session_prompt.rs` writes command envelopes and
  bumps activity; `session_process.rs` also bumps on stdout processing.
- `mainframe-adapter-codex/src/compaction.rs` deduplicates completion events;
  `session_adapter.rs` has no usable command-based compaction trigger.
- `packages/types/src/settings.ts` owns `GeneralConfig` and defaults.
- `GeneralPane.tsx`, `ToggleRow.tsx`, `SystemMessage.tsx`, and
  `ProviderSwitchMarker.tsx` are the existing UI patterns to extend.
