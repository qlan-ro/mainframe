# changelog-watch: codex rust-v0.169.1 → rust-v0.170.0 (2026-11-19)

Entries seen: 41 · risks: 0 · opportunities: 1 · relevant, no action: 11 · dropped as irrelevant: 29

**How the entries were counted.** rust-v0.170.0 has 10 curated bullets and 48 per-PR Changelog lines. The curated bullets cite 17 of those PRs, and each curated bullet is classified once together with the PRs it cites. That leaves 41 distinct entries: 10 curated and 31 standalone PR lines. The Changelog list is `compare/rust-v0.169.0...rust-v0.170.0`. rust-v0.169.1 was a patch release whose three commits were reviewed on 2026-11-18 and don't appear here.

No compatibility risk. Most of the sandbox work moves Codex's internals from legacy sandbox policies to permission profiles, but Codex still accepts the legacy `sandbox`/`sandboxPolicy` params Mainframe sends. The generated TypeScript for `ServerNotification`, `ServerRequest`, `ThreadStartParams`, `ThreadResumeParams`, `TurnStartParams`, `ThreadItem`, `ToolRequestUserInputParams`, `CommandExecutionRequestApprovalParams`, `ThreadTokenUsageUpdatedNotification` and `ErrorNotification` is byte-identical between rust-v0.169.1 and rust-v0.170.0. `models-manager/models.json` is unchanged too.

Still open from earlier runs: the rust-v0.169.1 low risk (`KNOWN_WINDOWS` still has `gpt-6.1-sol` at 272K and no `gpt-6.2-sol` row, while both are 500K upstream). With `models.json` unchanged, rust-v0.170.0 neither fixes nor worsens it.

## Compatibility risks

None.

## Adoption opportunities

- "Version answer display instructions and restrict unsupported payloads" (#60904) — `agentMessage.moderation.display` changes from a free-form `{action, blockType, cyberTrustedAccess, checkTrustedContacts}` to a versioned union: `{mode: "show", version: 1, annotation?, trustedContacts}`, `{mode: "hide", version: 1, replacement}` or `{mode: "block", version: 1, reason}` ("How Chat should present a recovered answer"). Mainframe's `AgentMessage` payload doesn't model `moderation`, so serde ignores it (`CODEX-ITEM-01`), and a recovered answer that Codex marks `hide` or `block` renders in full. This replaces the moderation-field opportunity from 2026-11-14 with a schema that is now stable enough to target. It would land in `src/thread_item_variants.rs` (an optional `moderation` field) and `src/thread_item_render.rs::render_agent_message` plus the history path, showing the replacement or a blocked notice. Size: small.

## Relevant, no action

- "Added experimental support for using identically named MCP servers across environments" (#60905) — `CODEX-RPC-10`/`CODEX-FLAG-05`: behind the `multi_environment_mcp` feature, which is off by default. Mainframe's single `mainframe` server keeps its plain name, and elicitations still carry `serverName: "mainframe"`.
- "Fixed permission updates and child threads losing existing sandbox restrictions" (#60936, #61134) — `CODEX-RPC-02b`/`CODEX-RPC-03`: #61134 turns a legacy `sandbox_policy` update into a permission profile when session settings take it. `TurnStartParams` is unchanged, so Mainframe's per-turn `sandboxPolicy` is still accepted. Sub-agent child threads now keep the parent's `read-only`/`workspace-write` restriction, which Mainframe's mode mapping already assumed.
- "Improved automatic reconnection for Cloud conversations and preserved active recovery turns when clients reconnect" (#60969, #61014) — `CODEX-RPC-02`: #61014 stops a `thread/resume` with config overrides from shutting down a loaded thread whose recovery turn holds the turn slot. Mainframe sends overrides on every resume, so it can now hit that case less, not more. #60969 is the Cloud backend only.
- "Oversized WebSocket requests now fall back to HTTP without unnecessary retries" (#60840, #60841) — `CODEX-EVT-08`: fewer `error` notifications with `willRetry: true`. The shape is unchanged.
- "Fixed MCP OAuth credential races during cancellation, login, and logout" (#60849, #60981) — `CODEX-FLAG-05`: the `mainframe` server authenticates with `bearer_token_env_var`, not OAuth.
- "Compare resume sandbox overrides using permission profile labels" (#61136) — `CODEX-RPC-02`: only how a resume's `sandbox` override is compared with the loaded thread changes. `external-sandbox` still satisfies a `danger-full-access` request, and the three legacy values Mainframe sends are still accepted.
- "Remove the legacy sandbox policy setter from `Config`" (#61144) — `CODEX-RPC-02b`: an internal setter. The wire params are unchanged (see the identical schemas above), and `Permissions` still validates legacy policies through `PermissionProfile::from_legacy_sandbox_policy_for_cwd`.
- "Preserve model-facing ID allocations in saved history" (#60771) — `CODEX-FILE-01`: rollout items gain optional `id_allocation` metadata, and legacy string IDs are still accepted. Mainframe's rollout reader doesn't model the field and uses no `deny_unknown_fields`.
- "Preserve retained assistant revisions across rollout replay" (#60839) — `CODEX-FILE-01`: this is Codex replaying its own rollouts. The `{type, payload}` envelope Mainframe reads is unchanged.
- "Preserve thread-local model ID state across replay and compaction" (#60942) — `CODEX-FILE-01`: the "model ID" here means model-facing item IDs, not the model name `thread/read` reports (`CODEX-RPC-08`).
- "Wait for the in-process initialization handshake to finish" (#60871) — `CODEX-RPC-01`: only in-process clients. Mainframe talks to `codex app-server` over stdio.

Dropped (29): TUI realtime voice (#61172), sidebar and panels (#61167), multiline status lines (#61141), thread titles (#60842), the service-tier status line (#60972) and the shortcut overlay (#60962); OTLP refreshable headers (#61028) and the shared HTTP headers crate (#61018); Windows fixes (#60872, #60943, #60944); file and thread search (#60845, #60846); Guardian reviewer work (#60784, #60914, #61163); history and notes tool schemas (#60770); allocated response item IDs in requests (#60977); Daybreak choices (#60773); GCP incremental tool declarations (#60848); Command Center task ownership (#60929); biometric verification (#60948); Code Mode proxy 503 retries (#61153); filesystem helper sandbox prep (#61138); plugin cache refreshes (#61129); reasoning replay metrics (#61017); DNSSEC advisories (#61156); the issue labeler (#60897, #60964); test fixtures (#60882, #60898); sandbox docs (#61133).
