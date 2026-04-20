# @-Picker Path Autocomplete

Adds terminal-style path autocomplete to the composer's `@`-picker. Fuzzy search is kept for discovery; typing `/` switches to tree-driven path completion.

## Problem

Today the `@`-picker calls `searchFiles` (`/api/projects/:id/search/files`) on every keystroke. Users who know the path of a file still have to wait on fuzzy search, can't navigate the tree, and the results ranking doesn't always surface the file they expect. Terminal users expect `/`-triggered directory drill-down.

## Scope

- UI-only change in `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx` and a small new helper module.
- No backend changes. Reuses `GET /api/projects/:id/tree` (`handleTree` in `packages/core/src/server/routes/files.ts:17`) and the existing mention-commit path.
- The `/tree` endpoint is left unchanged because `FilesTab.tsx` (the project file browser) also consumes it and needs to list every file.

## Behavior

### Mode selection

The picker's `@`-token (everything after the trailing `@`) decides the mode:

- Token contains **no `/`** → **fuzzy mode** (current behavior). Agents, skills, and files are fuzzy-matched as today.
- Token contains **at least one `/`** → **autocomplete mode**. Agents/skills are hidden; only files and directories under the typed path are shown.

Mode is re-evaluated on every keystroke. Deleting the last `/` reverts to fuzzy mode automatically (no directory-context switch — see "Back-navigation" below).

### Autocomplete mode

The token is split at the last `/` into `{dir, leaf}`:

| Token | dir | leaf |
|---|---|---|
| `src/` | `src` | `` |
| `src/co` | `src` | `co` |
| `src/components/But` | `src/components` | `But` |
| `/` | `.` | `` |
| `/src` | `.` | `src` |

The picker calls `getFileTree(projectId, dir)` (already implemented in `packages/desktop/src/renderer/lib/api/files-api.ts:4`) and client-side filters the returned entries by prefix-match on `leaf` (case-insensitive).

Results are rendered with directories first, alphabetically within each group. Directories show a trailing `/` in the UI.

### Keys

| Key | Behavior |
|---|---|
| `↑` / `↓` | Move selection. No composer change. |
| `Enter` on **directory** | Replace the token's leaf with `<dirName>/` in the composer. Picker stays open; tree re-fetches for the new directory. |
| `Enter` on **file** | Commit the file as a mention (existing `addMention` flow), replace the whole `@`-token with the final `@<relPath>` text. Close picker. |
| `Tab` on **directory** | Same as Enter on directory. |
| `Tab` on **file** | Complete the filename (fills the leaf with the full entry name). Picker stays open; user can press Enter to commit. |
| `Escape` | Close picker, leave typed text untouched. |

### Back-navigation

Backspace only deletes characters. Directory context only changes when the user types a new `/` or selects a directory. Example: `@src/co` backspace → `@src/c` (still in `src/`), further backspace to `@src/` stays in `src/`, next backspace to `@src` drops the `/` and reverts to fuzzy mode. This matches Q5/A from brainstorming — predictable, no surprise re-navigation.

### Starting point

- `@/` → tree at project root (`dir = '.'`), no prefix filter.
- `@` with no other text → fuzzy mode with an empty query (current behavior: lists agents).

### Absolute paths, `..`, `~`

- Absolute paths (`@/Users/...`) are treated as project-rooted. `resolveAndValidatePath` in `handleTree` already rejects anything outside the project root; the picker just lets the request fail and shows an empty result.
- `..` is allowed inside the token but stops at the project root (same guard). Users can type `@../` but it won't escape the project.
- `~` is not supported. Typing it yields no tree results — acceptable since this is a project-scoped picker.

### Hidden & binary files

The tree endpoint already skips `IGNORED_DIRS` (`.git`, `node_modules`, `.idea`, `.vscode`, the dirs added in this branch, etc.). Binary files (`.png`, `.pdf`, …) **are** returned by the endpoint and **are** shown in autocomplete mode (Q3/B). If a user wants to reference an image for whatever reason — do it. Fuzzy search keeps hiding binaries because that is a different UX (you are searching for a name, and binary extensions collide with common source names like `Icon.tsx` vs `Icon.png`).

## Architecture

Everything is client-side in `packages/desktop/src/renderer/components/chat/`.

### New helper: `parse-at-token.ts`

