# Display Message Pipeline

**Date:** 2026-02-28
**Status:** Approved

## Problem

Message transformations are scattered across daemon and desktop:

1. **Tag stripping** (`stripMainframeCommandTags`) only ran on live events, not history — raw XML tags visible after restart.
2. **`groupMessages()`** (turn merging, tool-result attachment, dedup) runs on the desktop — business logic leaked into the UI layer.
3. **Tool categorization** (`CLAUDE_CATEGORIES`) is hardcoded in desktop's `convert-message.ts` — Claude adapter details leaked into adapter-agnostic UI.
4. **User message parsing** (command detection, file-path extraction) happens at render time in `UserMessage.tsx` — duplicated regex work on every render.
5. **`<mainframe-command>` filtering** placed inside Claude adapter's `history.ts` — mainframe commands are adapter-agnostic.

## Design Principle

**Messages served to clients are display-ready.** The desktop does nothing beyond mapping `DisplayMessage` to the UI framework's native message type (e.g., `ThreadMessageLike` for assistant-ui).

## Approach: Serve-Time Transformation

Raw `MessageCache` stays unchanged. A `prepareMessagesForClient()` pipeline transforms raw messages into `DisplayMessage[]` on demand when serving via REST or WS. This avoids a second cache and keeps the raw cache as the single source of truth.

## 1. New Types (`@mainframe/types`)

```typescript
// Display-ready content blocks — superset of raw MessageContent
export type DisplayContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'image'; mediaType: string; data: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown>;
      category: 'default' | 'explore' | 'hidden' | 'progress' | 'subagent';
      result?: ToolCallResult }
  | { type: 'tool_group'; calls: DisplayContent[] }  // collapsed explore tools
  | { type: 'task_group'; agentId: string; calls: DisplayContent[] }  // subagent tools
  | { type: 'permission_request'; request: unknown }
  | { type: 'error'; message: string };

export interface ToolCallResult {
  content: string;
  isError: boolean;
  structuredPatch?: DiffHunk[];
  originalFile?: string;
  modifiedFile?: string;
}

export interface DisplayMessage {
  id: string;
  chatId: string;
  type: 'user' | 'assistant' | 'system' | 'error' | 'permission';
  content: DisplayContent[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

Key differences from `ChatMessage`:
- `tool_use` and `tool_result` collapsed into `tool_call` with inline `result`.
- Tool categories applied server-side.
- `tool_group` and `task_group` virtual content types for collapsed/grouped tools.
- No `tool_use` or `tool_result` message types — those are merged into `assistant` turns.

## 2. Display Pipeline (`core/messages/display-pipeline.ts`)

Single function: `prepareMessagesForClient(messages: ChatMessage[], categories?: ToolCategories): DisplayMessage[]`

Steps (in order):
1. Filter internal user messages (`<mainframe-command>` wrappers, `<command-name>` skill markers).
2. Strip `<mainframe-command-response>` tags from assistant text blocks.
3. Group consecutive assistant/tool_use messages into turns.
4. Attach tool_result data to preceding tool_call blocks.
5. Deduplicate tool_call blocks by id.
6. Apply tool categories and create `tool_group`/`task_group` wrappers.
7. Attach `turnDurationMs` from system metadata markers.
8. Pre-process user messages: extract `metadata.command`, `metadata.attachedFiles`.

This consolidates logic currently in `groupMessages()`, `groupToolCallParts()`, `groupTaskChildren()`, `stripMainframeCommandTags()`, and desktop-side parsing.

## 3. Event Handler Updates

`onMessage()` and `onToolResult()` continue appending raw `ChatMessage` to `MessageCache`. No display transformation on the hot path.

New: after appending, prepare the incremental display delta and emit it:
- `display.message.added` — new display message ready for the client.
- `display.message.updated` — existing display message updated (e.g., tool_result attached to assistant turn).

The event handler calls `prepareMessagesForClient()` on the relevant slice to produce the delta.

## 4. WS & REST Events

New WS event types:
- `display.message.added` — carries a single `DisplayMessage`.
- `display.message.updated` — carries an updated `DisplayMessage` (same `id`, new content).
- `display.messages.set` — full replacement (used on history load).

Existing `message.added` stays for internal daemon use but is not forwarded to desktop clients.

REST `GET /chats/:id/messages` returns `DisplayMessage[]` instead of `ChatMessage[]`.

## 5. Tool Categories on Adapters

Move `CLAUDE_CATEGORIES` from desktop to Claude adapter registration:

```typescript
// In AgentAdapter or adapter registration
getToolCategories?(): ToolCategories;
```

`ClaudeAdapter` provides the concrete categories. The pipeline reads them from the adapter instance. If no categories provided, all tools default to `'default'`.

## 6. User Message Pre-Processing

Instead of parsing at render time, the pipeline extracts structured metadata:

```typescript
// In DisplayMessage.metadata for user messages:
{
  command?: { name: string; args?: string };
  attachedFiles?: string[];
}
```

`UserMessage.tsx` reads these fields instead of running regexes.

## 7. Desktop Simplification

After this change, the desktop:
- Removes `groupMessages()` call from `MainframeRuntimeProvider.tsx`.
- Removes `CLAUDE_CATEGORIES` and `getToolCategoriesForAdapter()` from `convert-message.ts`.
- Simplifies `convertMessage()` to a thin mapper from `DisplayMessage` → `ThreadMessageLike`.
- Removes regex parsing from `UserMessage.tsx` — reads `metadata.command` and `metadata.attachedFiles`.

## 8. `<mainframe-command>` Filtering Location

- **Claude adapter's `history.ts`**: reverts to `filterSkillExpansions()` — only filters `<command-name>` markers (Claude-specific skill injection pattern).
- **`display-pipeline.ts`**: filters `<mainframe-command>` wrappers (adapter-agnostic, mainframe concern).

## 9. Migration

- No database migration needed — raw messages unchanged.
- Desktop receives `DisplayMessage[]` from daemon; `ChatMessage` types no longer used client-side for rendering.
- `groupMessages()`, `tool-grouping.ts` functions remain in core (used by pipeline) but are no longer exported to desktop.
