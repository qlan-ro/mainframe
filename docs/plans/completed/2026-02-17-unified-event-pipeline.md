# Unified Claude Event Pipeline: Shared Content Extraction

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract shared content block builders so live-stream event handling and JSONL history loading use identical logic, preventing future drift.

**Architecture:** The live stream (`claude-events.ts` → `EventHandler`) and history loading (`claude-history.ts`) both parse the same Claude JSONL format but through independent code paths that have already drifted (e.g. `<task-notification>` leaking into history, text blocks in user entries rendering differently). The fix: move tool_result block construction into a shared helper exported from `claude-history.ts`, update both call sites to use it, and add a cross-path equivalence test that catches future drift automatically. This is a targeted patch — it does NOT restructure event emitters or introduce a new IR.

**Tech Stack:** TypeScript (strict, NodeNext), Vitest, pnpm workspaces.

---

## V2 Prioritization Guide

Before executing this plan, understand where it fits:

| Order | Plan | Why |
|-------|------|-----|
| **1st — this plan** | `2026-02-17-unified-event-pipeline.md` | Small, fixes root cause of drift, unblocks safe iteration on user-event handling |
| **2nd** | `2026-02-17-adapter-event-handlers-plan.md` | Extracts `ClaudeEventHandler`, parameterizes tool categories, removes `instanceof ClaudeAdapter` — prerequisite for any second adapter |
| **3rd** | `2026-02-17-adapter-session-refactor.md` | Massive structural refactor (22 files). Deferred until `AdapterSession` abstraction is genuinely needed (i.e. second adapter is being wired up) |
| **Deferred** | `codex-2026-02-17-provider-agnostic-message-pipeline-plan.md` | Introduces canonical `NormalizedMessageBlock` IR. YAGNI until Codex adapter exists. Overlaps with event-handlers plan on tool categorization — resolve that overlap when starting Codex work |

**Why this plan is first:** Tasks 5–7 of `adapter-event-handlers-plan.md` modify `event-handler.ts` and `claude-event-handler.ts`. This plan modifies `claude-events.ts` and `claude-history.ts` — no file conflicts, so both can be merged independently. But doing this plan first means any drift-prevention improvements land before the bigger refactors make the history/live boundary harder to find.

---

## Root Cause Summary

`handleUserEvent` (live stream) and `convertUserEntry` (history) parse the same JSONL `user` events but with separate logic:

| Concern | `handleUserEvent` | `convertUserEntry` |
|---------|------------------|-------------------|
| `tool_result` blocks | ✅ extracted | ✅ extracted (duplicate logic) |
| String `rawContent` | ❌ silently ignored | ✅ converted to text (with `<task-notification>` guard) |
| Text blocks in array content | ❌ ignored | ✅ extracted (with `[Request interrupted` guard) |
| Image blocks | ❌ ignored | ✅ extracted |

The divergence for text/image is **intentional**: live stream doesn't re-emit user-typed text because `chat-manager.sendMessage` already created that ChatMessage. History must reconstruct it from JSONL. Document this clearly.

The divergence for `tool_result` block construction is **unintentional** duplication. Both paths have copy-pasted the same structuredPatch/originalFile/modifiedFile spread. Any future change to tool_result handling requires two edits.

---

### Task 1: Extract `buildToolResultBlocks` shared helper

**Files:**
- Modify: `packages/core/src/adapters/claude-history.ts`
- Test: `packages/core/src/__tests__/message-loading.test.ts`

**Step 1: Write failing test for the shared helper**

Add to `packages/core/src/__tests__/message-loading.test.ts`:

