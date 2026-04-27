# New-Session Button on Worktree Rows — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `+` button to each worktree row in the Branches popover that creates a new Claude chat already attached to that worktree.

**Architecture:** Extend the existing `chat.create` WebSocket message with two optional fields (`worktreePath`, `branchName`). Thread them through `ChatManager → ChatLifecycleManager → DB update` so the new chat is born with those fields set, reusing the existing CLI-spawn path that already honors `chat.worktreePath`. UI adds a `Plus` button next to the existing `Trash` in `WorktreeSection`.

**Tech Stack:** TypeScript (strict), Node 20, Electron/React, Zod, Vitest, pnpm workspaces, better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-04-21-new-session-on-worktree-design.md`

---

## File Structure

**Modify:**
- `packages/core/src/server/ws-schemas.ts` — extend `ChatCreate` schema.
- `packages/core/src/chat/lifecycle-manager.ts` — add optional worktree args to `createChat` / `createChatWithDefaults`, persist via `db.chats.update` before event emission.
- `packages/core/src/chat/chat-manager.ts` — forward new args in `createChatWithDefaults`.
- `packages/core/src/server/websocket.ts` — forward new fields in `chat.create` handler.
- `packages/desktop/src/renderer/lib/client.ts` — extend `daemonClient.createChat` signature with optional `attachWorktree`.
- `packages/desktop/src/renderer/components/git/useBranchActions.ts` — add `handleNewSession`.
- `packages/desktop/src/renderer/components/git/BranchList.tsx` — add `Plus` button + prop to `WorktreeSection`.
- `packages/desktop/src/renderer/components/git/BranchPopover.tsx` — wire `onNewSession` prop.

**Create:**
- `packages/core/src/__tests__/chat/create-on-worktree.test.ts` — lifecycle tests for worktree-attached chat creation.
- `packages/desktop/src/__tests__/components/git/useBranchActions-new-session.test.tsx` — handler unit tests (same directory as existing `BranchPopover.test.tsx`).

**No new files for routes** — this is a WS schema extension, not a new REST endpoint.

---

## Task 1: Extend `chat.create` WS schema

**Files:**
- Modify: `packages/core/src/server/ws-schemas.ts:5-11`
- Test: `packages/core/src/__tests__/ws-schemas.test.ts`

### Step 1: Write failing schema tests

Append to `packages/core/src/__tests__/ws-schemas.test.ts`:

```ts
describe('ChatCreate schema', () => {
  const base = {
    type: 'chat.create' as const,
    projectId: 'proj-1',
    adapterId: 'claude',
  };

  it('accepts a payload without worktree fields', () => {
    const result = ClientEventSchema.safeParse(base);
    expect(result.success).toBe(true);
  });

  it('accepts a payload with both worktreePath and branchName', () => {
    const result = ClientEventSchema.safeParse({
      ...base,
      worktreePath: '/projects/my-repo/.worktrees/feat-x',
      branchName: 'feat-x',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty worktreePath', () => {
    const result = ClientEventSchema.safeParse({
      ...base,
      worktreePath: '',
      branchName: 'feat-x',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty branchName when provided', () => {
    const result = ClientEventSchema.safeParse({
      ...base,
      worktreePath: '/projects/my-repo/.worktrees/feat-x',
      branchName: '',
    });
    expect(result.success).toBe(false);
  });
});
```

### Step 2: Run tests to verify failure

Run: `pnpm --filter @qlan-ro/mainframe-core test -- ws-schemas`

Expected: FAIL on "accepts a payload with both worktreePath and branchName" — schema doesn't recognize those keys, Zod strict parsing rejects them, OR schema passes them through silently without the validation we want. Either way: the "rejects empty worktreePath" test FAILS because the field has no rule yet.

### Step 3: Extend `ChatCreate` schema

Edit `packages/core/src/server/ws-schemas.ts` lines 5–11, replacing the `ChatCreate` definition:

```ts
const ChatCreate = z.object({
  type: z.literal('chat.create'),
  projectId: z.string().min(1),
  adapterId: z.string().min(1),
  model: z.string().optional(),
  permissionMode: permissionModeSchema,
  worktreePath: z.string().min(1).optional(),
  branchName: z.string().min(1).optional(),
});
```

### Step 4: Run tests to verify pass

Run: `pnpm --filter @qlan-ro/mainframe-core test -- ws-schemas`

Expected: PASS — all four new tests pass along with the existing MessageSend tests.

### Step 5: Commit

```bash
git add packages/core/src/server/ws-schemas.ts packages/core/src/__tests__/ws-schemas.test.ts
git commit -m "feat(ws): optional worktreePath/branchName on chat.create"
```

---

## Task 2: Plumb fields through `ChatLifecycleManager.createChat` & `createChatWithDefaults`

**Files:**
- Modify: `packages/core/src/chat/lifecycle-manager.ts:55-81`
- Test: `packages/core/src/__tests__/chat/create-on-worktree.test.ts` (new)

### Step 1: Write failing lifecycle test

Create `packages/core/src/__tests__/chat/create-on-worktree.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { ChatLifecycleManager } from '../../chat/lifecycle-manager.js';
import type { LifecycleManagerDeps } from '../../chat/lifecycle-manager.js';
import type { Chat } from '@qlan-ro/mainframe-types';

function makeChat(overrides: Partial<Chat> = {}): Chat {
  return {
    id: 'chat-new',
    projectId: 'proj-1',
    adapterId: 'claude',
    model: 'claude-sonnet-4-5',
    permissionMode: 'default',
    status: 'active',
    processState: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    title: undefined,
    claudeSessionId: undefined,
    worktreePath: undefined,
    branchName: undefined,
    totalCost: 0,
    totalTokensInput: 0,
    totalTokensOutput: 0,
    lastContextTokensInput: 0,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<LifecycleManagerDeps> = {}): LifecycleManagerDeps {
  const createdChat = makeChat();
  return {
    db: {
      chats: {
        get: vi.fn(() => createdChat),
        create: vi.fn(() => createdChat),
        update: vi.fn(),
      },
      projects: { get: vi.fn() },
      settings: { get: vi.fn() },
    } as any,
    adapters: { get: vi.fn(), all: vi.fn().mockReturnValue([]) } as any,
    activeChats: new Map(),
    messages: { get: vi.fn(), set: vi.fn(), delete: vi.fn() } as any,
    permissions: {
      clear: vi.fn(),
      hasPending: vi.fn(),
      markInterrupted: vi.fn(),
      restorePendingPermission: vi.fn(),
    } as any,
    emitEvent: vi.fn(),
    buildSink: vi.fn(),
    ...overrides,
  };
}

describe('ChatLifecycleManager.createChat — worktree attachment', () => {
  it('persists worktreePath and branchName on create when provided', async () => {
    const deps = makeDeps();
    const lifecycle = new ChatLifecycleManager(deps);

    const chat = await lifecycle.createChat(
      'proj-1',
      'claude',
      'claude-sonnet-4-5',
      'default',
      '/projects/my-repo/.worktrees/feat-x',
      'feat-x',
    );

    expect(deps.db.chats.create).toHaveBeenCalledWith('proj-1', 'claude', 'claude-sonnet-4-5', 'default');
    expect(deps.db.chats.update).toHaveBeenCalledWith(chat.id, {
      worktreePath: '/projects/my-repo/.worktrees/feat-x',
      branchName: 'feat-x',
    });
    expect(chat.worktreePath).toBe('/projects/my-repo/.worktrees/feat-x');
    expect(chat.branchName).toBe('feat-x');
  });

  it('does not update worktree fields when not provided (back-compat)', async () => {
    const deps = makeDeps();
    const lifecycle = new ChatLifecycleManager(deps);

    await lifecycle.createChat('proj-1', 'claude', 'claude-sonnet-4-5', 'default');

    expect(deps.db.chats.update).not.toHaveBeenCalled();
  });

  it('emits chat.created with worktree fields populated', async () => {
    const deps = makeDeps();
    const lifecycle = new ChatLifecycleManager(deps);

    await lifecycle.createChat(
      'proj-1',
      'claude',
      'claude-sonnet-4-5',
      'default',
      '/projects/my-repo/.worktrees/feat-x',
      'feat-x',
    );

    expect(deps.emitEvent).toHaveBeenCalledWith({
      type: 'chat.created',
      chat: expect.objectContaining({
        worktreePath: '/projects/my-repo/.worktrees/feat-x',
        branchName: 'feat-x',
      }),
    });
  });
});

describe('ChatLifecycleManager.createChatWithDefaults — worktree attachment', () => {
  it('forwards worktreePath and branchName to createChat', async () => {
    const deps = makeDeps();
    const lifecycle = new ChatLifecycleManager(deps);
    const spy = vi.spyOn(lifecycle, 'createChat');

    await lifecycle.createChatWithDefaults(
      'proj-1',
      'claude',
      'claude-sonnet-4-5',
      'default',
      '/projects/my-repo/.worktrees/feat-x',
      'feat-x',
    );

    expect(spy).toHaveBeenCalledWith(
      'proj-1',
      'claude',
      'claude-sonnet-4-5',
      'default',
      '/projects/my-repo/.worktrees/feat-x',
      'feat-x',
    );
  });
});
```

### Step 2: Run test to verify failure

Run: `pnpm --filter @qlan-ro/mainframe-core test -- create-on-worktree`

Expected: FAIL — `createChat` and `createChatWithDefaults` do not accept the 5th/6th arguments yet (TypeScript compile error in the test file, or runtime assertion fails).

### Step 3: Extend `createChat` to accept and persist worktree fields

Edit `packages/core/src/chat/lifecycle-manager.ts` replacing lines 55–61:

```ts
async createChat(
  projectId: string,
  adapterId: string,
  model?: string,
  permissionMode?: string,
  worktreePath?: string,
  branchName?: string,
): Promise<Chat> {
  const chat = this.deps.db.chats.create(projectId, adapterId, model, permissionMode);
  if (worktreePath && branchName) {
    this.deps.db.chats.update(chat.id, { worktreePath, branchName });
    chat.worktreePath = worktreePath;
    chat.branchName = branchName;
  }
  log.info({ chatId: chat.id, projectId, adapterId, worktreePath }, 'chat created');
  this.deps.activeChats.set(chat.id, { chat, session: null });
  this.deps.emitEvent({ type: 'chat.created', chat });
  return chat;
}
```

Note: the `if (worktreePath && branchName)` guard means **both** must be present to persist. If only one is provided we silently ignore — the WS schema prevents this combo in practice (both are independently optional but the UI always sends both), so it's a defensive noop rather than an error path.

### Step 4: Extend `createChatWithDefaults` to accept and forward

Edit `packages/core/src/chat/lifecycle-manager.ts` replacing lines 63–81:

```ts
async createChatWithDefaults(
  projectId: string,
  adapterId: string,
  model?: string,
  permissionMode?: string,
  worktreePath?: string,
  branchName?: string,
): Promise<Chat> {
  let effectiveModel = model;
  let effectiveMode = permissionMode;

  if (!effectiveModel || !effectiveMode) {
    const defaultModel = this.deps.db.settings.get('provider', `${adapterId}.defaultModel`);
    const defaultMode = this.deps.db.settings.get('provider', `${adapterId}.defaultMode`);

    if (!effectiveModel && defaultModel) effectiveModel = defaultModel;
    if (!effectiveMode && defaultMode) effectiveMode = defaultMode;
  }

  return this.createChat(projectId, adapterId, effectiveModel, effectiveMode, worktreePath, branchName);
}
```

### Step 5: Run tests to verify pass

Run: `pnpm --filter @qlan-ro/mainframe-core test -- create-on-worktree`

Expected: PASS — all four tests pass.

### Step 6: Commit

```bash
git add packages/core/src/chat/lifecycle-manager.ts packages/core/src/__tests__/chat/create-on-worktree.test.ts
git commit -m "feat(chat): accept worktree attachment on chat creation"
```

---

## Task 3: Forward worktree fields through `ChatManager.createChatWithDefaults`

**Files:**
- Modify: `packages/core/src/chat/chat-manager.ts:137-144`

### Step 1: Extend `ChatManager.createChatWithDefaults`

Edit `packages/core/src/chat/chat-manager.ts` replacing lines 137–144:

```ts
async createChatWithDefaults(
  projectId: string,
  adapterId: string,
  model?: string,
  permissionMode?: string,
  worktreePath?: string,
  branchName?: string,
): Promise<Chat> {
  return this.lifecycle.createChatWithDefaults(
    projectId,
    adapterId,
    model,
    permissionMode,
    worktreePath,
    branchName,
  );
}
```

### Step 2: Typecheck

Run: `pnpm --filter @qlan-ro/mainframe-core build`

Expected: build succeeds, no TypeScript errors. Any existing callers of `createChatWithDefaults` continue to compile because the new parameters are optional.

### Step 3: Run core tests

Run: `pnpm --filter @qlan-ro/mainframe-core test`

Expected: all tests pass (no behavior change for existing callers; new parameter just gets forwarded).

### Step 4: Commit

```bash
git add packages/core/src/chat/chat-manager.ts
git commit -m "feat(chat-manager): forward worktree attachment args"
```

---

## Task 4: Forward worktree fields in WS `chat.create` handler

**Files:**
- Modify: `packages/core/src/server/websocket.ts:108-117`

### Step 1: Write failing route-parity test

Append to `packages/core/src/__tests__/ws-schemas.test.ts` (to protect against drift between the schema and the handler):

```ts
describe('ChatCreate schema shape parity', () => {
  it('ClientEvent inferred type includes optional worktreePath and branchName', () => {
    // Compile-time check: if these lines compile, the type exposes the fields.
    const ev = {
      type: 'chat.create' as const,
      projectId: 'p',
      adapterId: 'claude',
      worktreePath: '/tmp/wt',
      branchName: 'b',
    };
    const parsed = ClientEventSchema.parse(ev);
    if (parsed.type === 'chat.create') {
      expect(parsed.worktreePath).toBe('/tmp/wt');
      expect(parsed.branchName).toBe('b');
    }
  });
});
```

### Step 2: Run test to verify current state

Run: `pnpm --filter @qlan-ro/mainframe-core test -- ws-schemas`

Expected: PASS after Task 1 is committed — this test documents the contract the handler must honor. Keep it as a regression guard.

### Step 3: Update the handler to forward the fields

Edit `packages/core/src/server/websocket.ts` replacing lines 108–117:

```ts
case 'chat.create': {
  const chat = await this.chats.createChatWithDefaults(
    event.projectId,
    event.adapterId,
    event.model,
    event.permissionMode,
    event.worktreePath,
    event.branchName,
  );
  client.subscriptions.add(chat.id);
  break;
}
```

### Step 4: Typecheck and run tests

Run: `pnpm --filter @qlan-ro/mainframe-core build && pnpm --filter @qlan-ro/mainframe-core test`

Expected: build passes; all tests pass.

### Step 5: Commit

```bash
git add packages/core/src/server/websocket.ts packages/core/src/__tests__/ws-schemas.test.ts
git commit -m "feat(ws): forward worktree fields in chat.create handler"
```

---

## Task 5: Extend `daemonClient.createChat` signature

**Files:**
- Modify: `packages/desktop/src/renderer/lib/client.ts:136-144`

### Step 1: Extend the client method

Edit `packages/desktop/src/renderer/lib/client.ts` replacing lines 136–144:

```ts
createChat(
  projectId: string,
  adapterId: string,
  model?: string,
  permissionMode?: 'default' | 'acceptEdits' | 'plan' | 'yolo',
  attachWorktree?: { worktreePath: string; branchName: string },
): void {
  this.send({
    type: 'chat.create',
    projectId,
    adapterId,
    model,
    permissionMode,
    worktreePath: attachWorktree?.worktreePath,
    branchName: attachWorktree?.branchName,
  });
  log.info('createChat', { projectId, adapterId, model, permissionMode, attachWorktree });
}
```

Why `{ worktreePath, branchName }` as a grouped optional object: the two fields only make sense together (UI always sends both or neither). Grouping prevents callers from accidentally passing just one.

### Step 2: Typecheck the desktop package

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`

Expected: build passes. Existing callers (`App.tsx:30`, `PreviewTab.tsx:276,316`, `ProjectGroup.tsx:357`) compile unchanged — the new parameter is optional and positional, no rename.

### Step 3: Run desktop tests

Run: `pnpm --filter @qlan-ro/mainframe-desktop test`

Expected: all tests pass (no existing test exercises the new arg).

### Step 4: Commit

```bash
git add packages/desktop/src/renderer/lib/client.ts
git commit -m "feat(desktop): allow createChat to attach worktree at birth"
```

---

## Task 6: Add `handleNewSession` to `useBranchActions`

**Files:**
- Modify: `packages/desktop/src/renderer/components/git/useBranchActions.ts`
- Test: `packages/desktop/src/__tests__/components/git/useBranchActions-new-session.test.tsx` (new)

### Step 1: Write failing handler test

Create `packages/desktop/src/__tests__/components/git/useBranchActions-new-session.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBranchActions } from '../../../renderer/components/git/useBranchActions';

vi.mock('../../../renderer/lib/api', () => ({
  getGitBranches: vi.fn().mockResolvedValue({ current: 'main', local: [], remote: [], worktrees: [] }),
  getGitStatus: vi.fn().mockResolvedValue({ files: [] }),
  getProjectWorktrees: vi.fn(),
  deleteWorktree: vi.fn(),
  gitCheckout: vi.fn(),
  gitCreateBranch: vi.fn(),
  gitFetch: vi.fn(),
  gitPull: vi.fn(),
  gitPush: vi.fn(),
  gitMerge: vi.fn(),
  gitRebase: vi.fn(),
  gitAbort: vi.fn(),
  gitRenameBranch: vi.fn(),
  gitDeleteBranch: vi.fn(),
  gitUpdateAll: vi.fn(),
}));

vi.mock('../../../renderer/lib/toast', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('../../../renderer/lib/client', () => ({
  daemonClient: { createChat: vi.fn() },
}));

vi.mock('../../../renderer/lib/adapters', () => ({
  getDefaultModelForAdapter: vi.fn(() => 'claude-sonnet-4-5'),
}));

import { getProjectWorktrees } from '../../../renderer/lib/api';
import { daemonClient } from '../../../renderer/lib/client';
import { toast } from '../../../renderer/lib/toast';

describe('useBranchActions.handleNewSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves worktree path and calls daemonClient.createChat with attachWorktree', async () => {
    (getProjectWorktrees as any).mockResolvedValue({
      worktrees: [
        { path: '/projects/my-repo', branch: 'refs/heads/main' },
        { path: '/projects/my-repo/.worktrees/feat-x', branch: 'refs/heads/feat-x' },
      ],
    });

    const { result } = renderHook(() =>
      useBranchActions('proj-1', 'chat-a', vi.fn(), vi.fn()),
    );

    let success = false;
    await act(async () => {
      success = await result.current.handleNewSession('feat-x', 'feat-x');
    });

    expect(success).toBe(true);
    expect(daemonClient.createChat).toHaveBeenCalledWith(
      'proj-1',
      'claude',
      'claude-sonnet-4-5',
      undefined,
      { worktreePath: '/projects/my-repo/.worktrees/feat-x', branchName: 'feat-x' },
    );
  });

  it('shows an error toast and does not create chat when the worktree cannot be resolved', async () => {
    (getProjectWorktrees as any).mockResolvedValue({ worktrees: [] });

    const { result } = renderHook(() =>
      useBranchActions('proj-1', undefined, vi.fn(), vi.fn()),
    );

    let success = false;
    await act(async () => {
      success = await result.current.handleNewSession('ghost', 'ghost');
    });

    expect(success).toBe(true); // withBusy resolves; the failure is surfaced via toast, not throw
    expect(daemonClient.createChat).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("ghost"));
  });

  it('calls onClose after a successful creation', async () => {
    (getProjectWorktrees as any).mockResolvedValue({
      worktrees: [{ path: '/projects/my-repo/.worktrees/feat-x', branch: 'refs/heads/feat-x' }],
    });
    const onClose = vi.fn();

    const { result } = renderHook(() =>
      useBranchActions('proj-1', undefined, vi.fn(), onClose),
    );

    await act(async () => {
      await result.current.handleNewSession('feat-x', 'feat-x');
    });

    expect(onClose).toHaveBeenCalled();
  });
});
```

### Step 2: Run test to verify failure

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- useBranchActions-new-session`

Expected: FAIL — `handleNewSession` is not defined on the returned object (TypeScript or runtime error).

### Step 3: Add the handler and export it

Edit `packages/desktop/src/renderer/components/git/useBranchActions.ts`:

**3a.** At the top of the file, add these imports next to the existing `getProjectWorktrees`/`deleteWorktree` import block (after line 21):

```ts
import { daemonClient } from '../../lib/client';
import { getDefaultModelForAdapter } from '../../lib/adapters';
```

**3b.** Extend the `BranchActions` interface (after line 49, before the closing brace of the interface):

```ts
handleNewSession: (worktreeDirName: string, branchName: string | undefined) => Promise<boolean>;
```

**3c.** Insert the new handler immediately after `handleDeleteWorktree` (after line 299, before the `return {` block):

```ts
const handleNewSession = useCallback(
  async (worktreeDirName: string, branchName: string | undefined) => {
    return withBusy(async () => {
      const { worktrees } = await getProjectWorktrees(projectId);
      const match = worktrees.find(
        (wt) => wt.path.endsWith(`/${worktreeDirName}`) || wt.path === worktreeDirName,
      );
      if (!match) {
        toast.error(`Could not resolve path for worktree '${worktreeDirName}'`);
        return;
      }
      daemonClient.createChat(
        projectId,
        'claude',
        getDefaultModelForAdapter('claude'),
        undefined,
        { worktreePath: match.path, branchName: branchName ?? worktreeDirName },
      );
      toast.success(`Started new session on worktree '${worktreeDirName}'`);
      onClose();
    });
  },
  [projectId, onClose, withBusy],
);
```

**3d.** Add `handleNewSession` to the return object (inside the `return { ... }` at lines 301–319, near `handleDeleteWorktree`):

```ts
handleDeleteWorktree,
handleNewSession,
```

### Step 4: Run tests to verify pass

Run: `pnpm --filter @qlan-ro/mainframe-desktop test -- useBranchActions-new-session`

Expected: PASS — all three tests pass.

### Step 5: Commit

```bash
git add packages/desktop/src/renderer/components/git/useBranchActions.ts \
        packages/desktop/src/__tests__/components/git/useBranchActions-new-session.test.tsx
git commit -m "feat(branches): handleNewSession creates a chat on a worktree"
```

---

## Task 7: Add `Plus` button to `WorktreeSection`

**Files:**
- Modify: `packages/desktop/src/renderer/components/git/BranchList.tsx`

### Step 1: Extend `BranchListProps` and `WorktreeSection` props

Edit `packages/desktop/src/renderer/components/git/BranchList.tsx`:

**1a.** Update the import on line 2:

```ts
import { ChevronRight, ChevronDown, GitBranch, Star, Trash2, Plus } from 'lucide-react';
```

**1b.** Extend `BranchListProps` (around line 12–20) — add under `onDeleteWorktree`:

```ts
onNewSession?: (worktreeDirName: string, branchName: string | undefined) => void;
```

**1c.** Extend `WorktreeSection` props object (around line 151–163):

```ts
function WorktreeSection({
  name,
  branches,
  currentBranch,
  onSelectBranch,
  onDeleteWorktree,
  onNewSession,
}: {
  name: string;
  branches: BranchInfo[];
  currentBranch: string;
  onSelectBranch: (branch: string, isCurrent: boolean, isRemote: boolean) => void;
  onDeleteWorktree?: (worktreeDirName: string, branchName: string | undefined) => void;
  onNewSession?: (worktreeDirName: string, branchName: string | undefined) => void;
}): React.ReactElement {
```

### Step 2: Render the `Plus` button before `Trash2`

Edit `packages/desktop/src/renderer/components/git/BranchList.tsx`, inside the `<div className="flex items-center">` wrapper (currently lines 170–192). Insert the `Plus` block **before** the existing `{onDeleteWorktree && ...}` block:

```tsx
<div className="flex items-center">
  <button
    onClick={() => setExpanded(!expanded)}
    className="flex-1 flex items-center gap-1 px-2 py-1 text-xs font-semibold text-mf-text-secondary uppercase tracking-wider"
  >
    {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
    {name}
  </button>
  {onNewSession && (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => onNewSession(name, branchName)}
          className="p-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-text-primary transition-colors"
          aria-label={`New session on worktree ${name}`}
        >
          <Plus size={11} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">New session on this worktree</TooltipContent>
    </Tooltip>
  )}
  {onDeleteWorktree && (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={() => onDeleteWorktree(name, branchName)}
          className="p-1 mr-1 rounded hover:bg-mf-hover text-mf-text-secondary hover:text-mf-destructive transition-colors"
          aria-label={`Delete worktree ${name}`}
        >
          <Trash2 size={11} />
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">Delete worktree</TooltipContent>
    </Tooltip>
  )}
</div>
```

Note: the `Plus` button has no `mr-1` (the existing trash button keeps `mr-1` so it flushes against the row's right edge). `hover:text-mf-text-primary` (non-destructive) differentiates it from the trash button's `hover:text-mf-destructive`.

### Step 3: Pass `onNewSession` through `BranchList`

Edit `packages/desktop/src/renderer/components/git/BranchList.tsx`:

**3a.** Extend the `BranchList` function props (around lines 210–218):

```tsx
export function BranchList({
  local,
  remote,
  worktrees,
  currentBranch,
  search,
  onSelectBranch,
  onDeleteWorktree,
  onNewSession,
}: BranchListProps): React.ReactElement {
```

**3b.** Forward the prop in the `worktreeGroups.map(...)` render (around lines 293–302):

```tsx
{worktreeGroups.map((wt) => (
  <WorktreeSection
    key={wt.name}
    name={wt.name}
    branches={wt.branches}
    currentBranch={currentBranch}
    onSelectBranch={onSelectBranch}
    onDeleteWorktree={onDeleteWorktree}
    onNewSession={onNewSession}
  />
))}
```

### Step 4: Typecheck

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`

Expected: build passes. The `onNewSession` prop is optional, so the UI renders fine even if no parent passes it yet.

### Step 5: Commit

```bash
git add packages/desktop/src/renderer/components/git/BranchList.tsx
git commit -m "feat(branches): Plus button on worktree rows"
```

---

## Task 8: Wire `onNewSession` through `BranchPopover`

**Files:**
- Modify: `packages/desktop/src/renderer/components/git/BranchPopover.tsx:232-240`

### Step 1: Pass the handler to `BranchList`

Edit `packages/desktop/src/renderer/components/git/BranchPopover.tsx` replacing lines 232–240 (the `<BranchList ... />` element):

```tsx
<BranchList
  local={branches.local}
  remote={branches.remote}
  worktrees={branches.worktrees}
  currentBranch={branches.current}
  search={search}
  onSelectBranch={handleSelectBranch}
  onDeleteWorktree={actions.handleDeleteWorktree}
  onNewSession={actions.handleNewSession}
/>
```

### Step 2: Typecheck the desktop package

Run: `pnpm --filter @qlan-ro/mainframe-desktop build`

Expected: build passes.

### Step 3: Run desktop tests

Run: `pnpm --filter @qlan-ro/mainframe-desktop test`

Expected: all existing and new tests pass.

### Step 4: Commit

```bash
git add packages/desktop/src/renderer/components/git/BranchPopover.tsx
git commit -m "feat(branches): wire new-session button in popover"
```

---

## Task 9: Full verification and changeset

**Files:**
- Create: `.changeset/new-session-on-worktree.md`

### Step 1: Run full test suites

Run: `pnpm --filter @qlan-ro/mainframe-core test && pnpm --filter @qlan-ro/mainframe-desktop test`

Expected: all tests pass.

### Step 2: Full build

Run: `pnpm build`

Expected: all three packages build with no TypeScript errors.

### Step 3: Write changeset

Create `.changeset/new-session-on-worktree.md`:

```markdown
---
'@qlan-ro/mainframe-core': minor
'@qlan-ro/mainframe-desktop': minor
---

Add a "+" button to worktree rows in the Branches popover that starts a new Claude session already attached to that worktree. Under the hood, the `chat.create` WebSocket message now accepts optional `worktreePath` and `branchName` fields so the attachment is atomic.
```

### Step 4: Commit changeset

```bash
git add .changeset/new-session-on-worktree.md
git commit -m "chore: changeset for new-session-on-worktree"
```

### Step 5: Manual verification

This is a manual checklist — not an automated step. Do **all** of these in order before opening the PR:

1. Start the app (`pnpm --filter @qlan-ro/mainframe-desktop dev` or via the normal launch script).
2. Pick a project with at least one non-main worktree. If none, create one: `git -C <project> worktree add .worktrees/tmp-new-session-test -b tmp-new-session-test`.
3. Open the Branches popover from the chat header.
4. Confirm: the main worktree section (shown as loose local branches at the top) shows **neither** `+` nor `Trash`.
5. Confirm: each non-main worktree section shows `+` then `Trash`, in that order, right-aligned.
6. Hover the `+` — tooltip reads "New session on this worktree".
7. Click `+` on the `tmp-new-session-test` row.
8. Expected: popover closes, a new chat tab opens, the top banner shows "Working in worktree isolation", and prompting the agent to `pwd` returns the worktree's absolute path.
9. Cleanup: `git -C <project> worktree remove .worktrees/tmp-new-session-test`.

If any step fails, do not open the PR — debug and add a task above.

### Step 6: Commit any fixes from manual testing

If step 5 reveals a fix, commit it as a follow-up:

```bash
git add <fixed files>
git commit -m "fix(branches): <describe the fix>"
```

Skip if nothing was needed.

---

## Self-Review Checklist

Run these **before** handing off to execution:

**Spec coverage:** each spec section has a task —
- UI (Plus icon, visibility, styling, tooltip) → Task 7
- Client action (`handleNewSession`, close popover) → Task 6
- Server (`chat.create` schema extension) → Task 1
- Server plumbing (lifecycle → chat-manager → websocket handler) → Tasks 2, 3, 4
- Desktop client signature → Task 5
- Validation & error handling (empty string rejection, toast.error on resolve failure) → Tasks 1, 6
- Tests (core lifecycle, desktop handler) → Tasks 2, 6

**Placeholder scan:** no "TBD", "add appropriate error handling", "similar to Task N", unexecutable steps — confirmed.

**Type consistency:** `handleNewSession: (worktreeDirName: string, branchName: string | undefined) => Promise<boolean>` is used identically in interface, handler, and `BranchList` prop. The WS schema field names `worktreePath`/`branchName` match the lifecycle signature names and the desktop `attachWorktree` object keys.
