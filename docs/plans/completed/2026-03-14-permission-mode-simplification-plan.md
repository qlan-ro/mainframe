# Permission Mode Simplification Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify permission mode management by always passing `--permission-mode` and `--allow-dangerously-skip-permissions` at spawn, removing daemon-side yolo auto-approval, and eliminating `planExecutionMode` tracking.

**Architecture:** The CLI handles permission enforcement natively. The daemon always tells the CLI which mode to use at spawn via `--permission-mode <mode> --allow-dangerously-skip-permissions`. Mode transitions use `set_permission_mode` control_requests. The ExitPlanMode dialog is the only place that picks the post-plan mode — no defaults or fallback chains needed.

**Tech Stack:** TypeScript, Node.js, Vitest

---

## Chunk 1: Spawn logic and yolo removal

### Task 1: Simplify spawn args in `session.ts`

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/session.ts:130-136`

- [ ] **Step 1: Write the failing test**

In `packages/core/src/__tests__/claude-session-spawn.test.ts` (or the existing spawn test file), add tests that verify:
1. `--permission-mode default --allow-dangerously-skip-permissions` for `permissionMode: 'default'`
2. `--permission-mode plan --allow-dangerously-skip-permissions` for `permissionMode: 'plan'`
3. `--permission-mode acceptEdits --allow-dangerously-skip-permissions` for `permissionMode: 'acceptEdits'`
4. `--permission-mode bypassPermissions --allow-dangerously-skip-permissions` for `permissionMode: 'yolo'`
5. No `--dangerously-skip-permissions` flag in any case

Note: `spawn` calls `child_process.spawn` — tests should mock it and inspect the args array. Check existing test patterns for how `spawn` is tested in this codebase. If no spawn arg tests exist, create `packages/core/src/__tests__/session-spawn-args.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/__tests__/session-spawn-args.test.ts`
Expected: FAIL — current code doesn't pass `--permission-mode` for `default`, passes `--dangerously-skip-permissions` for yolo

- [ ] **Step 3: Replace spawn arg logic**

In `packages/core/src/plugins/builtin/claude/session.ts`, replace lines 130-136:

```typescript
// Before:
if (options.permissionMode === 'plan') {
  args.push('--permission-mode', 'plan');
} else if (options.permissionMode === 'acceptEdits') {
  args.push('--permission-mode', 'acceptEdits');
} else if (options.permissionMode === 'yolo') {
  args.push('--dangerously-skip-permissions');
}

// After:
const cliMode = options.permissionMode === 'yolo' ? 'bypassPermissions' : (options.permissionMode ?? 'default');
args.push('--permission-mode', cliMode, '--allow-dangerously-skip-permissions');
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/core/src/__tests__/session-spawn-args.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat: always pass --permission-mode and --allow-dangerously-skip-permissions at spawn
```

### Task 2: Remove `setPermissionMode` yolo-to-bypassPermissions mapping

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/session.ts:209-219`
- Modify: `packages/core/src/__tests__/control-requests.test.ts`

The `setPermissionMode` method maps `'yolo'` → `'bypassPermissions'`. This mapping should stay — our internal type uses `'yolo'` but the CLI expects `'bypassPermissions'`. No change needed here.

(This task is a no-op — keep the existing mapping. Noted for completeness.)

### Task 3: Remove daemon-side yolo auto-approval

**Files:**
- Modify: `packages/core/src/chat/event-handler.ts:134-148`

- [ ] **Step 1: Write the failing test**

In `packages/core/src/__tests__/event-handler.test.ts`, add a test:
```typescript
it('does not auto-approve permissions in yolo mode (CLI handles it)', () => {
  // Set up active chat with permissionMode: 'yolo'
  // Build sink, call sink.onPermission(request) with a non-interactive tool
  // Verify respondToPermission was NOT called (no daemon-side auto-approve)
  // Verify the permission was enqueued normally
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/__tests__/event-handler.test.ts`
Expected: FAIL — current code auto-approves in yolo mode

- [ ] **Step 3: Remove yolo auto-approval block**

In `packages/core/src/chat/event-handler.ts`, delete lines 136-148 (the `if (mode === 'yolo' && !requiresUserInput)` block). The `onPermission` handler should unconditionally enqueue all requests:

```typescript
onPermission(request: any) {
  const isFirst = permissions.enqueue(chatId, request);
  if (isFirst) {
    log.info(
      { chatId, requestId: request.requestId, toolName: request.toolName },
      'permission.requested emitted to clients',
    );
    emitEvent({ type: 'permission.requested', chatId, request });
    // ... push notification code stays
  } else {
    // ... queue log stays
  }
},
```

