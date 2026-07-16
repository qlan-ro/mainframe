# Draft Composer Default Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Initialize each new-session draft with a stable, explicit snapshot of every visible provider and model default before enabling its composer.

**Architecture:** Add a pure resolver for daemon-equivalent draft defaults and an async initializer that fetches provider settings, resolves one complete `DraftCfg`, and stores it. Route both new-session entry paths and draft adapter changes through that initializer. Keep first send deterministic by sending and applying the stored snapshot only.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Testing Library, pnpm workspaces

## Global Constraints

- Keep daemon chat creation lazy until first send.
- Snapshot defaults once per draft; later provider-setting changes cannot mutate it.
- Switching the adapter in an empty draft snapshots the new adapter's defaults once.
- Do not render an interactive composer from guessed defaults.
- Preserve existing user changes in the dirty worktree and stage only files from this plan.
- Add no comments unless they explain a non-obvious constraint.

---

### Task 1: Pure default snapshot resolver

**Files:**
- Create: `packages/ui/src/features/sessions/new-thread/resolve-draft-defaults.ts`
- Create: `packages/ui/src/features/sessions/new-thread/__tests__/resolve-draft-defaults.test.ts`
- Modify: `packages/ui/src/features/sessions/runtime/draft-config.ts`

**Interfaces:**
- Consumes: `AdapterInfo`, `ProviderConfig`, `DraftCfg`, `clampEffortToSupported`, and `TUNABLE_FEATURES` from shared types.
- Produces: `resolveDraftDefaults(projectId: string, adapter: AdapterInfo, provider?: ProviderConfig): DraftCfg`.

- [ ] **Step 1: Write failing resolver tests**

Cover these exact outcomes:

```ts
expect(resolveDraftDefaults('p1', adapter, {
  defaultModel: 'opus',
  defaultMode: 'yolo',
  defaultPlanMode: 'true',
  defaultEffort: 'high',
  defaultFast: 'true',
  defaultUltracode: 'false',
  defaultAdaptiveThinking: 'true',
})).toEqual({
  projectId: 'p1', adapterId: 'claude', model: 'opus',
  permissionMode: 'yolo', planMode: true, effort: 'high',
  fast: true, ultracode: false, adaptiveThinking: true,
});
```

Also test stale configured model fallback, catalog default fallback, first-model fallback, absent provider defaults, unsupported-feature clamping, effort clamping, and ultracode forcing `xhigh`.

- [ ] **Step 2: Run the resolver test and verify RED**

Run:

```bash
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/new-thread/__tests__/resolve-draft-defaults.test.ts
```

Expected: FAIL because `resolve-draft-defaults.ts` does not exist.

- [ ] **Step 3: Implement the resolver**

Implement one pure function. Resolve the model first, then use the shared effort clamp and feature metadata. Return explicit values for all fields. Throw `Error('Cannot initialize draft: adapter has no models')` when the catalog is empty.

- [ ] **Step 4: Clarify the draft contract**

Update `DraftCfg` documentation so model, permission, plan, effort, and features are explicit after initialization. Keep fields optional because partial patches and legacy/retry state still use the type.

- [ ] **Step 5: Run the resolver test and verify GREEN**

Run the command from Step 2. Expected: all resolver tests pass.

### Task 2: Shared asynchronous draft initializer

**Files:**
- Create: `packages/ui/src/features/sessions/new-thread/initialize-draft.ts`
- Create: `packages/ui/src/features/sessions/new-thread/__tests__/initialize-draft.test.ts`
- Modify: `packages/ui/src/features/sessions/new-thread/use-new-thread-auto-config.ts`
- Modify: `packages/ui/src/features/sessions/new-thread/__tests__/use-new-thread-auto-config.test.tsx`
- Modify: `packages/ui/src/features/sessions/sidebar/SessionsNewButton.tsx`
- Modify: `packages/ui/src/features/sessions/sidebar/__tests__/SessionsNewButton.test.tsx`
- Modify: `packages/ui/src/features/sessions/runtime/new-thread-ready-store.ts`
- Modify: `packages/ui/src/features/sessions/new-thread/ChatSurface.tsx`
- Modify: `packages/ui/src/features/sessions/new-thread/__tests__/ChatSurface.test.tsx`

