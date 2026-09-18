# `features/chat/` — charter

The chat surface, built on **assistant-ui** (`useExternalStoreRuntime`) over a
**per-chat controller** that adapts the daemon's ACP facade. The wire contract
lives in `lib/daemon` (facade: `acp-client.ts`; side-band: `ws-client.ts`) +
`lib/api`; everything here is the *adapter* over it. Spec:
`docs/specs/2026-08-28-todo-350-wire-protocol-payload-grammar.md`.

## Data flow

```
/acp/{profile} WS  →  controller (state)   →  view-model (projection)  →  runtime (aui adapter)
side-band / WS        per-chat reducer        AcpItem→ThreadMessage        useExternalStoreRuntime
lib/api (REST)                                                                     │
                                                                                   ▼
                                            messages · parts · tools · gates · composer (render + input)
```

## Subdirectories

| Dir | What | Key files |
|-----|------|-----------|
| **`controller/`** | The stateful seam: a per-chat `AcpChatController` + a **pure reducer** split by plane. `AcpSessionPlane` speaks the facade (transcript items, run frames, gates, `session/resume` on heartbeat gaps); `ChatWsSubscription` + `chat-event-router` handle the side-band (config, background tasks, worktree offers, workflow runs); `chat-environment-state` reduces that slice; `chat-reconcile` owns the optimistic-send pending slice + multiset matcher; `chat-actions` the send/retry/worktree flows; `ChatPlaneLoader` the deduped REST-seed + facade-attach. | `acp-chat-controller.ts`, `acp-session-plane.ts`, `chat-thread-state.ts`, `chat-environment-state.ts`, `chat-reconcile.ts`, `chat-actions.ts`, `chat-plane-loader.ts`, `project-messages.ts` |
| **`runtime/`** | The assistant-ui adapter: the `useExternalStoreRuntime` wiring in `use-chat-thread-runtime.ts`, and the `extras` contract + consumer hooks (`useChatExtras`, `useChatPermissionFront`, …) in `chat-extras.ts`. | `use-chat-thread-runtime.ts`, `chat-extras.ts` |
| **`view-model/`** | **Pure projection** — facade `session/update`s accumulate into stable-id items (`acp-item-accumulator`), converted to native `ThreadMessage`s (`convert-acp-item`/`convert-acp-user`). No React. | `acp-item-accumulator.ts`, `convert-acp-item.ts`, `convert-acp-user.ts`, `content.ts`, `message-meta.ts`, `tool-group-summary.ts` |
| **`messages/`** | Per-role message components + their chrome. | `AssistantMessage`, `UserMessage`, `SystemMessage`, `QueuedUserTurn`, `MessageActionBar`, `MessageTiming/Timestamp`, `ReadMoreBubble`, `user-directives` |
| **`parts/`** | Content-part renderers (the inside of a message). | `markdown-text`, `CodeHeader`, `syntax-highlight`, `markdown-url-transform`, `extract-text` |
| **`thread/`** | The thread shell — scroll viewport, message list, composer + gate mounts. | `ChatThread.tsx` |
| **`tools/`** | The ONE tool-card system: a flat `Record<toolName, card>` registry (`ToolFallback` = catch-all), `mcp__*` resolution, native `GroupedParts` dispatch, and the per-family **display** cards (read-only). | `registry`, `register-cards`, `group-parts`, `tool-dispatch`, `chat-tool-context`, `ToolResultExpand`, `cards/`, `shared/` |
| **`gates/`** | **Interactive blocking cards** — Permission / AskUserQuestion / Plan — dispatched by `ControlRequest.toolName`, replying out-of-band via `extras`. Queue-front-only. The permission gate renders the daemon's option list verbatim (spec decision 12); answers ride the rich `_mainframe.dev` `ControlResponse` plus the clicked `optionId`. *(Distinct from `tools/cards/`, which are read-only tool displays.)* | `ChatGateMount`, `PermissionGate`, `AskUserQuestionGate`, `PlanGate`, `build-control-response`, `build-acp-permission-response`, `gate-types`, `select-front`, `answers` |
| **`composer/`** | Input area. Shell + attachments at the root; `config-toolbar/` = the model/effort/features/plan/permission controls (server-authoritative, PATCH-only); `edit/` = queued-message edit mode. | `Composer.tsx`, `attachment-adapter`, `config-toolbar/`, `edit/` |

## Load-bearing rules

- **Daemon is the single source of truth.** No app-side message cache; drift is
  handled by the facade's **heartbeat gap → `session/resume` replay** (unknown
  cursor → full replay), never a REST history refetch.
- **Stable item ids are contract** (spec decision 3) — the same id keys an item
  live, in resume replay, and in history reconstruction; `convert-acp-item`
  projects them as the aui message keys. Never re-key.
- **A lost gate answer self-heals** — resume redelivers the still-open
  `session/request_permission` under the same `gate-{requestId}` correlation id;
  there is no delivery-verify re-read.
- **Config is server-authoritative** (no optimistic edits) — the composer reads
  `state.chatConfig` and PATCHes; the side-band `chat.updated` broadcast updates
  the toolbar.
- **Pure logic stays in `view-model/`**, not in components.
- See `packages/ui/CLAUDE.md` for the assistant-ui-first golden rule + the
  per-area native-vs-ours verdicts.
