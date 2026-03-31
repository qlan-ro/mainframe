# Code Analysis Report (Codex)

**Generated:** 2026-03-30  
**Method:** `code-analysis-openai` skill + command-backed verification

## Executive Summary

- `pnpm lint`: **fails** (mostly generated artifacts)
- `pnpm build`: **passes** (workspace compiles)
- Desktop lint totals: **987 errors / 209 warnings**
- Desktop source-only lint (`packages/desktop/src`): **0 errors / 13 warnings**
- Core source-only lint (excluding tests): **0 errors / 39 warnings**

## Top Priorities

1. **[critical]** `packages/desktop/playwright/.cache/**` and `packages/desktop/resources/daemon.cjs` dominate lint failures and mask source quality.
2. **[critical]** `packages/core/src/server/routes/path-utils.ts:1,7,8` and `packages/core/src/workspace/worktree.ts:1,59,78,109,121` use sync I/O/exec in server paths.
3. **[critical]** Mobile a11y coverage is effectively zero: 139 interactive refs, 0 `accessibility*` refs across `packages/mobile/components` + `packages/mobile/app`.
4. **[critical]** `packages/mobile/package.json:12` uses `@qlan-ro/mainframe-types` as `^0.2.0` instead of `workspace:*`.
5. **[critical]** `packages/mobile/store/chats.ts:8` uses single `ControlRequest` per chat; `packages/mobile/lib/event-router.ts:42` assumes one pending request.
6. **[high]** `packages/desktop/src/renderer/components/SettingsModal.tsx:88` modal lacks `role="dialog"`, `aria-modal`, and accessible naming.
7. **[high]** `packages/core/tsconfig.json:5` disables `noUncheckedIndexedAccess` in core.
8. **[high]** Silent catches in active code paths: `chat-manager.ts:275`, `adapter.ts:86`, `lsp/index.ts:16`, `useContextPicker.ts:50-52`.
9. **[high]** `packages/core/src/chat/event-handler.ts:96,104,115,133,154` uses `any` in high-traffic event pipeline callbacks.
10. **[medium]** `text-mf-text-tertiary` class used (e.g. `RemoteAccessSection.tsx:91`) but no mapped `--color-mf-text-tertiary` in theme config (`index.css`).
11. **[medium]** Multiple files exceed 300-line rule (e.g. `PreviewTab.tsx`, `history.ts`, `RemoteAccessSection.tsx`, `chat-manager.ts`, `ChatsPanel.tsx`).
12. **[medium]** Rerender-prone selectors/store access patterns in desktop chat runtime and hooks.

## Detailed Findings

### 1) Lint Gate Is Dominated by Generated Files

- **Critical** — `packages/desktop/playwright/.cache/assets/index-DIPag1YP.js`: `685e 22w`
- **Critical** — `packages/desktop/resources/daemon.cjs`: `280e 143w`
- **Critical** — Remaining generated cache files add additional errors.

**Impact:** `pnpm lint` fails despite clean-ish source lint, reducing signal quality for real regressions.

**Fix direction:** Exclude generated artifacts from lint scope (at minimum `.cache`, bundled daemon output).

### 2) Sync I/O and Sync Process Calls in Core

- **Critical** — `packages/core/src/server/routes/path-utils.ts:1,7,8,21,22` uses `realpathSync` in path validation.
- **Critical** — `packages/core/src/workspace/worktree.ts:59,78,109,117,121` uses `execFileSync` in git worktree operations.
- **High** — Additional sync usage in core startup/helpers:
  - `packages/core/src/index.ts:5,27` (`execFileSync` in PATH enrichment)
  - `packages/core/src/plugins/manager.ts:1,127,128,139,141` (`readdirSync`/`existsSync`/`readFileSync`)
  - `packages/core/src/plugins/builtin/claude/session.ts:127,322,324,335,338` (`accessSync`/`existsSync`/`readFileSync`)

**Impact:** Potential event-loop blocking under load and slower route responsiveness.

**Fix direction:** Move hot-path operations to async APIs and helper wrappers (`fs/promises`, async exec).

### 3) Mobile Accessibility Gaps

- **Critical** — Scan results:
  - interactive refs (`Pressable`/`TouchableOpacity`/`TextInput`/`Switch`): **139**
  - accessibility refs (`accessibilityLabel|accessibilityRole|accessibilityHint`): **0**

Representative files:
- `packages/mobile/app/welcome.tsx`
- `packages/mobile/components/chat/Composer.tsx`
- `packages/mobile/components/sandbox/SandboxHeader.tsx`
- `packages/mobile/components/chat/PermissionCard.tsx`

