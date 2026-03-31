# Fast Search: Ripgrep Backend & Binary Exclusion

> **Task:** #41 — Find in Path is really slow on big projects
> **Scope:** Content search (Find in Path), file name search (Command Palette, @ Popover)

## Problem

Content search (Find in Path) reads every file sequentially in pure JS — slow on large projects. File name search (Command Palette, @ Popover) returns build artifacts and binaries that clutter results.

## Design

### 1. Dependency: `@vscode/ripgrep`

Add `@vscode/ripgrep` to `@qlan-ro/mainframe-core`. This npm package ships a pre-built `rg` binary per platform (macOS, Linux, Windows) — no user install required. It exports `rgPath` (absolute path to the binary).

**Bundling** (follows the established native/platform binary pattern):

1. `pnpm --filter @qlan-ro/mainframe-core add @vscode/ripgrep`
2. Add `@vscode/ripgrep` to `pnpm.onlyBuiltDependencies` in root `package.json`
3. Add `'@vscode/ripgrep'` to `external` array in `packages/desktop/scripts/bundle-daemon.mjs`
4. Add `extraResources` entry in `packages/desktop/package.json`:
   ```json
   { "from": "../../node_modules/@vscode/ripgrep", "to": "node_modules/@vscode/ripgrep", "filter": ["**/*", "!**/*.md"] }
   ```

### 2. Content Search — Ripgrep Backend

**New module:** `packages/core/src/server/ripgrep.ts`

Exports a function that spawns `rg` and parses structured output:

```ts
interface RipgrepOptions {
  maxResults?: number;       // default 200
  maxFileSize?: string;      // default '1M'
  includeIgnored?: boolean;  // maps to --no-ignore
}

function searchWithRipgrep(
  scopePath: string,
  query: string,
  opts?: RipgrepOptions,
): Promise<SearchContentResult[]>
```

**`rg` invocation flags:**

| Flag | Purpose |
|------|---------|
| `--json` | Structured JSON-lines output (file, line, column, text) |
| `--ignore-case` | Matches current case-insensitive behavior |
| `--max-filesize 1M` | Matches current 1MB file size limit |
| `--no-require-git` | Works in non-git projects |
| `--max-count <n>` | Caps matches per file to avoid one huge file dominating |

Ripgrep's built-in filtering handles binary exclusion (null-byte detection), hidden files/dirs, and `.gitignore` rules — no explicit `--glob` patterns needed for binary extensions.

When `includeIgnored` is true, add `--no-ignore` and `--hidden` (skips `.gitignore` rules and includes hidden files).

**JSON output parsing:** Each `rg --json` line is a JSON object. Match lines have `type: "match"` with `data.path.text`, `data.line_number`, `data.submatches[0].start`, and `data.lines.text`. Parse these into `SearchContentResult[]`.

**Changes to `search.ts`:** `handleContentSearch` calls `searchWithRipgrep` instead of the manual file-list-then-scan loop. The existing JS implementation stays as a fallback — if `rg` fails to spawn (missing binary, permission error), log a warning and fall back to the JS path.

### 3. File Name Search — `rg --files`

**Changes to `files.ts` (`handleSearchFiles`):** Use `rg --files` to get the file list instead of the recursive `readdir` walk. This gives the Command Palette and @ Popover the same filtering as ripgrep content search — `.gitignore` rules, hidden files, and binaries are all excluded automatically. The existing walk stays as a fallback when ripgrep is unavailable.

The ripgrep module exports `listFilesWithRipgrep(dirPath, opts?)` which returns `string[] | null` — `null` signals ripgrep is unavailable and the caller should fall back. The substring + fuzzy matching logic stays in JS, operating on the file list from ripgrep.

### 4. Extended Ignore Lists

**`IGNORED_DIRS`** — add these common build/dependency directories:

```
.gradle, .cargo, target, .parcel-cache, .nuxt, .output, bower_components
```

Full list after merge:
```
.git, node_modules, .next, dist, build, out, .cache, __pycache__, .venv,
vendor, coverage, .turbo, .gradle, .cargo, target, .parcel-cache, .nuxt,
.output, bower_components
```

`BINARY_EXTENSIONS` remains unchanged in `fs-utils.ts` — used only by the JS fallback paths. When ripgrep is available, it handles binary detection internally for both content search and file listing.

### 5. Error Handling

| Scenario | Behavior |
|----------|----------|
| `rg` fails to spawn | Log warning, fall back to JS search |
| `rg` process stderr | Logged at debug level (file-access warnings) |
| `rg` exceeds 30s timeout | Kill process, return partial results collected so far |
| `rg` returns no results | Return empty array (not an error) |

### 6. Testing

- **`ripgrep.ts` unit tests** — mock `execFile`, verify argument construction and JSON-line parsing
- **Content search integration tests** — verify the ripgrep path returns correct `SearchContentResult[]`
- **JS fallback test** — simulate `rg` spawn failure, verify fallback produces results
- **File name search test** — verify binary extensions are excluded from `handleSearchFiles` results

## Files Changed

| File | Change |
|------|--------|
| `packages/core/package.json` | Add `@vscode/ripgrep` dependency |
| `package.json` (root) | Add to `pnpm.onlyBuiltDependencies` |
| `packages/desktop/scripts/bundle-daemon.mjs` | Add to `external` |
| `packages/desktop/package.json` | Add `extraResources` entry |
| `packages/core/src/server/ripgrep.ts` | **New** — ripgrep wrapper |
| `packages/core/src/server/routes/search.ts` | Use ripgrep, JS fallback |
| `packages/core/src/server/routes/files.ts` | Use `rg --files` with walk fallback |
| `packages/core/src/server/fs-utils.ts` | Extend `IGNORED_DIRS` |
| `packages/core/src/__tests__/ripgrep.test.ts` | **New** — ripgrep tests |
| `packages/core/src/__tests__/search.test.ts` | Update for ripgrep path |
| `docs/DEVELOPER-GUIDE.md` | Already updated with bundling guide |