```ts
import { buildToolResultBlocks } from '../adapters/claude-history.js';

describe('buildToolResultBlocks', () => {
  it('extracts tool_result blocks from array message content', () => {
    const message = {
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tu_123',
          content: 'file written successfully',
          is_error: false,
        },
      ],
    };
    const blocks = buildToolResultBlocks(message, undefined);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: 'tu_123',
      content: 'file written successfully',
      isError: false,
    });
  });

  it('attaches structuredPatch and file contents from toolUseResult', () => {
    const message = {
      content: [{ type: 'tool_result', tool_use_id: 'tu_456', content: 'ok' }],
    };
    const tur = {
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 2, lines: ['+line'] }],
      originalFile: 'old content',
      content: 'new content',
      type: 'update',
    };
    const blocks = buildToolResultBlocks(message, tur as Record<string, unknown>);
    expect(blocks[0]).toHaveProperty('structuredPatch');
    expect(blocks[0]).toHaveProperty('originalFile', 'old content');
    expect(blocks[0]).toHaveProperty('modifiedFile', 'new content');
  });

  it('returns empty array when message has no tool_result blocks', () => {
    const message = { content: [{ type: 'text', text: 'hello' }] };
    expect(buildToolResultBlocks(message, undefined)).toHaveLength(0);
  });

  it('returns empty array for non-array content', () => {
    const message = { content: 'plain string content' };
    expect(buildToolResultBlocks(message as Record<string, unknown>, undefined)).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify failure**

Run: `pnpm --filter @mainframe/core test -- message-loading`
Expected: FAIL — `buildToolResultBlocks` is not exported.

**Step 3: Extract `buildToolResultBlocks` from `convertUserEntry`**

In `packages/core/src/adapters/claude-history.ts`, add this exported function BEFORE `convertUserEntry`:

```ts
export function buildToolResultBlocks(
  message: Record<string, unknown>,
  tur: Record<string, unknown> | undefined,
): MessageContent[] {
  const rawContent = message.content;
  if (!Array.isArray(rawContent)) return [];

  const sp = tur?.structuredPatch as DiffHunk[] | undefined;
  const originalFile = tur?.originalFile as string | undefined;
  const modifiedFile = deriveModifiedFile(tur, originalFile);

  const blocks: MessageContent[] = [];
  for (const block of rawContent) {
    if (block.type !== 'tool_result') continue;
    blocks.push({
      type: 'tool_result',
      toolUseId: (block.tool_use_id as string) || '',
      content: typeof block.content === 'string' ? block.content : JSON.stringify(block.content ?? ''),
      isError: !!block.is_error,
      ...(sp?.length ? { structuredPatch: sp } : {}),
      ...(originalFile != null ? { originalFile } : {}),
      ...(modifiedFile != null ? { modifiedFile } : {}),
    });
  }
  return blocks;
}
```

**Step 4: Update `convertUserEntry` to call the shared helper**

Replace the inline tool_result extraction in `convertUserEntry` with:

```ts
// In convertUserEntry, replace the Array.isArray branch:
} else if (Array.isArray(rawContent)) {
  // Tool results — use shared builder (same logic as live stream)
  const toolResults = buildToolResultBlocks(message, toolUseResult);
  contentBlocks.push(...toolResults);

  // Text and image blocks are intentionally only in history:
  // live stream doesn't re-emit them because sendMessage() already created
  // the user ChatMessage and tool results come via a separate tool_result entry.
  for (const block of rawContent) {
    if (block.type === 'text') {
      const text = block.text || '';
      if (!text.startsWith('[Request interrupted')) {
        contentBlocks.push({ type: 'text', text });
      }
    } else if (block.type === 'image') {
      const source = block.source as Record<string, unknown> | undefined;
      if (source?.type === 'base64') {
        contentBlocks.push({ type: 'image', mediaType: source.media_type as string, data: source.data as string });
      }
    }
  }
}
```

**Step 5: Run tests**

Run: `pnpm --filter @mainframe/core test -- message-loading`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/core/src/adapters/claude-history.ts packages/core/src/__tests__/message-loading.test.ts
git commit -m "refactor: extract buildToolResultBlocks shared helper from convertUserEntry"
```

---

### Task 2: Update `handleUserEvent` to use the shared helper

**Files:**
- Modify: `packages/core/src/adapters/claude-events.ts`
- Test: `packages/core/src/__tests__/claude-events.test.ts` (or create it)

**Step 1: Write failing test for `handleUserEvent` using the shared helper**

Add (or expand) `packages/core/src/__tests__/claude-events.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { handleStdout } from '../adapters/claude-events.js';
import type { ClaudeEventEmitter } from '../adapters/claude-types.js';

describe('handleUserEvent — tool_result blocks', () => {
  function makeProcesses(processId: string) {
    return new Map([[processId, { buffer: '', chatId: null, status: 'ready', lastAssistantUsage: undefined }]]);
  }

  it('emits tool_result with structuredPatch from toolUseResult', () => {
    const emitter = { emit: vi.fn() } as unknown as ClaudeEventEmitter;
    const processes = makeProcesses('p1');
    const event = {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' },
        ],
      },
      toolUseResult: {
        structuredPatch: [{ oldStart: 1, oldLines: 0, newStart: 1, newLines: 1, lines: ['+new line'] }],
        originalFile: 'original',
        type: 'update',
        content: 'new content',
      },
    };
    const chunk = Buffer.from(JSON.stringify(event) + '\n');
    handleStdout('p1', chunk, processes, emitter);

    const toolResultCall = (emitter.emit as ReturnType<typeof vi.fn>).mock.calls.find(
      ([event]) => event === 'tool_result',
    );
    expect(toolResultCall).toBeDefined();
    const [, , blocks] = toolResultCall!;
    expect(blocks[0]).toHaveProperty('structuredPatch');
    expect(blocks[0]).toHaveProperty('originalFile', 'original');
    expect(blocks[0]).toHaveProperty('modifiedFile', 'new content');
  });
});
```

**Step 2: Run test to verify it passes (it should already pass)**

