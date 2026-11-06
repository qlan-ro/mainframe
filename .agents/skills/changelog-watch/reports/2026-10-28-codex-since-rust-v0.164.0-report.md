# changelog-watch: codex rust-v0.164.0 → rust-v0.165.0 (2026-10-28)

Entries seen: 67 · risks: 1 · opportunities: 3 · relevant, no action: 9 · dropped as irrelevant: 54

**How the entries were counted.** The delta has 12 curated bullets and 68 per-PR Changelog lines. The curated bullets cite 13 of those PRs, and each curated bullet is classified once together with the PRs it cites. That leaves 67 distinct entries: 12 curated and 55 standalone PR lines.

Main points: there is one new model with a non-default context window that Mainframe's static table doesn't know. The new app-server surfaces are experimental and opt-in (`thread/fork attachToSource`, `thread/memory/read`, `thread/sample threadSource`). Codex now sends MCP cancellations, and Mainframe's orchestration server already handles them. The installed CLI is still 0.163.0, so nothing was run live. The state DB is still `state_5.sqlite`, and no PR in this release touches it.

## Compatibility risks

### low — Added GPT-6.1 Terra to the model catalogs. (#57337) (rust-v0.165.0)

- Checklist row: `CODEX-PROBE-02`. Consumers: `src/adapter.rs::map_codex_model` → `src/context_window.rs::catalog_context_window`. The emission fallback is `known_context_window`.
- Why it threatens the row: `codex-rs/models-manager/models.json` at `rust-v0.165.0` lists `gpt-6.1-terra` with `context_window: 500000` (`max_context_window: 872000`). It is the only listed model whose window isn't the 272K default. `KNOWN_WINDOWS` has no entry for it, so the catalog path reports `AdapterModel.contextWindow = 272_000`. That understates the window by about 45%, so the picker shows the wrong size, and the context gauge divides by 272K whenever `tokenUsage.modelContextWindow` is missing from the wire. Nothing errors. It is rated low because the gauge uses the wire value when it is present. The table also lacks `gpt-6.1-sol`, `gpt-6-sol` and `gpt-6-luna`, but they are 272K and the default covers them.
- Recommended regression test: add `#[test] known_context_window_returns_the_terra_6_1_window` in `src/context_window.rs` (`mod tests`), asserting `known_context_window(Some("gpt-6.1-terra")) == Some(500_000)`. Add a `tests/list_models.rs` case that pins a `model/list` entry `{"id":"gpt-6.1-terra","model":"gpt-6.1-terra","displayName":"GPT-6.1 Terra",…}` and asserts the mapped `context_window == Some(500_000)`.
- Verify live: .claude/skills/codex-protocol-debugger/. After upgrading to 0.165.0, check whether `thread/tokenUsage/updated` carries `modelContextWindow: 500000` for a Terra 6.1 turn.

## Adoption opportunities

- **`thread/fork` `attachToSource`** (experimental; Added experimental attached thread forks to the app-server API. (#56351)). This persists a fork attached to its source without emitting `thread/started`, and hides it from ordinary listings. `thread/list` gains `attachedToThreadId`, and deleting the source is rejected while attached forks exist. The flag is optional and not combinable with `ephemeral`, so the `CODEX-RPC-07` fork Mainframe sends is unchanged. It would land next to `src/fork.rs` as a hidden side thread for side questions or `/btw`-style probes that shouldn't appear in the user's `/resume` list. Size: medium.
- **`thread/memory/read`** (experimental, #56465) returns `{summary}` from the thread's memory version, or `null`. It would land as a read-only memory view in the chat sidebar. It is low value until Mainframe surfaces Codex memory at all. Size: small.
- **`thread/sample` `threadSource`** (#56364): an optional source tag on the sampling fork. This amends the 2026-10-24 `thread/sample` opportunity (replacing the `CODEX-FLAG-04` title one-shot). A title sample could tag itself so it doesn't count as a user thread. Size: none beyond the standing medium.

## Relevant, no action

**Curated bullets**

- Enabled reasoning effort changes during a conversation by default for supported models. (#56163) — `CODEX-RPC-03`/`CODEX-FLAG-02`: `reasoning_effort_override` is promoted to stable. A per-turn `collaborationMode.settings.reasoning_effort` change now also reaches the model as a configuration update in history. The request shape is unchanged, so Mainframe's mid-chat effort switches work better.
- Cancelled remote MCP tool requests when their local response futures are dropped. (#56132) — `CODEX-FLAG-05`: interrupting a turn during a long `mainframe` tool call now sends `notifications/cancelled`. `mainframe-orchestration/src/dispatch.rs::on_notification` already maps `requestId` to `cancel_call`, so the server-side wait now ends instead of running on.
- Stopped retrying when a provider reports that a model was not found, preserving its error message. (#56445) — `CODEX-RPC-03`: a bad model now fails the turn quickly with the provider's message. The failed-turn path is already handled.
- Prevented queued agent messages from restarting work after an interrupt or a switch to Plan mode. (#56330) — `CODEX-RPC-03`: `turn/interrupt` now sticks when sub-agent mail arrives afterwards. This helps Mainframe, and the shape is unchanged.

**Standalone PR lines**

- #56124 Forward Guardian reviewer events to parent raw-event subscribers — `CODEX-EVT-03`: more `codex/event/*` traffic, dropped by the blanket prefix match. Mainframe never enables `auto_review`.
- #56224 Reuse current model context across paginated resume config loading — `CODEX-RPC-02`: a resume-path optimization. Mainframe sends an explicit model on resume.
- #56250 Avoid redundant settings checkpoints when resuming threads — `CODEX-FILE-01`: fewer `ThreadSettingsApplied` rollout records. Mainframe reads none of them.
- #56278 Add negotiated network policy metadata support for MCP calls — `CODEX-FLAG-05`: advertised only to trusted ChatGPT origins, so the `127.0.0.1` `mainframe` server never receives it.
- #56284 Scope model catalogs and caches by thread originator — `CODEX-RPC-05`: only supported originators get separate catalogs. Mainframe's `clientInfo.name` is `mainframe` (`session_spawn.rs`), so it stays on the default manager and catalog.

Dropped (54): 6 curated bullets (the Vertex AI `gcp` provider; the TUI repository filter; memory v2 default and imports; TUI approval-reviewer default; TUI preferences; marketplace URL validation) and 48 standalone PR lines. By category: Guardian v3 and message boards; multi-agent mail; environment hooks and managed config loaders; enterprise MCP auth, disable reasons and network review domains; AWS SigV4 and MITM proxy; auth caching and EMA; memory imports and consolidation; rollout traces (#56312, #56342; diagnostics only, not rollout files); model-catalog overrides for internal tools; writable-root prompt wording; prompt telemetry; TUI; Windows/WSL; V8; Python SDK; Bazel, CI, release tooling and dependency bumps; test-only changes.

## Carry-overs (not re-checked this run)

The 2026-10-24 high on `CODEX-ITEM-01` (generated images moved to `fileId`) and the 2026-10-17 medium on `CODEX-FILE-01` (compressed rollouts) are untouched by this release.
