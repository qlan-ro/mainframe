# ACP (Agent Client Protocol) for Mainframe

Evaluation of the [Agent Client Protocol](https://agentclientprotocol.com) at
two boundaries:

- **A — the adapter boundary.** Mainframe's Rust daemon spawns coding-agent CLIs
  as children behind the `Adapter`/`AdapterSession`/`SessionSink` traits
  (`packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs`). ACP is a
  client↔agent protocol, so this is where it actually belongs: the daemon would
  be the ACP *Client*, the agent CLI (or a bridge wrapping it) the ACP *Agent*.
- **B — the daemon↔UI boundary.** Same question the prior survey asked of AG-UI,
  AssistantTransport and UI Message Stream v1
  ([WIRE-PROTOCOL-SURVEY.md](WIRE-PROTOCOL-SURVEY.md)). ACP is not a UI protocol,
  but unlike those three it has a mid-run inbound request, so it is worth scoring
  rather than dismissing.

Companion to [AG-UI-EVALUATION.md](AG-UI-EVALUATION.md); same method — every
claim cited to a file in a cloned source tree, a registry/npm/crates.io response,
or a repo path here.

## Sources and versions

| Source | Version / commit | Date read |
|---|---|---|
| `agentclientprotocol/agent-client-protocol` (spec + schema, clone) | `d0370de50e16` (`main`); schema crate `1.7.0`, v1 schema `1.21.0` | 2026-08-28 |
| ACP **protocol v1** (stable baseline) | `schema/v1/schema.json`, `schema/v1/meta.json`, `agent-client-protocol-schema/src/v1/*.rs` | 2026-08-28 |
| ACP **protocol v2** (draft) | `schema/v2/schema.json`, `docs/protocol/v2/migration.mdx`, `docs/announcements/acp-v2-draft.mdx` (published 2026-07-20) | 2026-08-28 |
| ACP Rust SDK (`agentclientprotocol/rust-sdk`, clone) | `754d5aa1ce2c`; `agent-client-protocol` **2.0.0** on crates.io (2026-07-23), 77 versions since 0.0.10 (2025-07-24), 3.98M downloads / 1.84M recent | 2026-08-28 |
| ACP TypeScript SDK | `@agentclientprotocol/sdk` **1.4.0** npm latest, 50 versions, first 2025-10-10 | 2026-08-28 |
| Claude ACP bridge (`agentclientprotocol/claude-agent-acp`, clone) | `14d192d1087e`; npm `@agentclientprotocol/claude-agent-acp` **0.70.0**, 64 versions, first 2026-03-26. Predecessor `@zed-industries/claude-code-acp` (0.16.2) is **deprecated** on npm | 2026-08-28 |
| Codex ACP bridge (`agentclientprotocol/codex-acp`, clone) | `@agentclientprotocol/codex-acp` **1.7.0**, 31 versions, first 2026-04-24; wraps `@openai/codex ^0.148.0` | 2026-08-28 |
| ACP agent registry | `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json` — 39 agents | 2026-08-28 |
| t3code (`pingdotgg/t3code`, clone) | `main`; `packages/effect-acp`, `apps/server/src/provider/**` | 2026-08-28 |
| Mainframe Claude consumed surface | [`adapters/claude/CONSUMED-SURFACE.md`](adapters/claude/CONSUMED-SURFACE.md) (CLI 2.1.220) | working tree |
| Mainframe Claude ↔ Agent SDK parity | [`adapters/claude/AGENT-SDK-PARITY.md`](adapters/claude/AGENT-SDK-PARITY.md) (SDK 0.3.247 / CLI 2.1.247) | working tree |
| Mainframe Codex consumed surface | [`adapters/codex/CONSUMED-SURFACE.md`](adapters/codex/CONSUMED-SURFACE.md) | working tree |
| Mainframe adapter contract | `packages/core-rs/crates/mainframe-adapter-api/src/adapter.rs` | working tree |

**Baseline note.** The repo publishes four schemas: v1 stable, v1 unstable, v2
stable-draft, v2 unstable (`schema/{v1,v2}/{schema,schema.unstable}.json`). Unless
a row says otherwise, everything below is **v1 stable**. Items behind
`unstable_*` cargo features or in v2 are tagged inline.

**Ownership note.** The project moved from `zed-industries/` to its own
`agentclientprotocol/` GitHub org, with a published governance model
(`GOVERNANCE.md` → `agentclientprotocol.com/community/governance`) and two lead
maintainers — Ben Brandt (Zed) and Sergey Ignatov (JetBrains), plus core
maintainers from JetBrains and Rust project leadership (`MAINTAINERS.md`, last
updated 2026-06-01). This is materially stronger governance than AG-UI's
repo-level model.

## Protocol surface (v1 stable)

### Transport

`docs/protocol/v1/transports.mdx` defines exactly one transport: **stdio** — the
client launches the agent as a subprocess and exchanges newline-delimited
JSON-RPC 2.0 over stdin/stdout, with stderr free for logs. "Streamable HTTP" is
listed as *"In discussion, draft proposal in progress."* Custom transports are
explicitly permitted but unspecified.

The remote transport is an active RFD
(`docs/rfds/streamable-http-websocket-transport.mdx`, authors from Block/Goose,
championed by a JetBrains core maintainer; a Transports Working Group was
announced 2026-04-22). It proposes a single `/acp` endpoint with long-lived GET
SSE streams (one connection-scoped, one per session), POST returning `202`, plus
a `Upgrade: websocket` alternative, targeted at v1 as additive. It states plainly
that in v1 "**In-flight messages are not replayed**… server→client messages
emitted while a client was disconnected are not redelivered on reconnect", and
that reconnect/liveness are implementer responsibilities.

Ahead of the spec, the Rust SDK already ships
`agent-client-protocol-http` 2.0.0 — "HTTP and WebSocket transport for the Agent
Client Protocol", with `client.rs`, `http_server.rs`, `websocket_server.rs`
(`rust-sdk/src/agent-client-protocol-http/`).

### Methods

From `schema/v1/meta.json` (stable) and `meta.unstable.json`:

**Agent methods (client → agent), stable:** `initialize`, `authenticate`,
`session/new`, `session/load`, `session/set_mode`, `session/set_config_option`,
`session/prompt`, `session/cancel`, `session/list`, `session/delete`,
`session/resume`, `session/close`, `logout`.

**Client methods (agent → client), stable:** `session/request_permission`,
`session/update`, `fs/read_text_file`, `fs/write_text_file`, `terminal/create`,
`terminal/output`, `terminal/release`, `terminal/wait_for_exit`,
`terminal/kill`, `elicitation/create`, `elicitation/complete`.

**Protocol:** `$/cancel_request`.

**Unstable (feature-gated):** agent-side `providers/list|set|disable`,
`session/fork`, `mcp/message`, `nes/*` (next-edit suggestions), `document/did*`;
client-side `mcp/connect|message|disconnect`.

**v2 draft** removes `fs/*`, `terminal/*` and `session/set_mode` entirely, folds
`session/load` into `session/resume` with a `replayFrom`, renames
`authenticate`/`logout` to `auth/login`/`auth/logout`, and makes
`session/list`/`session/close`/`session/resume` required rather than
capability-gated (`docs/protocol/v2/migration.mdx`).

### Initialization and capabilities

`initialize` negotiates a single integer major protocol version plus capability
objects (`docs/protocol/v1/initialization.mdx`). Omitted capability = unsupported;
adding capabilities is explicitly not a breaking change. Client capabilities:
`fs.readTextFile`, `fs.writeTextFile`, `terminal`, `auth.terminal`,
`elicitation.{form,url}`, `session.configOptions.boolean`. Agent capabilities:
`loadSession`, `promptCapabilities.{image,audio,embeddedContext}`,
`mcpCapabilities.{http,sse}`, `auth.logout`, and a `sessionCapabilities` group
(`delete`, `resume`, `close`, `list`, `fork` (unstable),
`additionalDirectories`). Custom capabilities ride in `_meta`
(`docs/protocol/v1/extensibility.mdx`).

### Session lifecycle

- `session/new { cwd, mcpServers }` → `{ sessionId }`. `cwd` MUST be absolute and
  is the session's filesystem root; `additionalDirectories` widens the root set.
- `session/load` (gated on `loadSession`) — the agent **MUST replay the entire
  conversation** as `session/update` notifications, then answer the request.
- `session/resume` (gated on `sessionCapabilities.resume`) — restores context
  **without** replaying history.
- `session/list`, `session/delete`, `session/close` — each capability-gated;
  `close` cancels ongoing work and frees resources.
- `session/fork` — **unstable only**.

### `session/update` variants

`agent-client-protocol-schema/src/v1/client.rs:99` (`SessionUpdate`, tagged by
`sessionUpdate`, `#[non_exhaustive]`):

`user_message_chunk`, `agent_message_chunk`, `agent_thought_chunk` (each a
`ContentChunk` with optional `messageId`); `tool_call`, `tool_call_update`;
`plan`; `available_commands_update`; `current_mode_update`;
`config_option_update`; `session_info_update`; `usage_update`. Unstable adds
`plan_update`/`plan_removed`, `notice` (severity/title/description advisories,
explicitly "not part of session history"), and
`compaction_update`/`compaction_summary_chunk`.

`UsageUpdate` is `{ used: u64, size: u64, cost?: { amount, currency } }`
(`client.rs:607`) — context-window occupancy plus money, not per-turn token
counts.

Tool calls (`v1/tool_call.rs`): `toolCallId`, `title`, `kind` ∈ {`read`, `edit`,
`delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode`, `other`},
`status` ∈ {`pending`, `in_progress`, `completed`, `failed`}, `content[]` (a
`Content` block, a `Diff {path, oldText?, newText}`, or a `Terminal {terminalId}`),
`locations[]` (`{path, line?}` — the "follow the agent" surface), `rawInput`,
`rawOutput`, `_meta`. `ToolCallUpdate` is a sparse patch over the same fields;
`name` is unstable-only.

### Permission model — the decisive detail

Confirmed against both the sequence diagram in `docs/protocol/v1/prompt-turn.mdx`
and the schema: **`session/request_permission` is an agent→client JSON-RPC
*request*, issued mid-turn while `session/update` notifications keep streaming,
and the agent blocks on the client's response.** The turn is not terminated,
no run boundary is fabricated, and the diagram shows it nested inside the
"until completion" loop, between the `tool_call` update and the
`status: in_progress` update. This is precisely the property AG-UI,
AssistantTransport and UI Message Stream v1 all lacked.

The payload is narrow (`v1/client.rs:966`):

```
RequestPermissionRequest { sessionId, toolCall: ToolCallUpdate, options: PermissionOption[], _meta? }
PermissionOption          { optionId, name, kind, _meta? }
PermissionOptionKind      allow_once | allow_always | reject_once | reject_always
RequestPermissionResponse { outcome, _meta? }
RequestPermissionOutcome  cancelled | selected { optionId }
```

**The response carries an option id and nothing else.** There is no
`updatedInput`, no `updatedPermissions`, no rule/suggestion vocabulary, no
per-answer execution-mode or clear-context payload. All semantics must be
pre-baked by the agent into the option list; the client is a button renderer.
Cancellation is mandated: on `session/cancel` the client MUST answer every open
permission request with `outcome: "cancelled"`.

**v2 does not change this.** The v2 draft's "more flexible permission requests"
(`docs/protocol/v2/migration.mdx`, PR #1577) adds a required `title`, an optional
`description`, and an extensible `subject` replacing the hard-wired `toolCall`
(`schema/src/v2/client.rs`) — richer *presentation*, same selection-only outcome.
v2 does add an untagged `Other` escape variant to the outcome enum, with the rule
that agents which don't understand it "MUST NOT treat it as approval".

### Modes, config options, slash commands, elicitation

- **Session modes** — `session/set_mode` + `current_mode_update`; the agent
  advertises `SessionModeState { currentModeId, availableModes[] }`. Changeable
  "at any point during a session, whether the Agent is idle or generating"
  (`docs/protocol/v1/session-modes.mdx`). Removed in v2 in favour of config options.
- **Session config options** — a typed key/value settings surface
  (`select` with grouped options, `boolean`), with a
  `SessionConfigOptionCategory` that includes a model category. This is how ACP
  agents expose model pickers, reasoning effort, and similar tuning.
- **Slash commands** — `available_commands_update` carrying
  `AvailableCommand { name, description, input }`; the agent may revise the list
  at any time.
- **Elicitation** — `elicitation/create` + `elicitation/complete`, stabilized in
  schema 1.21.0 (2026-08-20). Form and URL modes, capability-negotiated. This is
  the structured-question channel, distinct from permissions.

### Client-side services

`fs/read_text_file` / `fs/write_text_file` let the agent route file I/O through
the client (so unsaved editor buffers win). `terminal/*` (create, output,
wait_for_exit, kill, release) let the agent run commands in the client's
terminal, with `ToolCallContent::Terminal { terminalId }` embedding live output
in a tool card. **Both families are removed in v2**, replaced by client-provided
MCP servers and a display-only agent-owned terminal surface.

### Extensibility

`_meta` on essentially every request, response, notification and nested struct;
`_`-prefixed values reserved for implementation-specific enum extensions (v2
generalizes this to every enum and tagged union). MCP passthrough exists as
`mcp/connect|message|disconnect` behind `unstable_mcp_over_acp`; stable v1 MCP
support is limited to *declaring* servers (stdio/http/sse) at session setup.

### Maturity signals

- v1 stable since 2026 with a working RFD process: `docs/rfds/` holds 30+ RFDs
  and `docs/announcements/` records ~14 dated stabilizations in 2026 alone —
  `session/list`, `session/resume`, `session/close`, `session/delete`,
  `session_info_update`, `session/usage`, elicitation, message-id,
  request-cancellation, additional-directories, boolean config options,
  model-config category, logout, agent registry.
- Schema releases are semver'd and changelogged per version line
  (`schema/v1/CHANGELOG.md` at 1.21.0). Rust SDK at 2.0.0. TS SDK at 1.4.0.
- 39 agents in the official registry, including Gemini CLI (`--acp` native),
  GitHub Copilot CLI, Cursor, OpenCode, Goose, Amp, Cline, Devin, JetBrains
  Junie, Kimi, Qwen, Mistral Vibe, Google Antigravity, Factory Droid, Kilo,
  Poolside, Snowflake Cortex Code, plus the Claude and Codex bridges.
- Cost: v2 is a real breaking revision (published draft 2026-07-20) that removes
  three whole method families, and the guidance is to run v1 and v2 side by side
  indefinitely.

Read plainly: ACP is a genuinely healthier standard than the UI-side candidates —
multi-vendor governance, a working change process, a large agent ecosystem, and a
Rust SDK we could actually use. The problems below are about *fit*, not health.

---

## Boundary A — ACP as the adapter-side standard

### A.0 What the bridge topology actually is

Neither Claude Code nor Codex speaks ACP. Both are reached through a Node bridge:

- **Claude:** `@agentclientprotocol/claude-agent-acp` is a stdio ACP agent that
  drives `@anthropic-ai/claude-agent-sdk` 0.3.238 (`cc-acp/package.json`), which
  in turn spawns the Claude CLI. Adopting it means
  `mainframe-daemon (Rust) → node bridge → Agent SDK → claude CLI`, adding one
  process, one Node runtime, and one translation layer versus today's
  `daemon → claude CLI`.
- **Codex:** `@agentclientprotocol/codex-acp` "starts the Codex App Server,
  translates ACP requests into Codex operations, and maps Codex events back"
  (`codex-acp/README.md`). That is the *same* app-server JSON-RPC that
  `mainframe-adapter-codex` already speaks natively (CODEX-RPC-01..05) — so for
  Codex, ACP is a strictly-added hop over a protocol we already consume directly.

Both bridges are maintained under the ACP org, not by Anthropic or OpenAI.

The Claude bridge is not a thin shim — 16.5k lines of non-test TypeScript
(`acp-agent.ts` alone is 9,573 lines) plus 47k lines of tests, and three of its
own documented ACP extensions (`docs/permission-extension.md`,
`docs/goal-extension.md`, `docs/session-failure-extension.md`). It is far more
capable than a naive reading of ACP's surface suggests. It is also versioned
`0.70.0`, ships breaking-ish features weekly (64 npm releases since 2026-03-26),
and defines a private `_claude/*` / `claudeCode.*` `_meta` namespace that is *not*
part of ACP.

### A.1 Claude consumed-surface loss table

Row IDs from [CONSUMED-SURFACE.md](adapters/claude/CONSUMED-SURFACE.md). "Via
bridge" = reachable through `claude-agent-acp` 0.70.0 as an ACP client.
**bold** in the Notes column marks where the capability exists only as a
bridge-private `_meta` extension, i.e. off-protocol.

| ID | Surface | Via ACP bridge? | Notes |
|---|---|---|---|
| CLAUDE-FLAG-01 | Session spawn argv (`--permission-prompt-tool`, `--replay-user-messages`, `--permission-mode`, …) | **No** | The bridge owns the spawn. Our argv contract is replaced by the bridge's, which is the Agent SDK's. `--replay-user-messages` is ours alone (parity doc §C) and the SDK does not pass it. |
| CLAUDE-FLAG-02 | One-shot quota/title/probe spawns | **Partial** | Model catalog arrives via the live-session `initializationResult` (`cc-acp/src/acp-agent.ts:6984`) surfaced as ACP config options — strictly better than our probe. Title: the bridge emits `session_info_update`. Quota: no ACP construct; see PROBE-03. |
| CLAUDE-ENV-01 | CLIProxyAPI endpoint env (`ANTHROPIC_BASE_URL`/`AUTH_TOKEN`, `API_KEY` stripped) | **No** | We control the child env today. Through a bridge we would control the *bridge's* env and depend on it forwarding. The bridge has its own auth model (`auth/login`, `--hide-claude-auth` at `acp-agent.ts:1286-1288` can refuse claude.ai subscriptions entirely) and its own gateway/provider concepts. |
| CLAUDE-EVT-01 | `system` subtypes: `init`, `compact_boundary`, `task_started/updated/notification` | **Partial** | Compaction: unstable `compaction_update` only. Background tasks: the bridge models them (`src/async-tasks.ts`, 757 lines, incl. `local_workflow` → `workflow`) but ACP has no task construct — it lands in tool calls and `_meta`. **`_claude/*`** |
| CLAUDE-EVT-02 | `assistant` tool_use specialization (TodoWrite, Task v2, Bash PR detection, Skill) | **Partial** | Todos → ACP `plan` (a genuine mapping, and the bridge does it). Skills → `_meta.claudeCode.skill` / `.skillPath`. Subagents → native ACP subagent sessions, but only "after bilateral capability negotiation" on a **draft** `clientCapabilities.subagents` field (`cc-acp/README.md`); otherwise flattened. PR detection reads Bash tool inputs — survives, since `rawInput` is preserved. |
| CLAUDE-EVT-03 | `user` event parsing (`isReplay`/uuid, `isMeta`, `toolUseResult`, local-command stdout, skill-injection markers) | **No** | Entirely internal to the bridge. Our queued-message replay-ack machinery (`supports_replay_ack`, `on_queued_processed`) has no ACP equivalent; the bridge keeps its own `turnQueue` and a private `_session/steering` method (`acp-agent.ts:293`) for mid-turn input. **`_session/steering`** |
| CLAUDE-EVT-04 | `result` event: `total_cost_usd`, `usage`, subagent-result suppression, context tokens from the last parent assistant `usage` | **Partial** | `usage_update { used, size, cost }` covers occupancy + money. The per-turn `usage` breakdown and our specific "context tokens come from the last parent-turn assistant usage, never the result event" rule (#197) are not expressible; we would inherit the bridge's `contextWindowSize` bookkeeping (`acp-agent.ts:691-714, 3998-4028`). |
| CLAUDE-EVT-05 | `rate_limit_event` → normalized `ProviderQuota` | **No (protocol)** | The bridge forwards it as **`_meta["_claude/rateLimit"]`** (`acp-agent.ts:4896-4904`) — raw, un-normalized, off-protocol. ACP has no quota/rate-limit construct at all. |
| CLAUDE-EVT-06 | `stream_event` (unhandled today; `--include-partial-messages`) | **Yes** | ACP chunk updates are the delta grammar we want (parity doc B4). A point in ACP's favour. |
| CLAUDE-IO-01 | stderr trust detection ("has not been trusted" + `permissions.allow`) | **No** | ACP reserves the agent's stderr for logging. Trust routing, and the `~/.claude.json` write that answers it, are outside any ACP concept. |
| CLAUDE-IO-02 | Stdin envelopes we write (user frames, `uuid` for replay-ack, slash-command XML wrapper) | **Partial** | `session/prompt` with content blocks replaces the user frame; `available_commands_update` replaces our command list. The `uuid`+replay pairing does not survive. |
| CLAUDE-CTRL-01 | Inbound `can_use_tool` incl. `permission_suggestions`, `decision_reason` | **Partial, lossy** | See below — this is the central loss. |
| CLAUDE-CTRL-02 | Inbound `control_response`, double-wrapped context-usage sniff, request correlation | **Superseded** | JSON-RPC handles correlation properly; `usage_update` replaces the sniff. A genuine improvement. |
| CLAUDE-CTRL-05 | `control_cancel_request` (CLI withdraws a pending prompt) | **Partial** | ACP has `$/cancel_request` and the bridge races the SDK's `AbortSignal` against the open request (`docs/permission-extension.md` §Cancellation). Our per-request withdrawal + promote-next-queued behaviour (#284) would be re-derived from ACP cancellation semantics. |
| CLAUDE-CTRL-03 | Outbound `interrupt`/`stop_task`/`get_context_usage`/`set_permission_mode`/`set_model`/`apply_flag_settings`/`cancel_async_message`/`initialize` | **Partial** | `session/cancel` covers interrupt; `session/set_mode` covers permission mode; model + effort + fast mode ride the bridge's config options (`cc-acp/src/tests/fast-mode-config.test.ts`, `session-config-options.test.ts`). `apply_flag_settings` itself is absent (0 hits in the bridge); `ultracode` appears once; `alwaysThinkingEnabled` zero times. Our per-chat tuning (`ResolvedTuning` → `tuning_to_flag_settings`) would degrade to whatever config options the bridge chooses to expose. `stop_task` / `cancel_async_message` have no ACP construct. |
| CLAUDE-CTRL-04 | Outbound permission answer: `behavior`, `toolUseID`, **`updatedInput`**, `updatedPermissions`, `message`, `executionMode`, `clearContext` | **No** | **The hard blocker.** ACP's response is `{ outcome: "selected", optionId }` — full stop, in v1 *and* v2. We would lose: (1) `updatedInput` mutation, which `buildAskUserQuestionResponse` uses to send the user's answers back (`packages/ui/src/features/chat/gates/build-control-response.ts:23`); (2) the six-variant `ControlUpdate` suggestion vocabulary (`mainframe-types/src/adapter.rs:161`) rendered as user-chosen rules; (3) `executionMode` + `clearContext` on plan approval. The bridge works around all three by pre-baking effects into fixed option ids (`allow-with-updates`, `allow-skill-prefix`, `exit-plan-auto`, `exit-plan-clear-bypass`, …) and states outright: *"Permission options are fixed… Selecting the option applies the exact snapshotted Claude SDK `PermissionUpdate`; **the client cannot edit it**"* (`docs/permission-extension.md`). AskUserQuestion is routed to ACP elicitation instead — and *disabled at session creation* when the client lacks form elicitation. |
| CLAUDE-FILE-01 | Transcript path convention | **No** | No ACP construct. The bridge maps ACP `sessionId` to the SDK session id (`acp-agent.ts:6665-6671`) but exposes no path. |
| CLAUDE-FILE-02 | Transcript presence probe | **No** | Degraded-chat recovery has no ACP analogue. |
| CLAUDE-FILE-03 | External-session discovery (scan `~/.claude/projects/**/*.jsonl`) | **Partial** | `session/list` exists and the bridge implements it over the SDK's `listSessions({dir})` (`acp-agent.ts:1818`), itself a JSONL read. We would trade a scan we control for a list we don't — and lose per-file mtime dedup and the prefix-directory tolerance of `discover_project_dirs`. |
| CLAUDE-FILE-04 | JSONL history reconstruction incl. sidechain discovery + subagent inlining (`toolUseResult.agentId`, 2.1.118+) | **Partial** | `session/load` replays history as `session/update`s — architecturally nicer. But replay fidelity is the bridge's; our subagent inlining is replaced by its draft-capability native subagent sessions or its flattened fallback. |
| CLAUDE-FILE-05 | Skill/command/agent discovery across project, user, plugins | **Partial** | Commands via `available_commands_update`; skills only as `_meta.claudeCode.skill`. The agents list and skill *body* reads have no construct. |
| CLAUDE-FILE-06 | `~/.claude.json` identity + workspace-trust write | **No** | Quota attribution and trust acceptance are outside ACP entirely. |
| CLAUDE-FILE-07 | Cwd-encoding (three implementations) | **No** | Moot if we never touch the filesystem — but only because we lose FILE-01..04. |
| CLAUDE-FILE-08 | Background-task spool root `/tmp/claude-{uid}` | **No** | The bridge models async tasks internally; the spool path, boot reconciliation and worktree kill sweep have no ACP surface. |
| CLAUDE-PROBE-01 | `initialize` model catalog (`supportedEffortLevels`, `supportsFastMode`, `supportsAdaptiveThinking`) | **Partial** | The bridge already calls live `initializationResult()` (our parity doc's B2 adoption) and exposes models as config options with a model category, honouring a settings allowlist. Richer than our probe on discovery; poorer on the per-model capability flags that gate our composer affordances. |
| CLAUDE-PROBE-02 | Fallback catalog, context windows, tool categories | **Partial** | ACP `ToolKind` (10 values) is a better-designed vocabulary than our `explore`/`hidden`/`progress`/`subagent` split, but it is *categorization*, not our hidden/progress rendering semantics. Context windows come from `usage_update.size`. |
| CLAUDE-PROBE-03 | Prose parsers: `/usage` output, rate-limit key mapping, AskUserQuestion result text, compact preamble | **No** | The single highest-risk row in the checklist stays a Mainframe problem *and* moves out of reach: `/usage` is in the bridge's `LOCAL_ONLY_COMMANDS` set (`acp-agent.ts:1297`), and rate limits arrive only as raw `_meta["_claude/rateLimit"]`. Our own parity doc's B1 fix (the SDK's structured `get_usage`) is reachable natively but not through ACP. |

**Tally.** Of 27 rows: **1** fully carried (EVT-06), **1** improved by
replacement (CTRL-02), **13** partial, **12** not carried. Five rows — EVT-01,
EVT-02 and FILE-05 among the partials, EVT-03 and EVT-05 among the
not-carried — are reachable *only* through the bridge's private `_claude/*`,
`claudeCode.*` or `_session/*` `_meta` namespaces, which are not ACP.

**The escape hatch, and why it proves the point.** The bridge has an
`emitRawSDKMessages` option that re-emits raw SDK messages as
`extNotification("_claude/sdkMessage", …)` (`acp-agent.ts:996-1002, 3046-3049`).
Full fidelity is therefore *technically* recoverable — by consuming the raw
Claude stream through an ACP tunnel, in Rust, alongside ACP's own vocabulary.
That is our current adapter plus two extra layers.

### A.2 Codex

`mainframe-adapter-codex` speaks Codex app-server JSON-RPC directly:
`thread/start`, `turn/start`, the 18-variant `ThreadItem` union,
`item/*/requestApproval`, `model/list`, `account/rateLimits/read`,
`experimentalRawEvents: true`, plus rollout-JSONL and
`~/.codex/state_5.sqlite` reads (CODEX-RPC-01..05, EVT-01..06, ITEM-01..03,
FILE-01..04). `codex-acp` wraps that identical app-server in a Node process and
narrows it to ACP's vocabulary. Every Codex-specific concept we consume —
`collaborationMode`, `personality`, `reasoning_summary`, `service_tier`,
`SubAgentActivity.kind`, `CollabAgentToolCall.receiverThreadIds`, per-window
rate limits keyed by `windowDurationMins` — is either absent from ACP or would
have to arrive through `codex-acp`'s own `_meta` extensions.

### A.3 A generic ACP adapter for long-tail agents

This is the interesting case. Mainframe's `Adapter` trait needs, at minimum:
`create_session`/`spawn`/`kill`, `send_message`, `respond_to_permission`,
`interrupt`, `set_model`, `set_permission_mode`, `send_command`,
`load_history`, `list_models`, and a `SessionSink` with ~24 callbacks
(`mainframe-adapter-api/src/adapter.rs`). ACP v1 covers a real fraction of that
with no per-agent reverse engineering:

| Mainframe adapter surface | ACP v1 construct |
|---|---|
| `spawn` / `kill` | stdio subprocess + `initialize` / `session/new` / `session/close` |
| `send_message` | `session/prompt` |
| `on_message` (text / thinking) | `agent_message_chunk` / `agent_thought_chunk` |
| tool calls + results | `tool_call` / `tool_call_update` with `content`, `locations`, `rawInput`, `rawOutput` |
| `on_permission` / `respond_to_permission` | `session/request_permission` (mid-turn, blocking) — with the CTRL-04 caveat above |
| `on_permission_cancelled` | `$/cancel_request` + the mandated `cancelled` outcome |
| `interrupt` | `session/cancel` + `StopReason::Cancelled` |
| `set_permission_mode` | `session/set_mode` (v1) / config options (v2) |
| `set_model`, tuning | `session/set_config_option` (model category) |
| `send_command` / slash commands | `available_commands_update` |
| `on_todo_update` | `plan` / `plan_update` |
| `on_context_usage`, cost | `usage_update { used, size, cost }` |
| `load_history` | `session/load` (replay) or `session/resume` (no replay) |
| external session list | `session/list` |
| `on_compact` / `on_compact_start` | unstable `compaction_update` |
| `on_provider_quota` | — **no construct** |
| `on_trust_required` | — no construct |
| `on_pr_detected` | derivable from `rawInput` (as today) |
| `on_skill_loaded`, `extract_skill_files` | — no construct (`_meta` per agent) |
| background tasks, `stop_background_task` | — no construct |
| `on_attention_request`, notifications | unstable `notice` |

That is roughly two-thirds of the sink covered by a standard, for 39 agents,
with a maintained Rust SDK. Compared with writing a bespoke adapter per agent —
which is what Gemini, OpenCode, Amp, Cursor, Goose, Copilot CLI would each cost
today — this is a decisively better trade. The missing third (quota, trust,
background tasks, skills) is exactly the surface that is per-vendor anyway and
that a long-tail agent would not have.

### A.4 What a comparable product actually routes through ACP

t3code (`pingdotgg/t3code`) ships five first-party provider drivers
(`apps/server/src/provider/builtInDrivers.ts`: Claude, Codex, Cursor, Grok,
OpenCode). Their protocol choices, read from imports:

| Driver | Protocol |
|---|---|
| Claude (`Layers/ClaudeAdapter.ts`) | **Native** — no ACP import |
| Codex (`Layers/CodexAdapter.ts`) | **Native app-server** — `effect-codex-app-server/{errors,schema}` |
| OpenCode (`Layers/OpenCodeAdapter.ts`) | **Native SDK** — `@opencode-ai/sdk/v2` |
| Cursor (`Layers/CursorAdapter.ts`) | **ACP** — `effect-acp/{errors,schema}` |
| Grok (`Layers/GrokAdapter.ts`) | **ACP** — `effect-acp` via `provider/acp/GrokAcpSupport.ts` |

`packages/effect-acp` is a real, generated, tested package (schema codegen in
`scripts/generate.ts` → `src/_generated/{schema,meta}.gen.ts`, plus
`agent.ts`/`client.ts`/`rpc.ts`/`terminal.ts` with test files), and
`apps/server/src/provider/acp/` holds a 20-file ACP runtime with per-vendor
extension modules (`CursorAcpExtension.ts`, `XAiAcpExtension.ts`).

The pattern is unambiguous and matches the analysis above: **native protocols for
the agents whose depth you sell; ACP for everything else** — with per-vendor
`_meta` extension shims even there.

### A.5 The Rust story

Strong. `agent-client-protocol` 2.0.0 (2026-07-23), 3.98M all-time / 1.84M recent
downloads, repo `agentclientprotocol/rust-sdk`, actively maintained (last commit
2026-08-24). The workspace ships `agent-client-protocol` (Client/Agent/Proxy/
Conductor roles, connection builders), `agent-client-protocol-http` (HTTP/SSE +
WebSocket transports), `agent-client-protocol-rmcp` (MCP integration),
`-conductor` / `-polyfill` (proxy chains), `-trace-viewer`, `-test`, and a
cookbook crate. Draft v2 is behind `unstable_protocol_v2`; every unstable feature
is an explicit cargo feature. It powers Zed's external-agent integration.

For a Rust daemon this is the single most attractive fact in the evaluation: a
generic ACP adapter is `cargo add agent-client-protocol`, not a hand-rolled
JSON-RPC codec.

---

## Boundary B — ACP as the daemon↔UI wire format

Scored against the three walls from [WIRE-PROTOCOL-SURVEY.md](WIRE-PROTOCOL-SURVEY.md).

| Wall | ACP v1 | ACP v2 draft |
|---|---|---|
| **1. Mid-run inbound (client→server *into* a running turn)** | **Passes.** `session/request_permission` is a blocking agent→client request mid-turn. `session/set_mode` and `session/set_config_option` are explicitly legal "whether the Agent is idle or generating a response". | Passes, plus `requires_action` as a first-class session state. |
| **2. Unsolicited push outside a run** | **Passes in practice, ambiguous on paper.** `session/update` is a notification, and v1 never prohibited out-of-turn sends — but the v2 announcement records that this "was a common point of confusion for implementers". | **Passes explicitly.** "`session/update` notifications can proceed freely at any point in the session"; "Background activity can continue and emit other `session/update` notifications while the Agent reports `idle`" (`docs/protocol/v2/migration.mdx`). |
| **3. Multiplexing N chats over one connection** | **Passes.** One connection carries N sessions; every session-scoped message is keyed by `sessionId`. This is structurally what our WS envelope does. | Passes. |

So ACP clears all three walls that killed AG-UI, AssistantTransport and UI
Message Stream v1. It fails on four *different* ones:

1. **The transport is a subprocess.** stdio is the only defined transport, and it
   makes the client the spawning parent. A desktop webview and a phone cannot be
   the parent of the daemon. Remote transport is a draft RFD with a working
   group, a partial Rust implementation, and an explicit v1 statement that
   in-flight messages are **not** replayed across a reconnect — the exact
   guarantee our mobile/desktop reconnect path depends on
   (`subscribe:ack` re-seed, `app-tauri-first-message-renders-last`).
2. **No multi-client attach.** Nothing in v1 or v2 describes two concurrent
   clients observing one session; the transport RFD scopes each session stream to
   an `Acp-Connection-Id` + `Acp-Session-Id` pair. The v2 announcement mentions
   "the potential for multiple clients observing the same session" as a *benefit
   of the new replay semantics*, not as a specified behaviour. Same chat live on
   desktop and phone — our actual product requirement — is unspecified.
   `permission.resolved` fan-out to a second watcher has no equivalent at all.
3. **Direction and ownership are inverted.** ACP's Agent owns session state; the
   Client is a renderer plus a filesystem/terminal service provider. Mainframe's
   daemon is authoritative over ~40 `Chat` fields, worktrees, launch processes,
   automations, plugins, tunnels — none of which are agent state. Making the
   daemon an ACP Agent to the UI means claiming to *be* a coding agent, and the
   UI would have to implement `fs/*` and `terminal/*` for a daemon that already
   owns both.
4. **It covers only the chat domain.** The same 20+ non-chat event families
   catalogued in AG-UI-EVALUATION.md — `launch.*`, `file:changed`, `tunnel:status`,
   `plugin.*`, `automation.*`, `notification.created`, `sessions.external.count` —
   have no ACP construct. A Mainframe dialect stays on the socket regardless.

There is one genuinely relevant sub-case: **the daemon could speak ACP to
*remote* clients** once the HTTP/WS transport stabilizes, exposing Mainframe
chats to third-party ACP clients (Zed, JetBrains, Neovim). That is an
interoperability *feature*, not a replacement for our dialect, and it is blocked
on the same draft transport.

---

## Verdicts

### A1 — Replace `mainframe-adapter-claude` with ACP: **reject**

Three independent blockers, any one sufficient:

1. **The permission answer cannot carry what we send.** ACP's response is
   `{ outcome, optionId }` in v1 and in the v2 draft. We lose the six-variant
   `ControlUpdate` suggestion vocabulary rendered as user-chosen rules, and
   `executionMode`/`clearContext` on plan approval. (`updatedInput` mutation has
   one escape route — AskUserQuestion specifically can go through ACP
   elicitation, which is what the bridge does, conditional on the client
   advertising form support; nothing covers the general case.) The official
   bridge's own documentation concedes the consequence: *"Permission options are
   fixed… the client cannot edit it."* Our permission UI is a product
   differentiator, not a button row.
2. **Half the crate has no ACP surface.** Quota and rate limits, trust detection
   and `~/.claude.json` writes, CLIProxyAPI env redirection, transcript paths and
   JSONL history with subagent inlining, background-task spool reconciliation,
   `apply_flag_settings` tuning — 12 of 27 checklist rows are not carried, and
   five more survive only through the bridge's private `_meta` namespaces.
3. **The topology is worse.** `Rust daemon → Node bridge → Agent SDK → CLI` adds a
   process and a Node runtime to a path we currently own end to end, and
   substitutes a third-party 0.70.0 package's release cadence for our own.
   [AGENT-SDK-PARITY.md](adapters/claude/AGENT-SDK-PARITY.md) §D already rejected
   reimplementing on the Agent SDK for structural reasons that all still apply —
   the ACP bridge is the Agent SDK *plus* a lossy translation.

The bridge remains valuable as a **reference implementation**: its permission
option taxonomy, its plan-mode handoff, its async-task model and its
`_claude/rateLimit` forwarding are worth diffing against on CLI upgrades, exactly
as the parity doc recommends for the Agent SDK itself.

### A2 — Replace `mainframe-adapter-codex` with ACP: **reject, more clearly than A1**

`codex-acp` translates the very app-server JSON-RPC that `mainframe-adapter-codex`
already consumes. Adopting it buys a strictly narrower vocabulary (the 18-variant
`ThreadItem` union, `collaborationMode`, `personality`/`service_tier`, per-window
rate limits, `SubAgentActivity`, rollout JSONL and the thread SQLite registry all
lose or degrade), at the cost of a Node process in the middle. There is no
upside except uniformity with a generic adapter we do not have yet.

### A3 — A new generic ACP adapter for long-tail agents: **adopt, when a second-tier agent is next scheduled**

This is the recommendation of this document. One `mainframe-adapter-acp` crate
built on `agent-client-protocol` 2.0.0 would cover roughly two-thirds of the
`SessionSink`/`AdapterSession` contract for **39 registry agents** — Gemini CLI,
Copilot CLI, Cursor, OpenCode, Goose, Amp, Cline, Devin, Junie, Kimi, Qwen,
Mistral Vibe — replacing N bespoke reverse-engineering efforts with one
protocol implementation plus small per-vendor `_meta` shims. t3code, the closest
comparable product, made exactly this call: native for Claude/Codex/OpenCode,
`effect-acp` for Cursor and Grok, with `CursorAcpExtension.ts` / `XAiAcpExtension.ts`
handling the vendor tails.

Scoping notes for whoever builds it:

- Target **v1 stable** and negotiate the version; gate v2 behind a feature flag.
  Do not build on `session/fork`, `mcp/*` passthrough, compaction or notices —
  all unstable.
- Budget for the permission-answer gap: our `ControlResponse` becomes
  "pick an `optionId`", so the gate UI needs an ACP mode that renders
  agent-supplied options rather than our allow/deny/always triad.
- Decide up front whether to implement client `fs/*` and `terminal/*`. They are
  what make ACP tool cards good (live terminal output embedded by `terminalId`),
  and they are removed in v2 — so implementing them is v1-only work.
- Quota, trust and background tasks stay per-adapter capabilities, absent for
  ACP agents. `AdapterCapabilities` already models this.

### B — ACP as the daemon↔UI wire format: **reject**

ACP clears all three walls that killed the previous candidates — mid-run inbound,
out-of-run push (explicit in v2), and per-`sessionId` multiplexing — which makes
it the best-scoring external protocol evaluated so far. It still fails, on
different grounds: the only defined transport spawns the agent as a subprocess
(a webview cannot be the daemon's parent); the remote transport is a draft RFD
that explicitly declines to replay in-flight messages across a reconnect;
multi-client attach to one session is unspecified; the Agent owns session state
where our daemon is authoritative; and the ~20 non-chat event families keep a
Mainframe dialect on the socket regardless.

Revisit if the Streamable-HTTP/WebSocket RFD stabilizes **and** a multi-observer
session semantic is specified — and then as an *additional* interop surface
(third-party ACP clients attaching to Mainframe chats), never as a replacement
for the dialect.

### Addendum (2026-08-28): the façade counter-proposal — verdict B answers the wrong question for it

A parallel Codex session (rollout
`~/.codex/sessions/2026/08/28/rollout-2026-08-28T08-18-54-01a046ce-…jsonl`,
"Rewrite Session Protocol With ACP") proposes something this document's B verdict
did not evaluate: not adopting ACP as-specified, but **redesigning the chat seam
in ACP's methodology** — the daemon as an ACP server façade at
`/acp/{adapter-profile}` over our own WS binding, chat-surface only, non-chat
domains staying on the existing REST/event interfaces, and Mainframe concepts
*rethought* in ACP v2 terms rather than mapped one-for-one:

- queued prompts become ordinary `session/prompt` submissions (v2 separates
  prompt *acceptance* from work *completion*), retiring `queue.*` as protocol
  objects;
- reconnect/re-seed becomes `session/resume` with replay and **stable item
  IDs** (which retires `subscribe:ack` re-seed, REST history refresh, queue
  snapshot, and pending-permission recovery as separate mechanisms);
- subagents become tool calls with `_meta` relations (`mainframe.dev`
  namespace), retiring `task_group`;
- gaps filled by ACP-sanctioned extensions: `_`-prefixed custom methods
  (`_mainframe.dev/session/cancel_tool_call`), namespaced `_meta`, capability
  advertisement, graceful degradation for generic clients.

This dissolves two of B's four grounds by construction (ownership inversion —
don't advertise `fs/*`/`terminal/*`; domain coverage — non-chat was never in
scope) and reframes the transport ground (we own both ends, so the WS binding
is ours regardless). What it does **not** dissolve:

1. **The design is built on v2 semantics** (prompt lifecycle, resume replay,
   explicit out-of-turn updates) — a draft spec. We'd freeze a snapshot we
   control, but conformance drift is then our maintenance line.
2. **Multi-client attach is still ours to define** (the session sketches an
   `_mainframe.dev/session/acquire_control` extension and defers the policy).
3. **Stable IDs are a real prerequisite lift** — transient `nanoid()` IDs in
   the display pipeline can't survive into a replay-based contract; vendor
   item IDs / transcript UUIDs must become canonical across adapters, history
   reconstruction, and clients.
4. **Permission-response richness** — core ACP's `{outcome, optionId}` is
   still the gate answer; our `ControlUpdate` suggestion vocabulary rides
   extensions, so the "differentiator" surface is Mainframe-aware-client-only
   either way.

Net: the façade is a legitimate competing direction for the todo #350 grammar
refactor, not a rejected one — the spec pass should evaluate it head-to-head
against the dialect-with-borrowed-grammar direction sketched in
[WIRE-PROTOCOL-SURVEY.md](WIRE-PROTOCOL-SURVEY.md). Verdict B stands only as
an answer to "adopt ACP as-specified as the UI wire."

---

## What to borrow

Input to the payload-grammar refactor sketched in
[WIRE-PROTOCOL-SURVEY.md](WIRE-PROTOCOL-SURVEY.md) and to todo #350. All of these
are adoptable in our own dialect for the cost of a field, with none of the
protocol.

1. **The `ToolCallUpdate` patch grammar.** One update type, keyed by
   `toolCallId`, where omitted = unchanged, `null` = cleared, value = replaced,
   chunks append (v2 makes these semantics uniform across messages, tool calls
   and plans). This is a better answer to our whole-message re-sends than the
   start/delta/end triples of UI Message Stream v1, because it handles *revision*
   as well as *append* — which is what our `display.message.updated` actually
   does. v2's `tool_call_content_chunk` adds streaming for individual content
   items without resending the card.
2. **`ToolKind` as a tool taxonomy.** Ten values — `read`, `edit`, `delete`,
   `move`, `search`, `execute`, `think`, `fetch`, `switch_mode`, `other` —
   agreed across 39 agents. Strictly better than our hardcoded
   `explore`/`hidden`/`progress`/`subagent` lists duplicated in two places
   (CLAUDE-PROBE-02). Adopt it as the *category* axis and keep our rendering
   treatment as a separate axis.
3. **`ToolCallLocation { path, line? }`.** The "follow the agent" surface: a
   first-class list of files a tool call touches, distinct from its content. We
   reconstruct this ad hoc from tool inputs today.
4. **`PermissionOption { optionId, name, kind }` as the gate's presentation
   model.** Even keeping our richer `ControlResponse`, letting the *adapter*
   supply an ordered option list with `allow_once`/`allow_always`/`reject_once`/
   `reject_always` kinds — instead of the UI hardcoding a triad — is what would
   let a generic adapter, plan mode, and AskUserQuestion share one gate
   component. The bridge's option-id taxonomy (`allow-with-updates`,
   `allow-skill-prefix`, `exit-plan-clear-bypass`) is a worked example of
   encoding effects into options.
   Its companion rule is worth copying verbatim: *the client must not infer
   storage scope, lifetime or permission effects from the option kind or button
   text* — the adapter owns the effect and applies it only after validating the
   response.
5. **`UsageUpdate { used, size, cost }`.** One event for context occupancy *and*
   money, cleanly separated from per-turn token consumption — the exact
   distinction AG-UI conflated and that our `chat.contextUsage` gets right by
   accident. Worth formalizing.
6. **Structured `_meta` extension discipline.** A reserved `_meta` on every
   frame, `_`-prefixed enum values reserved for implementations, and the rule
   that unknown values must not be treated as approval. Our dialect's ad-hoc
   extension fields have no such convention, and CONSUMED-SURFACE's opening
   paragraph records the cost: unknown Claude event types are silently dropped
   with no typed enum anywhere.
7. **The RFD + dated-stabilization process.** `docs/rfds/` plus
   `docs/announcements/*-stabilized.mdx` is a cheap, legible way to run a
   versioned wire contract — a better model for our own protocol-version
   handshake than a changelog.
