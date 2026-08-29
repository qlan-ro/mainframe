# AG-UI as a wire format for Mainframe's chat surface

Evaluation of the [AG-UI protocol](https://github.com/ag-ui-protocol/ag-ui) as a
replacement for Mainframe's `DaemonEvent`/`ClientEvent` dialect on the
daemon↔client chat surface, and of `@assistant-ui/react-ag-ui`'s
`useAgUiRuntime` as a near-native consumer of it.

## Sources and versions

| Source | Version / commit | Date |
|---|---|---|
| `ag-ui-protocol/ag-ui` (monorepo clone) | `a0d5a7f93866` (`main`) | 2026-08-27 |
| `@ag-ui/core` (npm `latest`) | `0.0.59` — 74 published versions, first `0.0.27` on 2025-04-30 | 2026-08-27 |
| `@ag-ui/client` (npm `latest`) | `0.0.59` | 2026-08-27 |
| `@assistant-ui/react-ag-ui` (npm `latest`) | `0.0.57` — 52 published versions, first `0.0.2` on 2025-11-19 | 2026-08-27 |
| `@assistant-ui/react` in `packages/ui` | `0.15.13` (npm latest is `0.15.17`) | `packages/ui/package.json:15` |
| Mainframe WS catalog | `docs/API-REFERENCE.md` §"WebSocket Protocol" (L606–745), last touched `7165a3a7` | 2026-08-15 |
| Mainframe wire types | `packages/types/src/{events,display,chat,adapter,content}.ts` | working tree, 2026-08-28 |

Every AG-UI claim below is read from the TypeScript SDK source in the clone
(`sdks/typescript/packages/{core,client}/src/`), not from docs.ag-ui.com prose.
Where a doc page is cited it is the `.mdx` in the same clone.

## AG-UI event vocabulary (complete, `@ag-ui/core` 0.0.59)

Ground truth: `sdks/typescript/packages/core/src/events.ts::EventType` (36
members) and the `EventSchemas` discriminated union at L463–500. Every event
extends `BaseEventSchema` (`type`, `timestamp?`, `rawEvent?`, `metadata?`,
`.passthrough()`), and — apart from the deprecated `THINKING_*` family and
`MESSAGES_SNAPSHOT` — every event carries an optional `subagentRunId`.

**Run lifecycle**
- `RUN_STARTED` — `threadId`, `runId`, `parentRunId?`, `input?: RunAgentInput`.
- `RUN_FINISHED` — `threadId`, `runId`, `result?`, `outcome?: {type:"success"} | {type:"interrupt", interrupts:Interrupt[]}`, `usage?: TokenUsage[]`.
- `RUN_ERROR` — `message`, `code?`, `usage?`.
- `STEP_STARTED` / `STEP_FINISHED` — `stepName`. Free-form framework step markers.

**Assistant text**
- `TEXT_MESSAGE_START` — `messageId`, `role` (default `"assistant"`; `developer|system|assistant|user`), `name?`.
- `TEXT_MESSAGE_CONTENT` — `messageId`, `delta`.
- `TEXT_MESSAGE_END` — `messageId`.
- `TEXT_MESSAGE_CHUNK` — all fields optional; a one-shot start+content+end.

**Reasoning** (the `THINKING_*` five are `@deprecated … removed in 1.0.0`, events.ts L23–42)
- `REASONING_START` / `REASONING_END` — `messageId`.
- `REASONING_MESSAGE_START` (`role: "reasoning"`) / `..._CONTENT` (`delta`) / `..._END` / `..._CHUNK`.
- `REASONING_ENCRYPTED_VALUE` — `subtype: "tool-call"|"message"`, `entityId`, `encryptedValue`. Zero-data-retention passthrough.
- `THINKING_START` (`title?`), `THINKING_END`, `THINKING_TEXT_MESSAGE_START|CONTENT|END` — deprecated.

**Tool calls**
- `TOOL_CALL_START` — `toolCallId`, `toolCallName`, `parentMessageId?`.
- `TOOL_CALL_ARGS` — `toolCallId`, `delta` (JSON text fragment).
- `TOOL_CALL_END` — `toolCallId`.
- `TOOL_CALL_CHUNK` — all-optional one-shot form.
- `TOOL_CALL_RESULT` — `messageId`, `toolCallId`, `content: string`, `role?: "tool"`. **`content` is a bare string**; there is no structured-result field on the event (the `error` field exists only on the `ToolMessage` shape in `types.ts:154`).

**Subagents** (newest family; `docs/concepts/subagents.mdx`)
- `SUBAGENT_STARTED` — `subagentRunId`, `name`, `description?`, `parentSubagentRunId?`, `parentToolCallId?`, `parentMessageId?`.
- `SUBAGENT_FINISHED` — `subagentRunId`, `result?`, `outcome?: {type:"success"} | {type:"suspended", interruptIds?}`.
- `SUBAGENT_ERROR` — `subagentRunId`, `message`, `code?`.

**State and snapshots**
- `STATE_SNAPSHOT` — `snapshot` (`z.any()`).
- `STATE_DELTA` — `delta`: RFC 6902 JSON Patch array.
- `MESSAGES_SNAPSHOT` — `messages: Message[]`; full thread replacement.

**Activity** (generic non-message surfaces)
- `ACTIVITY_SNAPSHOT` — `messageId`, `activityType: string`, `content: Record<string,any>`, `replace?` (default `true`).
- `ACTIVITY_DELTA` — `messageId`, `activityType`, `patch` (JSON Patch).

**Escape hatches**
- `CUSTOM` — `name: string`, `value: any`.
- `RAW` — `event: any`, `source?`.

**Non-event types that matter here** (`core/src/types.ts`)
- `Interrupt` — `id`, `reason`, `message?`, `toolCallId?`, `responseSchema?: JsonSchema`, `expiresAt?`, `metadata?`, `subagentRunId?` (L210–225).
- `ResumeEntry` — `interruptId`, `status: "resolved"|"cancelled"`, `payload?`, `metadata?` (L227–234).
- `RunAgentInput` — `threadId`, `runId`, `parentRunId?`, `state`, `messages`, `tools`, `context`, `forwardedProps`, `resume?: ResumeEntry[]` (L236–251).
- `Message` roles: `developer | system | assistant | user | tool | activity | reasoning` (L178–186). User content may be `string` or `InputContent[]` (`text|image|audio|video|document|binary`); **assistant content is `string` only** (L136–145).

### Transports

The `AgentCapabilities` schema *declares* `transport.{streaming, websocket, httpBinary, pushNotifications, resumable}` (`core/src/capabilities.ts:39–50`), but declaration is not implementation. In the TypeScript SDK:

- **SSE over HTTP** is the only shipped transport. `HttpAgent` sends `Accept: text/event-stream` (`client/src/agent/http.ts:58`) and reads the body via `response.body?.getReader()` (`client/src/run/http-request.ts:53`).
- **Protobuf over HTTP** is negotiated by response `content-type === proto.AGUI_MEDIA_TYPE` on the same request (`client/src/transform/http.ts:35–43`).
- **WebSocket: not implemented anywhere in the TS SDK.** `grep -rl WebSocket sdks/typescript/packages/*/src` matches exactly one file — `core/src/capabilities.ts`, the flag itself.
- `AbstractAgent.connect()` exists as a bidirectional extension point but the base implementation throws `AGUIConnectNotImplementedError` (`client/src/agent/agent.ts:266–267`); no shipped agent overrides it.
- The real integration seam is `abstract run(input: RunAgentInput): Observable<BaseEvent>` (`client/src/agent/agent.ts:148`). A custom `AbstractAgent` subclass can source events from anything, including an existing WebSocket. The client is RxJS-based (`rxjs@7.8.1`), not DOM-based.

### Human-in-the-loop / interrupts

AG-UI's HITL model is **run-terminating**, spelled out in `docs/concepts/interrupts.mdx`: "a terminal model where the run ends with an interrupt outcome, and the client starts a new run carrying per-interrupt responses." The agent emits `RUN_FINISHED { outcome: { type: "interrupt", interrupts: [...] } }`; the client answers by opening a **new run** whose `RunAgentInput.resume[]` carries `{interruptId, status, payload}`. A subagent that pauses reports `SUBAGENT_FINISHED { outcome: { type: "suspended", interruptIds } }` and may reuse its `subagentRunId` on the resuming run.

### Maturity signals

- **Versioning:** `0.0.x` across every SDK package after 16 months. Deprecations are tagged "Will be removed in 1.0.0" (events.ts L24–42) with no 1.0.0 date. No stability or versioning policy document exists in `docs/` (`docs/development/` holds only `contributing`, `roadmap`, `updates`); `docs/development/updates.mdx` contains a single entry dated 2025-04-09.
- **Cadence:** 74 `@ag-ui/core` releases in ~16 months, `0.0.58` → `0.0.59` on 2026-08-14 → 2026-08-27, with `canary` tags between.
- **Breaking-change history is visible in the code:** `@ag-ui/client` ships four dated compatibility middlewares — `backward-compatibility-0-0-39.ts`, `-0-0-45.ts`, `-0-0-47.ts`, `-0-0-57.ts` (`client/src/middleware/`). Several schemas carry explicit null-tolerance shims for producers in other language SDKs that emitted `null` for optional fields (`events.ts:142–150`, `:306–310`) — cross-SDK drift that the spec is patching rather than preventing.
- **Governance:** repo-level; roadmap is a GitHub project board (`docs/development/roadmap.mdx`). No RFC process, no spec-versioning header on the wire.

Read plainly: the vocabulary is well-designed and the source is unusually well-commented, but it is a pre-1.0 protocol still absorbing breaking changes at roughly one compatibility middleware per 10 releases.

## Coverage: Mainframe chat surface → AG-UI construct

Row source: `packages/types/src/events.ts::DaemonEvent`/`ClientEvent`,
`display.ts::DisplayContent`, `adapter.ts::ControlRequest`/`ControlResponse`,
`content.ts::LeafContent`, cross-checked against `docs/API-REFERENCE.md:652–728`.

### Message and streaming

| Mainframe concept | AG-UI construct | Fit |
|---|---|---|
| `display.message.added` + `display.message.updated` (`DisplayMessage`) | `TEXT_MESSAGE_START` / `_CONTENT` / `_END` | **Shape inversion.** We push whole re-rendered messages; AG-UI pushes deltas. The daemon would have to become delta-emitting, or spam `TEXT_MESSAGE_CHUNK` per revision (which appends, not replaces). |
| `display.messages.set` | `MESSAGES_SNAPSHOT` | Native |
| `messages.cleared` | `MESSAGES_SNAPSHOT { messages: [] }` | Native |
| `LeafContent.text` | `TEXT_MESSAGE_*` | Native |
| `LeafContent.thinking` | `REASONING_MESSAGE_START/_CONTENT/_END` | Native |
| `LeafContent.image` (assistant-produced) | — | **No construct.** `AssistantMessageSchema.content` is `z.string()` (`types.ts:138`); `InputContent` image parts exist on *user* messages only. Needs `CUSTOM` or `ACTIVITY_SNAPSHOT`. |
| `LeafContent.skill_loaded` (`skillName`, `path`, `content`) | — | No construct → `CUSTOM` / `ACTIVITY_SNAPSHOT` |
| `DisplayContent.error` (mid-message) | `RUN_ERROR` | **Partial.** `RUN_ERROR` is run-terminating; ours is an inline content block that leaves the turn alive. |
| `message.added` / `message.updated` (`ChatMessage` transcript form) | `MESSAGES_SNAPSHOT` | Redundant on an AG-UI wire — the transcript form exists only because we ship two message models. |

### Tool calls

| Mainframe concept | AG-UI construct | Fit |
|---|---|---|
| `DisplayContent.tool_call` (`id`, `name`, `input`) | `TOOL_CALL_START` + `TOOL_CALL_ARGS` + `TOOL_CALL_END` | Native |
| `ToolCallResult.content` / `.isError` | `TOOL_CALL_RESULT { content: string }` | **Partial.** No `isError` on the event — only on the `ToolMessage` shape, reachable via `MESSAGES_SNAPSHOT`. Live streams lose the error bit unless it is encoded into `content`. |
| `ToolCallResult.structuredPatch` / `originalFile` / `modifiedFile` / `truncated` / `fullBytes` / `askUserQuestion` | — | **No construct.** `content` is a flat string. Either JSON-in-string (and every client re-parses) or a parallel `CUSTOM`/`ACTIVITY_SNAPSHOT` keyed by `toolCallId`. |
| `tool_call.category` (`explore\|hidden\|progress\|subagent`) | `BaseEvent.metadata` (`z.record(z.any())`, `metadata.ts:32`) | Extension; open-by-key, unvalidated |
| `DisplayContent.tool_group` | — | Pure client-side grouping; no wire need either way |
| `DisplayContent.task_group` (`agentId`, `taskArgs`, nested `calls`) + `parentToolUseId` on every content block | `SUBAGENT_STARTED { subagentRunId, name, parentToolCallId, parentMessageId }` + `subagentRunId` on nearly every event + `SUBAGENT_FINISHED/ERROR` | **Native and precise — the single strongest match in the protocol.** `parentToolCallId` is exactly our Task-tool linkage, and per-event `subagentRunId` replaces our `parentToolUseId` tagging. Caveat below: `@assistant-ui/react-ag-ui` does not consume this family. |
| `DisplayContent.task_progress` | `ACTIVITY_SNAPSHOT` / `ACTIVITY_DELTA` with a custom `activityType` | Extension (generic slot exists; semantics are ours) |
| `todos.updated` (`TodoItem[]`) | `STATE_SNAPSHOT` / `STATE_DELTA` | Native — this is what the shared-state channel is for |

### Permission gates (the hard case)

| Mainframe concept | AG-UI construct | Fit |
|---|---|---|
| `permission.requested { request: ControlRequest, notify }` | `RUN_FINISHED { outcome: { type: "interrupt", interrupts: [Interrupt] } }` | **Semantic mismatch, not a rename.** Ours is *mid-run, out-of-band*: the CLI child stays alive, the turn is not over, and the gate is a `permission_request` content block inside the live message (`display.ts:60`). AG-UI's interrupt *ends the run*; resumption is a new `RunAgentInput` with `resume[]`. |
| `ControlRequest.{requestId, toolName, toolUseId, input}` | `Interrupt.{id, toolCallId, reason, message, responseSchema}` | Fields map; `toolName`/`input` land in `metadata` |
| `ControlRequest.suggestions: ControlUpdate[]` (6 variants incl. `setMode`, `addDirectories`) | `Interrupt.metadata` / `responseSchema` | Extension — no rule-suggestion vocabulary in AG-UI |
| `ControlResponse.{behavior, updatedInput, updatedPermissions, executionMode, clearContext}` | `ResumeEntry.payload` (`z.any()`) | Carries, unschematized |
| Multiple simultaneous pending gates (see `permission-queue-multi-control-request`) | `interrupts: Interrupt[]` | Array supports N, but only as one batch **at run end**. A second gate arriving while the first is open has no incremental event. |
| `permission.resolved { requestId }` | — | Implicit: resolution is the client's own `resume[]`. A *second* client watching the same chat never learns the gate closed. |
| CLI-initiated withdrawal (`control_cancel_request`, CLAUDE-CTRL-05) | `Interrupt.expiresAt` only | **No construct** → `CUSTOM` |

The honest daemon-side adaptation: either (a) mint a synthetic `RUN_FINISHED`/`RUN_STARTED` boundary per gate — which fabricates run boundaries the CLI never had, breaks single-turn `usage` accounting, and multiplies runs by the number of gates in a turn — or (b) carry gates as `CUSTOM` events entirely outside the interrupt protocol, forfeiting the one thing the aui runtime gives you for free. Neither is "covered".

### Queued turns

| Mainframe concept | AG-UI construct | Fit |
|---|---|---|
| `message.queued` / `.processed` / `.cancelled` / `.cleared` / `.snapshot` (`QueuedMessageRef`, move-on-ack; `daemon-owns-queued-messages`) | — | **No protocol construct.** AG-UI has no notion of a server-owned pending-input queue. `@assistant-ui/react-ag-ui` ships a *client-side* queue (`useAgUiRuntime.ts:112–145`, `createMessageQueue` from `@assistant-ui/core`) that holds sends locally until the run goes idle — the opposite ownership model from ours, where the CLI owns the queue and the daemon mirrors it. → `CUSTOM` for all five. |

### Compaction, context, quota

| Mainframe concept | AG-UI construct | Fit |
|---|---|---|
| `chat.compacting` / `chat.compactDone` / `DisplayContent.compaction` | — | No construct → `CUSTOM`. (`MESSAGES_SNAPSHOT` can express the *result* of compaction but not the boundary marker the transcript renders.) |
| `chat.contextUsage { percentage, totalTokens, maxTokens }` | — | **No construct.** `RUN_FINISHED.usage: TokenUsage[]` is *per-run consumption* (`inputTokens`/`outputTokens`/`cachedInputTokens`), not context-window occupancy — do not conflate. → `CUSTOM` or `STATE_*`. |
| `provider.quota.updated { adapterId, quota: ProviderQuota }` (connection-global, no `chatId`) | — | No construct, and it is not run-scoped at all — it cannot ride an AG-UI event stream without inventing an out-of-run channel. |
| `adapter.models.updated` | `AgentCapabilities` (pull, via `getCapabilities()`) | Not push. Our catalog is a live probe result pushed on change. |

### Session lifecycle and subscription

| Mainframe concept | AG-UI construct | Fit |
|---|---|---|
| `subscribe { chatId }` → `subscribe:ack` + history re-seed | `MESSAGES_SNAPSHOT` for the payload | **The re-seed content maps; the subscription does not.** AG-UI has no subscribe verb: a client *starts runs*, it does not attach to a stream someone else started. Our `subscribe:ack` re-seed (`app-tauri-first-message-renders-last`) has no protocol equivalent. |
| One WS carrying N chats, every frame keyed by `chatId` | — | **AG-UI is run-scoped.** `threadId` appears on `RUN_STARTED`/`RUN_FINISHED` only — not on `TEXT_MESSAGE_*`, `TOOL_CALL_*`, `STATE_*`. One `AbstractAgent` instance = one thread's stream. Multiplexing N chats over one socket requires an envelope **outside** AG-UI. |
| `chat.created` / `chat.updated` / `chat.ended` (`Chat`: 40+ fields — model, worktree, tags, cost, PRs, tuning) | — | Out of scope. Thread-list state is an assistant-ui *adapter* concern, not an AG-UI protocol concern. |
| `process.started` / `.ready` / `.stopped`, `isRunning`, `displayStatus` | `RUN_STARTED` / `RUN_FINISHED` | Partial — a CLI child's lifetime spans many runs |
| `chat.trustRequired`, `chat.prDetected`, `chat.notification` | — | No construct → `CUSTOM` |
| `worktree.offer.raised` / `.resolved` / `.snapshot` | `Interrupt` (shape fits — it *is* a user decision) or `CUSTOM` | Extension; same run-terminating problem as permission gates |
| `background_task.started` / `.updated` / `.ended` | `SUBAGENT_*` or `ACTIVITY_*` | Extension |
| `claude_workflow.run.updated` | `ACTIVITY_*` / `CUSTOM` | Extension |
| `context.updated { filePaths }` | `STATE_SNAPSHOT` / `STATE_DELTA` | Native |
| `error { chatId?, error }` | `RUN_ERROR` | Partial (run-terminating) |

### Client → server

| Mainframe concept | AG-UI construct | Fit |
|---|---|---|
| `message.send { chatId, content }` | `RunAgentInput.messages` + a new run | Native |
| `message.send.attachmentIds` | `UserMessage.content: InputContent[]` (`image`/`document`/`binary`) or `forwardedProps` | Partial — ours are daemon-stored blob ids, AG-UI's are inline data/URL |
| `message.send.metadata.command` (slash-command provenance) | `forwardedProps` | Extension |
| `permission.respond { response: ControlResponse }` | `RunAgentInput.resume[]` | Extension (new run required) |
| `subscribe` / `unsubscribe` | — | No construct (transport-level concern) |

### Explicitly outside AG-UI's scope

`launch.output`, `launch.status`, `launch.tunnel`, `launch.tunnel.failed`,
`launch.port.timeout`, `launch.scopeReleased`, `file:changed`,
`subscribe:file` / `subscribe:file:ack` / `unsubscribe:file`, `tunnel:status`,
`plugin.panel.*`, `plugin.action.*`, `plugin.notification`,
`sessions.external.count`, `automation.run.updated`,
`automation.interaction.created` / `.resolved`, `automation.completed`,
`automation.notification`, `notification.created`, `connection.ready`, and the
whole REST surface (`docs/API-REFERENCE.md:170–605`). AG-UI is a chat-stream
protocol; none of this is chat stream. **These 20 event types would keep a
Mainframe-native dialect on the same socket no matter what the chat surface
speaks.**

### Tally

Denominator: the 36 chat-surface `DaemonEvent` variants plus the 2 chat-surface
`ClientEvent` variants (`message.send`, `permission.respond`) — 38 total. Excluded:
the 20 non-chat types above, `connection.ready` and `subscribe`/`unsubscribe`
(transport-level), and `adapter.models.updated` / `provider.quota.updated`
(connection-global, no `chatId`, and so unrepresentable in a run-scoped stream
at all). Each variant lands in exactly one bucket.

- **Carried natively** (exact AG-UI construct, no reinterpretation): **5 — ≈13%.** `display.messages.set` and `messages.cleared` → `MESSAGES_SNAPSHOT`; `todos.updated` and `context.updated` → `STATE_*`; `message.send` → `RunAgentInput.messages`.
- **Carried with semantic adaptation** (construct exists, meaning shifts): **11 — ≈29%.** `display.message.added`/`.updated` and `message.added`/`.updated` (whole-message replace vs. delta append); `permission.requested`/`.resolved`/`permission.respond` (mid-run gate vs. run-terminating interrupt); `error` → `RUN_ERROR` (inline vs. terminal); `process.started`/`.ready`/`.stopped` → `RUN_STARTED`/`_FINISHED` (child lifetime vs. run lifetime).
- **`CUSTOM` / `ACTIVITY_*` / `metadata` extension** (no construct): **22 — ≈58%.** All five `message.queued.*`; both compaction events; `chat.contextUsage`; `chat.trustRequired`; `chat.prDetected`; `chat.notification`; all three `background_task.*`; `claude_workflow.run.updated`; `subscribe:ack`; all three `worktree.offer.*`; `chat.created`/`.updated`/`.ended`.

Two display-model constructs sit outside this count because they are not wire
event types: `task_group` maps natively onto `SUBAGENT_*`, and `tool_group` needs
no wire representation at all.

Weighted by *volume* rather than variant count the native share is higher —
text, tool calls, and subagent nesting are the bulk of the bytes. Weighted by
*the parts that are hard to get right*, it is lower: permission gates, queued
turns, and compaction are where our dialect earns its keep, and all three land
in the extension bucket.

## `useAgUiRuntime` maturity

Package: `@assistant-ui/react-ag-ui@0.0.57`, published by `AgentbaseAI Inc.`,
repo `assistant-ui/assistant-ui` `packages/react-ag-ui`.

**Size and activity**
- 8,271 lines in `src/` (ships source alongside `dist/`). Largest files: `runtime/AgUiThreadRuntimeCore.ts` (1,945), `runtime/adapter/conversions.ts` (1,201), `runtime/adapter/run-aggregator.ts` (983).
- Test files are 2,587 of those lines (~31%): `useAgUiRuntime.approval.test.tsx` (885), `runtime/adapter/tool-approval.test.ts` (681), `useAgUiRuntime.queue.test.tsx` (419), plus history, conversions, and core tests. Approvals and the message queue are the best-covered areas; there is no test naming subagents or activity deltas.
- ~215 commits touching `packages/react-ag-ui`, first on 2025-11-18. 52 npm releases; latest published 2026-08-27 — actively maintained, not abandoned.
- `assistant-ui/assistant-ui` has 4 open issues matching "ag-ui" (25 including PRs).
- Public API is still marked provisional: `unstable_enableMessageQueue`, `unstable_getPendingInterrupts`, `unstable_submitInterruptResponses` (already `@deprecated` in favour of hooks), `unstable_resume` (`useAgUiRuntime.ts:44–56, 112, 202`).

**Which AG-UI events it actually consumes**

Handled — subscriber (`runtime/adapter/subscriber.ts:103–148`) → parser (`runtime/event-parser.ts`) → aggregator (`runtime/adapter/run-aggregator.ts`) / core (`runtime/AgUiThreadRuntimeCore.ts`):

| Family | Status |
|---|---|
| `RUN_STARTED` / `_FINISHED` / `_ERROR` | Yes (plus a synthetic `RUN_CANCELLED`, `runtime/types.ts:137`, that is **not** an AG-UI event type) |
| `TEXT_MESSAGE_*` (all 4) | Yes |
| `TOOL_CALL_START/ARGS/END/CHUNK/RESULT` | Yes — tool results render (`run-aggregator.ts:325`, `AgUiThreadRuntimeCore.ts:1585`) |
| `REASONING_*` (6) + `THINKING_*` (5 deprecated) | Yes |
| `STATE_SNAPSHOT` / `STATE_DELTA` | Yes — `STATE_DELTA` applied via `fast-json-patch` (`AgUiThreadRuntimeCore.ts:1559–1580`) |
| `MESSAGES_SNAPSHOT` | Yes (`AgUiThreadRuntimeCore.ts:1581`) |
| `CUSTOM` | Yes — becomes an ordered `data` message part (`run-aggregator.ts:226–234`), so custom payloads render inline in sequence |
| `ACTIVITY_SNAPSHOT` | **Only two hard-coded `activityType`s**: `"mcp-apps"` and `"a2ui-surface"` (`run-aggregator.ts:55–57, 340–345`). Any other `activityType` is dropped. |
| `RAW` | Parsed and dispatched, then **dropped** — no `case "RAW"` in the aggregator or the core |
| `ACTIVITY_DELTA` | **Not handled** — no reference anywhere in `src/` |
| `STEP_STARTED` / `STEP_FINISHED` | **Not handled** |
| `REASONING_MESSAGE_CHUNK` | **Not handled** |
| `SUBAGENT_STARTED` / `_FINISHED` / `_ERROR`, and the `subagentRunId` attribution field | **Not handled at all.** `grep -rni subagent src/` in the 0.0.57 tarball returns zero matches. |

The last row is the decisive one for Mainframe: AG-UI's best-fitting construct
for our `task_group` nesting is invisible to the runtime that would consume it.
Unknown event types fall through `event-parser.ts:289–295` into `RAW` and are
then discarded, so a subagent-attributed stream renders flat.

**Feature checklist**

| Capability | Status |
|---|---|
| Tool result rendering | Yes |
| HITL approvals | Yes, and it is the most developed part: `runtime/adapter/tool-approval.ts` (366 lines) validates `Interrupt.responseSchema` against the approve/reject/edit shapes, `buildResumeArray` from `@ag-ui/client` builds `resume[]`, and `runtime/interrupt-internals.ts` preserves a non-object `responseSchema` across persistence |
| Multiple pending interrupts | Yes (`interrupts: readonly AgUiInterrupt[]` in extras, `useAgUiRuntime.ts:236`) |
| New run while interrupts pending | **Refused** — `assertNoPendingInterrupts()` throws (`AgUiThreadRuntimeCore.ts:397–402`), called from `append`, `edit`, `resume` |
| Thread lists | Yes, via an optional `adapters.threadList`; `onSwitchToThread` clears, re-seeds, and can resume in-flight (`useAgUiRuntime.ts:175–208`) |
| History seeding / resume | Yes, via a `ThreadHistoryAdapter`; `unstable_resume` needs the adapter to implement `resume()` or it warns and skips (`AgUiThreadRuntimeCore.ts:373–392`) |
| Attachments | Passthrough only — `adapters.attachments` is forwarded to the external store; the runtime adds nothing AG-UI-specific |
| Message editing / branching | Yes — `onEdit` and `onReload` route to `core.edit` / `core.reload` and clear the queue (`useAgUiRuntime.ts:247–254`) |
| Message queue | Yes, client-side, behind `unstable_enableMessageQueue` |

**The structural fact.** `useAgUiRuntime` is not an alternative to
`useExternalStoreRuntime` — it is a *caller* of it. `useAgUiRuntime.ts:12` imports
`useExternalStoreRuntime` from `@assistant-ui/core/react` and returns
`useExternalStoreRuntime(store)` at L289. Adopting it does not replace
Mainframe's runtime layer (`packages/ui/src/features/chat/runtime/use-chat-thread-runtime.ts`,
301 lines); it substitutes a fixed, opinionated event→message translator for the
one we control, on top of the identical store primitive.

