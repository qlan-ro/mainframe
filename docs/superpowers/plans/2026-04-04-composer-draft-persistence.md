# Composer Draft Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore per-chat composer draft persistence so text, attachments, and captures survive chat switches, and clean up drafts on archive.

**Architecture:** Module-level `Map<string, Draft>` outside the React tree. ComposerCard saves on unmount, restores on mount. Archive call sites delete the draft entry.

**Tech Stack:** React, assistant-ui (ComposerRuntime), Zustand (sandbox store), vitest

---

### File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/desktop/src/renderer/components/chat/assistant-ui/composer/composer-drafts.ts` | Create | Draft Map + get/save/delete helpers |
| `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx` | Modify | Save/restore/delete lifecycle |
| `packages/desktop/src/renderer/components/panels/FlatSessionRow.tsx` | Modify | Delete draft on archive |
| `packages/desktop/src/renderer/components/panels/ProjectGroup.tsx` | Modify | Delete draft on archive |
| `packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx` | Modify | Delete draft on archive |
| `packages/desktop/src/__tests__/components/composer/composer-drafts.test.ts` | Create | Unit tests for draft module |

---

### Task 1: Create `composer-drafts.ts` module

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/composer-drafts.ts`
- Test: `packages/desktop/src/__tests__/components/composer/composer-drafts.test.ts`

- [ ] **Step 1: Write failing tests for get/save/delete**

```ts
// packages/desktop/src/__tests__/components/composer/composer-drafts.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getDraft, saveDraft, deleteDraft } from '../../../renderer/components/chat/assistant-ui/composer/composer-drafts';

