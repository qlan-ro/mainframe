# Display Message Pipeline Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move all message transformations from the desktop to the daemon so clients receive display-ready messages.

**Architecture:** A `prepareMessagesForClient()` pipeline in `@mainframe/core/messages` transforms raw `ChatMessage[]` into `DisplayMessage[]`. The daemon runs this pipeline when serving messages via REST and when emitting WS events. The desktop becomes a thin mapper from `DisplayMessage` to the UI framework's `ThreadMessageLike`.

**Tech Stack:** TypeScript, Node.js, Vitest, React, assistant-ui, pnpm workspaces

---

### Task 1: Create feature branch

**Step 1: Create and switch to feature branch**

Run: `git checkout -b feat/display-message-pipeline`

**Step 2: Revert intermediate fixes from previous debugging session**

The working tree has uncommitted changes from the tag-stripping bug investigation. Revert them — the full pipeline supersedes these point fixes.

Run: `git checkout -- packages/core/src/__tests__/message-loading.test.ts packages/core/src/__tests__/messages/message-grouping.test.ts packages/core/src/chat/event-handler.ts packages/core/src/messages/message-grouping.ts packages/core/src/plugins/builtin/claude/history.ts`

**Step 3: Verify clean state**

Run: `git status`
Expected: clean working tree on `feat/display-message-pipeline`

---

### Task 2: Add DisplayMessage types to `@mainframe/types`

**Files:**
- Create: `packages/types/src/display.ts`
- Modify: `packages/types/src/index.ts`

**Step 1: Write the failing test**

Create: `packages/types/src/__tests__/display-types.test.ts`

```typescript
import { describe, it, expectTypeOf } from 'vitest';
import type { DisplayMessage, DisplayContent, ToolCallResult } from '../display.js';

describe('DisplayMessage types', () => {
  it('DisplayMessage has required fields', () => {
    expectTypeOf<DisplayMessage>().toHaveProperty('id');
    expectTypeOf<DisplayMessage>().toHaveProperty('chatId');
    expectTypeOf<DisplayMessage>().toHaveProperty('type');
    expectTypeOf<DisplayMessage>().toHaveProperty('content');
    expectTypeOf<DisplayMessage>().toHaveProperty('timestamp');
  });

  it('DisplayContent includes tool_call variant', () => {
    const tc: DisplayContent = {
      type: 'tool_call',
      id: 'tc1',
      name: 'Bash',
      input: {},
      category: 'default',
    };
    expectTypeOf(tc).toMatchTypeOf<DisplayContent>();
  });

  it('ToolCallResult has required fields', () => {
    expectTypeOf<ToolCallResult>().toHaveProperty('content');
    expectTypeOf<ToolCallResult>().toHaveProperty('isError');
  });

  it('DisplayMessage type union covers all message types', () => {
    const msg: DisplayMessage = {
      id: '1',
      chatId: 'c1',
      type: 'assistant',
      content: [],
      timestamp: new Date().toISOString(),
    };
    expectTypeOf(msg.type).toEqualTypeOf<'user' | 'assistant' | 'system' | 'error' | 'permission'>();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @mainframe/types test -- --run display-types`
Expected: FAIL — module `../display.js` not found

**Step 3: Create the types file**

Create: `packages/types/src/display.ts`

```typescript
import type { DiffHunk } from './chat.js';

export interface ToolCallResult {
  content: string;
  isError: boolean;
  structuredPatch?: DiffHunk[];
  originalFile?: string;
  modifiedFile?: string;
}

export type DisplayContent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; thinking: string }
  | { type: 'image'; mediaType: string; data: string }
  | {
      type: 'tool_call';
      id: string;
      name: string;
      input: Record<string, unknown>;
      category: 'default' | 'explore' | 'hidden' | 'progress' | 'subagent';
      result?: ToolCallResult;
    }
  | { type: 'tool_group'; calls: DisplayContent[] }
  | { type: 'task_group'; agentId: string; calls: DisplayContent[] }
  | { type: 'permission_request'; request: unknown }
  | { type: 'error'; message: string };

export interface DisplayMessage {
  id: string;
  chatId: string;
  type: 'user' | 'assistant' | 'system' | 'error' | 'permission';
  content: DisplayContent[];
  timestamp: string;
  metadata?: Record<string, unknown>;
}
```

