# changelog-watch: codex rust-v0.171.0 → rust-v0.172.0 (2026-11-24)

Entries seen: 82 · risks: 0 · opportunities: 0 · relevant, no action: 10 · dropped as irrelevant: 72

**How the entries were counted.** rust-v0.172.0 has 15 curated bullets and 85 per-PR Changelog lines (`compare/rust-v0.171.0...rust-v0.172.0`). The curated bullets cite 18 of those PRs, and each curated bullet is classified once together with the PRs it cites. That leaves 82 distinct entries: 15 curated and 67 standalone PR lines.

No compatibility risk. I fetched `codex_app_server_protocol.v2.schemas.json` at both tags and compared every definition. Eight changed, all additively, and Mainframe deserializes none of them strictly:

- `CodexErrorInfo` gains the bare strings `apiKeySpendLimitExceeded`, `projectSpendLimitExceeded` and `organizationSpendLimitExceeded`.
- `ModelAccessPrograms` gains an optional `daybreakAvailability`, and the new `DaybreakAvailability` enum is added. `Model` itself is identical.
- `AppToolConfig` gains an optional `approvals_reviewer` (config, not wire traffic Mainframe sees).
- `LoginAccountParams` gains Bedrock Runtime selection. Mainframe never calls the login RPCs.
- `ThreadRealtimeItem`, `ThreadRealtimeFrameChannels` and the new `ThreadRealtimeSessionInputReason` cover realtime voice, which Mainframe doesn't use.

Every other definition is byte-identical, including `Thread`, `Turn`, `ThreadItem`, `ThreadStartParams`, `ThreadResumeParams`, `TurnStartParams`, `TurnSteerParams`, `ThreadForkParams`, `ThreadReadParams`, `ErrorNotification`, `TurnError`, `ThreadTokenUsageUpdatedNotification`, the approval request params, `ServerRequestResolvedNotification`, `AgentMessageDeltaNotification`, `RateLimitSnapshot` and `ConfigReadResponse`. The compare touches no file under `codex-rs/state/`, no state migration and no `models.json`.

Still open from earlier runs: the rust-v0.169.1 low risk (`KNOWN_WINDOWS` lacks `gpt-6.2-sol` and still has `gpt-6.1-sol` at 272K). `models.json` didn't change in this range, so the gap is unchanged.

## Compatibility risks

None.

## Adoption opportunities

None.

## Relevant, no action

- "Codex reports provider errors as soon as they arrive in a response stream and identifies which API spend limit was reached." (#62329, #62356) — `CODEX-EVT-08`/`CODEX-EVT-09`: the three new spend-limit `CodexErrorInfo` strings aren't in the recognised set, so they count as no metadata and the failed turn shows Codex's own text. Earlier delivery only moves the same `error` notification sooner. If spend-limit failures turn out to be common, a dedicated headline in `src/codex_error_info.rs::describe` would be a small polish.
- "Optional stdio MCP servers with cached tool lists now start on their first tool call by default." (#62366) — `CODEX-FLAG-05`: the `mainframe` server is configured by `url`, not as a stdio command, so lazy startup doesn't apply to it.
- "Set an approval reviewer for individual connected app tools in `config.toml`." (#62360) — `CODEX-CTRL-01`: a user-config option. Approvals that reach the client still arrive as the same `requestApproval` requests.
- "Interrupting a parent turn preserves queued replies from child agents for the next turn." (#62348) — `CODEX-RPC-03`/`CODEX-ITEM-03`: `turn/interrupt {threadId, turnId}` is unchanged. Child replies show up in the next turn as ordinary items instead of being lost.
- "`codex exec resume` restores saved sandbox permissions, the working directory, and workspace roots unless explicitly overridden." (#62194) — `CODEX-FLAG-04`: the title one-shot runs `exec --ephemeral`, never `exec resume`.
- "Remote sessions preserve working directories, workspace roots, and writable paths when the client and server run on different operating systems." (#62375, #62376, #62377) — `CODEX-RPC-02`: Mainframe's app-server runs on the same machine, so the cwd it sends is already native. `ThreadStartParams` and `ThreadResumeParams` are identical.
- "App-server clients can select Amazon Bedrock Runtime during setup or sign-in." (#62222) — `CODEX-RPC-05`: an added `LoginAccountParams` arm. Mainframe calls `account/read` and `account/rateLimits/read`, never login.
- #62499 Expose Daybreak availability in model discovery — `CODEX-PROBE-02`: an optional field on `ModelAccessPrograms`. The `Model` fields `map_codex_model` reads are identical.
- #62206 Prevent duplicate initial context when injection races the first turn — `CODEX-RPC-11`: a fix on the path that carries `turn/start.additionalContext`. The param shape is unchanged.
- #62378 / #62419 `thread/sample` prompt limit removed and per-sample model overrides — `CODEX-RPC-04` area: `thread/sample` is a method Mainframe doesn't call. Listed because it sits beside `thread/read`.

Dropped (72): TUI-only bullets and PRs (thread links #62332, slash-argument completion #62343, command-center navigation #62200 and #62335, `PageUp`/`PageDown` answers #62209, cloud reply reconciliation #62403, `/status` versions #62202, hover highlighting #62390 and #62400, transcript overlay routing #62384, sidebar previews #62362, custom status lines #62387); docs (#62447); Code Mode gRPC, preloads and nested results (#62476, #62430, #62423); Python tooling hashes (#62346); about 15 Guardian review and policy PRs; about 10 sandbox launcher, Seatbelt, Linux and Windows MXC PRs; realtime voice (#62245, #62251, #62271, #62288, #62299); connector and Apps result passthrough (#62388, #62392, #62421, #62434, #62474); MCP message boards, agent mailbox and tracing (#62284, #62292, #62302, #62320, #62373); remote exec-server Noise (#62325); rollout budget and trace dedupe (#62190, #62407); telemetry counters and latency metrics (#62225, #62326, #62357, #62507); config internals (#62337, #62358, #62370, #62432, #62435); provider policy errors (#62354); Git worktree status deferral (#62437); and future-boxing refactors (#62420, #62477).
