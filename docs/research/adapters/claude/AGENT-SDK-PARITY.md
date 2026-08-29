# Claude Agent SDK parity audit

Diff of `mainframe-adapter-claude` against the official Claude Agent SDK —
what the SDK does that we don't, where we diverge, and per-item verdicts.

- **SDK audited**: `@anthropic-ai/claude-agent-sdk` 0.3.247, which pins CLI
  **2.1.247** (manifest commit `89c72618`, built 2026-08-26).
- **Our baseline**: [CONSUMED-SURFACE.md](CONSUMED-SURFACE.md), verified
  against CLI 2.1.220. Differences below may therefore be "upstream moved in
  2.1.221–2.1.247" rather than "we drifted"; each row says which.
- **Method**: full extraction of `sdk.d.ts` + minified `sdk.mjs` behavior
  (spawn contract, control subtypes both directions, initialize payload,
  permission flow), diffed against the consumed-surface checklist and targeted
  reads of `src/session.rs`, `src/session_control.rs`, `src/quota_*.rs`.

Scope note, both directions: the SDK is a protocol client, not a product.
Roughly half our crate (external-session scan, JSONL history reconstruction
with subagent inlining, trust-store writes, display pipeline, quota prose
parsing) has **no SDK equivalent** — "parity" below means the shared
wire surface only. Conversely, the SDK cannot rescue our two most fragile
surfaces: stderr trust detection (CLAUDE-IO-01) and the AskUserQuestion prose
parsing half of CLAUDE-PROBE-03. It **can** rescue the quota half — see
`get_usage` below.

## Raw surface counts

| Surface | SDK 0.3.247 | Mainframe |
|---|---|---|
| Outbound `control_request` subtypes | 37 | 8 (`interrupt`, `stop_task`, `get_context_usage`, `set_permission_mode`, `set_model`, `apply_flag_settings`, `cancel_async_message`, `initialize` — probe only) |
| Inbound `control_request` subtypes handled | 7 (`can_use_tool`, `hook_callback`, `mcp_message`, `elicitation`, `request_user_dialog`, `oauth_token_refresh`, `host_auth_token_refresh`) | 2 (`can_use_tool`, plus `control_cancel_request` withdrawal) |
| `initialize` on live sessions | always, from the Query constructor, before any input | never (model probe only, empty payload) |

The inbound gap is mostly self-consistent: the CLI only sends `hook_callback`
/ `elicitation` / `request_user_dialog` to clients that registered for them in
`initialize`. Since we never initialize, the CLI never sends them. Skipping
`initialize` is what makes not handling them safe — and also what caps the
features we can reach.

## A. Correctness findings (align)