**Step 4: Export from index**

Modify: `packages/types/src/index.ts` — add `export * from './display.js';`

**Step 5: Run test to verify it passes**

Run: `pnpm --filter @mainframe/types test -- --run display-types`
Expected: PASS

**Step 6: Typecheck**

Run: `pnpm --filter @mainframe/types build`
Expected: no errors

**Step 7: Commit**

```bash
git add packages/types/src/display.ts packages/types/src/index.ts packages/types/src/__tests__/display-types.test.ts
git commit -m "feat(types): add DisplayMessage, DisplayContent, ToolCallResult types"
```

---

### Task 3: Add `getToolCategories()` to `Adapter` interface

**Files:**
- Modify: `packages/types/src/adapter.ts:146` (Adapter interface)

**Step 1: Add optional method to Adapter interface**

In `packages/types/src/adapter.ts`, add to the `Adapter` interface (after line 155, the `killAll()` method):

```typescript
  getToolCategories?(): import('./tool-categorization.js').ToolCategories;
```

Wait — `ToolCategories` is defined in `@mainframe/core`, not `@mainframe/types`. We need to either:
- Move `ToolCategories` to types, OR
- Define a simpler version in types

Since `ToolCategories` uses `Set<string>` and is a simple interface, move it to types.

**Step 1a: Move ToolCategories to types**

Create or add to `packages/types/src/display.ts`:

```typescript
export interface ToolCategories {
  explore: Set<string>;
  hidden: Set<string>;
  progress: Set<string>;
  subagent: Set<string>;
}
```

**Step 1b: Update core to re-export from types**

Modify: `packages/core/src/messages/tool-categorization.ts` — change to import and re-export from types:

```typescript
export type { ToolCategories } from '@mainframe/types';
// keep predicate functions as-is
```

**Step 1c: Add to Adapter interface**

In `packages/types/src/adapter.ts`, add to the `Adapter` interface after `killAll()`:

```typescript
  getToolCategories?(): import('./display.js').ToolCategories;
```

**Step 2: Typecheck**

Run: `pnpm --filter @mainframe/types build && pnpm --filter @mainframe/core build`
Expected: no errors (ClaudeAdapter already has `getToolCategories()` — it now satisfies the interface)

**Step 3: Commit**

```bash
git add packages/types/src/display.ts packages/types/src/adapter.ts packages/core/src/messages/tool-categorization.ts
git commit -m "feat(types): add ToolCategories to Adapter interface"
```

---

### Task 4: Add display event types to DaemonEvent

**Files:**
- Modify: `packages/types/src/events.ts:7-29` (DaemonEvent union)

**Step 1: Add new event variants**

Add to the `DaemonEvent` union in `packages/types/src/events.ts`:

```typescript
  | { type: 'display.message.added'; chatId: string; message: import('./display.js').DisplayMessage }
  | { type: 'display.message.updated'; chatId: string; message: import('./display.js').DisplayMessage }
  | { type: 'display.messages.set'; chatId: string; messages: import('./display.js').DisplayMessage[] }
```

**Step 2: Typecheck**

Run: `pnpm --filter @mainframe/types build`
Expected: no errors

**Step 3: Commit**

```bash
git add packages/types/src/events.ts
git commit -m "feat(types): add display.message.added/updated/set event types"
```

---

### Task 5: Create the display pipeline — core transform function

This is the heart of the refactor. Creates `prepareMessagesForClient()` which transforms raw `ChatMessage[]` → `DisplayMessage[]`.

**Files:**
- Create: `packages/core/src/messages/display-pipeline.ts`
- Create: `packages/core/src/__tests__/messages/display-pipeline.test.ts`
- Modify: `packages/core/src/messages/index.ts` (export)

**Step 1: Write failing tests**

Create: `packages/core/src/__tests__/messages/display-pipeline.test.ts`

Write comprehensive tests covering:

