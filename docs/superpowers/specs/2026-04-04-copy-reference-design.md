# Copy Reference

Add a "Copy Reference" context menu action to Monaco editors. Copies a qualified reference string (`relativePath::SymbolChain` or `relativePath:line` fallback) to the clipboard.

## Context

IntelliJ's "Copy Reference" produces fully-qualified symbol paths like `com.example.Service.method`. We adapt this for a polyglot TypeScript-centric editor: best-effort symbol resolution via Monaco's `DocumentSymbolProvider`, with a clean line-number fallback for unsupported languages.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Symbol resolution | Multi-language, best-effort via Monaco DocumentSymbolProvider | TS/JS/CSS/JSON supported out of the box; graceful fallback for others |
| Output format | `relativePath::SymbolChain` / `relativePath:line` | `::` clearly separates path from symbol; matches existing `file_path:line_number` convention |
| Path style | Repo-relative | Unambiguous in a monorepo; matches git and tooling conventions |
| Approach | Monaco `editor.addAction()` | Follows existing "Add Agent Context" pattern; no custom HTML menu needed |

## Format Specification

Three tiers, highest-resolution first:

1. **Symbol resolved:** `packages/core/src/auth.ts::AuthService.validate`
2. **No symbol, word at cursor:** `packages/core/src/auth.ts:42 (validate)`
3. **Nothing resolvable:** `packages/core/src/auth.ts:42`

## Architecture

### New File: `editor/copy-reference.ts`

Single exported function:

```ts
async function copyReference(
  editor: monacoType.editor.ICodeEditor,
  filePath: string | undefined,
  monaco: typeof monacoType,
  lineOffset?: number,
): Promise<void>
```

Steps:
1. Get cursor position from editor
2. Get the text model
3. Request document symbols via `monaco.editor.getModelMarkers` — actually, use `monaco.languages.DocumentSymbolProvider` registered for the model's language
4. Walk the symbol tree depth-first to find the deepest symbol whose range contains the cursor
5. Build ancestor chain (e.g., `ClassName.methodName`)
6. Compose reference string per format spec above
7. Apply `lineOffset` (for diff editor with `startLine`) to fallback line numbers
8. Copy to clipboard via `navigator.clipboard.writeText()`

### Symbol Resolution Strategy

**TypeScript/JavaScript files:** Use the TS language service worker via `monaco.languages.typescript.getTypeScriptWorker()`. Call `client.getNavigationTree(uri)` to get the full symbol tree, then walk it to find the deepest node containing the cursor. Build the ancestor chain (e.g., `ClassName.methodName`).

**All other languages:** Use `model.getWordAtPosition(position)` for the word at cursor. No symbol nesting — produce `path:line (word)` or `path:line`.

This gives high-quality results for TS/JS (the primary languages in this codebase) without depending on unstable internal Monaco APIs.

## Components Changed

| File | Change |
|------|--------|
| `editor/copy-reference.ts` | **New.** `copyReference()` utility function |
| `editor/MonacoEditor.tsx` | Register `mainframe.copyReference` action in `handleMount` |
| `editor/MonacoDiffEditor.tsx` | Accept new `filePath?: string` prop; register action in `handleMount` |
| `center/DiffTab.tsx` | Pass `filePath` prop through to `MonacoDiffEditor` |

## Action Registration

Both editors register in `handleMount`:

```ts
editor.addAction({
  id: 'mainframe.copyReference',
  label: 'Copy Reference',
  contextMenuGroupId: '9_cutcopypaste',
  contextMenuOrder: 5,
  keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyC],
  run: (ed) => copyReference(ed, filePath, monaco),
});
```

- **Menu group:** `9_cutcopypaste` — appears near Cut/Copy/Paste in Monaco's native context menu
- **Keyboard shortcut:** `Cmd+Shift+Alt+C` (matches IntelliJ convention)

## Edge Cases

| Case | Behavior |
|------|----------|
| No `filePath` (untitled buffer) | Use `"untitled"` as path component |
| Diff editor with `startLine` offset | Add offset to line number in fallback format |
| Clipboard API failure | Catch silently — no toast for v1 |
| Cursor not on any word | Produce `path:line` (tier 3) |
| TS worker unavailable | Fall back to word-at-cursor (tier 2/3) |

## Out of Scope

- Custom toast/notification on successful copy
- Copy reference from file tree (separate feature)
- Multi-cursor / selection-range references