**Dependency-generation cost.** `react-ag-ui@0.0.57` requires
`@assistant-ui/core ^0.3.16` and `@assistant-ui/store ^0.3.11`.
`packages/ui` is on `@assistant-ui/react@0.15.13`, which pins
`@assistant-ui/core ^0.3.12` and `@assistant-ui/store ^0.3.8` — the same
architecture generation, one minor behind. Adoption is a version bump
(`0.15.13 → 0.15.17`), not an architecture migration. That is a real point in
its favour and the cheapest part of the whole proposal.

## Mobile

`packages/mobile` consumes the same `DaemonEvent` union over the same socket
today (`packages/mobile/lib/daemon-client.ts`, `packages/mobile/lib/event-router.ts`).

- `@ag-ui/core` is pure Zod schemas — no DOM, RN-safe.
- `@ag-ui/client` is RxJS + `fast-json-patch` + `uuid` — all RN-safe, **except the HTTP transport**: `HttpAgent` calls `response.body?.getReader()` (`client/src/run/http-request.ts:53`). React Native's `fetch` is XMLHttpRequest-backed and exposes no streaming `response.body`, so `HttpAgent` would fail on device without a streaming-fetch polyfill.
- Two mitigations exist and both are first-class: `HttpAgent` accepts an injected `fetch` (`client/src/agent/http.ts:87`), and — the better path — a custom `AbstractAgent` subclass implementing `run(input): Observable<BaseEvent>` bypasses HTTP entirely and can source events from the existing WebSocket.
- `@assistant-ui/react-ag-ui` is React-DOM-oriented (`jsdom` test env, `@assistant-ui/react-generative-ui`) and is **not** usable from React Native. Mobile would consume `@ag-ui/core`/`@ag-ui/client` and render with its own components either way — so the aui runtime's maturity is irrelevant to the mobile verdict, and mobile would get *only* the protocol's costs, none of its "free renderer" benefit.