1. **Empty input** → empty output
2. **Single user message** → DisplayMessage with type 'user'
3. **Single assistant text** → DisplayMessage with type 'assistant', content has text DisplayContent
4. **Assistant with tool_use + tool_result** → single assistant DisplayMessage with tool_call having inline result
5. **Consecutive assistant messages** → merged into one turn
6. **Tag stripping** → `<mainframe-command-response>` tags stripped from assistant text
7. **Internal message filtering** → `<mainframe-command>` wrapper messages filtered out
8. **Tool deduplication** → duplicate tool_use IDs collapsed
9. **System compact_boundary** → passed through as system DisplayMessage
10. **Error messages** → passed through as error DisplayMessage
11. **Tool categories applied** → tool_call blocks get correct `category` field
12. **turnDurationMs attachment** → system metadata marker attached to preceding assistant
13. **User message pre-processing** → `parseCommandMessage` results in metadata
14. **User message file tags** → `parseAttachedFilePathTags` results in metadata

Test helper structure:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { prepareMessagesForClient } from '../../messages/display-pipeline.js';
import type { ChatMessage, MessageContent, ToolCategories } from '@mainframe/types';

let idCounter = 0;
function resetIds() { idCounter = 0; }

function rawMsg(
  type: ChatMessage['type'],
  content: MessageContent[],
  overrides?: Partial<ChatMessage>,
): ChatMessage {
  idCounter++;
  return {
    id: `msg-${idCounter}`,
    chatId: 'chat-1',
    type,
    content,
    timestamp: new Date(2026, 0, 1, 0, 0, idCounter).toISOString(),
    ...overrides,
  };
}

