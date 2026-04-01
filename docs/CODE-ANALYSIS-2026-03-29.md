# Code Analysis Delta Report

**Generated:** 2026-03-29  
**Baseline compared:** `docs/CODE-ANALYSIS.md` (generated 2026-03-27)

## What I ran

- `pnpm lint`
- `pnpm build`
- Package-level ESLint JSON summaries for `packages/desktop`, `packages/core`, `packages/types`

## Current snapshot (2026-03-29)

### 1) Lint status

- `pnpm lint` fails.
- Total ESLint issues from desktop package: **1516 errors, 333 warnings**.
- Errors are concentrated in generated files:
  - `packages/desktop/resources/daemon.cjs`: **809 errors, 267 warnings**
  - `packages/desktop/playwright/.cache/assets/index-DIPag1YP.js`: **685 errors, 22 warnings**
  - Remaining source files: warnings only in a small set of TS/TSX files.

### 2) Core and types lint status

- `packages/core`: **0 errors, 486 warnings** (mostly test `any`/unused warnings)
- `packages/types`: **0 errors, 0 warnings**

### 3) Build/typecheck status

- `pnpm build` passes for all workspace packages (`types`, `core`, `desktop`).
- This indicates TypeScript compilation currently succeeds across the workspace.

## Differences from baseline report

`docs/CODE-ANALYSIS.md` (2026-03-27) focuses on structural and architectural issues (sync I/O, oversized files, accessibility, state management, type safety). Those findings may still be valid, but today’s command-based analysis surfaces a different immediate picture:

- **New/operationally dominant finding:** lint failure is currently dominated by **generated artifacts** (`resources/daemon.cjs`, `playwright/.cache/**`) being linted.
- **Type safety gate differs from lint gate:** despite lint failure, **build/typecheck is green** right now.
- **CI risk profile is different:** the fastest path to green lint appears to be lint scoping/ignore adjustments for generated files, before tackling deeper architecture debt.

## Suggested follow-up checks

1. Confirm whether `packages/desktop/resources/daemon.cjs` and `packages/desktop/playwright/.cache/**` should be excluded in ESLint config.
2. Re-run `pnpm lint` after exclude updates to expose true source-level lint errors.
3. Reconcile remaining source warnings against high-priority items in `docs/CODE-ANALYSIS.md`.