```ts
export interface AtToken {
  mode: 'fuzzy' | 'autocomplete';
  query: string;        // fuzzy-mode search query
  dir: string;          // autocomplete-mode directory (project-relative)
  leaf: string;         // autocomplete-mode prefix to match
  startOffset: number;  // offset of '@' in composer text
  endOffset: number;    // offset past the last char of the token
}

export function parseAtToken(text: string, caret: number): AtToken | null;
```

Pure function, unit-tested independently.

### Changes in `ContextPickerMenu.tsx`

1. Replace the existing `atMatch` regex with a call to `parseAtToken(text, caret)`.
2. Split the filter-mode state into three: `fuzzy-agents-files` (current), `autocomplete`, `skills` (unchanged `/`-trigger).
3. New `useEffect` for autocomplete: when `mode === 'autocomplete'` and `dir` changes, call `getFileTree(projectId, dir)`. Cache results in a `Map<string, TreeEntry[]>` keyed by `${projectId}:${dir}` for the lifetime of the component (tree calls are cheap, but re-fetching on every keystroke is still wasteful).
4. Build items: in autocomplete mode, the `items` array contains only `{type: 'file', ...}` and `{type: 'directory', ...}` from the filtered tree entries. Agents/skills/commands are skipped.
5. Extend `selectItem` to handle directory entries in autocomplete mode: instead of committing a mention, rewrite the composer text replacing `token.leaf` with `<entry.name>/`.
6. Add Tab handling: same branches as Enter but — for a file — only fills the leaf instead of committing.

### Data flow

```
user types @src/co
  → composer text changes
  → parseAtToken → {mode:'autocomplete', dir:'src', leaf:'co'}
  → useEffect fires getFileTree('src') [cache miss]
  → renders filtered entries (prefix 'co')
  → user presses ↓ Enter on 'components/' directory
  → selectItem rewrites text: @src/components/
  → parseAtToken → {mode:'autocomplete', dir:'src/components', leaf:''}
  → useEffect fires getFileTree('src/components')
  → renders entries
  → user types Bu → leaf 'Bu', filters client-side
  → user presses Enter on 'Button.tsx'
  → selectItem commits mention: addMention + replace token with @src/components/Button.tsx
  → picker closes
```

## Testing

### Unit (Vitest)

- `parseAtToken` — table-driven test covering: no `@`, `@` alone, `@foo`, `@src/`, `@src/co`, `@/`, `@/src`, `@../x`, `@` with trailing whitespace, caret inside vs after token.
- Client-side prefix filter — exact, case-insensitive, prefix-only (not substring).
- Tree cache — same dir in same component instance returns cached result (no second `getFileTree` call).

### Integration (React Testing Library)

- Type `@src/`, assert `getFileTree` called with `'src'` and entries render.
- Type `@src/comp`, assert filtered list shows `components/` (if fixture has it) and no others.
- Press Enter on a directory entry, assert composer text becomes `@<path>/` and `getFileTree` re-fires for new dir.
- Press Enter on a file entry, assert `addMention` called and composer text updated.
- Press Tab on a file entry, assert filename is completed but picker stays open and mention is NOT yet committed.
- Backspace through `/`, assert mode reverts to fuzzy on slash removal.

### Manual

1. `@ab` still returns fuzzy matches for both agents and files.
2. `@agentName` still selects an agent.
3. `@src/` opens tree autocomplete at `src/`, showing directories first.
4. `@src/comp<Tab>` fills `components` (if uniquely matching), cursor left at `components/` after user presses Enter on the dir.
5. `@nonexistent/` shows empty result, no crash.
6. `@../..` cannot escape project root (shows empty result beyond root).
7. Existing `/skill` trigger still works (`filterMode === 'skills'`).

## Non-goals

- No server-side change; no new endpoint.
- No change to `FilesTab` or `SearchPalette` (`⌘F`).
- No directory-as-mention feature. Selecting a directory only drills in; there is no way to commit a directory as a mention. If that's wanted later, it's a separate feature.
- No multi-segment Tab completion (no "complete up to the next `/`" — just complete the selected entry).
- No shell-style globbing (`@src/*.ts`).

## Risk

Low. Changes are scoped to the picker component and a pure helper module. Fuzzy-mode path is preserved unchanged, so the only regressions possible are in autocomplete mode itself (new code) — covered by the tests above. No backend, database, or cross-package API changes.