const CATEGORIES: ToolCategories = {
  explore: new Set(['Read', 'Glob', 'Grep']),
  hidden: new Set(['TodoWrite', 'Skill']),
  progress: new Set(['TaskCreate', 'TaskUpdate']),
  subagent: new Set(['Task']),
};
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mainframe/core test -- --run display-pipeline`
Expected: FAIL — module not found

**Step 3: Implement `prepareMessagesForClient()`**

Create: `packages/core/src/messages/display-pipeline.ts`

The function does the following steps in order:

1. **Filter internal user messages**: remove messages containing `<mainframe-command>` wrappers or `<command-name>` skill markers. Re-use the regex patterns from `message-parsing.ts`.
2. **Group turns**: merge consecutive assistant/tool_use messages into one turn (same logic as `groupMessages`).
3. **Attach tool_results**: find tool_result messages and attach to preceding assistant turn.
4. **Handle system turnDurationMs markers**: attach to preceding assistant turn, don't include in output.
5. **Convert to DisplayMessage**: for each grouped raw message, create a DisplayMessage:
   - Strip `<mainframe-command-response>` tags from assistant text blocks
   - Convert `tool_use` + matched `tool_result` into `tool_call` with inline `result`
   - Deduplicate tool_call by id
   - Apply tool categories to each tool_call
   - Pre-process user messages: extract command/skill info and file attachment tags into metadata
6. **Apply tool grouping**: run `groupToolCallParts` and `groupTaskChildren` on assistant DisplayMessages to create `tool_group` and `task_group` virtual entries.

Signature:

```typescript
export function prepareMessagesForClient(
  messages: ChatMessage[],
  categories?: ToolCategories,
): DisplayMessage[];
```

If `categories` is not provided, all tools get `category: 'default'` and no grouping/hiding is applied.

**Step 4: Run tests**

Run: `pnpm --filter @mainframe/core test -- --run display-pipeline`
Expected: PASS

**Step 5: Export from index**

Add to `packages/core/src/messages/index.ts`:

```typescript
export { prepareMessagesForClient } from './display-pipeline.js';
```

**Step 6: Typecheck**

Run: `pnpm --filter @mainframe/core build`

**Step 7: Commit**

```bash
git add packages/core/src/messages/display-pipeline.ts packages/core/src/__tests__/messages/display-pipeline.test.ts packages/core/src/messages/index.ts
git commit -m "feat(core): add prepareMessagesForClient display pipeline"
```

---

### Task 6: Add `getDisplayMessages()` to ChatManager and update REST endpoint

**Files:**
- Modify: `packages/core/src/chat/chat-manager.ts:276-313` (add new method after `getMessages`)
- Modify: `packages/core/src/server/routes/chats.ts:39-45` (use display messages)

**Step 1: Write failing test**

Add a test to an existing or new test file that calls `getDisplayMessages()` and verifies it returns `DisplayMessage[]`.

**Step 2: Add `getDisplayMessages()` to ChatManager**

```typescript
async getDisplayMessages(chatId: string): Promise<DisplayMessage[]> {
  const raw = await this.getMessages(chatId);
  const chat = this.getChat(chatId);
  const adapter = chat ? this.adapters.get(chat.adapterId) : undefined;
  const categories = adapter?.getToolCategories?.();
  return prepareMessagesForClient(raw, categories);
}
```

**Step 3: Update REST endpoint**

In `packages/core/src/server/routes/chats.ts`, change line 42:

```typescript
// Before:
const messages = await ctx.chats.getMessages(param(req, 'id'));
// After:
const messages = await ctx.chats.getDisplayMessages(param(req, 'id'));
```

**Step 4: Run tests and typecheck**

Run: `pnpm --filter @mainframe/core test -- --run` (relevant tests)
Run: `pnpm --filter @mainframe/core build`

**Step 5: Commit**

```bash
git add packages/core/src/chat/chat-manager.ts packages/core/src/server/routes/chats.ts
git commit -m "feat(core): serve DisplayMessage[] from REST endpoint"
```

---

### Task 7: Update event handler to emit display events

This is the critical WS path — when raw messages are appended, emit display events for clients.

**Files:**
- Modify: `packages/core/src/chat/event-handler.ts`

**Step 1: Design the incremental approach**

After each raw message append, re-run `prepareMessagesForClient()` on the full raw cache for that chat. Compare the count and last message against the previous display state to determine whether to emit `display.message.added` or `display.message.updated`.

Store the last display state in a simple `Map<string, DisplayMessage[]>` on the EventHandler class.

**Step 2: Add display state tracking to EventHandler**

Add a `displayCache: Map<string, DisplayMessage[]>` field to EventHandler. Add a private method `emitDisplayDelta(chatId)` that:

1. Gets raw messages from `this.messages.get(chatId)`
2. Gets tool categories from the active chat's adapter
3. Runs `prepareMessagesForClient(raw, categories)`
4. Compares with `this.displayCache.get(chatId)`
5. Emits appropriate display events
6. Updates `this.displayCache`

**Step 3: Call `emitDisplayDelta()` after each raw message append**

In `onMessage()`, `onToolResult()`, `onCompact()`, and `onSkillFile()` — after appending to cache and emitting the raw `message.added` event, call `emitDisplayDelta(chatId)`.

**Step 4: Also emit display events on history load**

When `doLoadChat()` populates the message cache, emit `display.messages.set` with the full display messages. This happens in `lifecycle-manager.ts` but can be triggered via the event handler.

**Step 5: Tests**

Write tests verifying:
- `onMessage()` emits `display.message.added` for the first assistant message
- `onToolResult()` emits `display.message.updated` (tool result merges into existing turn)
- Consecutive `onMessage()` calls emit `display.message.updated` (turn merging)

**Step 6: Commit**

```bash
git add packages/core/src/chat/event-handler.ts
git commit -m "feat(core): emit display.message events from event handler"
```

---

### Task 8: Update desktop store for DisplayMessage

**Files:**
- Modify: `packages/desktop/src/renderer/store/chats.ts`
- Modify: `packages/desktop/src/renderer/lib/ws-event-router.ts`

**Step 1: Change message store type**

In `packages/desktop/src/renderer/store/chats.ts`:
- Change `messages: Map<string, ChatMessage[]>` to `messages: Map<string, DisplayMessage[]>`
- Update `addMessage` and `setMessages` signatures
- Import `DisplayMessage` from `@mainframe/types`
- Remove `ChatMessage` import if no longer needed

**Step 2: Update WS event router**

In `packages/desktop/src/renderer/lib/ws-event-router.ts`:
- Handle `display.message.added` → `chats.addMessage(chatId, message)`
- Handle `display.message.updated` → replace last message with matching id
- Handle `display.messages.set` → `chats.setMessages(chatId, messages)`
- Keep `message.added` handler for now (backward compat during migration) but mark deprecated

Add an `updateMessage` action to the store:

```typescript
updateMessage: (chatId, message) =>
  set((state) => {
    const newMessages = new Map(state.messages);
    const existing = newMessages.get(chatId) || [];
    const idx = existing.findIndex((m) => m.id === message.id);
    if (idx >= 0) {
      const updated = [...existing];
      updated[idx] = message;
      newMessages.set(chatId, updated);
    } else {
      newMessages.set(chatId, [...existing, message]);
    }
    return { messages: newMessages };
  }),