## Verdict

### (a) Desktop web client — **reject**

`useAgUiRuntime` sits on the same `useExternalStoreRuntime` we already feed. The
upside is therefore not "a runtime we don't have" but "an event→message
translator we didn't write" — and that translator drops the two families we
most need (`SUBAGENT_*` entirely; `ACTIVITY_*` outside two hard-coded types) and
discards `RAW`. We would inherit a translator that cannot render our subagent
transcripts, then fork or wrap it — which is the maintenance cost we currently
pay in code we own and can debug.

The one thing worth having is the approval machinery in `tool-approval.ts`, and
it is bought at the price of AG-UI's run-terminating interrupt model, which does
not describe a mid-run `can_use_tool` gate against a live CLI child.

### (b) Mobile — **reject**

`react-ag-ui` is DOM-bound and unusable here, so mobile would adopt the protocol
without the renderer that is the whole argument for it. It would swap one
hand-written event router (`packages/mobile/lib/event-router.ts`) for another,
plus a `CUSTOM`-envelope decoder for the ~58% of our vocabulary AG-UI has no
construct for. Net negative.

### (c) Daemon — **reject as a replacement; worth one targeted borrow**

Three structural blockers, in order of severity:

1. **Scope mismatch.** AG-UI is run-scoped and client-initiated. Mainframe is chat-subscription-scoped and daemon-initiated: N chats multiplexed on one socket, every frame keyed by `chatId`, clients attaching to streams the daemon already started, `subscribe:ack` re-seeding history. `threadId` appears on two of 36 event types. A multiplexing envelope stays ours regardless — meaning the daemon ships a Mainframe dialect *and* AG-UI, not AG-UI instead of a dialect.
2. **The interrupt model does not fit permission gates.** Modelling each `can_use_tool` as a run boundary fabricates runs the CLI never had and breaks per-run `usage` accounting; modelling it as `CUSTOM` forfeits the only thing the aui runtime would have given us. There is no third option in the current spec.
3. **Pre-1.0 with live breaking-change debt.** Four dated compatibility middlewares in `@ag-ui/client`, five deprecated event types slated for removal in an undated 1.0.0, and no published stability policy. Our wire format is a private contract between two clients we ship; adopting AG-UI trades a contract we can change atomically for one whose changes arrive on someone else's schedule.