Run: `pnpm --filter @mainframe/core test -- claude-events`
Expected: If the test was already correct, PASS. If FAIL, it reveals an actual mismatch.

**Step 3: Update `handleUserEvent` to use `buildToolResultBlocks`**

In `packages/core/src/adapters/claude-events.ts`, replace the inline tool_result construction in `handleUserEvent`:

```ts
import { buildToolResultBlocks } from './claude-history.js';

function handleUserEvent(processId: string, event: Record<string, unknown>, emitter: ClaudeEventEmitter): void {
  const message = event.message as { content: Array<Record<string, unknown>> } | undefined;
  if (!message?.content) return;

  const tur = event.toolUseResult as Record<string, unknown> | undefined;

  // Use shared builder — same logic as convertUserEntry in claude-history.ts
  const toolResultContent = buildToolResultBlocks(message as Record<string, unknown>, tur);

  if (toolResultContent.length > 0) {
    emitter.emit('tool_result', processId, toolResultContent);
  }

  // Side-effects: plan and skill file detection (history side reads these from JSONL directly)
  for (const block of message.content) {
    if (block.type === 'tool_result') {
      const text = typeof block.content === 'string' ? block.content : '';
      const planMatch = text.match(/Your plan has been saved to: (\/\S+\.md)/);
      if (planMatch?.[1]) {
        emitter.emit('plan_file', processId, planMatch[1].trim());
      }
    } else if (block.type === 'text') {
      const text = (block.text as string) || '';
      const skillMatch = text.match(/^Base directory for this skill: (.+)/m);
      if (skillMatch?.[1]) {
        emitter.emit('skill_file', processId, path.join(skillMatch[1].trim(), 'SKILL.md'));
      }
    }
  }
  const rawContent = (event.message as Record<string, unknown>)?.content;
  if (typeof rawContent === 'string') {
    const skillMatch = rawContent.match(/^Base directory for this skill: (.+)/m);
    if (skillMatch?.[1]) {
      emitter.emit('skill_file', processId, path.join(skillMatch[1].trim(), 'SKILL.md'));
    }
  }
}
```

**Step 4: Run tests**

Run: `pnpm --filter @mainframe/core test -- claude-events`
Expected: PASS.

**Step 5: Typecheck**

Run: `pnpm --filter @mainframe/core build`
Expected: PASS — no circular imports (claude-events imports from claude-history, not the other way around).

**Step 6: Commit**

```bash
git add packages/core/src/adapters/claude-events.ts packages/core/src/__tests__/claude-events.test.ts
git commit -m "refactor: handleUserEvent uses buildToolResultBlocks shared helper"
```

---

### Task 3: Add cross-path equivalence test

**Files:**
- Test: `packages/core/src/__tests__/event-pipeline-parity.test.ts`

This is the regression guard. It takes a JSONL user event and verifies that the tool_result blocks produced by `buildToolResultBlocks` (used by both paths) are identical. Adding new filtering logic to `convertUserEntry` without updating `buildToolResultBlocks` will break this test.

**Step 1: Write the test**