- [ ] **Step 4: Also remove the yolo guard in `getPending`**

In `packages/core/src/chat/permission-manager.ts:15-18`, remove the yolo check:

```typescript
// Before:
getPending(chatId: string): ControlRequest | null {
  const chat = this.db.chats.get(chatId);
  if (chat?.permissionMode === 'yolo') return null;
  return this.pendingPermissions.get(chatId)?.[0] ?? null;
}

// After:
getPending(chatId: string): ControlRequest | null {
  return this.pendingPermissions.get(chatId)?.[0] ?? null;
}
```

This also removes the `DatabaseManager` and `AdapterRegistry` constructor dependencies from `PermissionManager` if they're only used for the yolo check. Check if `db` or `adapters` are used elsewhere in the class — if not, remove them from the constructor.

- [ ] **Step 5: Run tests to verify**

Run: `npx vitest run packages/core/src/__tests__/event-handler.test.ts packages/core/src/__tests__/permission-flow.test.ts`
Expected: PASS (may need to update permission-flow tests that tested yolo auto-approval behavior)

- [ ] **Step 6: Commit**

```
refactor: remove daemon-side yolo auto-approval, let CLI handle it
```

---

## Chunk 2: Remove `planExecutionMode` tracking

### Task 4: Simplify `PlanModeHandler` — remove `planExecutionMode` usage

**Files:**
- Modify: `packages/core/src/chat/plan-mode-handler.ts`

- [ ] **Step 1: Write the failing test**

In `packages/core/src/__tests__/plan-mode-handler.test.ts`, add/update tests:
```typescript
it('handleEscalation uses response.executionMode, falls back to default', () => {
  // Verify: response.executionMode = 'acceptEdits' → mode becomes 'acceptEdits'
  // Verify: response.executionMode = undefined → mode becomes 'default'
  // Verify: permissions.getPlanExecutionMode is NOT called
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/core/src/__tests__/plan-mode-handler.test.ts`

- [ ] **Step 3: Simplify all three methods**

Replace the `targetMode` logic in all three methods (`handleNoProcess`, `handleClearContext`, `handleEscalation`):

```typescript
// Before (in each method):
const targetMode = (response.executionMode ?? this.ctx.permissions.getPlanExecutionMode(chatId)) as ...;
this.ctx.permissions.deletePlanExecutionMode(chatId);
const newMode = targetMode || 'default';

// After (in each method):
const newMode = (response.executionMode ?? 'default') as Chat['permissionMode'];
```

Remove the `permissions` field from `PlanModeContext` interface (if no longer needed).

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/src/__tests__/plan-mode-handler.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
refactor: simplify PlanModeHandler — use response.executionMode directly
```

### Task 5: Remove `planExecutionMode` from `PermissionManager`

**Files:**
- Modify: `packages/core/src/chat/permission-manager.ts`

- [ ] **Step 1: Remove the `planExecutionModes` map and its methods**

Delete:
- Line 7: `private planExecutionModes = new Map<string, Chat['permissionMode']>()`
- Line 33: `this.planExecutionModes.delete(chatId)` from `clear()`
- Lines 54-64: `setPlanExecutionMode`, `getPlanExecutionMode`, `deletePlanExecutionMode` methods

- [ ] **Step 2: Run all tests**

Run: `npx vitest run packages/core/src/__tests__/`
Expected: Compilation errors in files that call these methods — fix in next tasks

- [ ] **Step 3: Commit**

```
refactor: remove planExecutionMode from PermissionManager
```

### Task 6: Remove `planExecutionMode` from `LifecycleManager` and `ChatManager`

**Files:**
- Modify: `packages/core/src/chat/lifecycle-manager.ts:42-86`
- Modify: `packages/core/src/chat/chat-manager.ts:122-139`

- [ ] **Step 1: Simplify `createChat`**

```typescript
// Before:
async createChat(projectId, adapterId, model?, permissionMode?, planExecutionMode?): Promise<Chat> {
  const chat = this.deps.db.chats.create(projectId, adapterId, model, permissionMode);
  ...
  if (planExecutionMode && permissionMode === 'plan') {
    this.deps.permissions.setPlanExecutionMode(chat.id, planExecutionMode as Chat['permissionMode']);
  }
  ...
}

// After:
async createChat(projectId, adapterId, model?, permissionMode?): Promise<Chat> {
  const chat = this.deps.db.chats.create(projectId, adapterId, model, permissionMode);
  ...
  // No planExecutionMode handling
  ...
}
```

- [ ] **Step 2: Simplify `createChatWithDefaults`**

```typescript
// Before:
async createChatWithDefaults(...) {
  let planExecutionMode: string | undefined;
  ...
  if (defaultMode === 'plan') {
    effectiveMode = 'plan';
    const storedExec = this.deps.db.settings.get('provider', `${adapterId}.planExecutionMode`);
    if (storedExec) planExecutionMode = storedExec;
  }
  return this.createChat(..., planExecutionMode);
}