describe('composer-drafts', () => {
  beforeEach(() => {
    // Clear all drafts between tests
    deleteDraft('test-chat-1');
    deleteDraft('test-chat-2');
  });

  it('returns undefined for unknown chatId', () => {
    expect(getDraft('nonexistent')).toBeUndefined();
  });

  it('saves and retrieves a draft', () => {
    const draft = { text: 'hello', attachments: [], captures: [] };
    saveDraft('test-chat-1', draft);
    expect(getDraft('test-chat-1')).toEqual(draft);
  });

  it('overwrites an existing draft', () => {
    saveDraft('test-chat-1', { text: 'old', attachments: [], captures: [] });
    saveDraft('test-chat-1', { text: 'new', attachments: [], captures: [] });
    expect(getDraft('test-chat-1')?.text).toBe('new');
  });

  it('deletes a draft', () => {
    saveDraft('test-chat-1', { text: 'hello', attachments: [], captures: [] });
    deleteDraft('test-chat-1');
    expect(getDraft('test-chat-1')).toBeUndefined();
  });

  it('does not throw when deleting nonexistent draft', () => {
    expect(() => deleteDraft('nonexistent')).not.toThrow();
  });

  it('isolates drafts between chat IDs', () => {
    saveDraft('test-chat-1', { text: 'one', attachments: [], captures: [] });
    saveDraft('test-chat-2', { text: 'two', attachments: [], captures: [] });
    expect(getDraft('test-chat-1')?.text).toBe('one');
    expect(getDraft('test-chat-2')?.text).toBe('two');
  });

  it('does not save empty drafts', () => {
    saveDraft('test-chat-1', { text: '', attachments: [], captures: [] });
    expect(getDraft('test-chat-1')).toBeUndefined();
  });

  it('saves draft with only attachments (no text)', () => {
    const draft = {
      text: '',
      attachments: [{ type: 'image', name: 'photo.png', contentType: 'image/png', content: [] }],
      captures: [],
    };
    saveDraft('test-chat-1', draft);
    expect(getDraft('test-chat-1')).toEqual(draft);
  });

  it('saves draft with only captures (no text)', () => {
    const draft = {
      text: '',
      attachments: [],
      captures: [{ type: 'screenshot' as const, imageDataUrl: 'data:image/png;base64,abc' }],
    };
    saveDraft('test-chat-1', draft);
    expect(getDraft('test-chat-1')).toEqual(draft);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec vitest run src/__tests__/components/composer/composer-drafts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `composer-drafts.ts`**

```ts
// packages/desktop/src/renderer/components/chat/assistant-ui/composer/composer-drafts.ts
import type { Capture } from '../../../../store/sandbox';

export interface Draft {
  text: string;
  attachments: Array<{ type: string; name: string; contentType?: string; content: unknown[] }>;
  captures: Array<Omit<Capture, 'id'>>;
}

const drafts = new Map<string, Draft>();

export function getDraft(chatId: string): Draft | undefined {
  return drafts.get(chatId);
}

export function saveDraft(chatId: string, draft: Draft): void {
  const hasContent = draft.text.trim() || draft.attachments.length > 0 || draft.captures.length > 0;
  if (!hasContent) return;
  drafts.set(chatId, draft);
}

export function deleteDraft(chatId: string): void {
  drafts.delete(chatId);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec vitest run src/__tests__/components/composer/composer-drafts.test.ts`
Expected: All 9 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/composer/composer-drafts.ts packages/desktop/src/__tests__/components/composer/composer-drafts.test.ts
git commit -m "feat(composer): add draft persistence module with get/save/delete"
```

---

### Task 2: Add save/restore lifecycle to ComposerCard

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx`

- [ ] **Step 1: Add `useRef` import and draft imports**

In `ComposerCard.tsx` line 1, add `useRef` to the React import:

```ts
import React, { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
```

Add draft imports after the existing imports (after line 20, the `useSandboxStore` import). Also import `Capture` type:

```ts
import { useSandboxStore, type Capture } from '../../../../store/sandbox';
import { getDraft, saveDraft, deleteDraft } from './composer-drafts';
```

(This replaces the existing `import { useSandboxStore } from '../../../../store/sandbox';` on line 20.)

- [ ] **Step 2: Add refs for cleanup closure**

In `ComposerCard()`, after line 109 (`const removeCapture = ...`), add:

```ts
  const composerRuntimeRef = useRef(composerRuntime);
  composerRuntimeRef.current = composerRuntime;
  const chatIdRef = useRef(chatId);
  chatIdRef.current = chatId;
```

- [ ] **Step 3: Replace the focus-only useEffect with save/restore lifecycle**

Replace the existing `useEffect` at lines 111-115:

```ts
  useEffect(() => {
    requestAnimationFrame(() => {
      focusComposerInput();
    });
  }, [chatId]);
```

With the full draft save/restore lifecycle:

```ts
  useEffect(() => {
    const draft = getDraft(chatId);
    if (draft) {
      requestAnimationFrame(() => {
        try {
          composerRuntime.setText(draft.text);
          for (const att of draft.attachments) {
            void composerRuntime.addAttachment(att as Parameters<typeof composerRuntime.addAttachment>[0]);
          }
        } catch {
          /* composer not ready */
        }
        if (draft.captures.length > 0) {
          const store = useSandboxStore.getState();
          for (const cap of draft.captures) store.addCapture(cap);
        }
      });
    }
    requestAnimationFrame(() => focusComposerInput());

    return () => {
      try {
        const state = composerRuntimeRef.current.getState();
        const text = state?.text ?? '';
        const attachments = (state?.attachments ?? []).map((a: { type: string; name: string; contentType?: string; content?: unknown[] }) => ({
          type: a.type,
          name: a.name,
          contentType: a.contentType,
          content: a.content ?? [],
        }));
        const caps: Omit<Capture, 'id'>[] = useSandboxStore.getState().captures.map(({ id: _, ...rest }) => rest);
        saveDraft(chatIdRef.current, { text, attachments, captures: caps });
        useSandboxStore.getState().clearCaptures();
      } catch {
        /* composerRuntime already disposed */
      }
    };
  }, [chatId]);
```

Note: the `composerRuntime` dependency is intentionally omitted from the dep array — we use `composerRuntimeRef` in cleanup to avoid re-running the effect on every runtime change. The effect should only trigger on `chatId` change (mount/unmount cycle).

- [ ] **Step 4: Add deleteDraft to SendButton**

In `SendButton`, add `chatId` prop back. Change the props interface (around line 68):

```ts
function SendButton({
  composerRuntime,
  hasCaptures,
  disabled: externalDisabled,
  chatId,
}: {
  composerRuntime: ComposerRuntime;
  hasCaptures: boolean;
  disabled?: boolean;
  chatId: string;
}) {
```

In the `onClick` handler, add `deleteDraft(chatId)` after `composerRuntime.send()`:

```ts
      onClick={() => {
        try {
          composerRuntime.send();
          deleteDraft(chatId);
        } catch (err) {
          log.warn('failed to send from composer', { err: String(err) });
        }
      }}
```

- [ ] **Step 5: Pass chatId to SendButton in the JSX**

Update the `<SendButton>` usage at the bottom of `ComposerCard` (around line 332):

```tsx
          <SendButton
            composerRuntime={composerRuntime}
            hasCaptures={captures.length > 0}
            disabled={chat?.worktreeMissing}
            chatId={chatId}
          />
```

- [ ] **Step 6: Also delete draft on Enter-while-running send**

In the `onKeyDown` handler on `ComposerPrimitive.Input` (around line 273-281), add `deleteDraft(chatId)` after `composerRuntime.send()`:

```ts
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && chat?.isRunning) {
              e.preventDefault();
              try {
                composerRuntime.send();
                deleteDraft(chatId);
              } catch (err) {
                log.warn('failed to send from composer', { err: String(err) });
              }
            }
          }}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx
git commit -m "feat(composer): save and restore drafts across chat switches"
```

---

### Task 3: Delete drafts on archive

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/FlatSessionRow.tsx`
- Modify: `packages/desktop/src/renderer/components/panels/ProjectGroup.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx`

- [ ] **Step 1: Add deleteDraft to FlatSessionRow.tsx**

Add import at the top of `FlatSessionRow.tsx`:

```ts
import { deleteDraft } from '../chat/assistant-ui/composer/composer-drafts';
```

In the `handleArchive` callback, add `deleteDraft(chat.id)` right after `removeChat(chat.id)` (line 74):

```ts
          removeChat(chat.id);
          deleteDraft(chat.id);
```

- [ ] **Step 2: Add deleteDraft to ProjectGroup.tsx**

Add import at the top of `ProjectGroup.tsx`:

```ts
import { deleteDraft } from '../chat/assistant-ui/composer/composer-drafts';
```

In the `handleArchiveChat` callback, add `deleteDraft(chatId)` right after `removeChat(chatId)` (line 271):

```ts
          removeChat(chatId);
          deleteDraft(chatId);
```

- [ ] **Step 3: Add deleteDraft to MainframeRuntimeProvider.tsx**

Add import at the top of `MainframeRuntimeProvider.tsx`:

```ts
import { deleteDraft } from './composer/composer-drafts';
```

In the `onArchive` callback, add `deleteDraft(threadId)` right after `removeChat(threadId)` (line 282):

```ts
        removeChat(threadId);
        deleteDraft(threadId);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/FlatSessionRow.tsx packages/desktop/src/renderer/components/panels/ProjectGroup.tsx packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx
git commit -m "fix(composer): discard draft when chat is archived"
```

---

### Task 4: Changeset

- [ ] **Step 1: Create changeset**

Run: `pnpm changeset`

Pick `@qlan-ro/mainframe-desktop` with `patch` bump.

Summary: `Restore composer draft persistence across chat switches and clean up drafts on archive`

- [ ] **Step 2: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for composer draft persistence"
```
