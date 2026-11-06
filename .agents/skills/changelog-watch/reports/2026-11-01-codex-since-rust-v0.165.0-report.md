# changelog-watch: codex rust-v0.165.0 → rust-v0.166.0 (2026-11-01)

Entries seen: 255 · risks: 1 · opportunities: 3 · relevant, no action: 25 · dropped as irrelevant: 226

**How the entries were counted.** The delta has 16 curated bullets and 264 per-PR Changelog lines. The curated bullets cite 25 of those PRs, and each curated bullet is classified once together with the PRs it cites. That leaves 255 distinct entries: 16 curated and 239 standalone PR lines.

Main points: this release has no new compatibility risk. The one risk below is the unfixed 2026-10-28 Terra context window, cited again because #57293 lands in this range; `models.json` is identical for Terra at both tags. The change that looked most dangerous, the idle-thread unload delay dropping from 30 minutes to 60 seconds (#57242), does not reach Mainframe: the app-server README at `rust-v0.166.0` says starting, resuming or forking a thread subscribes the connection until `thread/unsubscribe` or disconnect, and a chat's app-server holds its stdio connection for the chat's lifetime. Item notifications gain additive `startedAtMs`/`completedAtMs` fields, and the lenient item deserializer tolerates them. The installed CLI is still 0.163.0, so nothing was run live. The state DB is still `state_5.sqlite`; the NFS journaling PRs change the journal mode only on NFS and leave the filename alone.

## Compatibility risks

### low — Added GPT-6.1 Terra to the bundled, Vertex AI, and Amazon Bedrock model catalogs. (#57293) (rust-v0.166.0)

- Checklist row: `CODEX-PROBE-02`. Consumers: `src/adapter.rs::map_codex_model` → `src/context_window.rs::catalog_context_window`; emission fallback `known_context_window`.
- Why it threatens the row: this is the 2026-10-28 risk again, still open. `codex-rs/models-manager/models.json` at `rust-v0.166.0` lists `gpt-6.1-terra` with `context_window: 500000` (unchanged from 0.165.0), and `KNOWN_WINDOWS` on `origin/main` still has no entry for it. The catalog path therefore reports 272K, and the gauge divides by 272K whenever `tokenUsage.modelContextWindow` is absent. #57293 also makes Terra GCP's preferred memory-consolidation model, which doesn't affect Mainframe. Correction to the 10-28 report: Terra is *not* the only non-272K model; `gpt-daybreak-red-latest` is 372K, but the table already covers it.
- Recommended regression test: unchanged from 2026-10-28. Add `#[test] known_context_window_returns_the_terra_6_1_window` in `src/context_window.rs` (`mod tests`) asserting `known_context_window(Some("gpt-6.1-terra")) == Some(500_000)`, and a `tests/list_models.rs` case pinning a `model/list` entry `{"id":"gpt-6.1-terra","model":"gpt-6.1-terra","displayName":"GPT-6.1 Terra",…}` whose mapped `context_window == Some(500_000)`.
- Verify live: .claude/skills/codex-protocol-debugger/. After upgrading, check whether `thread/tokenUsage/updated` carries `modelContextWindow: 500000` on a Terra 6.1 turn.
- Todo: do not file a second one if the 10-28 draft was filed; otherwise file the draft below once.

## Adoption opportunities