// After:
async createChatWithDefaults(...) {
  ...
  // Just read defaultMode, no planExecutionMode lookup
  if (!effectiveMode && defaultMode) {
    effectiveMode = defaultMode;
  }
  return this.createChat(projectId, adapterId, effectiveModel, effectiveMode);
}
```

- [ ] **Step 3: Update `ChatManager.createChat` wrapper** to remove `planExecutionMode` param

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/src/__tests__/`

- [ ] **Step 5: Commit**

```
refactor: remove planExecutionMode from lifecycle and chat managers
```

### Task 7: Remove `planExecutionMode` from settings API and schema

**Files:**
- Modify: `packages/core/src/server/routes/schemas.ts:35`
- Modify: `packages/core/src/server/routes/settings.ts:67-81`
- Modify: `packages/core/src/__tests__/routes/settings.test.ts`

- [ ] **Step 1: Remove from Zod schema**

In `schemas.ts`, remove `planExecutionMode: z.string().optional()` from `UpdateProviderSettingsBody`.

- [ ] **Step 2: Remove from settings route handler**

In `settings.ts`, remove the `planExecutionMode` destructuring and the DB set/delete block (lines 78-80).

- [ ] **Step 3: Update or remove the settings test**

In `settings.test.ts`, remove/update the `'sets planExecutionMode'` test.

- [ ] **Step 4: Run tests**

Run: `npx vitest run packages/core/src/__tests__/routes/settings.test.ts`

- [ ] **Step 5: Commit**

```
refactor: remove planExecutionMode from settings API
```

### Task 8: Remove `planExecutionMode` from types and UI

**Files:**
- Modify: `packages/types/src/settings.ts:6`
- Modify: `packages/desktop/src/renderer/components/settings/constants.ts:23-35`
- Modify: `packages/desktop/src/renderer/components/settings/ProviderSection.tsx:102-129`
- Modify: `packages/desktop/src/renderer/components/chat/PlanApprovalCard.tsx:43`

- [ ] **Step 1: Remove from `ProviderConfig` type**

In `packages/types/src/settings.ts`, remove line 6: `planExecutionMode?: 'default' | 'acceptEdits' | 'yolo'`

- [ ] **Step 2: Remove `EXECUTION_MODE_OPTIONS` from constants**

In `packages/desktop/src/renderer/components/settings/constants.ts`, delete the entire `EXECUTION_MODE_OPTIONS` array (lines 23-35) and the type import if unused.

- [ ] **Step 3: Remove "After Plan Approval" section from ProviderSection**

In `ProviderSection.tsx`, delete the entire conditional block at lines 102-129 that renders the plan execution mode radio buttons.

- [ ] **Step 4: Simplify PlanApprovalCard default**

In `PlanApprovalCard.tsx:43`, change:
```typescript
// Before:
const settingsDefault: ExecutionMode = providerConfig?.planExecutionMode ?? 'default';

// After:
const settingsDefault: ExecutionMode = 'default';
```

Also remove the `useSettingsStore` import and `providerConfig` lookup if no longer needed.

- [ ] **Step 5: Build types package, then run desktop typecheck**

```bash
pnpm --filter @qlan-ro/mainframe-types build
pnpm --filter @qlan-ro/mainframe-desktop exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```
refactor: remove planExecutionMode from types and UI
```

---

## Chunk 3: Update docs

### Task 9: Update API reference

**Files:**
- Modify: `docs/API-REFERENCE.md:680`

- [ ] **Step 1: Remove `planExecutionMode` from the API docs**

Find the table entry at line 680 and remove it.

- [ ] **Step 2: Commit**

```
docs: remove planExecutionMode from API reference
```

---

## Summary of changes

| Area | Before | After |
|------|--------|-------|
| Spawn | Conditional `--permission-mode` for plan/acceptEdits, `--dangerously-skip-permissions` for yolo, nothing for default | Always `--permission-mode <mode> --allow-dangerously-skip-permissions` |
| Yolo handling | Daemon auto-approves `control_request`s | CLI handles it natively via `bypassPermissions` mode |
| `planExecutionMode` | Per-chat + per-adapter-setting + fallback chain | Gone — ExitPlanMode dialog picks the mode, falls back to `'default'` |
| Mode transitions | Mix of spawn flags and `set_permission_mode` | `set_permission_mode` for all in-flight transitions |
| Settings UI | "After Plan Approval" radio group in provider settings | Removed |