**Compared to the status quo**, `useExternalStoreRuntime` + `DisplayMessage`
already works, already renders subagent nesting, already carries structured
diffs and permission gates, and is shared verbatim by desktop and mobile. AG-UI
would carry ≈13% of the chat vocabulary natively, ≈29% with semantic distortion,
and ≈58% through `CUSTOM` — an envelope inside an envelope.

**The borrow worth making:** AG-UI's subagent attribution model is better than
ours. `subagentRunId` as an opaque per-*invocation* handle, with
`SUBAGENT_STARTED.parentToolCallId` linking back to the spawning tool call and
`SUBAGENT_FINISHED.outcome` distinguishing completed from suspended
(`core/src/events.ts:401–461`, `docs/concepts/subagents.mdx`), is a cleaner
design than tagging every content block with `parentToolUseId` and
reconstructing the tree client-side (`chat.ts:123–149`). That idea can be
adopted in our own dialect for the cost of a field, with none of the protocol.

## Addendum (2026-08-28): the official Claude integration confirms the HITL finding

`integrations/claude-agent-sdk/typescript` in the AG-UI monorepo advertises
"human-in-the-loop" support. Read from source (`src/adapter.ts`), the mechanism
is exactly the run-boundary pattern this document predicted, not a mid-run gate:

- Each AG-UI run is a **fresh SDK `query()`** — a new CLI process — resumed
  from the prior turn via `forwardedProps.resume: sessionId`
  (`adapter.ts:140–154`).
- HITL applies to **client-declared frontend tools only**. They are registered
  as an in-process MCP server and **auto-granted** in `allowedTools`
  (`adapter.ts:301–327`, log line "Auto-granted permission to ag_ui tools").
  When Claude calls one, the adapter emits the `TOOL_CALL_*` events, sets
  `haltEventStream = true`, breaks out of the SDK message stream, and emits
  `RUN_FINISHED` (`adapter.ts:689–696`) — abandoning the in-flight turn. The
  answer arrives as the **next run's** input, which spawns a new CLI process
  with `--resume`.
- The SDK's `canUseTool` permission callback is **never used** (zero matches in
  the integration). The harness's own permission system is bypassed; "approval"
  is an application tool whose UI happens to render approve/reject buttons.

Applied to Mainframe, this pattern would kill and respawn the CLI child at
every `can_use_tool` prompt — several times per turn on a busy session — and
requires auto-approving at the harness layer to work at all. It is
confirmation of blocker (2) above, with the official integration as evidence,
not a workaround for it.