- **Item lifecycle timestamps** (#57172 Expose lifecycle timestamps on app-server thread items). Nullable `startedAtMs`/`completedAtMs` (Unix ms) on every `ThreadItem`, in live `item/started`/`item/completed` and in `thread/read` history, preserved across resume and pagination. The JSON payload stays flat, so `CODEX-ITEM-01`'s lenient deserializer ignores the fields today (no `deny_unknown_fields` in the crate; covered by `tests/item_types.rs::sub_agent_activity_tolerates_an_unknown_extra_field`). It would land in `src/thread_item_variants.rs` plus the render path as real per-tool durations, including on reload. A command's start time is recorded during approval, so the duration includes the approval wait. Size: small.
- **`features.plugin_discovery_prefetch = false`** (#57249). This is a stable flag that skips the plugin directory, featured plugins and recommendations fetch at app-server startup. Mainframe's temporary app-servers (models, quota, history reconstruction) never use plugins and would start with less network work if `CODEX-FLAG-01`'s argv added `-c features.plugin_discovery_prefetch=false` for those spawns only. It would land in `src/session.rs::build_app_server_command` (temp-server variant). Size: small.
- **ChatGPT workspace switching** (#57514, experimental; the README documents `accountSession/list` and `accountSession/switch`). Switching stops loaded threads and emits `thread/closed`, which `CODEX-EVT-02` currently ignores, plus `account/updated`. It would land beside `src/quota_pull.rs`/`CODEX-RPC-05` as a workspace picker in Codex provider settings. Adopting it would also require handling `thread/closed`. Size: medium.

## Relevant, no action

**Curated bullets**

- Preserved acknowledged approval and permission settings when resuming or forking threads. (#57227) — `CODEX-RPC-07`/`CODEX-RPC-02b`: Mainframe sends explicit `approvalPolicy`/`sandbox` on resume, and its forks inherit by omission. This makes the inherited policy stick, and neither request shape changes.
- Fixed app-server thread startup and shutdown races and released completed runtimes promptly. (#57787, #57788) — `CODEX-RPC-02`: an upstream fix to the `thread/start`/`thread/resume` lifecycle Mainframe already relies on, with no shape change.
- Preserved reasoning-token accounting across resume and fork to avoid premature compaction. (#57839) — `CODEX-EVT-04`: resumed and forked chats report correct reasoning totals in `tokenUsage`, and the `{last,total}` shape is unchanged.

**Standalone PR lines**

- #57242 Reduce the default thread unload delay to one minute — `CODEX-RPC-03`: unload requires *no subscribers*. Start, resume and fork subscribe the connection until unsubscribe or disconnect (README, `rust-v0.166.0`), Mainframe never calls `thread/unsubscribe`, and each chat app-server keeps its stdio connection open, so an idle chat stays loaded.
- #57840 Validate thread providers before resume and input — `CODEX-RPC-02`/`CODEX-RPC-03`: this rejects resume or input only when the configured provider no longer matches the chat's. Mainframe never changes providers, and a mismatch fails the request visibly with structured `ModelProviderError` data.
- #57420 Make thread item timestamps optional in TypeScript exports — `CODEX-ITEM-01`: a TypeScript-only optionality change for the #57172 fields; the Rust consumer doesn't read them.
- #57513 Replace the npm wrapper with the native binary using `execve` — `CODEX-FLAG-01`: for npm installs, the PID Mainframe spawns now *is* the native app-server, so the daemon's kill and exit status reach it directly instead of via Node. Argv and env are preserved. Homebrew/native installs are unaffected.
- #57352 Preserve child signal failures in the npm wrapper — `CODEX-FLAG-01`: the spawn-fallback path (Windows, old Node) reports the child's signal correctly, and exit handling only improves.
- #57181 Add optional names to untrusted additional context — `CODEX-RPC-11`: an optional field on `untrusted` entries. Mainframe sends one `kind: "application"` entry.
- #57279 Render untrusted additional context as named tool outputs — `CODEX-RPC-11`: affects only `untrusted` entries, behind a flag; `application` entries render as before.
- #57204 Register the `untrusted_as_tool_output` feature flag — `CODEX-RPC-11`: this is the flag gating #57279, off by default and irrelevant to `application` kind.
- #57196 Isolate MCP inputs and timeouts for callers sharing a connection — `CODEX-FLAG-05`: per-call isolation. Each chat's `mainframe` server has one app-server caller, and `tool_timeout_sec` is still honoured per server.
- #57210 Add opt-in protocol discovery for local stdio MCP servers — `CODEX-FLAG-05`: stdio-only and opt-in; the `mainframe` server is streamable HTTP.
- #57211 Share eligible local stdio MCP connections across chats — `CODEX-FLAG-05`: stdio-only. The HTTP `mainframe` server and its per-chat bearer token are not shared.
- #57552 Expose and persist image generation IDs — `CODEX-ITEM-01`: an additive field on `ImageGeneration`. The 2026-10-24 high (`fileId` move) remains the open item on that variant.
- #57542 Add model-gated literature search to standalone web search — `CODEX-ITEM-04`: any new action tag falls back to the `search` face via `#[serde(other)]`.
- #57251 Show native dollar thread usage for ENT26 plans — `CODEX-RPC-05`: adds `nativeUsageUsdMicros` to `ThreadUsage` (account token usage), not to `account/rateLimits/read`, which is the only quota RPC Mainframe calls.
- #57538 Preserve host-assigned user input IDs in Responses messages — `CODEX-RPC-07c`: a core-only `user_item_uuid`; no `app-server-protocol` file changes, so the `userMessage` ids the fork-from-message pin matches are unchanged.
- #57358 Serialize session index mutations across processes — `CODEX-FILE-01`: fixes concurrent writers. Mainframe runs several app-servers but only reads rollouts.
- #57360 Bound waits for the thread writer coordination lock — `CODEX-FILE-02`: writer-side locking. Mainframe's `state_5.sqlite` query is read-only.
- #57185 Centralize unified exec output rendering — `CODEX-FILE-04`: refactors model-facing output text (omission markers kept); nothing indicates the rollout `custom_tool_call_output` array envelope changes. Watch on the next live capture.
- #57191 Read unified exec output directly from stdout and stderr — `CODEX-FILE-04`: drops the lossy broadcast channel, so captured output is more complete, not differently shaped.
- #57452 Distinguish policy-restricted capacity failures from server overloads — `CODEX-RPC-03`: a new failure classification on the existing failed-turn path, which Mainframe renders as text.
- #57757 Expose Guardian assessments in response streams — `CODEX-EVT-03`: Guardian runs only with `auto_review`, which Mainframe never sends, and any raw-event traffic hits the `codex/event/*` drop.
- #57800 Backfill exec completion items through paginated history — `CODEX-FLAG-04`: `codex exec` now recovers dropped items via `thread/items/list` on paginated threads. The ephemeral title one-shot isn't paginated, keeps the `thread/read` path, and its stdout final answer is unchanged.

Dropped (226): 12 curated bullets (transcript selection; TUI Markdown; `codex queue --resume`; TUI safety-block explanations; `codex doctor --network-only`; composer image restore; macOS standalone pruning; unarchiving descendants, since Mainframe never archives; TUI reconnect; Bazel V8; standalone executor packaging; Node/Rust toolchain pins) and 214 standalone PR lines. By category: Guardian reviewer crate moves and context preparation (~40); message boards; multi-agent V2 spawning and prediction forks; code-mode host and gRPC; plugin process host, V8 runtime and plugin catalogs; skill catalog deltas and description omission; runtime/gateway/FedRAMP auth, GCP/Vertex/Bedrock provider setup and the experimental GCP account RPC; MITM proxy, network proxy and managed requirements; OpenTelemetry config and redaction (`config/read` reads only `config.model`); rollout *traces* (#57193, #57194, #57199, #57280, #57311, #57615; diagnostics, not rollout files); NFS SQLite journaling and migration; memory baselines and consolidation; model-catalog approval-wording fields (#57263, #57325, #57581, #57599; prompt text, not `model/list` fields); `process/*` exec backpressure (#57569; Mainframe doesn't call `process/*`); `review/start` detached delivery (#57667; not called); remote app-server WebSocket compression; critical-path timing and analytics; TUI, status line and resume picker; Windows/WSL/MXC; exec-server packaging (#57589, #57590, #57628); Bazel, CI, release tooling, advisories and dependency bumps; test-only changes; refactors with no stated behaviour change (#57260, #57261, #57278, #57435, #57438, #57575).

## Carry-overs (not re-checked this run)

The 2026-10-24 high on `CODEX-ITEM-01` (generated images moved to `fileId`) and the 2026-10-17 medium on `CODEX-FILE-01` (compressed rollouts) are untouched by this release.
