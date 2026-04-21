# @-Picker Path Autocomplete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add terminal-style path autocomplete to the composer's `@`-picker. Typing a `/` in the `@`-token switches the picker from fuzzy search to tree-driven navigation; fuzzy mode (agents + file discovery) is preserved.

**Architecture:** Client-only change. A new pure helper `parseAtToken` splits the `@`-token into `{mode, dir, leaf, offsets}`. `ContextPickerMenu` uses it to decide between the existing fuzzy flow and a new autocomplete flow that calls the existing `GET /api/projects/:id/tree` endpoint, caches results per directory, and filters client-side.

**Tech Stack:** TypeScript, React 18 (`useState`/`useEffect`/`useSyncExternalStore`), Vitest, `@testing-library/react`, `@testing-library/user-event`.

**Spec:** `docs/superpowers/specs/2026-04-21-at-picker-path-autocomplete-design.md`

---

## File Structure

| File | Role |
|---|---|
| `packages/desktop/src/renderer/lib/parse-at-token.ts` (**new**) | Pure helper: given composer text and caret, returns `AtToken` (mode + dir + leaf + offsets) or null. |
| `packages/desktop/src/renderer/lib/parse-at-token.test.ts` (**new**) | Unit tests for the helper. Table-driven. |
| `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx` (**modify**) | Wire the helper in, add tree-fetching effect + cache, extend `selectItem`, add Tab branch for autocomplete. |
| `packages/desktop/src/renderer/components/chat/ContextPickerMenu.test.tsx` (**new**) | Integration tests for the picker's autocomplete paths. |

No backend changes. `GET /api/projects/:id/tree` (`handleTree` in `packages/core/src/server/routes/files.ts:17`) and `getFileTree` (`packages/desktop/src/renderer/lib/api/files-api.ts:4`) are reused unchanged.

---

## Task 1: Create `parse-at-token.ts` helper

**Files:**
- Create: `packages/desktop/src/renderer/lib/parse-at-token.ts`
- Test: `packages/desktop/src/renderer/lib/parse-at-token.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/renderer/lib/parse-at-token.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseAtToken } from './parse-at-token';

describe('parseAtToken', () => {
  it('returns null when there is no @ before the caret', () => {
    expect(parseAtToken('hello world', 11)).toBeNull();
    expect(parseAtToken('', 0)).toBeNull();
  });

  it('returns fuzzy mode for @ with no slash', () => {
    // text = 'hello @foo', caret at end
    expect(parseAtToken('hello @foo', 10)).toEqual({
      mode: 'fuzzy',
      query: 'foo',
      dir: '',
      leaf: '',
      startOffset: 6,
      endOffset: 10,
    });
  });

  it('returns fuzzy mode for @ alone (empty query)', () => {
    expect(parseAtToken('@', 1)).toEqual({
      mode: 'fuzzy',
      query: '',
      dir: '',
      leaf: '',
      startOffset: 0,
      endOffset: 1,
    });
  });

  it('returns autocomplete mode when token contains a slash', () => {
    expect(parseAtToken('@src/co', 7)).toEqual({
      mode: 'autocomplete',
      query: '',
      dir: 'src',
      leaf: 'co',
      startOffset: 0,
      endOffset: 7,
    });
  });

  it('handles trailing slash (empty leaf)', () => {
    expect(parseAtToken('@src/', 5)).toEqual({
      mode: 'autocomplete',
      query: '',
      dir: 'src',
      leaf: '',
      startOffset: 0,
      endOffset: 5,
    });
  });

  it('handles nested path', () => {
    expect(parseAtToken('hello @src/components/But', 25)).toEqual({
      mode: 'autocomplete',
      query: '',
      dir: 'src/components',
      leaf: 'But',
      startOffset: 6,
      endOffset: 25,
    });
  });

  it('handles token starting with slash (project root)', () => {
    expect(parseAtToken('@/', 2)).toEqual({
      mode: 'autocomplete',
      query: '',
      dir: '.',
      leaf: '',
      startOffset: 0,
      endOffset: 2,
    });
    expect(parseAtToken('@/src', 5)).toEqual({
      mode: 'autocomplete',
      query: '',
      dir: '.',
      leaf: 'src',
      startOffset: 0,
      endOffset: 5,
    });
  });

  it('returns null when caret is before the @ token', () => {
    // text = 'hello @foo bar', caret at index 4 (inside 'hello')
    expect(parseAtToken('hello @foo bar', 4)).toBeNull();
  });

  it('requires @ to be at start of line or after whitespace', () => {
    // email-like input should not trigger
    expect(parseAtToken('foo@bar', 7)).toBeNull();
  });

  it('stops the token at the next whitespace', () => {
    // text = '@foo bar', caret at end of 'bar'
    // The @ token is only 'foo' (ends at the space). Caret past the token → null.
    expect(parseAtToken('@foo bar', 8)).toBeNull();
  });

  it('preserves @ at start of line', () => {
    expect(parseAtToken('@foo', 4)).toEqual({
      mode: 'fuzzy',
      query: 'foo',
      dir: '',
      leaf: '',
      startOffset: 0,
      endOffset: 4,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- parse-at-token`

