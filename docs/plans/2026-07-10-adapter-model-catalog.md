# Adapter Model Catalog Corrections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep live Claude and Codex model catalogs accurate, remove Claude's duplicate default target, and let Codex choose its account default when Mainframe has no explicit model.

**Architecture:** Normalize Claude's live probe at the provider boundary using the CLI's per-entry `resolvedModel`. Add a path-aware Codex probe so the revisioned registry from PR #395 launches the configured executable. Build Codex JSON-RPC payloads without a model property when the chat inherits the provider default.

**Tech Stack:** TypeScript 6, Node.js child processes, Codex JSON-RPC app-server, Claude stream-json control protocol, Vitest, pnpm workspaces.

---

### Task 1: Deduplicate Claude's Concrete Default Target

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/probe-models.ts:53-77`
- Test: `packages/core/src/plugins/builtin/claude/__tests__/probe-models.test.ts`

**Step 1: Write the failing duplicate-alias test**

Add a live-shaped payload containing:

```ts
models: [
  {
    value: 'default',
    displayName: 'Default (recommended)',
    description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
    resolvedModel: 'claude-opus-4-8[1m]',
  },
  {
    value: 'opus[1m]',
    displayName: 'Opus',
    description: 'Opus 4.8 with 1M context · Best for everyday, complex tasks',
    resolvedModel: 'claude-opus-4-8[1m]',
  },
  {
    value: 'sonnet',
    displayName: 'Sonnet',
    resolvedModel: 'claude-sonnet-5',
  },
]
```

Assert that `extractProbePayload` returns `['default', 'sonnet']`, retains `default.isDefault`, and labels it `Default - Opus 4.8`.

Add a second test proving that entries remain when there is no default `resolvedModel` or when their concrete targets differ.

**Step 2: Run the focused test and verify it fails**

Run:

```bash
node node_modules/vitest/vitest.mjs run src/plugins/builtin/claude/__tests__/probe-models.test.ts
```

from `packages/core`.

Expected: FAIL because `opus[1m]` is still present.

**Step 3: Implement minimal provider-boundary normalization**

Add a pure helper in `probe-models.ts`:

```ts
function removeConcreteDefaultDuplicate(models: AdapterModel[]): AdapterModel[] {
  const defaultModel = models.find((model) => model.isDefault);
  if (!defaultModel?.resolvedModel) return models;
  return models.filter(
    (model) => model === defaultModel || model.resolvedModel !== defaultModel.resolvedModel,
  );
}
```

Apply it after mapping the raw CLI entries and before returning `ProbeResult`. Keep the default entry's `resolvedModel` for context-window enrichment.

**Step 4: Run Claude probe and context tests**

Run:

```bash
node node_modules/vitest/vitest.mjs run \
  src/plugins/builtin/claude/__tests__/probe-models.test.ts \
  src/plugins/builtin/claude/__tests__/adapter-enrich.test.ts \
  src/plugins/builtin/claude/__tests__/probe-context-window.test.ts
```

Expected: all tests pass; Default/Opus deduplication does not change Sonnet, Fable, or Haiku window inference.

**Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/probe-models.ts \
  packages/core/src/plugins/builtin/claude/__tests__/probe-models.test.ts
git commit -m "fix(claude): collapse duplicate default model alias"
```

### Task 2: Use the Resolved Executable for Codex Discovery

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/adapter.ts:69-88`
- Modify: `packages/core/src/plugins/builtin/codex/adapter.ts:131-150`
- Test: `packages/core/src/plugins/builtin/codex/__tests__/list-models.test.ts`

**Step 1: Write the failing path-aware probe test**

Mock `node:child_process.spawn`, call:

```ts
const probe = adapter.probeModels('/configured/bin/codex');
```

Drive the mocked initialize and `model/list` responses through stdout. Assert:

```ts
expect(spawn).toHaveBeenCalledWith(
  '/configured/bin/codex',
  ['app-server'],
  expect.objectContaining({ detached: false }),
);
```

Also assert that hidden models are excluded and a non-empty result is returned.

**Step 2: Run the focused test and verify it fails**

Run:

```bash
node node_modules/vitest/vitest.mjs run src/plugins/builtin/codex/__tests__/list-models.test.ts
```

Expected: FAIL because `CodexAdapter` has no `probeModels` method and its temporary app-server hardcodes `codex`.

**Step 3: Implement a shared path-aware loader**

Keep `listModels()` for direct callers and add the registry probe hook:

```ts
async listModels(): Promise<AdapterModel[]> {
  return this.loadModels('codex');
}

