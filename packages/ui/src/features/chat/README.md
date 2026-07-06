# `features/chat/` — charter

The chat surface, built on **assistant-ui** (`useExternalStoreRuntime`) over a
**per-chat controller** that adapts the daemon's WS/REST contract. The frozen
contract lives in `lib/daemon` + `lib/api`; everything here is the *adapter* over
it (a Phase-2 Rust daemon re-implements the contract with zero changes here).

## Data flow

```
daemon WS/REST  →  controller (state)  →  view-model (projection)  →  runtime (aui adapter)
  lib/daemon         per-chat reducer       DisplayMessage→parts        useExternalStoreRuntime
  lib/api                                                                      │
                                                                               ▼
                                              messages · parts · tools · gates · composer (render + input)
```

## Subdirectories

| Dir | What | Key files |
|-----|------|-----------|
| **`controller/`** | The stateful seam: a per-chat `ChatThreadController` + a **pure reducer** + `handle-daemon-event`. Subscribes to the WS, holds the per-chat projection (no app-side cache), optimistic-send reconcile, reconnect/resume. | `chat-thread-controller.ts`, `chat-thread-state.ts`, `handle-daemon-event.ts`, `project-messages.ts` |
| **`runtime/`** | The assistant-ui adapter: the `useExternalStoreRuntime` wiring, `extras`, and the convenience hooks (`useChatExtras`, `useChatPermissionFront`, …). | `use-chat-thread-runtime.ts` |
| **`view-model/`** | **Pure projection** — `DisplayMessage` → native `ThreadMessage` parts (the load-bearing WS14c invariants: `\0` sentinel, `uniqueId` dedup, ≥1-part fallback). No React. | `convert-message.ts`, `map-assistant-blocks.ts`, `map-tool-result.ts`, `content.ts`, `message-meta.ts`, `tool-group-summary.ts` |
| **`messages/`** | Per-role message components + their chrome. | `AssistantMessage`, `UserMessage`, `SystemMessage`, `QueuedUserTurn`, `MessageActionBar`, `MessageTiming/Timestamp`, `ReadMoreBubble`, `user-directives` |
| **`parts/`** | Content-part renderers (the inside of a message). | `markdown-text`, `CodeHeader`, `syntax-highlight`, `markdown-url-transform`, `extract-text` |
| **`thread/`** | The thread shell — scroll viewport, message list, composer + gate mounts. | `ChatThread.tsx` |
| **`tools/`** | The ONE tool-card system: a flat `Record<toolName, card>` registry (`ToolFallback` = catch-all), `mcp__*` resolution, native `GroupedParts` dispatch, and the per-family **display** cards (read-only). | `registry`, `register-cards`, `group-parts`, `tool-dispatch`, `chat-tool-context`, `ToolResultExpand`, `cards/` (15 families), `shared/` |
| **`gates/`** | **Interactive blocking cards** — Permission / AskUserQuestion / Plan — dispatched by `ControlRequest.toolName`, replying out-of-band via `extras`. Queue-front-only. *(Distinct from `tools/cards/`, which are read-only tool displays.)* | `ChatGateMount`, `PermissionGate`, `AskUserQuestionGate`, `PlanGate`, `build-control-response`, `select-front`, `answers` |
| **`composer/`** | Input area. Shell + attachments at the root; `config-toolbar/` = the model/effort/features/plan/permission controls (server-authoritative, PATCH-only); `edit/` = queued-message edit mode. | `Composer.tsx`, `attachment-adapter`, `config-toolbar/`, `edit/` |

*(`sessions/` — the thread-list sidebar — is build-order step 11, not yet built.)*

## Load-bearing rules

- **Daemon is the single source of truth.** No app-side message cache; drift is handled by **refetch-on-gap**, not a client `seq`.
- **`convert-message` invariants are load-bearing** — never drop the `\0` sentinel / `uniqueId` dedup / dual re-encode.
- **Config is server-authoritative** (no optimistic edits) — the composer reads `state.chatConfig` and PATCHes; the `chat.updated` broadcast updates the toolbar.
- **Pure logic stays in `view-model/`**, not in components.
- See `packages/app-tauri/CLAUDE.md` for the assistant-ui-first golden rule + the per-area native-vs-ours verdicts.
