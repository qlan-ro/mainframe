# Append System Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Instruct Claude to use `AskUserQuestion` tool for all user interaction by appending to its system prompt.

**Architecture:** Define a shared prompt constant in a new `constants.ts` file. The CLI adapter passes it via `--append-system-prompt` flag. The SDK adapter passes it via the `appendSystemPrompt` query option.

**Tech Stack:** TypeScript, Node.js child_process, Anthropic Claude Agent SDK

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/core/src/plugins/builtin/claude/constants.ts` | Shared prompt constant |
| Modify | `packages/core/src/plugins/builtin/claude/session.ts:120-128` | Add `--append-system-prompt` to spawn args |
| Modify | `packages/core/src/plugins/builtin/claude-sdk/session.ts:93-104` | Add `appendSystemPrompt` to query options |
| Modify | `packages/core/src/__tests__/session-spawn-args.test.ts` | Test CLI adapter spawn args |
| Modify | `packages/core/src/__tests__/plugins/claude-sdk/session.test.ts` | Test SDK adapter query options |

---

### Task 1: Create shared constant

**Files:**
- Create: `packages/core/src/plugins/builtin/claude/constants.ts`

- [ ] **Step 1: Create the constants file**

```ts
/**
 * System prompt appended to every Claude session spawned by Mainframe.
 * Instructs Claude to use AskUserQuestion for interactive input instead of
 * plain-text questions, since Mainframe renders it as clickable UI elements.
 */
export const MAINFRAME_SYSTEM_PROMPT_APPEND = [
  'You are running inside Mainframe, a desktop GUI that manages your session.',
  'When you need user input, clarification, or a decision, use the AskUserQuestion',
  'tool — it renders as an interactive UI element the user can click. Do not ask',
  'questions in plain text.',
].join(' ');
```

- [ ] **Step 2: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/constants.ts
git commit -m "feat: add shared system prompt constant for Mainframe sessions"
```

---

### Task 2: Wire CLI adapter + test (TDD)

**Files:**
- Modify: `packages/core/src/__tests__/session-spawn-args.test.ts`
- Modify: `packages/core/src/plugins/builtin/claude/session.ts:120-128`

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe('ClaudeSession spawn args')` block in `packages/core/src/__tests__/session-spawn-args.test.ts`:

```ts
it('includes --append-system-prompt with Mainframe prompt', async () => {
  const { ClaudeSession } = await import('../plugins/builtin/claude/session.js');
  const { MAINFRAME_SYSTEM_PROMPT_APPEND } = await import('../plugins/builtin/claude/constants.js');
  const session = new ClaudeSession({ projectPath: '/tmp', chatId: undefined });
  await session.spawn({} as any).catch(() => {});
  const args = spawnMock.mock.calls[0]?.[1] as string[];
  const idx = args.indexOf('--append-system-prompt');
  expect(idx).toBeGreaterThan(-1);
  expect(args[idx + 1]).toBe(MAINFRAME_SYSTEM_PROMPT_APPEND);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run --reporter=verbose packages/core/src/__tests__/session-spawn-args.test.ts`

Expected: FAIL — `--append-system-prompt` not found in args.

- [ ] **Step 3: Add the flag to spawn args**

In `packages/core/src/plugins/builtin/claude/session.ts`, add the import at the top:

```ts
import { MAINFRAME_SYSTEM_PROMPT_APPEND } from './constants.js';
```

Then in the `spawn()` method, add these two lines after the existing args array (after line 128, before the `if (this.resumeSessionId)` check):

```ts
args.push('--append-system-prompt', MAINFRAME_SYSTEM_PROMPT_APPEND);
```

The args block should look like:

```ts
const args = [
  '--output-format',
  'stream-json',
  '--input-format',
  'stream-json',
  '--verbose',
  '--permission-prompt-tool',
  'stdio',
];

args.push('--append-system-prompt', MAINFRAME_SYSTEM_PROMPT_APPEND);

if (this.resumeSessionId) args.push('--resume', this.resumeSessionId);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run --reporter=verbose packages/core/src/__tests__/session-spawn-args.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/session.ts packages/core/src/__tests__/session-spawn-args.test.ts
git commit -m "feat: append Mainframe system prompt to Claude CLI spawn args"
```

---

### Task 3: Wire SDK adapter + test (TDD)

**Files:**
- Modify: `packages/core/src/__tests__/plugins/claude-sdk/session.test.ts`
- Modify: `packages/core/src/plugins/builtin/claude-sdk/session.ts:93-104`

- [ ] **Step 1: Write the failing test**

Add this test to the existing `describe('ClaudeSdkSession')` block in `packages/core/src/__tests__/plugins/claude-sdk/session.test.ts`:

```ts
it('passes appendSystemPrompt in query options', async () => {
  const { MAINFRAME_SYSTEM_PROMPT_APPEND } = await import('../../../plugins/builtin/claude/constants.js');
  const mockGen = createMockQuery([]);
  (mockQuery as ReturnType<typeof vi.fn>).mockReturnValue(mockGen);

  const session = new ClaudeSdkSession({ projectPath: '/tmp/test' });
  const sink = createMockSink();
  await session.spawn({}, sink);
  await session.sendMessage('Hello');

  const callArgs = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0];
  expect(callArgs.options.appendSystemPrompt).toBe(MAINFRAME_SYSTEM_PROMPT_APPEND);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run --reporter=verbose packages/core/src/__tests__/plugins/claude-sdk/session.test.ts`

Expected: FAIL — `appendSystemPrompt` is undefined.

- [ ] **Step 3: Add appendSystemPrompt to SDK query options**

In `packages/core/src/plugins/builtin/claude-sdk/session.ts`, add the import at the top:

```ts
import { MAINFRAME_SYSTEM_PROMPT_APPEND } from '../claude/constants.js';
```

Then in the `startQuery()` method, add `appendSystemPrompt` to the options object (after line 98, inside the `options` object literal):

```ts
const options: Record<string, any> = {
  cwd: this.projectPath,
  permissionMode: toSdkPermissionMode(this.spawnOptions.permissionMode),
  allowDangerouslySkipPermissions: true,
  appendSystemPrompt: MAINFRAME_SYSTEM_PROMPT_APPEND,
  env: {
    ...process.env,
    FORCE_COLOR: '0',
    NO_COLOR: '1',
    CLAUDECODE: undefined,
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run --reporter=verbose packages/core/src/__tests__/plugins/claude-sdk/session.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/claude-sdk/session.ts packages/core/src/__tests__/plugins/claude-sdk/session.test.ts
git commit -m "feat: append Mainframe system prompt to Claude SDK query options"
```

---

### Task 4: Typecheck and full test suite

- [ ] **Step 1: Run typecheck**

Run: `pnpm --filter @qlan-ro/mainframe-core build`

Expected: No type errors.

- [ ] **Step 2: Run full core test suite**

Run: `pnpm --filter @qlan-ro/mainframe-core test -- --run`

Expected: All tests PASS. No regressions.

- [ ] **Step 3: Final commit (if any fixes needed)**

Only if typecheck or tests revealed issues that needed fixing.