async probeModels(executablePath?: string): Promise<AdapterModel[] | null> {
  return this.loadModels(executablePath ?? 'codex');
}
```

Move the existing request/cache/error handling into `loadModels(executable: string)`, and change `spawnTempAppServer` to accept that executable:

```ts
private async spawnTempAppServer(executable: string): Promise<JsonRpcClient> {
  const child = spawn(executable, ['app-server'], { /* existing options */ });
  // existing initialize handshake
}
```

Keep empty results uncached so PR #395's registry can retry.

**Step 4: Run Codex model and registry tests**

Run:

```bash
node node_modules/vitest/vitest.mjs run \
  src/plugins/builtin/codex/__tests__/list-models.test.ts \
  src/adapters/__tests__/registry.test.ts \
  src/__tests__/adapter-registry.test.ts
```

Expected: all tests pass and the registry continues to publish only successful live catalogs.

**Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/adapter.ts \
  packages/core/src/plugins/builtin/codex/__tests__/list-models.test.ts
git commit -m "fix(codex): probe models with configured executable"
```

### Task 3: Omit an Unset Codex Model

**Files:**
- Modify: `packages/core/src/plugins/builtin/codex/types.ts:212-217`
- Modify: `packages/core/src/plugins/builtin/codex/turn-config.ts:10-49`
- Modify: `packages/core/src/plugins/builtin/codex/session.ts:199-251`
- Test: `packages/core/src/plugins/builtin/codex/__tests__/turn-config.test.ts`
- Test: `packages/core/src/__tests__/codex-session.test.ts`

**Step 1: Write the failing collaboration-settings test**

Update `buildTurnConfig` tests to call it with `undefined` and assert:

```ts
expect(cfg.collaborationMode.settings).not.toHaveProperty('model');
```

Keep the existing explicit-model assertion for `gpt-5.5`.

**Step 2: Run the turn-config test and verify it fails**

Run:

```bash
node node_modules/vitest/vitest.mjs run src/plugins/builtin/codex/__tests__/turn-config.test.ts
```

Expected: FAIL because `modelId` is required and the builder always creates `model`.

**Step 3: Make collaboration-mode model optional**

Change `CollaborationModeSettings.model` to optional in `types.ts`, accept `modelId?: string` in `buildTurnConfig`, and construct settings with:

```ts
settings: {
  ...(modelId ? { model: modelId } : {}),
  reasoning_effort: tuning.effort as string | null,
  developer_instructions: null,
},
```

Pass `this.pendingModel` directly from `CodexSession`.

**Step 4: Run the turn-config test and verify it passes**

Run the command from Step 2.

Expected: PASS.

**Step 5: Write failing JSON-RPC payload tests**

Extend the existing `CodexSession` mocked-process harness. For a new session spawned without a model, capture `thread/start` and `turn/start`, then assert:

```ts
expect(threadStart.params).not.toHaveProperty('model');
expect(turnStart.params).not.toHaveProperty('model');
expect(turnStart.params.collaborationMode.settings).not.toHaveProperty('model');
```

Add a resume case asserting `thread/resume.params` also omits `model`. Retain or add an explicit-model case proving `gpt-5.6-sol` appears in all applicable payloads.

**Step 6: Run the session test and verify it fails**

Run:

```bash
node node_modules/vitest/vitest.mjs run src/__tests__/codex-session.test.ts
```

Expected: FAIL because the request objects include `model: undefined` before JSON serialization or collaboration settings include an empty model.

**Step 7: Omit model fields at request construction**

Create one local object per send:

```ts
const modelParams = this.pendingModel ? { model: this.pendingModel } : {};
```

Spread `modelParams` into `thread/start`, `thread/resume`, and `turn/start` instead of assigning `model` directly. Keep all other JSON-RPC parameters unchanged.

**Step 8: Run Codex session and configuration tests**

Run:

```bash
node node_modules/vitest/vitest.mjs run \
  src/__tests__/codex-session.test.ts \
  src/plugins/builtin/codex/__tests__/turn-config.test.ts \
  src/plugins/builtin/codex/__tests__/collaboration-mode.test.ts
```

Expected: all tests pass for inherited and explicit model selections.

**Step 9: Commit**

