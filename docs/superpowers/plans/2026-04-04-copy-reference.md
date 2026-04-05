# Copy Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Copy Reference" context menu action to Monaco editors that copies `relativePath::SymbolChain` (or `relativePath:line` fallback) to the clipboard.

**Architecture:** A single utility module (`copy-reference.ts`) handles symbol resolution and clipboard writing. Both `MonacoEditor` and `MonacoDiffEditor` register it as a Monaco action. For TS/JS files, the TS language worker provides nested symbol trees via `getNavigationTree`. For other languages, `getWordAtPosition` provides a best-effort fallback.

**Tech Stack:** Monaco Editor 0.55, `@monaco-editor/react`, TypeScript language service worker

**Spec:** `docs/superpowers/specs/2026-04-04-copy-reference-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/desktop/src/renderer/components/editor/copy-reference.ts` | Create | `copyReference()` — symbol resolution + clipboard write |
| `packages/desktop/src/renderer/components/editor/copy-reference.test.ts` | Create | Unit tests for `buildReference()` and `findSymbolChain()` |
| `packages/desktop/src/renderer/components/editor/MonacoEditor.tsx` | Modify | Register `mainframe.copyReference` action |
| `packages/desktop/src/renderer/components/editor/MonacoDiffEditor.tsx` | Modify | Accept `filePath` prop, register `mainframe.copyReference` action |
| `packages/desktop/src/renderer/components/center/DiffTab.tsx` | Modify | Pass `filePath` to `MonacoDiffEditor` |

---

## Task 1: Pure Reference Formatting Utility + Tests

**Files:**
- Create: `packages/desktop/src/renderer/components/editor/copy-reference.ts`
- Create: `packages/desktop/src/renderer/components/editor/copy-reference.test.ts`

Build the pure functions first — no Monaco dependency, fully testable.

- [ ] **Step 1: Write failing tests for `buildReference()`**

Create the test file:

```ts
// packages/desktop/src/renderer/components/editor/copy-reference.test.ts
import { describe, expect, it } from 'vitest';
import { buildReference } from './copy-reference';

describe('buildReference', () => {
  it('tier 1: returns path::symbolChain when symbol chain is provided', () => {
    expect(buildReference('packages/core/src/auth.ts', 42, 'AuthService.validate')).toBe(
      'packages/core/src/auth.ts::AuthService.validate',
    );
  });

  it('tier 2: returns path:line (word) when only word is provided', () => {
    expect(buildReference('packages/core/src/auth.ts', 42, undefined, 'validate')).toBe(
      'packages/core/src/auth.ts:42 (validate)',
    );
  });

  it('tier 3: returns path:line when neither symbol nor word is available', () => {
    expect(buildReference('packages/core/src/auth.ts', 42)).toBe('packages/core/src/auth.ts:42');
  });

  it('uses "untitled" when filePath is undefined', () => {
    expect(buildReference(undefined, 10)).toBe('untitled:10');
  });

  it('applies lineOffset to line number in tier 2 and 3', () => {
    expect(buildReference('file.ts', 5, undefined, 'foo', 100)).toBe('file.ts:105 (foo)');
    expect(buildReference('file.ts', 5, undefined, undefined, 100)).toBe('file.ts:105');
  });

  it('does not apply lineOffset to tier 1 (symbol chain)', () => {
    expect(buildReference('file.ts', 5, 'MyClass.method', undefined, 100)).toBe('file.ts::MyClass.method');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec vitest run src/renderer/components/editor/copy-reference.test.ts`
Expected: FAIL — `buildReference` not found.

- [ ] **Step 3: Implement `buildReference()`**

Create the module:

```ts
// packages/desktop/src/renderer/components/editor/copy-reference.ts

/**
 * Build a reference string from file path + symbol info.
 *
 * Tier 1 (symbol chain): `path::SymbolChain`
 * Tier 2 (word only):    `path:line (word)`
 * Tier 3 (nothing):      `path:line`
 */
export function buildReference(
  filePath: string | undefined,
  line: number,
  symbolChain?: string,
  word?: string,
  lineOffset?: number,
): string {
  const path = filePath ?? 'untitled';
  if (symbolChain) return `${path}::${symbolChain}`;
  const adjustedLine = line + (lineOffset ?? 0);
  if (word) return `${path}:${adjustedLine} (${word})`;
  return `${path}:${adjustedLine}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec vitest run src/renderer/components/editor/copy-reference.test.ts`
Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/editor/copy-reference.ts packages/desktop/src/renderer/components/editor/copy-reference.test.ts
git commit -m "feat(editor): add buildReference() for copy reference formatting"
```