```

**Step 3: Typecheck**

Run: `pnpm --filter @mainframe/desktop build`

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/store/chats.ts packages/desktop/src/renderer/lib/ws-event-router.ts
git commit -m "feat(desktop): handle display.message events in store"
```

---

### Task 9: Update useChatSession and API client for DisplayMessage

**Files:**
- Modify: `packages/desktop/src/renderer/hooks/useChatSession.ts`
- Modify: `packages/desktop/src/renderer/lib/api.ts` (getChatMessages return type)

**Step 1: Update API client return type**

In `packages/desktop/src/renderer/lib/api.ts`, change `getChatMessages()` return type from `ChatMessage[]` to `DisplayMessage[]`.

**Step 2: Update useChatSession**

The hook should work with `DisplayMessage[]` now. The types flow from the store. Verify the hook compiles.

**Step 3: Typecheck**

Run: `pnpm --filter @mainframe/desktop build`

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/hooks/useChatSession.ts packages/desktop/src/renderer/lib/api.ts
git commit -m "feat(desktop): update useChatSession for DisplayMessage"
```

---

### Task 10: Simplify convert-message.ts

This is where the desktop sheds most of its message transformation logic.

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.ts`

**Step 1: Remove CLAUDE_CATEGORIES and tool grouping imports**

Remove:
- `CLAUDE_CATEGORIES` constant (lines 14-28)
- `getToolCategoriesForAdapter` function (lines 31-34)
- Imports of `groupMessages`, `GroupedMessage`, `ToolGroupItem`, `TaskProgressItem`, `PartEntry`, `ToolCategories`, `groupToolCallParts`, `groupTaskChildren` from `@mainframe/core/messages`
- Re-exports on line 40

**Step 2: Rewrite convertMessage for DisplayMessage**

The function now maps `DisplayMessage` → `ThreadMessageLike`. It's much simpler:

```typescript
import type { ThreadMessageLike } from '@assistant-ui/react';
import type { DisplayMessage, DisplayContent } from '@mainframe/types';

export const ERROR_PLACEHOLDER = Object.freeze({ type: 'text' as const, text: '\0__MF_ERROR__' });
export const PERMISSION_PLACEHOLDER = Object.freeze({ type: 'text' as const, text: '\0__MF_PERMISSION__' });

type ContentPart = Exclude<ThreadMessageLike['content'], string>[number];

export function convertMessage(message: DisplayMessage): ThreadMessageLike {
  switch (message.type) {
    case 'user': {
      const parts = message.content
        .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text')
        .map((c) => ({ type: 'text' as const, text: c.text }));
      return {
        role: 'user',
        content: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
    }

    case 'system':
      return {
        role: 'system',
        content: message.content
          .filter((c): c is DisplayContent & { type: 'text' } => c.type === 'text')
          .map((c) => ({ type: 'text', text: c.text })),
        id: message.id,
        createdAt: new Date(message.timestamp),
      };

    case 'assistant': {
      const parts: ContentPart[] = [];
      for (const block of message.content) {
        switch (block.type) {
          case 'text':
            parts.push({ type: 'text', text: block.text });
            break;
          case 'thinking':
            parts.push({ type: 'reasoning' as const, text: block.thinking });
            break;
          case 'tool_call':
            parts.push({
              type: 'tool-call',
              toolCallId: block.id,
              toolName: block.name,
              args: block.input,
              result: block.result
                ? block.result.structuredPatch
                  ? {
                      content: block.result.content,
                      structuredPatch: block.result.structuredPatch,
                      originalFile: block.result.originalFile,
                      modifiedFile: block.result.modifiedFile,
                    }
                  : block.result.content
                : undefined,
              isError: block.result?.isError,
            });
            break;
          case 'tool_group':
            // Virtual group — map to _ToolGroup tool-call
            parts.push({
              type: 'tool-call',
              toolCallId: (block.calls[0] as any)?.id ?? '',
              toolName: '_ToolGroup',
              args: { items: block.calls },
              result: 'grouped',
            });
            break;
          case 'task_group':
            parts.push({
              type: 'tool-call',
              toolCallId: block.agentId,
              toolName: '_TaskGroup',
              args: { taskArgs: (block.calls[0] as any)?.input ?? {}, children: block.calls },
              result: (block.calls[0] as any)?.result,
            });
            break;
          case 'error':
            parts.push(ERROR_PLACEHOLDER);
            break;
          case 'permission_request':
            parts.push(PERMISSION_PLACEHOLDER);
            break;
        }
      }
      return {
        role: 'assistant',
        content: parts.length > 0 ? parts : [{ type: 'text', text: '' }],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
    }

    case 'error':
      return {
        role: 'assistant',
        content: [ERROR_PLACEHOLDER],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };

    case 'permission':
      return {
        role: 'assistant',
        content: [PERMISSION_PLACEHOLDER],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };

    default:
      return {
        role: 'assistant',
        content: [{ type: 'text', text: '' }],
        id: message.id,
        createdAt: new Date(message.timestamp),
      };
  }
}
```

