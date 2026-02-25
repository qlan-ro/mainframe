# Context Picker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace `AtMentionMenu` + `SlashCommandMenu` with a single `ContextPickerMenu` that handles agents, files, and skills from one button and from inline `@`/`/` triggers.

**Architecture:** A new `ContextPickerMenu` component derives its `filterMode` from both a `forceOpen` prop (button) and text-based regex triggers (`@` → agents+files, `/` → skills). The button in `ComposerCard` is updated to a `/@` icon and sets `forceOpen=true`. Both old menu files are deleted.

**Tech Stack:** React, `useSyncExternalStore`, `@assistant-ui/react` (`useComposerRuntime`), Zustand stores (`useSkillsStore`, `useProjectsStore`, `useChatsStore`), Tailwind CSS (project token classes).

---

### Task 1: Lower file-search minimum query length on the server

**Files:**
- Modify: `packages/core/src/server/routes/files.ts:72`

**Step 1: Change the guard**

At line 72, change:
```ts
if (q.length < 2) {
```
to:
```ts
if (q.length < 1) {
```

**Step 2: Verify build passes**

```bash
pnpm --filter @mainframe/core build
```
Expected: no TypeScript errors.

**Step 3: Commit**

```bash
git add packages/core/src/server/routes/files.ts
git commit -m "fix: allow single-character file search queries"
```

---

### Task 2: Create `ContextPickerMenu` component

**Files:**
- Create: `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx`

This single file replaces both `AtMentionMenu.tsx` and `SlashCommandMenu.tsx`. Write it in full:

