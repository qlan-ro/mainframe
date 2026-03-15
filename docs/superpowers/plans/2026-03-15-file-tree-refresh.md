# File Tree Refresh Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-refresh the file tree when an agent session modifies files, using debounced `context.updated` WebSocket events.

**Architecture:** Add a `refreshKey` counter to `FilesTab` that increments on debounced `context.updated` events. Pass it to `FileTreeNode` children. Expanded nodes re-fetch; collapsed nodes with stale caches clear their children. Mirrors the proven ContextTab debounce pattern exactly.

**Tech Stack:** React, TypeScript, WebSocket (existing `daemonClient`)

**Spec:** `docs/superpowers/specs/2026-03-15-file-tree-refresh-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/desktop/src/renderer/components/panels/FilesTab.tsx` | Modify | Add event subscription, debounce, refreshKey propagation |

Single file change. No new files, no new types, no daemon changes.

---

## Chunk 1: Implementation

### Task 1: Add debounced `context.updated` subscription to `FilesTab`

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/FilesTab.tsx`

- [ ] **Step 1: Add imports and refreshKey state**

Add `useRef` to the React import. Import `daemonClient`. Add `refreshKey` state and `debounceRef`.

In `FilesTab`, after the existing state declarations (line 108):

```typescript
import React, { useCallback, useEffect, useRef, useState } from 'react';
```

```typescript
import { daemonClient } from '../../lib/client';
```

Inside `FilesTab()`, after `const [contextMenu, setContextMenu] = ...`:

```typescript
const [refreshKey, setRefreshKey] = useState(0);
const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

- [ ] **Step 2: Add the event subscription useEffect**

Add a new `useEffect` after the existing root-fetch effect (after line 115). This mirrors `ContextTab.tsx:30-41` exactly:

```typescript
useEffect(() => {
  if (!activeChatId) return;
  const unsub = daemonClient.onEvent((event) => {
    if (event.type === 'context.updated' && event.chatId === activeChatId) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        setRefreshKey((k) => k + 1);
      }, 500);
    }
  });
  return () => {
    unsub();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };
}, [activeChatId]);
```

- [ ] **Step 3: Add `refreshKey` to root fetch dependency array**

Change the existing root-fetch `useEffect` (line 110-115) to include `refreshKey`:

Before:
```typescript
}, [activeProjectId, activeChatId]);
```

After:
```typescript
}, [activeProjectId, activeChatId, refreshKey]);
```

- [ ] **Step 4: Pass `refreshKey` to `FileTreeNode`**

Update the `FileTreeNode` render call (around line 168) to pass the prop:

```tsx
<FileTreeNode
  key={entry.path}
  entry={entry}
  depth={1}
  projectPath={activeProject.path}
  onContextMenu={handleContextMenu}
  refreshKey={refreshKey}
/>
```

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/FilesTab.tsx
git commit -m "feat(files-tab): add debounced context.updated subscription with refreshKey"
```

---

### Task 2: Handle `refreshKey` in `FileTreeNode`

**Files:**
- Modify: `packages/desktop/src/renderer/components/panels/FilesTab.tsx`

- [ ] **Step 1: Add `refreshKey` to `FileTreeNode` props**

Update the props type and destructuring (around line 27-36):

```typescript
function FileTreeNode({
  entry,
  depth,
  projectPath,
  onContextMenu,
  refreshKey,
}: {
  entry: FileEntry;
  depth: number;
  projectPath: string;
  onContextMenu: (e: React.MouseEvent, entryPath: string) => void;
  refreshKey: number;
}): React.ReactElement {
```

- [ ] **Step 2: Add refs to avoid stale closures, then add the refresh useEffect**

The `refreshKey` effect needs current values of `expanded` and `children` without adding them as dependencies (which would cause re-runs on every expand/collapse). Use refs:

After the existing state declarations in `FileTreeNode`, add refs:

```typescript
const expandedRef = useRef(expanded);
expandedRef.current = expanded;
const childrenRef = useRef(children);
childrenRef.current = children;
```

Then add the refresh effect:

```typescript
useEffect(() => {
  if (refreshKey === 0) return;
  if (entry.type !== 'directory') return;
  if (expandedRef.current && activeProjectId) {
    getFileTree(activeProjectId, entry.path, activeChatId ?? undefined)
      .then(setChildren)
      .catch((err) => log.warn('refresh file tree failed', { err: String(err) }));
  } else if (childrenRef.current.length > 0) {
    setChildren([]);
  }
}, [refreshKey, activeProjectId, activeChatId, entry.path, entry.type]);
```

Note: `expandedRef`/`childrenRef` read current values without triggering re-runs. The remaining deps (`activeProjectId`, `activeChatId`, `entry.path`, `entry.type`) are stable or change only on tree restructure.

- [ ] **Step 3: Pass `refreshKey` to child `FileTreeNode` recursively**

Update the recursive render (around line 90):

```tsx
<FileTreeNode
  key={child.path}
  entry={child}
  depth={depth + 1}
  projectPath={projectPath}
  onContextMenu={onContextMenu}
  refreshKey={refreshKey}
/>
```

- [ ] **Step 4: Verify typecheck passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/panels/FilesTab.tsx
git commit -m "feat(files-tab): handle refreshKey in FileTreeNode for auto-refresh"
```

---

### Task 3: Manual testing

- [ ] **Step 1: Build and run the app**

```bash
pnpm build && pnpm --filter @qlan-ro/mainframe-desktop dev
```

- [ ] **Step 2: Test the refresh behavior**

1. Open a project in the app
2. Navigate to the Files tab in the right panel
3. Expand a few directories
4. Start a chat session and ask the agent to create a new file in an expanded directory
5. Verify: the new file appears in the tree within ~1 second (500ms debounce + fetch time)
6. Ask the agent to create a file in a collapsed directory
7. Expand that directory — verify the new file is visible (fresh fetch, not stale cache)
8. Ask the agent to delete a file visible in an expanded directory
9. Verify: the file disappears from the tree

- [ ] **Step 3: Test edge cases**

1. Switch to the Context tab while the agent is writing files — switch back to Files tab — verify no errors in console
2. Switch the active chat — verify no stale refreshes from the old chat
3. Rapid file writes (ask agent to scaffold multiple files) — verify the tree settles once, not flickering

- [ ] **Step 4: Final commit if any adjustments were needed**

```bash
git add -u
git commit -m "fix(files-tab): adjustments from manual testing"
```