**Step 3: Typecheck**

Run: `pnpm --filter @mainframe/desktop build`

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/convert-message.ts
git commit -m "refactor(desktop): simplify convertMessage for DisplayMessage input"
```

---

### Task 11: Update MainframeRuntimeProvider — remove groupMessages

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx`

**Step 1: Remove groupMessages import and usage**

- Line 11: Remove `groupMessages` from imports
- Line 83: Remove `const groupedMessages = useMemo(() => groupMessages(rawMessages), [rawMessages]);`
- Use `rawMessages` directly (they are now `DisplayMessage[]`)
- Update the `useExternalStoreRuntime` call to use `rawMessages` instead of `groupedMessages`

**Step 2: Update getExternalStoreMessages usage**

Components that call `getExternalStoreMessages<ChatMessage>` should use `getExternalStoreMessages<DisplayMessage>` instead.

**Step 3: Typecheck**

Run: `pnpm --filter @mainframe/desktop build`

**Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx
git commit -m "refactor(desktop): remove groupMessages from MainframeRuntimeProvider"
```

---

### Task 12: Simplify UserMessage — read structured metadata

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/messages/UserMessage.tsx`

**Step 1: Remove parsing imports**

Remove imports of `parseCommandMessage`, `parseRawCommand`, `parseAttachedFilePathTags`, `resolveSkillName` from `../message-parsing`.

**Step 2: Read structured metadata instead**

The display pipeline now puts command/skill info and file attachments into `metadata`:

```typescript
// Before (parsing at render time):
const { files: parsedFileTags, cleanText } = parseAttachedFilePathTags(rawUserText);
let parsed = cleanText ? parseCommandMessage(cleanText) : null;

// After (reading pre-computed metadata):
const original = ...; // from getExternalStoreMessages<DisplayMessage>
const command = original?.metadata?.command as { name: string; args?: string; isCommand?: boolean } | undefined;
const attachedFiles = original?.metadata?.attachedFiles as { name: string }[] | undefined;
const cleanText = original?.metadata?.cleanText as string | undefined ?? firstText?.text ?? '';
```

**Step 3: Update rendering logic**

Replace `parsed` references with `command`, replace `parsedFileTags` with `attachedFiles`.

**Step 4: Typecheck**

Run: `pnpm --filter @mainframe/desktop build`

**Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/messages/UserMessage.tsx
git commit -m "refactor(desktop): read structured metadata instead of parsing in UserMessage"
```

---

### Task 13: Revert `filterInternalMessages` in history.ts

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/history.ts:202-214`

**Step 1: Revert to filterSkillExpansions**

The `<mainframe-command>` filtering now happens in `display-pipeline.ts`. The Claude adapter should only filter `<command-name>` skill markers (Claude-specific concern).

```typescript
// Rename back and remove <mainframe-command> pattern
const SKILL_EXPANSION_RE = /<command-name>/;

export function filterSkillExpansions(messages: ChatMessage[]): ChatMessage[] {
  return messages.filter((msg) => {
    if (msg.type !== 'user') return true;
    return !msg.content.some(
      (b) => b.type === 'text' && SKILL_EXPANSION_RE.test((b as { text: string }).text),
    );
  });
}
```