Expected: FAIL with `Cannot find module './parse-at-token'`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/desktop/src/renderer/lib/parse-at-token.ts`:

```ts
export interface AtToken {
  mode: 'fuzzy' | 'autocomplete';
  /** Fuzzy-mode search query (empty in autocomplete mode). */
  query: string;
  /** Autocomplete-mode directory (project-relative). Empty in fuzzy mode. */
  dir: string;
  /** Autocomplete-mode prefix to filter. Empty in fuzzy mode. */
  leaf: string;
  /** Offset of '@' in the composer text. */
  startOffset: number;
  /** Offset past the last char of the token (end of whitespace-free run after '@'). */
  endOffset: number;
}

/**
 * Parse the @-token at or ending at the caret.
 * Returns null if no @-token ends at the caret position (e.g. caret is
 * past whitespace after the token, or there is no @ at all).
 */
export function parseAtToken(text: string, caret: number): AtToken | null {
  // Look backward from caret for '@' with start-of-text or whitespace before it.
  // The token extends from '@' through the first whitespace or end-of-text.
  // Caret must fall inside [startOffset, endOffset].
  let at = -1;
  for (let i = caret - 1; i >= 0; i--) {
    const ch = text[i];
    if (ch === undefined) break;
    if (/\s/.test(ch)) return null;
    if (ch === '@') {
      const prev = i === 0 ? ' ' : text[i - 1];
      if (prev === undefined || /\s/.test(prev)) {
        at = i;
      }
      break;
    }
  }
  if (at === -1) return null;

  let end = at + 1;
  while (end < text.length) {
    const ch = text[end];
    if (ch === undefined || /\s/.test(ch)) break;
    end++;
  }
  if (caret > end) return null;

  const tokenBody = text.slice(at + 1, end);
  const lastSlash = tokenBody.lastIndexOf('/');

  if (lastSlash === -1) {
    return {
      mode: 'fuzzy',
      query: tokenBody,
      dir: '',
      leaf: '',
      startOffset: at,
      endOffset: end,
    };
  }

  const rawDir = tokenBody.slice(0, lastSlash);
  const dir = rawDir === '' ? '.' : rawDir;
  const leaf = tokenBody.slice(lastSlash + 1);
  return {
    mode: 'autocomplete',
    query: '',
    dir,
    leaf,
    startOffset: at,
    endOffset: end,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- parse-at-token`

Expected: PASS (11/11).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/lib/parse-at-token.ts packages/desktop/src/renderer/lib/parse-at-token.test.ts
git commit -m "feat(desktop): parse-at-token helper for @-picker autocomplete"
```

---

## Task 2: Export the helper; wire it into `ContextPickerMenu` without changing behavior

**Goal:** Replace the `atMatch` regex with the new helper, keeping fuzzy mode output identical. Autocomplete mode is detected but not yet acted on (items remain empty in autocomplete mode for this task).

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx` — around the `atMatch`/`slashMatch`/`filterMode` block (lines 82–92 in the file as of this plan) and the fuzzy `useEffect` (lines 108–124).

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/renderer/components/chat/ContextPickerMenu.test.tsx` (minimal skeleton — more added in Task 4):

```tsx
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/api', () => ({
  searchFiles: vi.fn().mockResolvedValue([]),
  getFileTree: vi.fn().mockResolvedValue([]),
  addMention: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../store', () => ({
  useSkillsStore: () => ({ agents: [], skills: [], commands: [] }),
  useChatsStore: (sel: any) => sel({ activeChatId: 'chat-1' }),
}));

vi.mock('../../hooks/useActiveProjectId.js', () => ({
  useActiveProjectId: () => 'proj-1',
}));

vi.mock('../../lib/focus', () => ({
  focusComposerInput: vi.fn(),
}));

let composerText = '';
const composerSubscribers = new Set<() => void>();
const mockComposerRuntime = {
  getState: () => ({ text: composerText }),
  setText: (t: string) => {
    composerText = t;
    composerSubscribers.forEach((cb) => cb());
  },
  subscribe: (cb: () => void) => {
    composerSubscribers.add(cb);
    return () => composerSubscribers.delete(cb);
  },
};

vi.mock('@assistant-ui/react', () => ({
  useComposerRuntime: () => mockComposerRuntime,
}));

import { ContextPickerMenu } from './ContextPickerMenu';
import { searchFiles, getFileTree } from '../../lib/api';

beforeEach(() => {
  composerText = '';
  composerSubscribers.clear();
  vi.mocked(searchFiles).mockClear();
  vi.mocked(getFileTree).mockClear();
});

describe('ContextPickerMenu: fuzzy mode preserved', () => {
  it('calls searchFiles (not getFileTree) when token has no slash', async () => {
    render(<ContextPickerMenu forceOpen={false} onClose={vi.fn()} />);
    act(() => mockComposerRuntime.setText('@foo'));
    // Debounce in component is 150ms; wait past that.
    await new Promise((r) => setTimeout(r, 200));
    expect(searchFiles).toHaveBeenCalledTimes(1);
    expect(getFileTree).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify current behavior still works**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- ContextPickerMenu`

Expected: PASS. (If this FAILS before the refactor, the test setup is wrong — fix it here before touching the component.)

- [ ] **Step 3: Refactor `ContextPickerMenu.tsx` to use `parseAtToken`**

At the top of `ContextPickerMenu.tsx`, add the import:

```ts
import { parseAtToken, type AtToken } from '../../lib/parse-at-token';
```

Replace lines 82–92 (the `atMatch` / `slashMatch` / `filterMode` / `query` / `isOpen` block) with:

```ts
const caret = text.length; // composer doesn't expose caret; use end-of-text
const atToken: AtToken | null = parseAtToken(text, caret);
const slashMatch = !atToken && text.match(/^\/(\S*)$/);

type DerivedMode = 'all' | 'fuzzy-agents-files' | 'autocomplete' | 'skills';
let mode: DerivedMode = 'all';
if (atToken) mode = atToken.mode === 'fuzzy' ? 'fuzzy-agents-files' : 'autocomplete';
else if (slashMatch) mode = 'skills';

// Fuzzy-mode query (for agents/skills/files search) vs autocomplete-mode leaf.
const fuzzyQuery = atToken?.mode === 'fuzzy' ? atToken.query : '';
const allModeQuery = mode === 'all' ? (text.match(/(\S+)$/)?.[1] ?? '') : '';
const query = fuzzyQuery || (slashMatch !== null ? (slashMatch?.[1] ?? '') : '') || allModeQuery;
const isOpen = forceOpen || atToken !== null || slashMatch !== null;
```

Update the fuzzy `useEffect` that calls `searchFiles` (lines 108–124) — change the condition `filterMode !== 'agents-files'` to `mode !== 'fuzzy-agents-files'`:

```ts
useEffect(() => {
  if (mode !== 'fuzzy-agents-files' || query.length < 1 || !activeProjectId) {
    setFileResults([]);
    return;
  }
  clearTimeout(debounceRef.current);
  debounceRef.current = setTimeout(() => {
    searchFiles(activeProjectId, query, 30, activeChatId ?? undefined)
      .then((r) =>
        setFileResults(r.filter((f) => f.type === 'file').map((f) => ({ name: f.name, path: f.path }))),
      )
      .catch((err) => {
        log.warn('file search failed', { err: String(err) });
        setFileResults([]);
      });
  }, SEARCH_DEBOUNCE_MS);
  return () => clearTimeout(debounceRef.current);
}, [mode, query, activeProjectId, activeChatId]);
```

Update the items-building block (line 127–152). Change `filterMode === 'all' || filterMode === 'agents-files'` to `mode === 'all' || mode === 'fuzzy-agents-files'`; change `filterMode === 'agents-files'` to `mode === 'fuzzy-agents-files'`; change `filterMode === 'all' || filterMode === 'skills'` to `mode === 'all' || mode === 'skills'`. Autocomplete mode yields an empty `items` array for this task — that gap is filled in Task 3.

Also update `useEffect(() => setSelectedIndex(0), [filterMode, query])` to depend on `mode` instead:

```ts
useEffect(() => setSelectedIndex(0), [mode, query]);
```

Remove the now-unused `FilterMode` type alias at the top (line 15).

- [ ] **Step 4: Run test to verify fuzzy path still works**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- ContextPickerMenu`

Expected: PASS.

Also run typecheck: `pnpm --filter @qlan-ro/mainframe-desktop build`

Expected: no TS errors.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx packages/desktop/src/renderer/components/chat/ContextPickerMenu.test.tsx
git commit -m "refactor(desktop): use parseAtToken in ContextPickerMenu"
```

---

## Task 3: Autocomplete fetch + cache + filtered items

**Goal:** When `mode === 'autocomplete'`, fetch the tree for `atToken.dir`, cache by directory, filter by `atToken.leaf` prefix, and render results (files + directories). Directory entries get a trailing `/` in display.

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx`

- [ ] **Step 1: Write the failing test**

Append to `ContextPickerMenu.test.tsx`:

```tsx
import { vi as _vi } from 'vitest'; // alias to appease lint if already imported

describe('ContextPickerMenu: autocomplete mode', () => {
  it('calls getFileTree for the typed dir, renders filtered entries', async () => {
    vi.mocked(getFileTree).mockResolvedValueOnce([
      { name: 'components', type: 'directory', path: 'src/components' },
      { name: 'core', type: 'directory', path: 'src/core' },
      { name: 'app.ts', type: 'file', path: 'src/app.ts' },
    ]);

    render(<ContextPickerMenu forceOpen={false} onClose={vi.fn()} />);
    act(() => mockComposerRuntime.setText('@src/co'));
    await new Promise((r) => setTimeout(r, 200));

    expect(getFileTree).toHaveBeenCalledWith('proj-1', 'src', 'chat-1');

    // Prefix filter on leaf 'co' → matches 'components', 'core'; not 'app.ts'.
    expect(screen.queryByTestId('picker-item-file-app.ts')).toBeNull();
    expect(await screen.findByText('components/')).toBeInTheDocument();
    expect(await screen.findByText('core/')).toBeInTheDocument();
  });

  it('caches tree results — second keystroke in same dir does not re-fetch', async () => {
    vi.mocked(getFileTree).mockResolvedValue([
      { name: 'alpha.ts', type: 'file', path: 'src/alpha.ts' },
      { name: 'beta.ts', type: 'file', path: 'src/beta.ts' },
    ]);

    render(<ContextPickerMenu forceOpen={false} onClose={vi.fn()} />);
    act(() => mockComposerRuntime.setText('@src/a'));
    await new Promise((r) => setTimeout(r, 200));
    expect(getFileTree).toHaveBeenCalledTimes(1);

    act(() => mockComposerRuntime.setText('@src/al'));
    await new Promise((r) => setTimeout(r, 200));
    // Same dir 'src' → cache hit, still 1 call.
    expect(getFileTree).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- ContextPickerMenu`

Expected: FAIL — `getFileTree` not called, no entries rendered.

- [ ] **Step 3: Implement autocomplete fetch + cache + items**

In `ContextPickerMenu.tsx`, update the import line that already pulls from `../../lib/api`:

```ts
import { searchFiles, getFileTree, addMention } from '../../lib/api';
```

Extend the `PickerItem` union at the top of the file:

```ts
type PickerItem =
  | { type: 'agent'; name: string; description: string; scope: string }
  | { type: 'file'; name: string; path: string }
  | { type: 'directory'; name: string; path: string }
  | { type: 'skill'; skill: Skill }
  | { type: 'command'; command: CustomCommand };
```

Inside the component, just below the other `useRef`s, add:

```ts
const [treeEntries, setTreeEntries] = useState<{ name: string; type: 'file' | 'directory'; path: string }[]>([]);
const treeCacheRef = useRef<Map<string, { name: string; type: 'file' | 'directory'; path: string }[]>>(new Map());
const treeAbortRef = useRef<AbortController | null>(null);
```

Below the fuzzy `useEffect`, add the autocomplete fetch `useEffect`:

```ts
useEffect(() => {
  if (mode !== 'autocomplete' || !atToken || !activeProjectId) {
    setTreeEntries([]);
    return;
  }
  const dir = atToken.dir;
  const cacheKey = `${activeProjectId}:${dir}`;
  const cached = treeCacheRef.current.get(cacheKey);
  if (cached) {
    setTreeEntries(cached);
    return;
  }
  // Cancel any in-flight request for a different dir.
  treeAbortRef.current?.abort();
  const controller = new AbortController();
  treeAbortRef.current = controller;
  getFileTree(activeProjectId, dir, activeChatId ?? undefined)
    .then((entries) => {
      if (controller.signal.aborted) return;
      treeCacheRef.current.set(cacheKey, entries);
      setTreeEntries(entries);
    })
    .catch((err) => {
      if (controller.signal.aborted) return;
      log.warn('tree fetch failed', { err: String(err), dir });
      setTreeEntries([]);
    });
}, [mode, atToken?.dir, activeProjectId, activeChatId]);
```

In the items-building block, add the autocomplete branch (before the `if (filterMode === 'all' || filterMode === 'skills')` block):

```ts
if (mode === 'autocomplete' && atToken) {
  const leafLower = atToken.leaf.toLowerCase();
  const filtered = treeEntries.filter((e) => e.name.toLowerCase().startsWith(leafLower));
  // Directories first, alphabetical within each group.
  filtered.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const e of filtered) {
    if (e.type === 'directory') {
      items.push({ type: 'directory', name: e.name, path: e.path });
    } else {
      items.push({ type: 'file', name: e.name, path: e.path });
    }
  }
}
```

Add a render branch for `type === 'directory'` entries in the map over `items`. Mirror the existing `type === 'file'` render but show `{item.name}/` as the display label and use the same `FolderOpen` icon already imported (`import { File, Bot, Zap, FolderOpen, ... } from 'lucide-react'`). Example insertion inside the existing item `button` rendering (near lines 274, 288 in the current file):

```tsx
{item.type === 'directory' && <FolderOpen size={14} className="text-mf-text-secondary mt-0.5 shrink-0" />}
```

For the label span:

```tsx
item.type === 'directory' ? (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="text-mf-body text-mf-text-primary font-medium font-mono truncate" tabIndex={0}>
        {item.name}/
      </span>
    </TooltipTrigger>
    <TooltipContent>{item.path}/</TooltipContent>
  </Tooltip>
) : /* existing agent/file branch */
```

For the type pill (existing block has `{item.type === 'file' && <span>file</span>}`):

```tsx
{item.type === 'directory' && <span>dir</span>}
```

For the key generation (existing switch):

```ts
const key =
  item.type === 'agent' ? `a:${item.name}`
  : item.type === 'file' ? `f:${item.path}`
  : item.type === 'directory' ? `d:${item.path}`
  : item.type === 'command' ? `c:${item.command.name}`
  : `s:${item.skill.id}`;
```

And `data-testid`:

```ts
data-testid={`picker-item-${item.type}-${
  item.type === 'agent' ? item.name
  : item.type === 'file' ? item.name
  : item.type === 'directory' ? item.name
  : item.type === 'command' ? item.command.name
  : item.skill.invocationName || item.skill.name
}`}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- ContextPickerMenu parse-at-token`

Expected: PASS (all prior + the two new autocomplete tests).

Run typecheck: `pnpm --filter @qlan-ro/mainframe-desktop build`

Expected: no TS errors.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx packages/desktop/src/renderer/components/chat/ContextPickerMenu.test.tsx
git commit -m "feat(desktop): @-picker autocomplete fetches tree + filters by leaf"
```

---

## Task 4: Directory selection drills in; file selection commits mention

**Goal:** Pressing Enter on a directory entry in autocomplete mode replaces the token's leaf with `<entryName>/`, keeps the picker open, and triggers a new tree fetch. Pressing Enter on a file entry commits the mention using the full path and closes the picker.

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx` — `selectItem` callback (currently lines 156–199).

- [ ] **Step 1: Write the failing tests**

Append to `ContextPickerMenu.test.tsx`:

```tsx
describe('ContextPickerMenu: autocomplete selection', () => {
  it('Enter on directory rewrites text with trailing slash, keeps picker open, re-fetches', async () => {
    vi.mocked(getFileTree)
      .mockResolvedValueOnce([
        { name: 'components', type: 'directory', path: 'src/components' },
      ])
      .mockResolvedValueOnce([
        { name: 'Button.tsx', type: 'file', path: 'src/components/Button.tsx' },
      ]);

    const onClose = vi.fn();
    render(<ContextPickerMenu forceOpen={false} onClose={onClose} />);
    act(() => mockComposerRuntime.setText('@src/co'));
    await new Promise((r) => setTimeout(r, 200));

    // Press Enter on the (only) matching item — 'components' directory.
    await userEvent.keyboard('{Enter}');

    expect(composerText).toBe('@src/components/');
    expect(onClose).not.toHaveBeenCalled();

    // Wait for the re-fetch effect; dir changed to 'src/components'.
    await new Promise((r) => setTimeout(r, 200));
    expect(getFileTree).toHaveBeenLastCalledWith('proj-1', 'src/components', 'chat-1');
  });

  it('Enter on file commits mention, closes picker', async () => {
    vi.mocked(getFileTree).mockResolvedValueOnce([
      { name: 'app.ts', type: 'file', path: 'src/app.ts' },
    ]);
    const onClose = vi.fn();
    render(<ContextPickerMenu forceOpen={false} onClose={onClose} />);
    act(() => mockComposerRuntime.setText('@src/a'));
    await new Promise((r) => setTimeout(r, 200));

    await userEvent.keyboard('{Enter}');

    expect(composerText).toBe('@src/app.ts ');
    const { addMention } = await import('../../lib/api');
    expect(addMention).toHaveBeenCalledWith('chat-1', {
      kind: 'file',
      name: 'app.ts',
      path: 'src/app.ts',
    });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- ContextPickerMenu`

Expected: FAIL — directory selection currently commits and closes rather than drilling in; file selection produces an incomplete text replacement because the existing `selectItem` regex doesn't know about autocomplete tokens.

- [ ] **Step 3: Implement autocomplete-aware `selectItem`**

Replace the existing `selectItem` (lines 156–199) with:

```ts
const selectItem = useCallback(
  (item: PickerItem) => {
    try {
      const cur = composerRuntime.getState()?.text ?? '';

      // Autocomplete-mode selections: rewrite the token body, not the whole tail.
      if (atToken?.mode === 'autocomplete' && (item.type === 'directory' || item.type === 'file')) {
        const before = cur.slice(0, atToken.startOffset);
        const after = cur.slice(atToken.endOffset);
        if (item.type === 'directory') {
          // Replace only the leaf portion so the user keeps drilling in.
          const newToken = `@${item.path}/`;
          composerRuntime.setText(before + newToken + after);
        } else {
          // File commits the full path + trailing space (matches fuzzy behavior).
          const newToken = `@${item.path} `;
          composerRuntime.setText(before + newToken + after);
          if (activeChatId) {
            addMention(activeChatId, { kind: 'file', name: item.name, path: item.path }).catch((err) =>
              log.warn('add mention failed', { err: String(err) }),
            );
          }
        }
        focusComposerInput();
        if (item.type === 'file') onClose();
        return;
      }

      // Fuzzy / skills / all mode — existing insert behaviour.
      const ins =
        item.type === 'agent'
          ? `@${item.name} `
          : item.type === 'file'
            ? `@${item.path} `
            : item.type === 'command'
              ? `/${item.command.name} `
              : item.type === 'skill'
                ? `/${item.skill.invocationName || item.skill.name} `
                : '';
      const aInText = cur.match(/(?:^|\s)@(\S*)$/);
      const sInText = cur.match(/^\/(\S*)$/);
      if (aInText) {
        const start = aInText.index! + (aInText[0].startsWith(' ') ? 1 : 0);
        composerRuntime.setText(cur.slice(0, start) + ins);
      } else if (sInText) {
        composerRuntime.setText(ins);
      } else {
        const trailingWord = cur.match(/(\S+)$/);
        if (trailingWord) {
          composerRuntime.setText(cur.slice(0, trailingWord.index!) + ins);
        } else {
          const prefix = cur.length === 0 || cur.endsWith(' ') ? '' : ' ';
          composerRuntime.setText(cur + prefix + ins);
        }
      }
      focusComposerInput();
      if (activeChatId && (item.type === 'agent' || item.type === 'file')) {
        addMention(activeChatId, {
          kind: item.type === 'agent' ? 'agent' : 'file',
          name: item.name,
          path: item.type === 'file' ? item.path : undefined,
        }).catch((err) => log.warn('add mention failed', { err: String(err) }));
      }
      onClose();
    } catch (err) {
      log.warn('selection failed', { err: String(err) });
      onClose();
    }
  },
  [composerRuntime, activeChatId, onClose, atToken],
);
```

Note: directory path uses `item.path` (the full project-relative path) so that drilling into a deeply-nested directory is a single text replacement, even if the user originally typed a shorter path. The trailing `@` + path + `/` replaces the whole `@`-token — this produces deterministic state regardless of how the user got there.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- ContextPickerMenu`

Expected: PASS (all prior + two new selection tests).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx packages/desktop/src/renderer/components/chat/ContextPickerMenu.test.tsx
git commit -m "feat(desktop): @-picker drills into directories, commits files"
```

---

## Task 5: Tab key completes filename without committing

**Goal:** In autocomplete mode, Tab on a file fills the leaf with the entry's full name (so the user can confirm/inspect before pressing Enter). Tab on a directory behaves the same as Enter (drill in). Outside autocomplete mode, Tab keeps today's behavior (acts like Enter).

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx` — the `handleKeyDown` effect (currently lines 201–231).

- [ ] **Step 1: Write the failing test**

Append to `ContextPickerMenu.test.tsx`:

```tsx
describe('ContextPickerMenu: Tab key', () => {
  it('Tab on file completes the leaf but does NOT close picker or commit mention', async () => {
    vi.mocked(getFileTree).mockResolvedValueOnce([
      { name: 'Button.tsx', type: 'file', path: 'src/Button.tsx' },
    ]);
    const onClose = vi.fn();
    render(<ContextPickerMenu forceOpen={false} onClose={onClose} />);
    act(() => mockComposerRuntime.setText('@src/But'));
    await new Promise((r) => setTimeout(r, 200));

    await userEvent.keyboard('{Tab}');

    // Leaf filled to full name; picker still open; mention not committed.
    expect(composerText).toBe('@src/Button.tsx');
    expect(onClose).not.toHaveBeenCalled();
    const { addMention } = await import('../../lib/api');
    expect(addMention).not.toHaveBeenCalled();
  });

  it('Tab on directory drills in (same as Enter)', async () => {
    vi.mocked(getFileTree)
      .mockResolvedValueOnce([{ name: 'components', type: 'directory', path: 'src/components' }])
      .mockResolvedValueOnce([]);

    render(<ContextPickerMenu forceOpen={false} onClose={vi.fn()} />);
    act(() => mockComposerRuntime.setText('@src/co'));
    await new Promise((r) => setTimeout(r, 200));

    await userEvent.keyboard('{Tab}');

    expect(composerText).toBe('@src/components/');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- ContextPickerMenu`

Expected: FAIL — Tab currently calls `selectItem` which commits the file and closes the picker.

- [ ] **Step 3: Implement Tab branch**

In the `handleKeyDown` function (inside the keyboard `useEffect`), replace the `Enter` / `Tab` branch:

```ts
} else if (e.key === 'Enter' || e.key === 'Tab') {
  e.preventDefault();
  const item = items[selectedIndex];
  if (!item) return;

  // Tab in autocomplete on a file: only fill the leaf, don't commit.
  if (e.key === 'Tab' && atToken?.mode === 'autocomplete' && item.type === 'file') {
    const cur = composerRuntime.getState()?.text ?? '';
    const before = cur.slice(0, atToken.startOffset);
    const after = cur.slice(atToken.endOffset);
    composerRuntime.setText(`${before}@${item.path}${after}`);
    focusComposerInput();
    return;
  }

  selectItem(item);
}
```

Also add `atToken` to the `useEffect` dependency array at the bottom of the keyboard effect. The deps list becomes:

```ts
}, [isOpen, items, selectedIndex, selectItem, composerRuntime, onClose, atToken]);
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- ContextPickerMenu`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx packages/desktop/src/renderer/components/chat/ContextPickerMenu.test.tsx
git commit -m "feat(desktop): Tab completes file leaf without committing"
```

---

## Task 6: Back-navigation sanity test

**Goal:** Prove that deleting the `/` reverts to fuzzy mode and does NOT re-fetch the parent directory.

**Files:**
- Modify: `packages/desktop/src/renderer/components/chat/ContextPickerMenu.test.tsx` (tests only — no production code changes expected).

- [ ] **Step 1: Write the test**

Append to `ContextPickerMenu.test.tsx`:

```tsx
describe('ContextPickerMenu: back-navigation', () => {
  it('deleting the slash reverts to fuzzy mode', async () => {
    vi.mocked(getFileTree).mockResolvedValueOnce([]);
    vi.mocked(searchFiles).mockResolvedValue([]);

    render(<ContextPickerMenu forceOpen={false} onClose={vi.fn()} />);

    // Enter autocomplete mode.
    act(() => mockComposerRuntime.setText('@src/'));
    await new Promise((r) => setTimeout(r, 200));
    expect(getFileTree).toHaveBeenCalledTimes(1);

    // User backspaces past the '/'. Token is now '@src' → fuzzy mode.
    act(() => mockComposerRuntime.setText('@src'));
    await new Promise((r) => setTimeout(r, 200));
    expect(searchFiles).toHaveBeenCalledWith('proj-1', 'src', 30, 'chat-1');
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- ContextPickerMenu`

Expected: PASS (no production code change needed — this verifies the Task 2 wiring behaves correctly on the back-navigation path).

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/chat/ContextPickerMenu.test.tsx
git commit -m "test(desktop): back-navigation reverts @-picker to fuzzy mode"
```

---

## Task 7: Manual smoke test + typecheck + full suite

**Goal:** Exercise the real picker in a running desktop app against a real project, confirm the design's manual checklist, and make sure the package test suites + typecheck are clean.

- [ ] **Step 1: Full core + desktop typecheck**

Run:
```bash
pnpm --filter @qlan-ro/mainframe-core build
pnpm --filter @qlan-ro/mainframe-desktop build
```

Expected: both succeed, no TS errors.

- [ ] **Step 2: Full desktop test suite**

Run: `pnpm --filter @qlan-ro/mainframe-desktop test`

Expected: PASS. Test count should be previous count + at least 14 (11 parse tests + 2 fuzzy + 2 autocomplete + 2 selection + 2 Tab + 1 back-nav).

- [ ] **Step 3: Manual smoke test**

Launch the desktop app (`pnpm --filter @qlan-ro/mainframe-desktop dev` or the project's normal dev command). In a chat composer, walk through:

1. `@ab` — fuzzy matches for agents and files. (existing behaviour preserved)
2. `@<agentName>` — agent is selectable as a mention.
3. `@src/` — tree autocomplete appears; directories first with trailing `/`, then files.
4. `@src/comp` then ↓ Enter — drills into `src/components/`, list refreshes.
5. `@src/components/But<Tab>` — filename is filled to the matching entry (e.g. `Button.tsx`); picker stays open.
6. Press Enter — mention commits, picker closes, composer has `@src/components/Button.tsx `.
7. Backspace past the `/` in `@src/` — mode reverts to fuzzy.
8. `@nonexistent/` — empty result list, no crash.
9. `@../` in a project — tree call returns empty or an error; picker stays stable.
10. Existing `/skill` trigger still works.

- [ ] **Step 4: Add a changeset for the feature**

Run: `pnpm changeset`

Select `@qlan-ro/mainframe-desktop` with `minor` bump. Summary:

> `@`-picker gains terminal-style path autocomplete. Typing `/` in an `@`-token switches from fuzzy search to tree navigation; Tab completes filenames; Enter on a directory drills in.

- [ ] **Step 5: Commit the changeset**

```bash
git add .changeset/*.md
git commit -m "chore: changeset for @-picker path autocomplete"
```

---

## Self-Review Notes

**Spec coverage**

| Spec section | Implemented in |
|---|---|
| Mode selection | Task 2 (`parseAtToken` → mode) |
| Autocomplete split into `{dir, leaf}` | Task 1 (`parse-at-token.ts`) |
| `getFileTree(projectId, dir)` call + cache | Task 3 |
| Directory entries rendered with trailing `/` | Task 3 |
| Agents/skills hidden in autocomplete mode | Task 3 (items branch) |
| Enter on directory drills in | Task 4 |
| Enter on file commits mention | Task 4 |
| Tab completes file leaf without committing | Task 5 |
| Tab on directory = Enter | Task 5 |
| Escape clears token (existing behavior preserved) | Task 2 (no change to Escape branch) |
| Back-navigation reverts to fuzzy | Task 6 (test) |
| `@/` → project root (`dir = '.'`) | Task 1 |
| `resolveAndValidatePath` guard on `..` | No change — server-side guard already in place |
| Fuzzy mode preserved for agents + files | Task 2 (regression test) |

**Placeholder scan** — none. All code blocks are complete.

**Type consistency** — `AtToken`, `PickerItem` (with new `directory` variant), `DerivedMode` used consistently. `atToken?.mode === 'autocomplete'` guard used in every place that depends on autocomplete semantics.

**Scope** — single plan; all changes in one component + one helper + tests. No cross-package work.