---

## Task 2: Navigation Tree Symbol Resolution + Tests

**Files:**
- Modify: `packages/desktop/src/renderer/components/editor/copy-reference.ts`
- Modify: `packages/desktop/src/renderer/components/editor/copy-reference.test.ts`

Add the function that walks a TS `NavigationTree` to find the symbol chain at a given offset.

- [ ] **Step 1: Write failing tests for `findSymbolChain()`**

Append to the test file:

```ts
import { findSymbolChain } from './copy-reference';

/**
 * NavigationTree shape from TS language service:
 * { text: string, kind: string, spans: Array<{ start: number, length: number }>, childItems?: NavigationTree[] }
 */

describe('findSymbolChain', () => {
  it('returns deepest matching symbol chain', () => {
    const tree = {
      text: '"module"',
      kind: 'module',
      spans: [{ start: 0, length: 200 }],
      childItems: [
        {
          text: 'MyClass',
          kind: 'class',
          spans: [{ start: 10, length: 100 }],
          childItems: [
            {
              text: 'validate',
              kind: 'method',
              spans: [{ start: 30, length: 20 }],
              childItems: [],
            },
          ],
        },
      ],
    };
    expect(findSymbolChain(tree, 35)).toBe('MyClass.validate');
  });

  it('returns single symbol when cursor is in class but not in a method', () => {
    const tree = {
      text: '"module"',
      kind: 'module',
      spans: [{ start: 0, length: 200 }],
      childItems: [
        {
          text: 'MyClass',
          kind: 'class',
          spans: [{ start: 10, length: 100 }],
          childItems: [
            {
              text: 'validate',
              kind: 'method',
              spans: [{ start: 30, length: 20 }],
              childItems: [],
            },
          ],
        },
      ],
    };
    expect(findSymbolChain(tree, 15)).toBe('MyClass');
  });

  it('returns top-level function name', () => {
    const tree = {
      text: '"module"',
      kind: 'module',
      spans: [{ start: 0, length: 100 }],
      childItems: [
        {
          text: 'helperFn',
          kind: 'function',
          spans: [{ start: 5, length: 40 }],
          childItems: [],
        },
      ],
    };
    expect(findSymbolChain(tree, 20)).toBe('helperFn');
  });

  it('returns undefined when cursor is outside all symbols', () => {
    const tree = {
      text: '"module"',
      kind: 'module',
      spans: [{ start: 0, length: 100 }],
      childItems: [
        {
          text: 'helperFn',
          kind: 'function',
          spans: [{ start: 50, length: 20 }],
          childItems: [],
        },
      ],
    };
    expect(findSymbolChain(tree, 5)).toBeUndefined();
  });

  it('returns undefined for empty tree', () => {
    const tree = {
      text: '"module"',
      kind: 'module',
      spans: [{ start: 0, length: 0 }],
      childItems: [],
    };
    expect(findSymbolChain(tree, 5)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify the new tests fail**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec vitest run src/renderer/components/editor/copy-reference.test.ts`
Expected: FAIL — `findSymbolChain` not exported.

- [ ] **Step 3: Implement `findSymbolChain()`**

Add to `copy-reference.ts`:

