# Adapter-Specific Event Handlers Design

**Goal:** Decouple the message pipeline from Claude-specific assumptions so a second adapter (Codex) can be added without modifying core message logic or the existing Claude code path.

**Approach:** Adapter-specific event handlers. Each adapter owns its full event-to-ChatMessage pipeline. Both write to the same shared `ChatMessage` model. No forced canonical event protocol — each adapter keeps its own typed events.

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Codex integration path | `@openai/codex-sdk` | Multi-turn via `Thread.run()`. No interactive approvals — blanket policy. |
| UI parity | Shared core + adapter hints | Normalize to common `ChatMessage` model; adapters annotate metadata for adapter-specific rendering. |
| Normalization boundary | At `ChatMessage` | Each adapter has its own event handler that maps raw events → `ChatMessage`. Everything downstream is adapter-agnostic. |
| Tool categorization | Adapter declares categories | Each adapter provides a `getToolCategories()` mapping. Core grouping uses categories, not hardcoded tool names. |

---

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐
│  ClaudeAdapter   │────▶│  ClaudeEventHandler   │──┐
│  (NDJSON events) │     │  (claude → ChatMessage)│  │
└─────────────────┘     └──────────────────────┘  │  ┌──────────────┐
                                                   ├─▶│ MessageCache  │
┌─────────────────┐     ┌──────────────────────┐  │  │ DaemonEvents │
│  CodexAdapter    │────▶│  CodexEventHandler    │──┘  └──────────────┘
│  (SDK events)    │     │  (codex → ChatMessage) │
└─────────────────┘     └──────────────────────┘
```

`EventHandler.setup()` loops over registered adapters and dispatches to the matching handler class. Each handler gets the same deps: db, messages, permissions, emitEvent, lookup.

---

## What doesn't change

- **`ChatMessage` / `MessageContent` types** — already generic enough for both adapters.
- **`ClaudeAdapter` event emissions** — zero changes to working Claude code.
- **`claude-events.ts`** — keeps parsing NDJSON into the same adapter events.
- **`message-grouping.ts`** — `groupMessages()` works on `ChatMessage`, which both adapters produce.
- **Desktop `convert-message.ts`** — still consumes `GroupedMessage`, still calls `groupToolCallParts` / `groupTaskChildren`.

---

## Changes

### 1. EventHandler becomes a registry

Extract Claude-specific listener wiring from `EventHandler.setup()` into `ClaudeEventHandler`. Create `CodexEventHandler` for Codex. `EventHandler.setup()` becomes a loop:

```ts
for (const adapter of this.adapters.all()) {
  const handler = this.resolveHandler(adapter);
  handler.setup(adapter);
}
```

Each handler class implements a shared interface:

```ts
interface AdapterEventHandler {
  setup(adapter: BaseAdapter): void;
}
```

### 2. AdapterEvents stays flexible per adapter

Each adapter keeps its own typed events. No shared event protocol.

```
ClaudeAdapter events (unchanged):
  init, message, tool_result, permission, result,
  plan_file, skill_file, error, exit

CodexAdapter events (new):
  thread_started, turn_started, turn_completed, turn_failed,
  item_started, item_updated, item_completed, error, exit
```

`BaseAdapter` only mandates `error` and `exit` (process lifecycle).

### 3. ChatMessage.metadata gets adapterId

Event handlers stamp `adapterId` on every message they write. Downstream code can use this for adapter-specific behavior.

### 4. Tool categorization moves to adapter

Remove hardcoded sets from `tool-categorization.ts`. Add to `BaseAdapter`:

```ts
getToolCategories(): ToolCategories {
  return { explore: new Set(), hidden: new Set(), progress: new Set(), subagent: new Set() };
}
```

`ClaudeAdapter` overrides with the current sets (`Read/Glob/Grep` as explore, `TaskList/Skill` as hidden, etc.). `CodexAdapter` provides its own.

`groupToolCallParts()` and `groupTaskChildren()` take `ToolCategories` as parameter. `convert-message.ts` resolves categories from `adapterId`.

### 5. Adapter interface gains optional plan/skill extraction

```ts
// packages/types/src/adapter.ts
export interface Adapter {
  // ...existing...
  extractPlanFiles?(sessionId: string, projectPath: string): Promise<string[]>;
  extractSkillFiles?(sessionId: string, projectPath: string): Promise<SkillFileEntry[]>;
}
```

`lifecycle-manager.ts` replaces `instanceof ClaudeAdapter` with:

```ts
if (adapter.extractPlanFiles) {
  const planPaths = await adapter.extractPlanFiles(sessionId, projectPath);
  // ...
}
```

### 6. Codex → ChatMessage mapping

| Codex item | ChatMessage type | MessageContent |
|---|---|---|
| `agent_message` | `assistant` | `{ type: 'text', text }` |
| `reasoning` | `assistant` | `{ type: 'thinking', thinking }` |
| `command_execution` | `assistant` | `{ type: 'tool_use', name: 'command_execution', input: { command, ... } }` |
| `file_change` | `assistant` | `{ type: 'tool_use', name: 'file_change', input: { changes } }` |
| `mcp_tool_call` | `assistant` | `{ type: 'tool_use', name: '<mcp_tool_name>', input }` |
| item completion | `tool_result` | `{ type: 'tool_result', toolUseId, content, isError }` |
| `turn.completed` | triggers `chat.updated` | cost/token update via db + DaemonEvent |

---

## New files

| File | Purpose |
|---|---|
| `packages/core/src/chat/claude-event-handler.ts` | Extracted from current `EventHandler` — Claude listener wiring |
| `packages/core/src/chat/codex-event-handler.ts` | Maps Codex SDK events → ChatMessage |
| `packages/core/src/adapters/codex.ts` | Codex adapter — wraps `@openai/codex-sdk` |
| `packages/core/src/adapters/codex-types.ts` | Codex event/item type definitions |

## Modified files

| File | Change |
|---|---|
| `packages/core/src/chat/event-handler.ts` | Becomes orchestrator, loops over adapters |
| `packages/core/src/messages/tool-categorization.ts` | Remove hardcoded sets, export `ToolCategories` type + parameterized lookup functions |
| `packages/core/src/messages/tool-grouping.ts` | `groupToolCallParts()` / `groupTaskChildren()` take `ToolCategories` param |
| `packages/core/src/adapters/base.ts` | Add `getToolCategories()` default |
| `packages/types/src/adapter.ts` | Add optional `extractPlanFiles` / `extractSkillFiles` |
| `packages/core/src/chat/lifecycle-manager.ts` | Replace `instanceof ClaudeAdapter` with optional method check |
| `packages/desktop/.../convert-message.ts` | Resolve `ToolCategories` from `adapterId`, pass to grouping |

---

## Not in scope (future work)

- Codex-specific UI components (e.g. rendering `todo_list` items, `file_change` diffs)
- Interactive approval for Codex (SDK doesn't support it)
- Codex history replay / `loadHistory`
- `message-parsing.ts` XML tag logic (stays in core, only used by Claude code paths — can move later)

---

## Risks

- **Codex event handler diverges from Claude's.** Mitigated by the shared `ChatMessage` target — both produce the same output shape. Divergence in handler internals is expected and acceptable.
- **Tool categories are incomplete for Codex on day one.** Fine — `getToolCategories()` returns empty sets by default, so grouping simply passes everything through ungrouped.
- **`message-parsing.ts` still has Claude XML parsing in core.** Low risk — it's only called from Claude-specific code paths. Can be moved to adapter module later if it bothers us.