**Impact:** Poor screen reader usability and accessibility compliance risk.

**Fix direction:** Add semantic roles/labels/hints for all interactive controls; prioritize chat + navigation + sandbox controls first.

### 4) Monorepo Dependency Consistency

- **Critical** — `packages/mobile/package.json:12`:
  - `"@qlan-ro/mainframe-types": "^0.2.0"`

**Impact:** Type drift risk between mobile and workspace packages.

**Fix direction:** Switch to `workspace:*` for shared internal packages.

### 5) Permission Queue Shape Mismatch (Mobile)

- **Critical** — `packages/mobile/store/chats.ts:8`:
  - `pendingPermissions: Map<string, ControlRequest>`
- **Critical** — `packages/mobile/lib/event-router.ts:42` resolves only one request id per chat.

**Impact:** Concurrent permission requests can overwrite/drop state.

**Fix direction:** Align with queue/list model (`Map<string, ControlRequest[]>`) and process FIFO on resolve.

### 6) UI Semantics: Settings Modal

- **High** — `packages/desktop/src/renderer/components/SettingsModal.tsx:88-94` renders modal container without dialog a11y attributes.

**Impact:** Reduced keyboard/screen-reader semantics for a core settings workflow.

**Fix direction:** Add `role="dialog"`, `aria-modal="true"`, and label association.

### 7) Type Safety and Catch Blocks

- **High** — `packages/core/tsconfig.json:5` overrides strict indexed access.
- **High** — `packages/core/src/chat/event-handler.ts:96,104,115,133,154` uses `any` in session sink handlers.
- **High** — `packages/core/src/git/git-service.ts:170,200,221,235,291,325` uses `catch (err: any)`.

**Impact:** Lower type guarantees in core pathways.

**Fix direction:** restore stricter compiler option and migrate to `unknown` + narrowing.

### 8) Silent Error Swallowing

- **High** — `packages/core/src/chat/chat-manager.ts:275` (`.catch(() => {})`)
- **High** — `packages/core/src/plugins/builtin/claude/adapter.ts:86` (`.catch(() => {})`)
- **High** — `packages/desktop/src/renderer/lib/lsp/index.ts:16` (`.catch(() => {})`)
- **High** — `packages/mobile/hooks/useContextPicker.ts:50-52` (`.catch(() => {})`)

**Impact:** Operational failures can be invisible.

**Fix direction:** Log with contextual metadata in all catch paths.

### 9) Tailwind/Theme Token Inconsistency

- **Medium** — class usages like `text-mf-text-tertiary` (e.g. `packages/desktop/src/renderer/components/settings/RemoteAccessSection.tsx:91`) exist.
- **Medium** — no mapped `--color-mf-text-tertiary` in `packages/desktop/src/renderer/index.css` theme block.

**Impact:** Potential inconsistent styling and token drift.

**Fix direction:** define and map a tertiary text token or remove the class usages.

### 10) File Size and Render Performance Debt

- **Medium** — Files over 300 lines include:
  - `packages/desktop/src/renderer/components/sandbox/PreviewTab.tsx` (592)
  - `packages/core/src/plugins/builtin/claude/history.ts` (495)
  - `packages/desktop/src/renderer/components/settings/RemoteAccessSection.tsx` (452)
  - `packages/core/src/chat/chat-manager.ts` (447)
  - `packages/desktop/src/renderer/components/panels/ChatsPanel.tsx` (434)
- **Medium** — Selector patterns likely to trigger unnecessary rerenders:
  - `packages/desktop/src/renderer/hooks/useChatSession.ts:11`
  - `packages/desktop/src/renderer/components/chat/assistant-ui/MainframeRuntimeProvider.tsx:242,250`
  - `packages/desktop/src/renderer/components/chat/ContextPickerMenu.tsx:69`

**Impact:** Maintainability and UI responsiveness risk.

**Fix direction:** extract large components and tighten selectors (`useShallow`/stable selectors).

## Verification Artifacts

Commands run:
- `pnpm lint`
- `pnpm build`
- `pnpm --filter @qlan-ro/mainframe-desktop exec eslint . -f json`
- `pnpm --filter @qlan-ro/mainframe-desktop exec eslint src -f json`
- `pnpm --filter @qlan-ro/mainframe-core exec eslint src --ignore-pattern "src/**/__tests__/**" --ignore-pattern "src/**/*.test.ts" -f json`
- targeted `rg` scans for sync I/O, silent catch, TODO/FIXME/HACK, a11y, and `any` usage