```bash
git add packages/core/src/plugins/builtin/codex/types.ts \
  packages/core/src/plugins/builtin/codex/turn-config.ts \
  packages/core/src/plugins/builtin/codex/session.ts \
  packages/core/src/plugins/builtin/codex/__tests__/turn-config.test.ts \
  packages/core/src/__tests__/codex-session.test.ts
git commit -m "fix(codex): omit unset model from app-server requests"
```

### Task 4: Changeset and Verification

**Files:**
- Create: `.changeset/<generated-name>.md`

**Step 1: Add a patch changeset**

Run `pnpm changeset`, select `@qlan-ro/mainframe-core`, choose `patch`, and summarize the catalog and default-model compatibility fixes.

**Step 2: Run formatting checks on changed files**

Run Prettier on the touched TypeScript and Markdown files, then run:

```bash
git diff --check
```

Expected: no output.

**Step 3: Run all focused tests**

Run:

```bash
node node_modules/vitest/vitest.mjs run \
  src/plugins/builtin/claude/__tests__/probe-models.test.ts \
  src/plugins/builtin/claude/__tests__/adapter-enrich.test.ts \
  src/plugins/builtin/claude/__tests__/probe-context-window.test.ts \
  src/plugins/builtin/codex/__tests__/list-models.test.ts \
  src/plugins/builtin/codex/__tests__/turn-config.test.ts \
  src/plugins/builtin/codex/__tests__/collaboration-mode.test.ts \
  src/__tests__/codex-session.test.ts \
  src/adapters/__tests__/registry.test.ts \
  src/__tests__/adapter-registry.test.ts
```

from `packages/core`.

Expected: all files pass.

**Step 4: Typecheck core**

Run:

```bash
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json
```

from `packages/core`.

Expected: exit 0 with no output.

**Step 5: Run live provider smoke probes**

Probe Claude 2.1.206 and confirm the normalized catalog contains one Opus 4.8 default row. Probe Codex 0.144.1 by absolute path and confirm its current non-hidden models are returned.

Do not modify the user's running daemon or its database during the smoke test.

**Step 6: Commit**

```bash
git add .changeset/<generated-name>.md
git commit -m "chore: add adapter model catalog changeset"
```

**Step 7: Review final branch state**

Run:

```bash
git status --short --branch
git log --oneline origin/main..HEAD
```

Expected: clean worktree on `fix/adapter-model-catalog` with design, implementation, tests, and changeset commits.

### Task 5: Normalize Stale Saved Provider Defaults

**Files:**
- Create: `packages/core/src/settings/model-default.ts`
- Create: `packages/core/src/settings/__tests__/model-default.test.ts`
- Modify: `packages/core/src/chat/lifecycle-manager.ts`
- Modify: `packages/core/src/__tests__/chat/create-on-worktree.test.ts`
- Modify: `packages/core/src/server/routes/settings.ts`
- Modify: `packages/core/src/__tests__/routes/settings.test.ts`

**Step 1: Write failing resolver tests**

Cover three cases: preserve a matching model id, preserve any value while the catalog is empty, and return `undefined` for an id absent from a non-empty catalog.

**Step 2: Run the resolver test and verify it fails**

Expected: FAIL because the resolver does not exist.

**Step 3: Implement the pure resolver**

```ts
export function normalizeSavedDefaultModel(
  configuredModel: string | undefined,
  models: AdapterModel[],
): string | undefined {
  if (!configuredModel || models.length === 0) return configuredModel;
  return models.some((model) => model.id === configuredModel) ? configuredModel : undefined;
}
```

**Step 4: Write failing integration tests**

Assert that provider-settings responses omit stale defaults once a non-empty catalog is available, and that `createChatWithDefaults` does not pass a stale saved id to `createChat`. Retain valid defaults and values observed during an empty catalog.

**Step 5: Apply the resolver at both boundaries**

Read the adapter snapshot synchronously from `AdapterRegistry.getSnapshots()`, normalize the saved value, and leave explicit per-chat model selections unchanged.

**Step 6: Run focused settings and lifecycle tests**

```bash
node node_modules/vitest/vitest.mjs run \
  src/settings/__tests__/model-default.test.ts \
  src/__tests__/routes/settings.test.ts \
  src/__tests__/chat/create-on-worktree.test.ts
```

**Step 7: Update the existing changeset and rerun final verification**

Mention stale provider-default normalization, then rerun formatting, focused adapter/settings tests, core typecheck, core build, and live catalog probes.