| # | Finding | Detail | Verdict |
|---|---|---|---|
| A1 | **Control-response race in `send_awaiting`** | `session_control.rs` writes the request to stdin, *then* registers the pending waiter. A response arriving in that window is dropped (`control_response_unknown_request_id_does_not_panic`), and the caller falsely times out at 5 s. The window is microseconds of sync Rust against a full CLI round trip — theoretical today, but the SDK guards this exact race with a 1024-entry unmatched-response map and our fix is trivial. | **Fix**: register before write (cheaper than the SDK's LRU). |
| A2 | **`NODE_OPTIONS` not stripped from the child env** | The SDK always deletes it. When the CLI resolves to the npm `cli.js` under Node, an inherited `NODE_OPTIONS=--inspect` breaks stdio; our `^Debugger` stderr filter (CLAUDE-IO-01) treats the symptom the SDK prevents. | **Fix**: `env_remove("NODE_OPTIONS")` in `build_spawn_command`. |
| A3 | **Blanket 5 s control timeout** | The SDK has *no* generic control-request timeout — it waits until abort/cleanup. Under load (large tool results, compaction) a slow `control_response` makes our `set_permission_mode` / `apply_flag_settings` / `get_context_usage` calls report failure for an operation the CLI then applies. | **Align**: raise the default substantially and treat timeout as "unknown", not "failed"; keep short timeouts only where the caller needs liveness. |
| A4 | **Interrupt SIGINT fallback is now gateable** | Our interrupt escalates protocol → `stop_task` → 10 s SIGINT (workaround for the 2.1.85 blocked-by-agents bug). CLI 2.1.247's `system:init` advertises `capabilities: ["interrupt_receipt_v1", "interrupt_cancel_queued_v1", ...]` and `interrupt` returns a receipt (`{still_queued, cancelled}`). We don't read `capabilities` at all. | **Align**: parse `capabilities` from `system:init`; on `interrupt_receipt_v1`, await the receipt and drop the SIGINT fallback. |
| A5 | **Kill ladder skips the graceful step** | Ours: SIGTERM → 3 s → SIGKILL. SDK: stdin EOF → 2 s → SIGTERM → 5 s → SIGKILL. stdin-EOF-first is the CLI's documented graceful shutdown and gives it time to flush the transcript tail. | **Align**: prepend stdin-close + grace to `ClaudeSession::kill`. |
| A6 | **`updatedInput` "required on every allow" is likely stale** | CLAUDE-CTRL-04 says allow answers are rejected without `updatedInput`. The SDK spreads `PermissionResult` verbatim and omits it freely at 2.1.247. Always sending it is harmless (superset). | **Doc fix only**: re-verify against a live CLI, soften the checklist claim. No code change. |

Non-findings worth recording: our `can_use_tool` answer envelope (capital
`toolUseID`, session-scoped `setMode`) matches the SDK's; our double-wrapped
`response.response` sniff matches the SDK's unwrap; our
`control_cancel_request` handling (drop silently, promote next prompt) is
compatible with the SDK's (abort → error response) — the CLI accepts both.

## B. Product gaps (adopt, ranked)

| # | Capability | What it buys | Verdict |
|---|---|---|---|
| B1 | `get_usage` control request | Structured session cost + `subscription_type` + rate-limit windows (`five_hour`, `seven_day`, `seven_day_opus`, …, each `{utilization: 0–100, resets_at: ISO}`). Replaces the `/usage` **prose parser** — the top-risk row in CONSUMED-SURFACE (CLAUDE-PROBE-03). Marked experimental on the SDK's `Query` (`usage_EXPERIMENTAL_…`). | **Adopt** with the prose parser kept as fallback until the subtype proves stable. |
| B2 | `initialize` on live sessions | The response carries `commands`, `agents`, `models`, `account`, output styles, fast-mode state — and uniquely, `pending_permission_requests` are **redelivered** in the initialize response. The SDK uses this for transport gaps; whether the CLI also replays them across a full process death + `--resume` respawn is plausible but unverified — likely fix for our restored-permission known gap, verify with a live resume test before relying on it. Also the prerequisite for dialogs/hooks (B7). | **Adopt** — low risk (the probe already sends it), high value. |
| B3 | `generate_session_title` control request | Kills the `-p <prompt> --no-session-persistence` one-shot title spawn (CLAUDE-FLAG-02) and its ghost-session/undocumented-flag risk. Takes `{description, persist:false}` on the live session. | **Adopt** for chats with a live session; keep the one-shot only for title-without-session paths. |
| B4 | `--include-partial-messages` | True token-delta streaming (`stream_event`). Today we get one event per completed content block and fake smoothness client-side. CLAUDE-EVT-06 already reserves the row. | **Adopt** behind a setting; requires a delta-accumulation path in `events.rs`. |
| B5 | `rewind_files` + `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` | CLI-native file checkpointing: rewind tracked files to a `user_message_id`, with `dry_run` preview. A turn-revert feature (t3code-style) nearly free, without building a git-ref checkpoint engine. | **Adopt** when a revert feature is scheduled; not wiring work worth doing speculatively. |
| B6 | Richer `system:init` consumption | We read only `session_id`. Also present: `capabilities` (needed for A4), `slash_commands`, `skills`, `plugins`, `permissionMode`, `model`, `fast_mode_state`. Could shrink (not replace — listings are needed with no live session) the filesystem scans of CLAUDE-FILE-05. | **Adopt** `capabilities` now; the rest opportunistically. |
| B7 | Dropped `can_use_tool` fields | The wire frame carries `blocked_path`, `title`, `display_name`, `description`, `agent_id`, `matched_ask_rule`, `requires_user_interaction`, `default_to_no` — we surface none. The TS SDK itself drops the last five, so a GUI can exceed SDK-based hosts here. | **Adopt** `display_name`/`description`/`blocked_path` for the permission gate UI when it's next touched. |
| B8 | New permission modes | `PermissionMode` now includes `dontAsk` and `auto` (post-2.1.220 upstream addition). Our enum and UI stop at the original four. | **Adopt** after verifying CLI behavior of each mode. |
| B9 | Longer tail | `read_file` (CLI-mediated, permission-gated file reads), `mcp_message` + in-process MCP (Mainframe-native tools without a sidecar server binary), hooks (31 events via `initialize.hooks` + `hook_callback`), `--session-id`/`--fork-session`/`--resume-session-at`, `--agents`, `--settings`, `--mcp-config`, transcript mirroring (`--session-mirror` + `transcript_mirror` frames) as an alternative to JSONL scanning. | **Later** — file individually when a feature needs them. |

## C. Intentional divergence (leave)

- **`--replay-user-messages`**: we pass it (queued-message move-on-ack); the
  SDK doesn't. Deliberate. Watch for upstream deprecation since the SDK no
  longer exercises it.
- **`--allow-dangerously-skip-permissions` always passed**: the SDK gates it
  on an option. Ours enables later `bypassPermissions` switches without a
  respawn — a product decision, but it means every session runs with the
  guard rail removed. Revisit only if we ever gate bypass mode in the UI.
- **`--append-system-prompt` via argv**: the SDK moved system prompts into
  `initialize`. Ours is a small static constant (no secrets, no size risk);
  argv visibility in `ps` is cosmetic. Migrate opportunistically if B2 lands.
- **Auxiliary one-shot spawns for quota/title**: superseded per B1/B3, kept
  for no-session paths.
- **Filesystem scanning for skills/commands/agents, JSONL history, trust
  store, stderr trust detection, cliproxy env contract**: product surface the
  SDK doesn't have. The SDK's new out-of-band session helpers
  (`listSessions`, `getSessionMessages`, …) are pure JSONL reads like ours —
  evidence the approach is sanctioned, not a replacement.

## D. Answering "should we reimplement the adapter on the SDK?"

No. The three structural reasons stand: the SDK is Node-only (our daemon is
Rust), the bulk of our crate is product surface the SDK doesn't cover, and
the SDK's abstraction drops information we use (it discards five
`can_use_tool` fields a GUI wants). The audit instead yields: six alignment
fixes (A1–A6, all small), three high-value adoptions (B1–B3), and a ranked
backlog (B4–B9). The SDK's real ongoing value to us is as a **reference
implementation to diff against on CLI upgrades** — extracting the npm
package's `sdk.d.ts`/`manifest.json` per release is cheaper and more precise
than changelog prose; fold that into the changelog-watch flow.