```ts
/** Shape of TS NavigationTree returned by the language service worker. */
export interface NavigationTreeNode {
  text: string;
  kind: string;
  spans: Array<{ start: number; length: number }>;
  childItems?: NavigationTreeNode[];
}

/**
 * Walk a TS NavigationTree depth-first and return the dotted symbol chain
 * for the deepest node whose span contains `offset`.
 * Skips the root module node (kind === 'module').
 */
export function findSymbolChain(root: NavigationTreeNode, offset: number): string | undefined {
  const chain: string[] = [];

  function walk(node: NavigationTreeNode): boolean {
    const inSpan = node.spans.some((s) => offset >= s.start && offset < s.start + s.length);
    if (!inSpan) return false;

    if (node.kind !== 'module') {
      chain.push(node.text);
    }

    if (node.childItems) {
      for (const child of node.childItems) {
        if (walk(child)) return true;
      }
    }

    return chain.length > 0;
  }

  walk(root);
  return chain.length > 0 ? chain.join('.') : undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec vitest run src/renderer/components/editor/copy-reference.test.ts`
Expected: All 11 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/editor/copy-reference.ts packages/desktop/src/renderer/components/editor/copy-reference.test.ts
git commit -m "feat(editor): add findSymbolChain() for TS navigation tree walking"
```

---

## Task 3: `copyReference()` Entry Point

**Files:**
- Modify: `packages/desktop/src/renderer/components/editor/copy-reference.ts`

Add the async function that ties everything together — gets the cursor position from the editor, resolves symbols via the TS worker (or falls back to word-at-cursor), builds the reference, and writes to clipboard. This function is not unit-tested directly because it depends on Monaco editor instances; it will be integration-tested via the UI.

- [ ] **Step 1: Implement `copyReference()`**

Add to `copy-reference.ts`:

```ts
import type * as monacoType from 'monaco-editor';

/**
 * Copy a qualified reference string for the symbol at the cursor to the clipboard.
 * Called by the Monaco `mainframe.copyReference` action in both editors.
 */
export async function copyReference(
  editor: monacoType.editor.ICodeEditor,
  filePath: string | undefined,
  monaco: typeof monacoType,
  lineOffset?: number,
): Promise<void> {
  const position = editor.getPosition();
  const model = editor.getModel();
  if (!position || !model) return;

  const line = position.lineNumber;
  const wordInfo = model.getWordAtPosition(position);
  const word = wordInfo?.word;

  let symbolChain: string | undefined;

  const langId = model.getLanguageId();
  if (langId === 'typescript' || langId === 'javascript') {
    try {
      const getWorker =
        langId === 'typescript'
          ? monaco.languages.typescript.getTypeScriptWorker
          : monaco.languages.typescript.getJavaScriptWorker;
      const worker = await getWorker();
      const client = await worker(model.uri);
      const navTree = await (client as any).getNavigationTree(model.uri.toString());
      if (navTree) {
        const offset = model.getOffsetAt(position);
        symbolChain = findSymbolChain(navTree, offset);
      }
    } catch {
      /* TS worker unavailable — fall back to word */
    }
  }

  const reference = buildReference(filePath, line, symbolChain, word, lineOffset);

  try {
    await navigator.clipboard.writeText(reference);
  } catch {
    /* clipboard API failure — silent for v1 */
  }
}
```

Note: the `import type * as monacoType from 'monaco-editor'` should be at the top of the file. Make sure `buildReference` and `findSymbolChain` are already defined above this function in the same file.

- [ ] **Step 2: Verify the file compiles**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run existing tests still pass**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec vitest run src/renderer/components/editor/copy-reference.test.ts`
Expected: All 11 tests PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/components/editor/copy-reference.ts
git commit -m "feat(editor): add copyReference() entry point with TS worker symbol resolution"
```

---

## Task 4: Register Action in MonacoEditor

**Files:**
- Modify: `packages/desktop/src/renderer/components/editor/MonacoEditor.tsx` (lines 196-202, inside `handleMount`)

- [ ] **Step 1: Add import and register the action**

At the top of `MonacoEditor.tsx`, add the import:

```ts
import { copyReference } from './copy-reference';
```

In the `handleMount` callback, after the existing `editor.addAction` for `mainframe.addComment` (line 202), add the copy reference action. This action should be registered unconditionally (not gated behind `onLineComment`), so place it **before** the `if (!onLineComment) return;` guard at line 165.

Insert after line 163 (after `registerDefinitionProvider`) and before line 165 (`if (!onLineComment) return;`):

```ts
      const filePathRef_val = filePath;
      editor.addAction({
        id: 'mainframe.copyReference',
        label: 'Copy Reference',
        contextMenuGroupId: '9_cutcopypaste',
        contextMenuOrder: 5,
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyC],
        run: (ed) => copyReference(ed, filePathRef_val, monaco),
      });
