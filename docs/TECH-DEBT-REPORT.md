# Mainframe Technical Debt Report

**Date:** 2026-02-15 (updated after async routes & cleanup)
**Codebase:** ~22,008 lines across 218 TypeScript/TSX files (178 source + 40 test)

## Executive Summary

| Metric | Before Cleanup | Current | Rating |
|--------|---------------|---------|--------|
| **God Classes** | 3 critical (1,053 / 974 / 662 lines) | 0 — largest is 307 lines | Resolved |
| **Security Vulnerabilities (code)** | 4 (injection + traversal) | 0 (path validation added to skill/agent names) | Resolved |
| **Security Vulnerabilities (deps)** | 3 HIGH (`tar`) | 0 (`pnpm.overrides` for tar ≥ 7.5.7) | Resolved |
| **Test Coverage (est.)** | Core ~30%, Desktop 0% | Core ~55%, Desktop store tests (165) | Improved |
| **Files > 300 lines** | 10+ production | 4 (339, 313, 307, 301) | Acceptable |
| **Silent `.catch(() => {})`** | 37 | 1 (acceptable fire-and-forget) | Resolved |
| **Bare `catch {}` in routes** | ~15 without logging | 0 (17 catch blocks now have `logger.warn`) | Resolved |
| **Linting** | None | ESLint + Prettier across all packages | Resolved |
| **Pre-commit hooks** | None | Husky + lint-staged | Resolved |
| **Outdated Major Deps** | 18 packages | 0 packages | Resolved |
| **Unused Dependencies** | 5 packages | 0 (4 Radix + postcss removed) | Resolved |
| **Dead Code** | 1 dead file + unused exports | 0 (api.ts deleted, exports cleaned) | Resolved |
| **Architecture Violations** | 1 (desktop→core source alias) | 0 (proper workspace dep + published export) | Resolved |
| **Type Inconsistencies** | PermissionMode duplicated in 4 files | 0 (consolidated to single canonical type) | Resolved |
| **CI/CD** | None | GitHub Actions (build + test + audit) | Resolved |
| **Input Validation** | None | Zod schemas on all API endpoints | Resolved |
| **Structured Logging** | console.log/error | pino with child loggers | Resolved |
| **Sync I/O in Routes** | 4 route files blocking event loop | 0 (all converted to async) | Resolved |
| **Orphaned Chats on Project Delete** | No cascade delete | 0 (`removeWithChats` transaction) | Resolved |
| **Monaco Eagerly Loaded** | ~15MB parsed at startup | 0 (React.lazy code-split) | Resolved |
| **`noUncheckedIndexedAccess`** | Not enabled | Enabled with all type errors fixed | Resolved |

**Overall: Low** — All critical, high-priority, and medium-priority items resolved across 10 PRs. Remaining: test coverage gaps, large React components, E2E tests.

---

## Completed Remediation History

### PR 1: Initial Cleanup (`dchiulan/cleanup`)

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Command injection via `execSync` with template strings | Replaced with `execFileSync('git', [...args])` — safe array args |
| 2 | Path traversal via symlinks | Added `realpathSync()` before all prefix checks |
| 3 | Shell injection in worktree operations | Converted to `execFileSync` with array args |
| 4 | `chat-manager.ts` (1,053 lines) god object | Decomposed into 7 modules under `chat/` |
| 5 | `claude.ts` (974 lines) monolithic adapter | Split into 5 modules under `adapters/` |
| 6 | `http.ts` (662 lines) oversized route file | Split into 10 route modules under `server/routes/` |
| 7 | No CI/CD | Added GitHub Actions (build, test, audit) |
| 8 | No React ErrorBoundary | Added at App root |
| 9 | `@ts-ignore` usage | Converted to `@ts-expect-error` with reasons |
| 10 | Debug `console.error` in production paths | Removed |
| 11 | Empty catch blocks undocumented | All catch blocks now have comments |

### PR 2: Quality Gates (`dchiulan/quality-gates`)

| # | Issue | Resolution |
|---|-------|------------|
| 1 | No input validation on API endpoints | Zod schemas for all route handlers + WebSocket messages |
| 2 | No structured logging | pino with child loggers across core package |
| 3 | ESLint only in desktop | ESLint + Prettier configured across all 3 packages |
| 4 | No pre-commit hooks | Husky + lint-staged (ESLint + Prettier on staged files) |
| 5 | Collapsible tool card duplication (8 components) | Extracted `CollapsibleToolCard` shared component |
| 6 | `realpathSync` + prefix check duplication | Extracted `validatePath()` helper |
| 7 | `JSON.parse` with fallback duplication | Extracted `parseJsonColumn()` helper |
| 8 | No vitest coverage config | Added `vitest.config.ts` with coverage thresholds |