```tsx
import React, { useState, useEffect, useCallback, useRef, useSyncExternalStore } from 'react';
import { File, Bot, Zap, FolderOpen, Globe, Puzzle } from 'lucide-react';
import { useComposerRuntime } from '@assistant-ui/react';
import { focusComposerInput } from '../../lib/focus';
import { useSkillsStore, useProjectsStore, useChatsStore } from '../../store';
import { searchFiles, addMention } from '../../lib/api';
import { cn } from '../../lib/utils';
import type { AgentConfig, Skill } from '@mainframe/types';

// ── types ──────────────────────────────────────────────────────────────────

type PickerItem =
  | { type: 'agent'; name: string; description: string; scope: string }
  | { type: 'file'; name: string; path: string }
  | { type: 'skill'; id: string; name: string; invocationName?: string; displayName?: string; description?: string; scope: string };

type FilterMode = 'all' | 'agents-files' | 'skills';

// ── helpers ────────────────────────────────────────────────────────────────

const SCOPE_ICON: Record<string, React.ReactNode> = {
  project: <FolderOpen size={12} />,
  global: <Globe size={12} />,
  plugin: <Puzzle size={12} />,
};

function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

const SEARCH_DEBOUNCE_MS = 150;

function useComposerText(): string {
  const composerRuntime = useComposerRuntime();
  const subscribe = useCallback(
    (cb: () => void) => {
      try {
        return composerRuntime.subscribe(cb);
      } catch {
        return () => {};
      }
    },
    [composerRuntime],
  );
  const getSnapshot = useCallback(() => {
    try {
      return composerRuntime.getState()?.text ?? '';
    } catch {
      return '';
    }
  }, [composerRuntime]);
  return useSyncExternalStore(subscribe, getSnapshot);
}

// ── component ──────────────────────────────────────────────────────────────

interface ContextPickerMenuProps {
  forceOpen: boolean;
  onClose: () => void;
}

export function ContextPickerMenu({ forceOpen, onClose }: ContextPickerMenuProps): React.ReactElement | null {
  const { agents, skills } = useSkillsStore();
  const activeProjectId = useProjectsStore((s) => s.activeProjectId);
  const activeChatId = useChatsStore((s) => s.activeChatId);
  const text = useComposerText();
  const composerRuntime = useComposerRuntime();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const [fileResults, setFileResults] = useState<{ name: string; path: string }[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Derive trigger mode from text
  const atMatch = text.match(/(?:^|\s)@(\S*)$/);
  const slashMatch = text.match(/^\/(\S*)$/);

  const textTrigger: FilterMode | null = atMatch ? 'agents-files' : slashMatch ? 'skills' : null;
  const isActive = forceOpen || textTrigger !== null;
  const filterMode: FilterMode = forceOpen && !textTrigger ? 'all' : (textTrigger ?? 'all');
  const query = atMatch?.[1] ?? slashMatch?.[1] ?? '';

  // Server-side file search (only in agents-files mode, query >= 1 char)
  useEffect(() => {
    if (!isActive || filterMode !== 'agents-files' || query.length < 1 || !activeProjectId) {
      setFileResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      searchFiles(activeProjectId, query, 30, activeChatId ?? undefined)
        .then((results) =>
          setFileResults(results.filter((r) => r.type === 'file').map((r) => ({ name: r.name, path: r.path }))),
        )
        .catch((err) => {
          console.warn('[context-picker] file search failed:', err);
          setFileResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [isActive, filterMode, query, activeProjectId, activeChatId]);

  // Build visible items list
  const items: PickerItem[] = [];
  if (isActive) {
    if (filterMode === 'agents-files' || filterMode === 'all') {
      for (const agent of agents) {
        if (!query || fuzzyMatch(query, agent.name)) {
          items.push({ type: 'agent', name: agent.name, description: agent.description, scope: agent.scope });
        }
      }
    }
    if (filterMode === 'agents-files') {
      for (const file of fileResults) {
        items.push({ type: 'file', name: file.name, path: file.path });
      }
    }
    if (filterMode === 'skills' || filterMode === 'all') {
      const filteredSkills = skills
        .filter((s) => {
          const name = s.invocationName || s.name;
          const display = s.displayName || s.name;
          return !query || fuzzyMatch(query, name) || fuzzyMatch(query, display);
        })
        .sort((a, b) => {
          const order = { project: 0, global: 1, plugin: 2 } as Record<string, number>;
          return (order[a.scope] ?? 9) - (order[b.scope] ?? 9);
        });
      for (const skill of filteredSkills) {
        items.push({ type: 'skill', id: skill.id, name: skill.name, invocationName: skill.invocationName, displayName: skill.displayName, description: skill.description, scope: skill.scope });
      }
    }
  }

  const visible = items.slice(0, 50);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, filterMode]);

  // ── selection ────────────────────────────────────────────────────────────

  const selectItem = useCallback(
    (item: PickerItem) => {
      try {
        const currentText = composerRuntime.getState()?.text ?? '';

        if (item.type === 'skill') {
          const command = `/${item.invocationName || item.name} `;
          // If slash trigger active, replace it; otherwise prepend
          if (slashMatch) {
            composerRuntime.setText(command);
          } else {
            composerRuntime.setText(command + currentText);
          }
        } else {
          const mention = item.type === 'agent' ? `@${item.name}` : `@${item.path}`;
          const matchInText = currentText.match(/(?:^|\s)@(\S*)$/);
          if (matchInText) {
            const start = matchInText.index! + (matchInText[0].startsWith(' ') ? 1 : 0);
            composerRuntime.setText(currentText.slice(0, start) + mention + ' ');
          } else {
            // Button-triggered: prepend mention
            const prefix = currentText.length === 0 || currentText.startsWith(' ') ? '' : ' ';
            composerRuntime.setText(mention + ' ' + prefix + currentText);
          }
          if (activeChatId) {
            addMention(activeChatId, {
              kind: item.type === 'agent' ? 'agent' : 'file',
              name: item.name,
              path: item.type === 'file' ? item.path : undefined,
            }).catch((err) => console.warn('[context-picker] add mention failed:', err));
          }
        }

        focusComposerInput();
        onClose();
      } catch (err) {
        console.warn('[ContextPickerMenu] selection failed:', err);
      }
    },
    [composerRuntime, activeChatId, slashMatch, onClose],
  );

  // ── keyboard ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isActive) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, visible.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if ((e.key === 'Enter' || e.key === 'Tab') && visible.length > 0) {
        e.preventDefault();
        const item = visible[selectedIndex];
        if (item) selectItem(item);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        try {
          const currentText = composerRuntime.getState()?.text ?? '';
          const cleaned = currentText
            .replace(/(?:^|\s)@\S*$/, '')
            .replace(/^\/\S*$/, '')
            .trimEnd();
          composerRuntime.setText(cleaned);
        } catch {}
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isActive, visible, selectedIndex, selectItem, composerRuntime, onClose]);

  // Auto-scroll selected item
  useEffect(() => {
    if (!menuRef.current) return;
    const el = menuRef.current.children[selectedIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isActive) return null;

  // ── render ────────────────────────────────────────────────────────────────

  if (visible.length === 0) {
    const hint =
      filterMode === 'all'
        ? 'Type @ to search files, or start typing to filter…'
        : filterMode === 'agents-files' && query.length === 0
          ? 'Type to search files and agents…'
          : 'No results';
    return (
      <div className="absolute bottom-full left-0 right-0 mb-1 px-3 py-2 bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-lg z-50 text-mf-body text-mf-text-secondary">
        {hint}
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="absolute bottom-full left-0 right-0 mb-1 max-h-[240px] overflow-y-auto bg-mf-panel-bg border border-mf-border rounded-mf-card shadow-lg z-50"
    >
      {visible.map((item, index) => (
        <button
          key={item.type === 'agent' ? `a:${item.name}` : item.type === 'file' ? `f:${item.path}` : `s:${item.id}`}
          type="button"
          onMouseDown={(e) => {
            e.preventDefault();
            selectItem(item);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
          className={cn(
            'w-full text-left px-3 py-2 flex items-start gap-2 transition-colors',
            index === selectedIndex ? 'bg-mf-hover' : 'hover:bg-mf-hover/50',
          )}
        >
          {item.type === 'agent' && <Bot size={14} className="text-mf-accent mt-0.5 shrink-0" />}
          {item.type === 'file' && <File size={14} className="text-mf-text-secondary mt-0.5 shrink-0" />}
          {item.type === 'skill' && <Zap size={14} className="text-mf-accent mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="text-mf-body text-mf-text-primary font-medium font-mono truncate"
                title={item.type === 'agent' ? item.name : item.type === 'file' ? item.path : item.invocationName || item.name}
              >
                {item.type === 'skill'
                  ? `/${item.invocationName || item.name}`
                  : item.type === 'file'
                    ? item.path
                    : item.name}
              </span>
              <span className="flex items-center gap-0.5 px-1.5 py-0 rounded-full bg-mf-hover text-mf-status text-mf-text-secondary shrink-0">
                {item.type === 'agent' ? (
                  <>
                    {SCOPE_ICON[item.scope]}
                    <span>agent</span>
                  </>
                ) : item.type === 'skill' ? (
                  SCOPE_ICON[item.scope]
                ) : (
                  <span>file</span>
                )}
              </span>
            </div>
            {(item.type === 'agent' || item.type === 'skill') && item.description && (
              <div className="text-mf-label text-mf-text-secondary mt-0.5 truncate" title={item.description}>
                {item.description}
              </div>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
```