```

Note: We capture `filePath` in a local variable to avoid stale closure issues. Since `handleMount` is only called once, this is fine.

- [ ] **Step 2: Verify the file compiles**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/desktop/src/renderer/components/editor/MonacoEditor.tsx
git commit -m "feat(editor): register Copy Reference action in MonacoEditor"
```

---

## Task 5: Register Action in MonacoDiffEditor + Wire filePath

**Files:**
- Modify: `packages/desktop/src/renderer/components/editor/MonacoDiffEditor.tsx` (interface + handleMount)
- Modify: `packages/desktop/src/renderer/components/center/DiffTab.tsx` (pass filePath prop)

- [ ] **Step 1: Add `filePath` prop to `MonacoDiffEditor`**

In `MonacoDiffEditor.tsx`, add `filePath?: string` to the `MonacoDiffEditorProps` interface:

```ts
interface MonacoDiffEditorProps {
  original: string;
  modified: string;
  language?: string;
  filePath?: string;
  startLine?: number;
  onLineComment?: (startLine: number, endLine: number, lineContent: string, comment: string) => void;
  onSubmitReview?: (comments: { startLine: number; endLine: number; lineContent: string; comment: string }[]) => void;
}
```

Destructure it in the component:

```ts
export function MonacoDiffEditor({
  original,
  modified,
  language,
  filePath,
  startLine,
  onLineComment,
  onSubmitReview,
}: MonacoDiffEditorProps): React.ReactElement {
```

- [ ] **Step 2: Add import and register the action in `handleMount`**

At the top of `MonacoDiffEditor.tsx`, add:

```ts
import { copyReference } from './copy-reference';
```

In `handleMount`, after `setGetModel(...)` (line 77) and before `if (!onLineComment) return;` (line 91), add:

```ts
      const filePathRef_val = filePath;
      const offset = startLine && startLine > 1 ? startLine - 1 : 0;
      inner.addAction({
        id: 'mainframe.copyReference',
        label: 'Copy Reference',
        contextMenuGroupId: '9_cutcopypaste',
        contextMenuOrder: 5,
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyC],
        run: (ed) => copyReference(ed, filePathRef_val, monaco, offset),
      });
```

Note: `offset` is computed from `startLine` to match how the diff editor offsets line numbers. This is passed as `lineOffset` to `copyReference`, which applies it in the tier 2/3 fallback format.

- [ ] **Step 3: Pass `filePath` from `DiffTab`**

In `DiffTab.tsx`, the `MonacoDiffEditor` JSX (around line 117) does not currently receive `filePath`. Add it:

```tsx
    <MonacoDiffEditor
      key={source === 'inline' ? `${original?.length}:${modified?.length}` : filePath}
      original={original}
      modified={modified}
      language={inferLanguage(filePath)}
      filePath={filePath}
      startLine={startLine}
      onLineComment={handleLineComment}
      onSubmitReview={handleSubmitReview}
    />
```

- [ ] **Step 4: Verify the file compiles**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/components/editor/MonacoDiffEditor.tsx packages/desktop/src/renderer/components/center/DiffTab.tsx
git commit -m "feat(editor): register Copy Reference action in MonacoDiffEditor with line offset"
```

---

## Task 6: Changeset + Typecheck + Final Test Run

**Files:**
- Create: `.changeset/*.md` (generated by `pnpm changeset`)

- [ ] **Step 1: Add changeset**

Run: `pnpm changeset`
Select: `@qlan-ro/mainframe-desktop` — `minor`
Summary: `Add "Copy Reference" context menu action to Monaco editors`

- [ ] **Step 2: Run full typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 3: Run all copy-reference tests**

Run: `pnpm --filter @qlan-ro/mainframe-desktop exec vitest run src/renderer/components/editor/copy-reference.test.ts`
Expected: All 11 tests PASS.

- [ ] **Step 4: Commit changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for copy reference feature"
```