**Interfaces:**
- Consumes: `resolveDefaultAdapterId`, `resolveDraftDefaults`, `getProviderSettings`, adapter catalog state, draft store, and ready store.
- Produces: `initializeDraft(args: { localId: string; projectId: string; port: number; defaultAdapterId: string | null; adapters: AdapterInfo[]; adapterId?: string }): Promise<DraftCfg>` and per-local-id initialization state (`idle | initializing | ready | error`).

- [ ] **Step 1: Write failing initializer tests**

Verify that `initializeDraft`:

```ts
await initializeDraft({ localId: '__LOCALID_1', projectId: 'p1', port: 31415, defaultAdapterId: null, adapters });
expect(getDraftConfig('__LOCALID_1')).toEqual(expectedCompleteSnapshot);
expect(useNewThreadReady.getState().isReady('__LOCALID_1')).toBe(true);
```

Use a deferred provider-settings promise to prove status is `initializing` and readiness remains false until settings resolve. Prove a rejected request stores no draft, records `error`, and leaves readiness false. Prove changing the mocked provider settings after resolution does not alter the stored snapshot.

- [ ] **Step 2: Run the initializer test and verify RED**

```bash
pnpm --filter @qlan-ro/mainframe-ui exec vitest run src/features/sessions/new-thread/__tests__/initialize-draft.test.ts
```

Expected: FAIL because `initializeDraft` does not exist.

- [ ] **Step 3: Implement `initializeDraft`**

Mark the local id initializing, fetch provider settings once, resolve the selected adapter, build the complete snapshot, store it, then mark ready. Mark readiness only after `setDraftConfig`. On failure, preserve any prior complete snapshot, record the error state, and reject. A retry calls the same initializer again.

- [ ] **Step 4: Route the project-filter hook through the initializer**

Read the daemon port with `useDaemonPort`. In the effect, call `initializeDraft` and log a tagged warning on rejection. Add cancellation so an obsolete effect cannot initialize a discarded or switched-away draft.

- [ ] **Step 5: Route the All-project picker through the initializer**

After `switchToNewThread()` returns the minted id, await `initializeDraft` instead of calling `setDraftConfig` and `markReady` directly. Keep the picker path retryable by surfacing failure with the existing toast facility and leaving the local id unready.

- [ ] **Step 6: Update both entry-path tests**

Replace partial-draft assertions with complete-snapshot assertions. Add deferred-request assertions showing neither path marks ready early. Retain minted-id, default-adapter, return-target, discard, and no-overwrite coverage.

- [ ] **Step 7: Gate `ChatSurface` on initialization state**

For a new local thread, render neither `ChatThread` nor its composer while status is `initializing`. Render the existing centered surface frame with `Initializing session…`. For `error`, render `Couldn’t initialize session` and a `Retry` button with `data-testid="new-session-initialization-retry"`; retry invokes the same initializer inputs retained by the status store. Add tests proving the composer is absent in both states and Retry transitions back to initializing.

- [ ] **Step 8: Run entry-path tests and verify GREEN**

```bash
pnpm --filter @qlan-ro/mainframe-ui exec vitest run \
  src/features/sessions/new-thread/__tests__/initialize-draft.test.ts \
  src/features/sessions/new-thread/__tests__/use-new-thread-auto-config.test.tsx \
  src/features/sessions/new-thread/__tests__/ChatSurface.test.tsx \
  src/features/sessions/sidebar/__tests__/SessionsNewButton.test.tsx
```

Expected: all tests pass.

### Task 3: Make toolbar changes and first send consume the snapshot

**Files:**
- Modify: `packages/ui/src/features/chat/composer/config-toolbar/use-composer-tuning.ts`
- Modify: `packages/ui/src/features/chat/composer/config-toolbar/synthesize-draft-chat.ts`
- Modify: `packages/ui/src/features/chat/composer/config-toolbar/__tests__/use-composer-tuning.test.ts`
- Modify: `packages/ui/src/features/chat/composer/config-toolbar/__tests__/synthesize-draft-chat.test.ts`
- Modify: `packages/ui/src/features/sessions/runtime/new-thread-coordinator.ts`
- Modify: `packages/ui/src/features/sessions/runtime/__tests__/new-thread-coordinator.test.ts`

