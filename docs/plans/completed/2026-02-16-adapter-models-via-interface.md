# Adapter-Provided Model Availability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Expose available models via the Adapter interface and drive desktop model selectors from `/api/adapters`.

**Architecture:** Add model metadata types to `@mainframe/types`, extend adapter contract with `listModels()`, implement it in `ClaudeAdapter`, and include models in `AdapterRegistry.list()`. On desktop, load adapters from API into store state and replace hardcoded model-source usage in settings/composer and model helpers.

**Tech Stack:** TypeScript (strict), Node.js/Express, React, Zustand, Vitest

---

### Task 1: Extend shared adapter contract and adapter metadata types

**Files:**
- Modify: `packages/types/src/adapter.ts`

**Step 1: Write failing expectation in core route test**

- Update `packages/core/src/__tests__/routes/adapters.test.ts` expected payloads to include `models`.

**Step 2: Run single test to verify failure**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/routes/adapters.test.ts`
Expected: FAIL due missing `models` typing/shape.

**Step 3: Add shared types and interface method**

- Add `AdapterModel` type in `packages/types/src/adapter.ts`
- Extend `AdapterInfo` with `models: AdapterModel[]`
- Add `listModels(): Promise<AdapterModel[]>` to `Adapter`

**Step 4: Run core adapters route test**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/routes/adapters.test.ts`
Expected: still failing until core implementation is updated (next task).

### Task 2: Implement adapter model listing in core and expose via `/api/adapters`

**Files:**
- Modify: `packages/core/src/adapters/base.ts`
- Modify: `packages/core/src/adapters/claude.ts`
- Modify: `packages/core/src/adapters/index.ts`
- Modify: `packages/core/src/__tests__/routes/adapters.test.ts`

**Step 1: Write/adjust failing route assertions**

- Ensure test expects each adapter item to include `models`.

**Step 2: Implement minimal core changes**

- `BaseAdapter`: implement default `listModels()` returning `[]`.
- `ClaudeAdapter`: return current static Claude model list via `listModels()`.
- `AdapterRegistry.list()`: await `adapter.listModels()` and include it in `AdapterInfo`.

**Step 3: Run core adapters test**

Run: `pnpm --filter @mainframe/core exec vitest run src/__tests__/routes/adapters.test.ts`
Expected: PASS.

### Task 3: Add desktop adapters API client and store

**Files:**
- Modify: `packages/desktop/src/renderer/lib/api/projects-api.ts`
- Modify: `packages/desktop/src/renderer/store/settings.ts` (or create dedicated adapters store)
- Modify: `packages/desktop/src/renderer/hooks/useDaemon.ts`

**Step 1: Add/confirm API type plumbing for adapters with models**

- Ensure `getAdapters()` returns `AdapterInfo[]` including models.

**Step 2: Add store state for adapter metadata**

- Add adapter list state and a setter in desktop store.

**Step 3: Load adapters during daemon boot**

- In `useDaemon`, fetch adapters and store them.
- Handle failure with non-fatal warning/log.

**Step 4: Run targeted desktop test(s)**

Run: `pnpm --filter @mainframe/desktop exec vitest run src/renderer/lib/adapters.test.ts`
Expected: FAIL until utility refactor in next task.

### Task 4: Refactor desktop adapter/model utilities to use API metadata

**Files:**
- Modify: `packages/desktop/src/renderer/lib/adapters.ts`
- Modify: `packages/desktop/src/renderer/lib/adapters.test.ts`

**Step 1: Replace hardcoded `ADAPTER_MODELS` as primary model source**

- Keep optional fallback label map only.
- Add helpers that accept adapter metadata input and compute:
  - adapter options
  - model options per adapter
  - label/context-window lookup

**Step 2: Update tests to new helper API**

- Verify known model labels/context windows from supplied metadata.
- Verify fallback behavior for unknown model ids.

**Step 3: Run utility test**

Run: `pnpm --filter @mainframe/desktop exec vitest run src/renderer/lib/adapters.test.ts`
Expected: PASS.

### Task 5: Switch settings and composer UI to adapter store metadata

**Files:**
- Modify: `packages/desktop/src/renderer/components/SettingsModal.tsx`
- Modify: `packages/desktop/src/renderer/components/settings/ProviderSection.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/assistant-ui/composer/ComposerCard.tsx`
- Modify: `packages/desktop/src/renderer/components/chat/ChatSessionBar.tsx`

**Step 1: Update UI reads**

- Adapter dropdowns use store-provided adapters list.
- Model dropdowns use store-provided model options per adapter.
- Model label/context window display uses metadata-aware helper.

**Step 2: Preserve safe defaults**

- If adapter or model list missing, do not crash; default to existing behavior.

**Step 3: Run targeted desktop tests**

Run: `pnpm --filter @mainframe/desktop exec vitest run src/__tests__/stores/chats.test.ts src/renderer/lib/adapters.test.ts`
Expected: PASS.

### Task 6: Verify types and package builds

**Files:**
- Modify: any files required by TypeScript errors

**Step 1: Run typecheck/builds**

Run: `pnpm build`
Expected: PASS for all workspaces.

**Step 2: Run focused tests touched by change**

Run: 
- `pnpm --filter @mainframe/core exec vitest run src/__tests__/routes/adapters.test.ts`
- `pnpm --filter @mainframe/desktop exec vitest run src/renderer/lib/adapters.test.ts`

Expected: PASS.