### PR 3: Tailwind 4 (`dchiulan/tailwind-4`)

| # | Issue | Resolution |
|---|-------|------------|
| 1 | tailwindcss 3.x → 4.x | Migrated config to CSS `@theme` directives, added `@tailwindcss/vite` plugin |

### PR 4: React 19 + Zustand 5 (`dchiulan/react-19`)

| # | Issue | Resolution |
|---|-------|------------|
| 1 | react 18.x → 19.x | Upgraded, removed `forwardRef` from UI components |
| 2 | zustand 4.x → 5.x | Upgraded (backward compatible `create()` API) |

### PR 5: Architecture (`dchiulan/architecture`)

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Message grouping/parsing in desktop | Moved to `@mainframe/core/messages` (pure functions, no React deps) |
| 2 | Status derivation in desktop | Added `displayStatus` and `isRunning` computed fields to Chat type |
| 3 | Tool result metadata not pre-computed | Core populates `structuredPatch`, `originalFile`, `modifiedFile` |
| 4 | Command/mention XML parsing in desktop | Moved pure functions to `@mainframe/core` |
| 5 | `@types/diff` redundant | Removed (diff@8 ships own types) |
| 6 | vitest 1.x → 4.x | Upgraded |
| 7 | better-sqlite3 9.x → 12.x | Upgraded for Node 25 support |
| 8 | express 4.x → 5.x | Upgraded (resolves `qs` vulnerability) |
| 9 | electron-builder 24.x → 26.x | Upgraded (resolves 3 HIGH `tar` vulns) |
| 10 | WebSocket listener leak | Added `close()` method to `WebSocketManager` |
| 11 | Sync I/O in `attachment-store.ts` | Converted to `node:fs/promises` async equivalents |
| 12 | Route handler tests missing | Added comprehensive tests for all 10 route files |
| 13 | DB layer tests missing | Added tests for database layer |
| 14 | Desktop store tests missing | Added Zustand store tests (165 tests) |
| 15 | `convert-message.ts` untested | Added unit tests (moved to core with tests) |

### PR 6: ChatManager Decomposition (`dchiulan/final-cleanup`)

| # | Issue | Resolution |
|---|-------|------------|
| 1 | `chat-manager.ts` still 583 lines | Extracted 3 handler classes: `ChatPermissionHandler` (121 lines), `ChatConfigManager` (136 lines), `ChatLifecycleManager` (287 lines). ChatManager reduced to 307 lines. |
| 2 | 3 silent `.catch(() => {})` in desktop | Added `console.warn` with contextual tags to `SyntaxHighlightedCode`, `AtMentionMenu`, `StatusBar` |

### PR 7: Dependency Upgrades (`dchiulan/dep-upgrades`)

| # | Issue | Resolution |
|---|-------|------------|
| 1 | vite 5.x → 7.x | Upgraded (electron-vite 5 supports vite ^5 \|\| ^6 \|\| ^7) |
| 2 | electron 33.x → 40.x | Upgraded (no breaking changes for our codebase) |

### PR 8: Tech Debt Remediation (`dchiulan/tech-debt-remediation`)

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Skills/agents name path traversal | Added `^[a-zA-Z0-9_-]+$` regex to Zod schemas + tests |
| 2 | 5 unused dependencies | Removed 4 Radix UI packages + postcss |
| 3 | Dead code (`api.ts`, unused exports) | Deleted `types/src/api.ts`, removed `isGitRepo` and `escapeXmlAttr` re-exports |
| 4 | `tar` dependency vulnerability (3 HIGH) | Added `pnpm.overrides` for `tar >= 7.5.7` |
| 5 | `tsconfig.web.json` inconsistency | Added `module: ESNext` for bundler resolution |
| 6 | `PermissionMode` type duplication | Consolidated to canonical type from `settings.ts` across events/adapter/base |
| 7 | Desktop→core source alias violation | Declared `@mainframe/core` as workspace dep, removed raw source alias |
| 8 | `handleEvent()` 142-line switch | Decomposed into 5 per-type handler functions |
| 9 | `convertHistoryEntry()` 101 lines | Split into `convertUserEntry()` + `convertAssistantEntry()` |
| 10 | `ChatsRepository.update()` 13 sequential ifs | Replaced with data-driven column map loop |
| 11 | Inline route handlers in `files.ts`/`git.ts` | Extracted 7 named handler functions |
| 12 | `react-resizable-panels` 1.x → 4.x | Upgraded with full v4 API migration |
| 13 | 17 bare `catch {}` in server routes | Added `logger.warn` with context to all |
| 14 | `@vitejs/plugin-react` 4.x → 5.x | Upgraded |