**Interfaces:**
- Consumes: `initializeDraft`, the complete `DraftCfg`, and the existing composer setters.
- Produces: explicit draft `Chat` projection and adapter-switch reinitialization.

- [ ] **Step 1: Write failing toolbar snapshot tests**

Assert that `synthesizeDraftChat` forwards every explicit snapshot field. In `useComposerTuning`, initialize a draft, change mocked provider settings, and verify chat/model/permission/plan/effort/features remain equal to the snapshot. Add an adapter-switch test that awaits a fresh initialization for the selected adapter rather than clearing only the model.

- [ ] **Step 2: Write failing first-send parity test**

Seed a complete draft, change the provider-settings mock, call `createForLocal`, and assert:

```ts
expect(createChat).toHaveBeenCalledWith(31415, expect.objectContaining({
  model: 'snapshotted-model', permissionMode: 'acceptEdits',
}));
expect(setChatConfig).toHaveBeenCalledWith(31415, 'chat-1', { planMode: true });
expect(setChatTuning).toHaveBeenCalledWith(31415, 'chat-1', {
  effort: 'high', fast: true, ultracode: false, adaptiveThinking: true,
});
```

- [ ] **Step 3: Run toolbar and coordinator tests and verify RED**

```bash
pnpm --filter @qlan-ro/mainframe-ui exec vitest run \
  src/features/chat/composer/config-toolbar/__tests__/synthesize-draft-chat.test.ts \
  src/features/chat/composer/config-toolbar/__tests__/use-composer-tuning.test.ts \
  src/features/sessions/runtime/__tests__/new-thread-coordinator.test.ts
```

Expected: new adapter-switch and full-snapshot assertions fail.

- [ ] **Step 4: Make draft projection explicit**

Project the stored fields directly. Provider-default fallbacks remain only for existing real chats that intentionally inherit; initialized drafts no longer depend on them.

- [ ] **Step 5: Reinitialize on draft adapter switch**

Change the draft adapter setter to invoke the shared initializer with the current project and selected adapter. Disable or ignore repeated adapter choices while initialization is in flight. On failure, retain the previous complete snapshot and report the tagged error.

- [ ] **Step 6: Keep first send snapshot-only**

Require the initialized fields at the coordinator boundary and pass them explicitly to chat creation and tuning patches. Preserve the current create-once, retry, and worktree behavior.

- [ ] **Step 7: Run targeted tests and verify GREEN**

Run the command from Step 3. Expected: all tests pass.

### Task 4: Final verification and changeset

**Files:**
- Create: `.changeset/<generated-name>.md`

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: release metadata and verification evidence.

- [ ] **Step 1: Run the complete focused test set**

```bash
pnpm --filter @qlan-ro/mainframe-ui exec vitest run \
  src/features/sessions/new-thread/__tests__/resolve-draft-defaults.test.ts \
  src/features/sessions/new-thread/__tests__/initialize-draft.test.ts \
  src/features/sessions/new-thread/__tests__/use-new-thread-auto-config.test.tsx \
  src/features/sessions/new-thread/__tests__/ChatSurface.test.tsx \
  src/features/sessions/sidebar/__tests__/SessionsNewButton.test.tsx \
  src/features/chat/composer/config-toolbar/__tests__/synthesize-draft-chat.test.ts \
  src/features/chat/composer/config-toolbar/__tests__/use-composer-tuning.test.ts \
  src/features/sessions/runtime/__tests__/new-thread-coordinator.test.ts
```

Expected: zero failed tests.

- [ ] **Step 2: Typecheck the UI**

```bash
pnpm --filter @qlan-ro/mainframe-ui typecheck
```

Expected: exit code 0.

- [ ] **Step 3: Add a patch changeset**

Run `pnpm changeset`, select `@qlan-ro/mainframe-ui`, choose `patch`, and describe that new-session composers now snapshot the exact defaults used on first send.

- [ ] **Step 4: Inspect scope**

Run `git diff --check` and `git status --short`. Confirm no unrelated user files are staged or modified by this implementation.