**Step 1: Create the file** with the code above.

**Step 2: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```
Expected: no TypeScript errors.

**Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx
git commit -m "feat: add ContextPickerMenu (agents, files, skills unified)"
```

---

### Task 3: Update `ComposerCard` to use `ContextPickerMenu`

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx`

**Step 1: Replace imports at the top of the file**

Remove these two import lines:
```ts
import { SlashCommandMenu } from '../../SlashCommandMenu';
import { AtMentionMenu } from '../../AtMentionMenu';
```

Add:
```ts
import { ContextPickerMenu } from '../../ContextPickerMenu';
```

Also add `useState` to the React import:
```ts
import React, { useCallback, useEffect, useState } from 'react';
```

Remove `AtSign` from the lucide import line and add nothing (the button will use a text label):
```ts
import { ArrowUp, Square, Paperclip, Shield, GitBranch, X } from 'lucide-react';
```

**Step 2: Add `forceOpen` state inside `ComposerCard`**

Add after `const composerRuntime = useComposerRuntime();`:
```ts
const [pickerOpen, setPickerOpen] = useState(false);
```

**Step 3: Replace the two menu components in the JSX**

Replace:
```tsx
<SlashCommandMenu />
<AtMentionMenu />
```
with:
```tsx
<ContextPickerMenu forceOpen={pickerOpen} onClose={() => setPickerOpen(false)} />
```

**Step 4: Replace the `@` button**

Replace the entire `<button>` block that has `onClick` inserting `@` (lines 102–123) with:

```tsx
<button
  type="button"
  onClick={() => setPickerOpen((v) => !v)}
  className="px-1.5 py-1 rounded-mf-input text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary transition-colors font-mono text-xs font-semibold tracking-tight"
  title="Insert agent, file, or skill"
  aria-label="Insert agent, file, or skill"
>
  /@
</button>
```

**Step 5: Typecheck**

```bash
pnpm --filter @mainframe/desktop build
```
Expected: no TypeScript errors.

**Step 6: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx
git commit -m "feat: wire ContextPickerMenu into ComposerCard, update /@ button"
```

---

### Task 4: Delete the old menu files

**Files:**
- Delete: `packages/desktop/src/renderer/components/chat/AtMentionMenu.tsx`
- Delete: `packages/desktop/src/renderer/components/chat/SlashCommandMenu.tsx`

**Step 1: Delete the files**

```bash
git rm packages/desktop/src/renderer/components/chat/AtMentionMenu.tsx
git rm packages/desktop/src/renderer/components/chat/SlashCommandMenu.tsx
```

**Step 2: Typecheck to confirm nothing else imports them**

```bash
pnpm --filter @mainframe/desktop build
```
Expected: no TypeScript errors. If there are import errors, find and remove the remaining references.

**Step 3: Commit**

```bash
git commit -m "chore: remove AtMentionMenu and SlashCommandMenu (replaced by ContextPickerMenu)"
```

---

### Task 5: Manual smoke test

Start the dev server and verify:

```bash
pnpm dev
```

Check these scenarios:
1. Click the `/@` button → picker opens showing agents + skills
2. Click the `/@` button again → picker closes
3. Type `@` in the composer → picker opens filtered to agents + files
4. Type `@re` → file search runs, results appear
5. Type `/` → picker opens showing only skills
6. Press Arrow keys to navigate, Enter to select → correct text inserted
7. Press Escape → picker closes, trigger token removed
8. Select an agent → `@agent-name ` inserted
9. Select a file → `@file/path ` inserted
10. Select a skill → `/skill-name ` inserted