Update the call site at line 271: `filterSkillExpansions(messages)`.

**Step 2: Update tests**

Modify `packages/core/src/__tests__/message-loading.test.ts`:
- Remove the test for `<mainframe-command>` filtering (it's now in display-pipeline tests)
- Keep tests for `<command-name>` filtering
- Update function name references from `filterInternalMessages` to `filterSkillExpansions`

**Step 3: Run tests**

Run: `pnpm --filter @mainframe/core test -- --run message-loading`

**Step 4: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/history.ts packages/core/src/__tests__/message-loading.test.ts
git commit -m "fix(claude): revert to filterSkillExpansions, move mainframe-command filtering to pipeline"
```

---

### Task 14: Clean up dead code and unused exports

**Files:**
- Modify: `packages/core/src/messages/index.ts` — review exports
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/message-parsing.tsx` — remove unused re-exports
- Check for unused imports across desktop

**Step 1: Audit exports**

- `groupMessages` — still needed internally by the pipeline but should NOT be re-exported for desktop use
- `GroupedMessage` — no longer needed by desktop
- Tool grouping functions — used internally by pipeline, not by desktop
- `CLAUDE_CATEGORIES` — deleted from desktop, no replacement needed (lives on adapter)

**Step 2: Clean up desktop message-parsing.tsx**

Remove re-exports that are no longer used by desktop components:
- `parseCommandMessage`, `parseRawCommand`, `parseAttachedFilePathTags` — only if no other desktop component uses them
- `COMMAND_NAME_RE`, `ATTACHED_FILE_PATH_RE` — check usage

Keep: `PLAN_PREFIX`, `highlightMentions`, `renderHighlights`, `formatTurnDuration` — still used by desktop

**Step 3: Typecheck both packages**

Run: `pnpm --filter @mainframe/core build && pnpm --filter @mainframe/desktop build`

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: clean up unused exports after display pipeline migration"
```

---

### Task 15: Run full test suite and typecheck

**Step 1: Build all packages**

Run: `pnpm build`

**Step 2: Run all tests**

Run: `pnpm test`
Expected: All tests pass (except known flaky title-generation tests)

**Step 3: Fix any issues**

If tests fail, diagnose and fix. Pay attention to:
- Import path changes
- Type mismatches between `ChatMessage` and `DisplayMessage`
- Missing exports

**Step 4: Final commit**

```bash
git add -A
git commit -m "test: verify full suite passes after display pipeline migration"
```

---

## Notes for Implementer

### Key Design Decisions

1. **No display cache**: The pipeline runs on-demand. For WS events, the event handler maintains a lightweight display state (`Map<string, DisplayMessage[]>`) to compute deltas — this is NOT a full cache, just the last pipeline output for diffing.

2. **Raw `message.added` events stay**: The daemon continues emitting `message.added` with raw `ChatMessage` for internal consumers. New `display.*` events are added alongside. Desktop switches to consuming only display events.

3. **Tool grouping in pipeline**: `groupToolCallParts()` and `groupTaskChildren()` run inside `prepareMessagesForClient()`, producing `tool_group` and `task_group` DisplayContent blocks. The desktop no longer calls these.

4. **User message metadata**: The pipeline extracts command/skill info and file attachments into `metadata.command`, `metadata.attachedFiles`, and `metadata.cleanText` so UserMessage.tsx doesn't parse at render time.

### Files NOT Modified

- `packages/core/src/chat/message-cache.ts` — unchanged, stores raw messages
- `packages/core/src/messages/message-grouping.ts` — unchanged, used internally by pipeline (or inlined)
- `packages/core/src/messages/tool-grouping.ts` — unchanged, used internally by pipeline
- `packages/core/src/messages/message-parsing.ts` — unchanged, functions used by pipeline

### Testing Strategy

- **Unit tests** for `prepareMessagesForClient()` covering all transform steps
- **Existing tests** for `groupMessages()`, `groupToolCallParts()`, `groupTaskChildren()` remain unchanged
- **Integration tests** for event handler display event emission
- **Type-level tests** for DisplayMessage type shape
