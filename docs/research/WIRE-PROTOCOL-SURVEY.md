# Wire-protocol survey: candidates for the daemon↔client chat surface

Companion to [AG-UI-EVALUATION.md](AG-UI-EVALUATION.md). One session (2026-08-28)
evaluated four external protocols as replacements for, or inputs to, Mainframe's
`DaemonEvent`/`ClientEvent` dialect. This file records the three verdicts that
don't have their own doc, and the refactor direction that fell out.

## Verdicts

| Protocol | Source read | Verdict |
|---|---|---|
| **AG-UI** | `@ag-ui/core` 0.0.59 + `@assistant-ui/react-ag-ui` 0.0.57, from source | **Reject** — 13% native / 29% distorted / 58% `CUSTOM`; run-terminating interrupt model can't express mid-run permission gates; run-scoped (no chat multiplexing). Full analysis: [AG-UI-EVALUATION.md](AG-UI-EVALUATION.md). |
| **AssistantTransport** (assistant-ui) | `/docs/runtimes/custom/assistant-transport.md` (full guide), 2026-08-28 | **Reject as transport** — POST-per-turn with a state document echoed client→server each request. Three structural walls: (1) no unsolicited server→client push outside an active run (kills multi-device sync, background tasks, automations, pending-gate restore, session-list liveness); (2) commands queue behind the in-flight request, so a mid-run `can_use_tool` answer cannot reach the server while the CLI waits on it — deadlock unless every gate fabricates a run boundary; (3) client-echoed state inverts the daemon-authoritative/no-client-cache design. Wire format explicitly pre-stable ("will migrate to SSE in a future release"; converter exported `unstable_`; one wire-shape deprecation already). **Adopt the idea, not the protocol**: its `set`/`append-text` JSON-delta streaming is the right shape for our WS payloads. |
| **AI SDK UI Message Stream v1** (Vercel) | `ai-sdk.dev/docs/ai-sdk-ui/stream-protocol.md`, 2026-08-28 | **Reject as transport, adopt as grammar template** — same POST+SSE run-scoped shape (same three walls as AssistantTransport), but the payload vocabulary is the best-designed of the four: versioned (`x-vercel-ai-ui-message-stream: v1`), typed parts with stable block ids and start/delta/end lifecycle (`text-*`, `reasoning-*`, `tool-input-*`), explicit turn framing (`start`, `start-step`/`finish-step`, `finish`, `abort` with reason, `[DONE]`), **`reset-step`** for invalidating partial output on retry, tool approvals as first-class parts (`tool-approval-request`/`response` with `approvalId`), and disciplined extensions (`data-*` typed parts, `custom` parts with `{provider}.{type}` kinds). |
| **A2A v1.0** | assistant-ui adapter docs only (no deep spike) | **Not formally scored** — shares AG-UI's structural properties (task-scoped, pause-via-`input-required` terminal state, agent-interop vocabulary, adapter layered on ExternalStoreRuntime). Score it with AG-UI-EVALUATION.md's method if ever revisited. |
| **ACP** (Agent Client Protocol) | Spec/schema + SDKs + both official bridges + t3code usage, from source (2026-08-28) | **Reject as UI wire format, adopt as adapter-side standard for long-tail agents.** The only candidate that clears all three walls below (mid-run `session/request_permission`, out-of-run `session/update` push — explicit in v2 — and per-`sessionId` multiplexing); fails on four different grounds: subprocess-parent transport (remote transport is a draft RFD with no reconnect replay), multi-client attach to one session unspecified, agent-owns-state inversion, chat-domain-only coverage. Adapter side: keep native Claude/Codex adapters (12/27 consumed-surface rows lost via the bridge; permission answer collapses to `{outcome, optionId}`); build one generic `mainframe-adapter-acp` when a second-tier agent (Gemini CLI, Cursor, …) is scheduled. Full analysis: [ACP-EVALUATION.md](ACP-EVALUATION.md). |

## The conclusion that generalizes

Every UI-side candidate except ACP fails on the same three walls, because they
are run/turn-scoped protocols for stateless backends (ACP, evaluated last,
clears all three and fails instead on transport parenthood, multi-client
attach, state ownership, and domain coverage — see
[ACP-EVALUATION.md](ACP-EVALUATION.md) Boundary B):

1. no unsolicited server push outside a run,
2. no client→server input **into** a running turn,
3. no multiplexing of N chats + non-chat domains on one connection.

Mainframe's product is a control surface over a long-lived stateful daemon:
permission gates answered mid-run against a live CLI child, background tasks
emitting after the turn, server-initiated turns (automations), the same chat
live on desktop + mobile. The persistent-WS, server-push, out-of-band-gate
**transport** is therefore correct and stays. (t3code, the closest comparable
product, reached the same shape: persistent authenticated Effect-RPC streams.)

What is *not* defensible against these references is our **payload grammar**:
no protocol version, no deltas (growing display messages are re-sent whole),
no explicit turn/step/abort/retry framing, the nested `task_group` payload
encoded at two sites, and ad-hoc extension fields. That layer is where
"hacky because it grew" is a fair description, and it is separable from the
transport.

## Refactor direction (input to the spec, not a spec)

Keep: WS envelope, per-chat subscriptions, out-of-band control requests,
non-chat event domains, daemon-authoritative state, additive-only mobile rule.

Change, modeled on UI Message Stream v1's grammar:

1. **Version handshake** — `connection.ready` carries a protocol version.
2. **Part grammar with block ids** — deltas idempotent by block id. Two
   candidate styles the spec must choose between: UI Message Stream v1's
   start/delta/end triples, or ACP's `ToolCallUpdate` patch semantics
   (omit = unchanged, `null` = cleared, value = replaced, chunks append) —
   the patch style also handles *revision*, which is what
   `display.message.updated` actually does (see
   [ACP-EVALUATION.md](ACP-EVALUATION.md) "What to borrow"). Pairs with
   adopting `--include-partial-messages` upstream (CLAUDE-EVT-06,
   [AGENT-SDK-PARITY.md](adapters/claude/AGENT-SDK-PARITY.md) B4) and cuts WS
   payload volume (today's whole-message re-sends).
3. **Lifecycle parts** — turn start/finish, abort-with-reason, and a `reset`
   part wired to the CLI's `api_retry` events (currently dropped) so retried
   partial output can be invalidated client-side.
4. **Namespaced extension parts** — gates, queued turns, task groups,
   compaction as typed `mainframe.*` parts; gates stay out-of-band but share
   the grammar.
5. **One canonical encoder** in the daemon — retires the dual `task_group`
   encoding as a side effect.
6. **Formalized sync contract** — heartbeat, and refetch-on-gap promoted from
   client heuristic to documented protocol rule.

Also recorded during the AG-UI spike, adoptable in our dialect independently:
AG-UI's `subagentRunId` + `parentToolCallId` attribution model (cleaner than
per-block `parentToolUseId` tagging).
