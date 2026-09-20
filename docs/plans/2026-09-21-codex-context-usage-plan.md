# Codex context usage — implementation plan (todo #352)

## Goal

A Codex-backed chat must report context-window occupancy through the same contract a
Claude-backed chat already uses. Today `thread/tokenUsage/updated` is parsed only to
stash `state.last_usage` for the end-of-turn `SessionResult.context_tokens`; the sink's
`on_context_usage` is never called, so no `ChatSurfaceEvent::Usage` is raised, the chat's
`last_context_total_tokens`/`last_context_max_tokens` stay unset, and the façade emits no
`usage_update` — the rail ring and the Summary row render empty for the life of the
session. The estimate fallback can't rescue it either, because `map_codex_model` sets
`context_window: None` on every Codex model and `deriveContextPct` refuses to divide by an
unknown window. This change makes the parent-thread token-usage notification publish a
`ContextUsage` (occupancy, window, percentage) and gives every catalogued Codex model a
context window, with no change to the sink contract, the façade wire shape, or the UI.

## Size

Short form: the expected non-test source diff is roughly 100 lines across 8 files. One
implementation group, TDD inline.

## Established facts

Every line below was verified while planning; the receipt is how to re-derive it.

1. **The wire already carries the window.** `thread/tokenUsage/updated` params are
   `{ threadId, turnId, tokenUsage }` and `tokenUsage` is
   `{ total: TokenUsageBreakdown, last: TokenUsageBreakdown, modelContextWindow: number | null }`.
   Receipt: `codex app-server generate-ts --out <dir>` on codex-cli 0.153.4 →
   `<dir>/v2/ThreadTokenUsageUpdatedNotification.ts` and `<dir>/v2/ThreadTokenUsage.ts`.
   This contradicts the brief's premise that the window must come from a static table; the
   table becomes a fallback, not the primary source.
2. **`TokenUsageBreakdown`** is
   `{ totalTokens, inputTokens, cachedInputTokens, cacheWriteInputTokens, outputTokens, reasoningOutputTokens }`.
   Receipt: `<dir>/v2/TokenUsageBreakdown.ts`. The repo's `CamelUsage`
   (`packages/core-rs/crates/mainframe-adapter-codex/src/types.rs:224`) reads a subset of
   these and stays as-is.
3. **`model/list` carries no window.** `Model` is `{ id, model, upgrade, upgradeInfo,
   availabilityNux, displayName, description, modelSpecialty, hidden,
   supportedReasoningEfforts, defaultReasoningEffort, inputModalities, supportsPersonality,
   multiAgentVersion, additionalSpeedTiers, serviceTiers, defaultServiceTier, isDefault }`.
   Receipt: `<dir>/v2/Model.ts`. The brief's premise is correct *for this RPC only*.
4. **Older builds omit `modelContextWindow`.** The repo's own 0.144.3 capture carries
   `tokenUsage` with only `total` and `last`. Receipt:
   `packages/core-rs/crates/mainframe-adapter-codex/tests/fixtures/collab-delegation-0.144.3.jsonl`
   (`grep -o '"tokenUsage":[^}]*}' <file>`). `#[serde(default)]` on the new field is what
   keeps that capture deserializing.