### PR 9: Async Routes & Cleanup (`dchiulan/async-routes`)

| # | Issue | Resolution |
|---|-------|------------|
| 1 | Sync I/O in `files.ts` (readdirSync, statSync, readFileSync) | Converted to `readdir`/`stat`/`readFile` from `node:fs/promises`, async `walk()` |
| 2 | Sync I/O in `git.ts` (execFileSync for all git ops) | Created async `execGit` helper using promisified `execFile`, converted all handlers |
| 3 | Sync I/O in `context.ts` (readFileSync) | Converted session-file handler to async `readFile` |
| 4 | Sync I/O in `settings.ts` (readFileSync) | Converted config-conflicts handler to async `readFile` |
| 5 | Orphaned chats on project deletion | Added `removeWithChats()` with transaction to delete chats before project |
| 6 | Monaco editor eagerly loaded (~15MB at startup) | Wrapped `EditorTab`, `DiffTab`, `SkillEditorTab` in `React.lazy()` with `Suspense` |
| 7 | `noUncheckedIndexedAccess` not enabled | Enabled in `tsconfig.base.json`, fixed all resulting type errors with proper guards |

---

## Current Dependency Versions

| Package | Version | Status |
|---------|---------|--------|
| electron | 40.x | Current |
| electron-builder | 26.x | Current |
| vite | 7.x | Current |
| better-sqlite3 | 12.x | Current |
| vitest | 4.x | Current |
| react | 19.x | Current |
| tailwindcss | 4.x | Current |
| zustand | 5.x | Current |
| express | 5.x | Current |
| react-resizable-panels | 4.x | Current |
| @vitejs/plugin-react | 5.x | Current |
| pino | latest | Current |
| zod | latest | Current |

---

## Remaining Items

### 1. Desktop React Component Tests

Store tests (165) and core tests (332) provide good coverage. Desktop React component tests with `@testing-library/react` require jsdom DOM mocking for Electron which is fragile.

**Recommendation:** Implement E2E tests with Playwright as a separate initiative. This provides more reliable coverage for Electron apps than unit-testing React components with jsdom.

### 2. Test Coverage Gaps

| Module | Coverage | Priority |
|--------|----------|----------|
| `src/attachment/` | 0% | High |
| `src/workspace/` | 0% | Medium |
| `src/adapters/` | ~28% | Medium |

### 3. Large React Components (93 function-size violations)

SearchPalette (229 lines), MainframeRuntimeProvider (223), AtMentionMenu (173), ChangesTab (173), AskUserQuestionCard (164), ComposerCard (161), PlanApprovalCard (157), MonacoEditor (148). These are UI components where extraction is lower-priority than core logic.

### 4. `chat-manager.ts` at 307 lines

Slightly above the 300-line guideline but acceptable — it's now a thin coordinator that delegates to 4 handler classes. The remaining methods (`sendMessage`, `getMessages`, accessor methods, `emitEvent`) belong together as they share the same state (activeChats, processToChat).

---

## Prevention Strategy

### Active Quality Gates

```yaml
pre_commit:
  - husky + lint-staged
  - eslint --fix on staged .ts/.tsx files
  - prettier --write on staged files

ci_pipeline:
  - pnpm build (all 3 packages)
  - pnpm test (vitest with coverage)
  - pnpm audit (dependency vulnerability scan)

code_standards:
  - No files > 300 lines (warn), > 500 lines (block)
  - No functions > 50 lines
  - Tests for new public methods
  - No empty catch blocks without logging
  - Zod validation on all API endpoints
```

### Debt Budget

- **New code** must include tests (enforced via coverage thresholds in vitest.config.ts)
- **Quarterly review** of file sizes and dependency versions
- **Automated dependency updates** via `pnpm audit` in CI