Create `packages/core/src/__tests__/event-pipeline-parity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildToolResultBlocks, convertHistoryEntry } from '../adapters/claude-history.js';
import type { ToolResultMessageContent } from '@mainframe/types';

/**
 * Ensures that tool_result blocks produced by history loading and live stream
 * are always identical. If this test fails, buildToolResultBlocks drifted from
 * its callers.
 */

const FIXTURE_TOOL_RESULT_EVENT = {
  type: 'user',
  uuid: 'test-uuid-1',
  timestamp: '2026-02-17T00:00:00Z',
  message: {
    role: 'user',
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'tu_abc123',
        content: 'Contents of file.txt:\n\nhello world',
        is_error: false,
      },
    ],
  },
  toolUseResult: {
    structuredPatch: [
      { oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: [' hello world'] },
    ],
    originalFile: 'original content',
    type: 'update',
    content: 'updated content',
  },
};

describe('event pipeline parity', () => {
  it('history convertHistoryEntry produces same tool_result blocks as buildToolResultBlocks directly', () => {
    const chatId = 'chat-parity-test';

    // Path A: history loading
    const historyMsg = convertHistoryEntry(FIXTURE_TOOL_RESULT_EVENT as Record<string, unknown>, chatId);
    expect(historyMsg).not.toBeNull();
    expect(historyMsg!.type).toBe('tool_result');
    const historyBlocks = historyMsg!.content.filter((b) => b.type === 'tool_result') as ToolResultMessageContent[];

    // Path B: shared builder (used by live stream)
    const liveBlocks = buildToolResultBlocks(
      FIXTURE_TOOL_RESULT_EVENT.message as unknown as Record<string, unknown>,
      FIXTURE_TOOL_RESULT_EVENT.toolUseResult as Record<string, unknown>,
    ) as ToolResultMessageContent[];

    expect(historyBlocks).toHaveLength(1);
    expect(liveBlocks).toHaveLength(1);

    // Both paths must produce identical tool_result content
    expect(liveBlocks[0].toolUseId).toBe(historyBlocks[0].toolUseId);
    expect(liveBlocks[0].content).toBe(historyBlocks[0].content);
    expect(liveBlocks[0].isError).toBe(historyBlocks[0].isError);
    expect(liveBlocks[0].structuredPatch).toEqual(historyBlocks[0].structuredPatch);
    expect(liveBlocks[0].originalFile).toBe(historyBlocks[0].originalFile);
    expect(liveBlocks[0].modifiedFile).toBe(historyBlocks[0].modifiedFile);
  });

  it('task-notification string content produces no ChatMessage in either path', () => {
    const taskNotifEvent = {
      type: 'user',
      uuid: 'test-uuid-2',
      timestamp: '2026-02-17T00:00:00Z',
      message: {
        role: 'user',
        content: '<task-notification>{"task":"foo","status":"pending"}</task-notification>',
      },
    };

    // History path: should return null (filtered)
    const historyMsg = convertHistoryEntry(taskNotifEvent as Record<string, unknown>, 'chat-1');
    expect(historyMsg).toBeNull();

    // Live-stream path: buildToolResultBlocks on string content returns empty
    const liveBlocks = buildToolResultBlocks(
      taskNotifEvent.message as unknown as Record<string, unknown>,
      undefined,
    );
    expect(liveBlocks).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify failure (before Task 1/2 are done)**

Run: `pnpm --filter @mainframe/core test -- event-pipeline-parity`
Expected: FAIL — `buildToolResultBlocks` not exported yet (if running before Task 1).
After Tasks 1 and 2: PASS.

**Step 3: Run test to verify it passes**

Run: `pnpm --filter @mainframe/core test -- event-pipeline-parity`
Expected: PASS.

**Step 4: Commit**

```bash
git add packages/core/src/__tests__/event-pipeline-parity.test.ts
git commit -m "test: add cross-path parity test for Claude event pipeline"
```

---

### Task 4: Document the intentional divergences in code

**Files:**
- Modify: `packages/core/src/adapters/claude-events.ts`
- Modify: `packages/core/src/adapters/claude-history.ts`

**Step 1: Add explaining comment to `handleUserEvent`**

At the top of `handleUserEvent` in `claude-events.ts`, add:

```ts
// Live stream handles ONLY tool_result blocks from user events.
// Text/image blocks in user entries are intentionally ignored here because:
//   - User-typed text: already created as a ChatMessage by chat-manager.sendMessage()
//   - Image blocks: not surfaced in live mode (no UX for them)
// History loading (convertUserEntry) reconstructs these from JSONL since it
// has no sendMessage() counterpart. See docs/plans/2026-02-17-unified-event-pipeline.md.
// TODO(task-support): handle <task-notification> string content as TaskGroupCard
```

**Step 2: Add comment to `convertUserEntry` above the string content branch**

In `claude-history.ts`, in `convertUserEntry`, add:

```ts
// String rawContent: user-typed text stored by Claude CLI when message.content
// is not an array. History must render it; live stream doesn't re-emit it
// (sendMessage() already created that ChatMessage).
// Known internal strings are filtered below — add new patterns here if they
// appear in JSONL but should never render in UI.
// TODO(task-support): render <task-notification> content once task UI is ready
```

**Step 3: Run full test suite**

Run: `pnpm --filter @mainframe/core test`
Expected: PASS — all existing tests plus the new parity and helper tests.

**Step 4: Typecheck**

Run: `pnpm --filter @mainframe/core build`
Expected: PASS.

**Step 5: Commit**

```bash
git add packages/core/src/adapters/claude-events.ts packages/core/src/adapters/claude-history.ts
git commit -m "docs(code): document intentional live-stream vs history divergences in user event handling"
```

---

### Task 5: Full verification

**Files:** None (verification only).

**Step 1: Run all core tests**

Run: `pnpm --filter @mainframe/core test`
Expected: PASS — all tests including the new event-pipeline-parity suite.

**Step 2: Run full monorepo build**

Run: `pnpm build`
Expected: PASS — types, core, desktop all compile.

**Step 3: Verify no duplicate tool_result construction code**

Run: `grep -n "type: 'tool_result'" packages/core/src/adapters/claude-events.ts`
Expected: 0 lines — all construction is now in `buildToolResultBlocks`.

Run: `grep -n "buildToolResultBlocks" packages/core/src/adapters/`
Expected: Appears in `claude-history.ts` (definition) and `claude-events.ts` (import + call).

**Step 4: Commit if any fixups**

```bash
git add -A && git commit -m "chore: fixups from final verification"
```