5. **Packaged per-model windows** (codex-cli 0.153.4's embedded `modelCatalogJson`):
   `gpt-6-astra`, `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-daybreak-blue-latest`,
   `gpt-5.5`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.2`, `codex-auto-review` → `context_window:
   272000`; `gpt-daybreak-red-latest` → `372000`. Receipt:
   dump the binary's strings once
   (`strings -a /opt/homebrew/Caskroom/codex/0.153.4/bin/codex > /tmp/codex_strings.txt`), then
   `grep -nE '"(slug|context_window|max_context_window|display_name)":' /tmp/codex_strings.txt`
   — those four fields appear in that order per model, so each `context_window` belongs to
   the `slug` listed above it. Use `context_window`,
   **not** `max_context_window` — they diverge (`gpt-5.4`: 272000 vs 1000000). This catalog
   is a packaged default that remote config can override at runtime, which is the second
   reason the wire value must win over the table.
6. **`on_context_usage`'s persistence is guarded, its surface notification is not.**
   `packages/core-rs/crates/mainframe-chat/src/event_handler.rs:1226` only writes
   `last_context_total_tokens`/`last_context_max_tokens` when `usage.max_tokens > 0`, but the
   `notify_surface(ChatSurfaceEvent::Usage { .. })` at :1251 runs unconditionally. So an emit
   with a zero window would light the ring without persisting anything — the adapter must
   never emit one.
7. **`docs/plans/` is gitignored** (`.gitignore:53`), so this file is committed with
   `git add -f`. Not a finding, just the mechanics.
8. **No changeset-tracked package covers `packages/core-rs`.** `.changeset/config.json`
   locksteps only `@qlan-ro/mainframe-types` and `@qlan-ro/mainframe-ui`, and `packages/`
   holds no `core` JS package. See Decisions.
9. **The reload seed is already adapter-agnostic.** `persistedContextUsage`
   (`packages/ui/src/features/chat/controller/chat-environment-state.ts:80-85`) rebuilds the
   `contextUsage` slice from the chat row's `lastContextTotalTokens`/`lastContextMaxTokens`
   for any adapter, gated only on `max > 0`, and the columns round-trip through
   `packages/core-rs/crates/mainframe-db/src/chats.rs:23` (select) and `:339` (update). AC 3
   therefore needs no new read-side code — only the write side (fact 6), which this change
   supplies. Its doc comment reads "Null when the chat has never reported (legacy rows,
   codex)" and goes stale the moment this lands.

## Files

Core (all under `packages/core-rs/crates/mainframe-adapter-codex/`):

| File | Change |
| --- | --- |
| `src/context_window.rs` **(new)** | `DEFAULT_CODEX_CONTEXT_WINDOW: i64 = 272_000`; the fact-5 table; `known_context_window(id) -> Option<i64>` (no default) and `catalog_context_window(id) -> i64` (falls back to the default). Inline `#[cfg(test)]` unit tests. |
| `src/lib.rs` | `pub(crate) mod context_window;` in the alphabetical list (after `compaction`). |
| `src/types.rs` | `TokenUsageEnvelope` gains `#[serde(default)] pub model_context_window: Option<i64>` (the struct already renames to camelCase and has no `deny_unknown_fields`). |
| `src/adapter.rs` | `map_codex_model` sets `context_window: Some(catalog_context_window(&m.id))` instead of `None`. |
| `src/session_state.rs` | `CodexSessionState` gains `pub resolved_turn_model: Option<String>` (doc-commented as "the id whose window the context percentage divides by"). |
| `src/session.rs` | In `send_message`, after `resolve_turn_model(..)` succeeds (~:588), store the resolved id on the session state. `model` and `default_model` are already in scope from the config lock above, so the cleanest shape is to move the `resolve_turn_model(..)` call inside the existing `self.state` lock block at ~:581 and write the field there — one lock, not two. This file is already 978 lines; keep the addition to the few lines this needs and add nothing else. |
| `src/turn_lifecycle.rs` | `handle_token_usage` gains a `sink: &Arc<dyn SessionSink>` parameter and, after the existing `state.last_usage` write, resolves a window and emits `sink.on_context_usage(..)`. The `Owner::Parent` guard and the `state.last_usage` write are unchanged. |
| `src/event_mapper.rs:64` | Pass `sink` at the single call site. |

Test:

| File | Change |
| --- | --- |
| `tests/common/mod.rs` | `Recorded` gains `pub context_usages: Vec<ContextUsage>`; `RecordingSink::on_context_usage` pushes instead of no-opping; add a `Recorder::context_usages()` accessor. `ContextUsage` is `Copy`. |
| `tests/context_usage.rs` **(new)** | The acceptance tests below. Uses `mod common;` like `tests/quota_notification.rs`. |

Cleanup (no-leftovers, same pass):

| File | Change |
| --- | --- |
| `packages/ui/src/features/chat/controller/chat-environment-state.ts` | Drop "codex" from `persistedContextUsage`'s doc comment (fact 9); it is the only line in the UI this change falsifies. No code change. |

Release:

| File | Change |
| --- | --- |
| `.changeset/codex-context-usage.md` | Patch changeset (see Decisions for the package name). |

## Behavior to implement

Window resolution inside `handle_token_usage`, in order:

1. `params.token_usage.model_context_window` when `Some(w)` and `w > 0` — the authoritative
   per-thread value (fact 1), which already reflects any remote catalog override.
2. Otherwise `known_context_window(state.resolved_turn_model)` — the **no-default** lookup,
   so an unrecognized id yields nothing here.
3. Otherwise emit nothing and log at `debug` (never `warn` — AC 4). `state.last_usage` is
   still written, so the end-of-turn `context_tokens` path is untouched.

The emitted `ContextUsage`:

- `total_tokens = resolved_usage().input_tokens` — the existing resolution order (legacy
  top-level `usage`, then `tokenUsage.last`, then `tokenUsage.total`) is reused verbatim via
  `TokenUsageUpdatedParams::resolved_usage()`. Cached input tokens are **not** subtracted;
  they occupy the window.
- `max_tokens` = the resolved window.
- `percentage = total_tokens as f64 / max_tokens as f64 * 100.0`. Do not clamp or round in
  the adapter — `deriveContextPct`
  (`packages/ui/src/features/chat/thread/session-bar-status.ts:16`) already does
  `Math.min(100, Math.round(..))`.

Non-parent notifications return before any of this, exactly as today.

## Tests (write first, watch them fail)

In `tests/context_usage.rs`, driven through `handle_notification("thread/tokenUsage/updated", ..)`
with a `Recorder` sink, mirroring `tests/quota_notification.rs`:

1. A parent-thread notification carrying `tokenUsage.modelContextWindow` emits exactly one
   `ContextUsage` whose `total_tokens` is `last.inputTokens`, whose `max_tokens` is the
   reported window, and whose percentage is their ratio.
2. A sub-thread / collab notification (a `threadId` that is not the parent's) emits none.
3. Resolution order feeding the emitted event: a legacy top-level snake_case `usage` wins
   over the envelope; with no `usage`, `tokenUsage.last` wins over `tokenUsage.total`; with
   only `total`, `total` is used.
4. No `modelContextWindow` and a `state.resolved_turn_model` in the table → the table's
   window is used.
5. No `modelContextWindow` and a `resolved_turn_model` absent from the table (or `None`) →
   no event is emitted.
6. In `src/context_window.rs`: `known_context_window` returns the table value for a known id
   (including the 372_000 outlier) and `None` for an unknown one; `catalog_context_window`
   returns the table value for a known id and `DEFAULT_CODEX_CONTEXT_WINDOW` for an unknown
   one.
7. In `src/adapter.rs`'s existing `#[cfg(test)] mod tests`: a mapped model carries a non-null
   `context_window`.

## Risks

- **A second emission source.** The compaction and quota paths also touch the panel; neither
  calls `on_context_usage`, so there is no double-emit risk — but confirm nothing else in the
  codex crate starts calling the sink method.
- **Replay tests.** `tests/collab_delegation.rs` replays the 0.144.3 capture through
  `handle_notification`. With no `modelContextWindow` (fact 4) and no `resolved_turn_model`
  on a default-constructed state, resolution falls through to "skip", so those tests must see
  no behavior change. If one does change, the skip branch is wrong, not the test.
- **Table staleness.** The window table is a snapshot of a packaged default. It is only ever
  consulted when the wire value is absent, and the catalog variant only feeds the UI's
  estimate fallback, so a stale entry degrades an estimate rather than corrupting a reported
  number.
- **`session.rs` size.** Already 978 lines against the repo's 300-line guidance. This change
  adds two or three lines to an existing function; do not take the opportunity to refactor it
  here.

## Decisions

- **Wire value over static table** (overrides the brief's recommendation). The brief assumed
  no window was available from the app-server because `model/list` carries none (fact 3);
  `thread/tokenUsage/updated` does carry one (fact 1). The table is kept as the fallback for
  builds that omit the field (fact 4) and as the source for the catalog's `contextWindow`.
- **Two lookups, deliberately.** AC 2 requires an id absent from the table to resolve to the
  declared default (catalog path, so the UI estimate always has a divisor); AC 4 requires an
  unresolvable window to emit nothing (emission path). One lookup cannot satisfy both. The
  consequence the PM owns: for an unrecognized model id the UI's *estimate* fallback will
  divide by 272_000, which is the AC as written.
- **`context_window`, not `max_context_window`** (fact 5). The larger figure is a ceiling the
  model can be configured up to, not the window a turn actually runs in.
- **Changeset package.** No JS package maps to `packages/core-rs` (fact 8). Use
  `'@qlan-ro/mainframe-types': patch` — the lockstepped package that drives the release tag —
  and describe the user-visible fix. Confirm against a recent Rust-only PR
  (`git log --format=%h -40 -- .changeset/` then inspect) before writing it; if that
  convention differs, follow the convention, not this line.

## Exit gates

- The new and existing `mainframe-adapter-codex` tests pass, including the untouched
  `tests/event_mapper.rs::turn_completed_reports_context_tokens_from_prior_token_usage`,
  which is the regression guard for AC 5 (end-of-turn `contextTokens` unchanged).
- The collab-delegation replay tests still pass unchanged.
- `cargo fmt` and `cargo clippy` are clean for the crate; no new `warn!` on the skip path.
- `src/context_window.rs` is under 300 lines and `src/turn_lifecycle.rs` stays under it too.
- AC 3 holds without new read-side code: after a Codex turn the chat row carries both
  context columns, and reopening the chat shows a non-null percentage via the existing
  `persistedContextUsage` seed (fact 9). Observe it by checking the persisted columns after a
  turn rather than by re-deriving the UI path.
- The changeset exists and names a real package.
