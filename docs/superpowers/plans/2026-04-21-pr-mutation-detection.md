# PR Mutation Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend PR detection so that `gh pr edit|ready|merge|close|reopen|comment|review` and GitLab/Azure equivalents register a "session touched PR #N" signal, even when the tool_result output omits the PR URL.

**Architecture:** Add a second detection path in `packages/core/src/plugins/builtin/claude/events.ts` that parses the PR identifier from Bash **command args** (URL or `owner/repo#N` compact form) at assistant-event time, stashes it keyed by `tool_use_id`, and emits `sink.onPrDetected({..., source: 'mentioned'})` at user-event time if the tool_result didn't error. The existing tool_result URL scraper (Path A) continues unchanged; the frontend's `(owner, repo, number)` dedup absorbs any overlap.

**Tech Stack:** TypeScript (strict, NodeNext), Vitest, pnpm workspaces. No new runtime dependencies. Changes are confined to the `@qlan-ro/mainframe-core` package and one docs file.

**Spec:** `docs/superpowers/specs/2026-04-21-pr-mutation-detection-design.md`

---

## Task 1: Add `pendingPrMutations` to session state

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/session.ts:48-66` (interface `ClaudeSessionState`)
- Modify: `packages/core/src/plugins/builtin/claude/session.ts:94-105` (constructor state init)

This task introduces the state field but leaves it unused. It's a one-line-each change that makes later tasks' type references valid.

- [ ] **Step 1: Extend `ClaudeSessionState` with `pendingPrMutations`**

Modify the interface at `packages/core/src/plugins/builtin/claude/session.ts` (around lines 48-66). Add one field right after `pendingPrCreates`:

```ts
export interface ClaudeSessionState {
  chatId: string;
  buffer: string;
  lastAssistantUsage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  child: ChildProcess | null;
  status: 'starting' | 'ready' | 'running' | 'stopped' | 'error';
  pid: number;
  activeTasks: Map<string, { type: string; command?: string }>;
  interruptTimer: ReturnType<typeof setTimeout> | null;
  /** Pending cancel_async_message callbacks keyed by request_id */
  pendingCancelCallbacks: Map<string, (cancelled: boolean) => void>;
  /** Tool_use IDs for Bash commands that match PR-create patterns (gh pr create, etc.) */
  pendingPrCreates: Set<string>;
  /** Tool_use IDs → parsed PR info for mutation commands (gh pr edit/ready/merge/close/reopen/comment/review, etc.) */
  pendingPrMutations: Map<string, { url: string; owner: string; repo: string; number: number }>;
}
```

- [ ] **Step 2: Initialize `pendingPrMutations` in the constructor**

In the same file, the constructor currently sets `pendingPrCreates: new Set()` around line 103. Add the mutations map right below it:

```ts
    this.state = {
      chatId: options.chatId ?? '',
      buffer: '',
      child: null,
      status: 'starting',
      pid: 0,
      activeTasks: new Map(),
      interruptTimer: null,
      pendingCancelCallbacks: new Map(),
      pendingPrCreates: new Set(),
      pendingPrMutations: new Map(),
    };
```

- [ ] **Step 3: Typecheck via build**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/session.ts
git commit -m "feat(core): add pendingPrMutations to claude session state"
```

---

## Task 2: Add mutation-command regexes and arg parser (TDD)

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/events.ts` (add near the existing `PR_CREATE_COMMANDS`, around lines 23-31)
- Create: `packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts`

This task adds pure functions: `PR_MUTATION_COMMANDS`, `isPrMutationCommand`, `parsePrIdentifierFromArgs`. No call-sites yet — those come in Tasks 3 and 4.

- [ ] **Step 1: Write failing tests for `isPrMutationCommand`**

Create `packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import { handleStdout, isPrMutationCommand, parsePrIdentifierFromArgs } from '../events.js';
import type { ClaudeSession } from '../session.js';

function createMockSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onCompactStart: vi.fn(),
    onContextUsage: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
    onQueuedProcessed: vi.fn(),
    onTodoUpdate: vi.fn(),
    onPrDetected: vi.fn(),
  };
}

function createMockSession(): ClaudeSession {
  return {
    id: 'test-session',
    state: {
      buffer: '',
      chatId: null,
      status: 'ready',
      lastAssistantUsage: undefined,
      activeTasks: new Map(),
      pendingCancelCallbacks: new Map(),
      pendingPrCreates: new Set(),
      pendingPrMutations: new Map(),
    },
    clearInterruptTimer: vi.fn(),
    requestContextUsage: vi.fn(),
  } as unknown as ClaudeSession;
}

describe('isPrMutationCommand', () => {
  it('matches gh pr mutations', () => {
    expect(isPrMutationCommand('gh pr edit 42 --title "new"')).toBe(true);
    expect(isPrMutationCommand('gh pr ready 42')).toBe(true);
    expect(isPrMutationCommand('gh pr merge 42 --squash')).toBe(true);
    expect(isPrMutationCommand('gh pr close 42')).toBe(true);
    expect(isPrMutationCommand('gh pr reopen 42')).toBe(true);
    expect(isPrMutationCommand('gh pr comment 42 --body "hi"')).toBe(true);
    expect(isPrMutationCommand('gh pr review 42 --approve')).toBe(true);
  });

  it('matches glab mr mutations', () => {
    expect(isPrMutationCommand('glab mr update 7 --title "new"')).toBe(true);
    expect(isPrMutationCommand('glab mr merge 7')).toBe(true);
    expect(isPrMutationCommand('glab mr close 7')).toBe(true);
    expect(isPrMutationCommand('glab mr reopen 7')).toBe(true);
    expect(isPrMutationCommand('glab mr note 7 --message "hi"')).toBe(true);
  });

  it('matches az repos pr update', () => {
    expect(isPrMutationCommand('az repos pr update --id 5 --status completed')).toBe(true);
  });

  it('does not match read-only or create commands', () => {
    expect(isPrMutationCommand('gh pr view 42')).toBe(false);
    expect(isPrMutationCommand('gh pr list')).toBe(false);
    expect(isPrMutationCommand('gh pr create --title "x"')).toBe(false);
    expect(isPrMutationCommand('gh pr checkout 42')).toBe(false);
    expect(isPrMutationCommand('gh pr diff 42')).toBe(false);
    expect(isPrMutationCommand('gh pr status')).toBe(false);
    expect(isPrMutationCommand('glab mr list')).toBe(false);
    expect(isPrMutationCommand('glab mr view 7')).toBe(false);
    expect(isPrMutationCommand('glab mr create')).toBe(false);
    expect(isPrMutationCommand('git push')).toBe(false);
    expect(isPrMutationCommand('echo gh pr edit 42')).toBe(true); // word-boundary match; acceptable — rare false positive
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts`
Expected: FAIL. Errors reference missing exports `isPrMutationCommand`, `parsePrIdentifierFromArgs`.

- [ ] **Step 3: Implement `PR_MUTATION_COMMANDS` and `isPrMutationCommand`**

In `packages/core/src/plugins/builtin/claude/events.ts`, right after the existing `PR_CREATE_COMMANDS` block (around lines 23-31), add:

```ts
export const PR_MUTATION_COMMANDS: RegExp[] = [
  /\bgh\s+pr\s+(edit|ready|merge|close|reopen|comment|review)\b/,
  /\bglab\s+mr\s+(update|merge|close|reopen|note)\b/,
  /\baz\s+repos\s+pr\s+update\b/,
];

export function isPrMutationCommand(command: string): boolean {
  return PR_MUTATION_COMMANDS.some((re) => re.test(command));
}
```

- [ ] **Step 4: Run tests for `isPrMutationCommand` to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts -t isPrMutationCommand`
Expected: `isPrMutationCommand` suite passes. Other tests in the file still fail (missing `parsePrIdentifierFromArgs`).

- [ ] **Step 5: Write failing tests for `parsePrIdentifierFromArgs`**

Append to the same test file:

```ts
describe('parsePrIdentifierFromArgs', () => {
  it('parses a GitHub PR URL', () => {
    expect(parsePrIdentifierFromArgs('gh pr edit https://github.com/org/repo/pull/42 --add-label bug')).toEqual({
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
    });
  });

  it('parses a GitLab MR URL', () => {
    expect(parsePrIdentifierFromArgs('glab mr update https://gitlab.com/org/repo/-/merge_requests/7')).toEqual({
      url: 'https://gitlab.com/org/repo/-/merge_requests/7',
      owner: 'org',
      repo: 'repo',
      number: 7,
    });
  });

  it('parses an Azure DevOps PR URL', () => {
    expect(
      parsePrIdentifierFromArgs(
        'az repos pr update https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/5',
      ),
    ).toEqual({
      url: 'https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/5',
      owner: 'myorg',
      repo: 'myrepo',
      number: 5,
    });
  });

  it('parses gh compact syntax owner/repo#N', () => {
    expect(parsePrIdentifierFromArgs('gh pr ready org/repo#42')).toEqual({
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
    });
  });

  it('returns null when command has no PR identifier', () => {
    expect(parsePrIdentifierFromArgs('gh pr edit 42 --title x')).toBeNull();
    expect(parsePrIdentifierFromArgs('gh pr edit')).toBeNull();
    expect(parsePrIdentifierFromArgs('az repos pr update --id 5')).toBeNull();
  });

  it('does not accept compact syntax for non-gh commands', () => {
    expect(parsePrIdentifierFromArgs('glab mr update org/repo#42')).toBeNull();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts -t parsePrIdentifierFromArgs`
Expected: FAIL. `parsePrIdentifierFromArgs is not a function`.

- [ ] **Step 7: Implement `parsePrIdentifierFromArgs`**

Still in `events.ts`, add after `isPrMutationCommand`:

```ts
const GH_COMPACT_REF_REGEX = /\b([^/\s#]+)\/([^/\s#]+)#(\d+)\b/;

export function parsePrIdentifierFromArgs(
  command: string,
): { url: string; owner: string; repo: string; number: number } | null {
  // Try full URLs first — any of the three existing regexes.
  const fromUrl = extractPrFromToolResult(command);
  if (fromUrl) return fromUrl;

  // gh-only compact syntax: owner/repo#N
  if (/\bgh\s+pr\s+/.test(command)) {
    const match = GH_COMPACT_REF_REGEX.exec(command);
    if (match) {
      const owner = match[1]!;
      const repo = match[2]!;
      const number = parseInt(match[3]!, 10);
      if (owner && repo && !isNaN(number)) {
        return { url: `https://github.com/${owner}/${repo}/pull/${number}`, owner, repo, number };
      }
    }
  }
  return null;
}
```

The parser delegates to `extractPrFromToolResult` for full URLs (the regex set is identical to what the tool-result scanner already uses). The compact-syntax branch only fires for `gh pr *` commands.

- [ ] **Step 8: Run all tests in the new file to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts`
Expected: all `isPrMutationCommand` and `parsePrIdentifierFromArgs` tests pass.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/events.ts packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts
git commit -m "feat(core): parse PR identifier from Bash mutation-command args"
```

---

## Task 3: Stash pending mutations at assistant-event time (TDD)

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/events.ts:138-183` (function `handleAssistantEvent`)
- Modify: `packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts`

Wire the assistant-event path: when a Bash tool_use command is a mutation command **and** the args contain a parseable identifier, stash `tool_use_id → prInfo` in `session.state.pendingPrMutations`.

- [ ] **Step 1: Write failing stash test**

Append to `pr-mutation-detection.test.ts`:

```ts
describe('handleAssistantEvent stashes pending mutations', () => {
  it('stashes tool_use_id and PR info for gh pr edit with URL arg', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_mut_1',
            name: 'Bash',
            input: { command: 'gh pr edit https://github.com/org/repo/pull/42 --add-label bug' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(session.state.pendingPrMutations.get('tu_mut_1')).toEqual({
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
    });
  });

  it('stashes with gh compact syntax', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_mut_2',
            name: 'BashTool',
            input: { command: 'gh pr ready org/repo#42' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(session.state.pendingPrMutations.get('tu_mut_2')).toEqual({
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
    });
  });

  it('does not stash number-only args (gh pr edit 42)', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_mut_3',
            name: 'Bash',
            input: { command: 'gh pr edit 42 --title new' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(session.state.pendingPrMutations.has('tu_mut_3')).toBe(false);
  });

  it('does not stash non-mutation commands even with PR URL in args', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_mut_4',
            name: 'Bash',
            input: { command: 'echo https://github.com/org/repo/pull/42' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(session.state.pendingPrMutations.has('tu_mut_4')).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts -t "stashes pending mutations"`
Expected: FAIL. `pendingPrMutations` stays empty.

- [ ] **Step 3: Wire the stash in `handleAssistantEvent`**

In `packages/core/src/plugins/builtin/claude/events.ts`, find the existing `isPrCreateCommand` block (around lines 168-174) inside `handleAssistantEvent`:

```ts
        const name = block.name as string;
        if (name === 'Bash' || name === 'BashTool') {
          const input = block.input as { command?: string } | undefined;
          if (input?.command && isPrCreateCommand(input.command)) {
            session.state.pendingPrCreates.add(block.id as string);
          }
        }
```

Extend it to also stash mutations:

```ts
        const name = block.name as string;
        if (name === 'Bash' || name === 'BashTool') {
          const input = block.input as { command?: string } | undefined;
          if (input?.command && isPrCreateCommand(input.command)) {
            session.state.pendingPrCreates.add(block.id as string);
          }
          if (input?.command && isPrMutationCommand(input.command)) {
            const pr = parsePrIdentifierFromArgs(input.command);
            if (pr) session.state.pendingPrMutations.set(block.id as string, pr);
          }
        }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts -t "stashes pending mutations"`
Expected: all four stash tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/events.ts packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts
git commit -m "feat(core): stash pending PR mutations at assistant-event time"
```

---

## Task 4: Consume pending mutations at user-event time (TDD)

**Files:**
- Modify: `packages/core/src/plugins/builtin/claude/events.ts:213-226` (tool_result branch in `handleUserEvent`)
- Modify: `packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts`

At tool_result time: if `tool_use_id` is in `pendingPrMutations` and `is_error !== true`, emit `sink.onPrDetected({...stashed, source: 'mentioned'})` and remove the entry.

- [ ] **Step 1: Write failing emission tests**

Append to `pr-mutation-detection.test.ts`:

```ts
describe('handleUserEvent consumes pending mutations', () => {
  it('emits source:mentioned when tool_result matches a pending mutation', () => {
    const sink = createMockSink();
    const session = createMockSession();

    // Simulate stash
    session.state.pendingPrMutations.set('tu_mut_ok', {
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
    });

    const userEvent = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_mut_ok',
            content: 'OK',
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(userEvent) + '\n'), sink);

    expect(sink.onPrDetected).toHaveBeenCalledWith({
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
      source: 'mentioned',
    });
    expect(session.state.pendingPrMutations.has('tu_mut_ok')).toBe(false);
  });

  it('does not emit when tool_result has is_error: true', () => {
    const sink = createMockSink();
    const session = createMockSession();

    session.state.pendingPrMutations.set('tu_mut_err', {
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
    });

    const userEvent = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_mut_err',
            content: 'authentication failed',
            is_error: true,
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(userEvent) + '\n'), sink);

    expect(sink.onPrDetected).not.toHaveBeenCalled();
    expect(session.state.pendingPrMutations.has('tu_mut_err')).toBe(false);
  });

  it('end-to-end: gh pr edit with URL arg emits source:mentioned after success', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const assistantEvent = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_e2e_1',
            name: 'Bash',
            input: { command: 'gh pr edit https://github.com/org/repo/pull/42 --add-label bug' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(assistantEvent) + '\n'), sink);

    const userEvent = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_e2e_1',
            content: '✓ Edited pull request #42',
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(userEvent) + '\n'), sink);

    expect(sink.onPrDetected).toHaveBeenCalledWith({
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
      source: 'mentioned',
    });
  });

  it('number-only gh pr edit 42 still detected via Path A when output contains URL', () => {
    const sink = createMockSink();
    const session = createMockSession();

    // tool_use with number-only arg → Path B does NOT stash
    const assistantEvent = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_num_1',
            name: 'Bash',
            input: { command: 'gh pr edit 42 --title new' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(assistantEvent) + '\n'), sink);
    expect(session.state.pendingPrMutations.has('tu_num_1')).toBe(false);

    // tool_result contains URL → Path A emits as 'mentioned' (not in pendingPrCreates)
    const userEvent = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_num_1',
            content: 'https://github.com/org/repo/pull/42',
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(userEvent) + '\n'), sink);

    expect(sink.onPrDetected).toHaveBeenCalledWith({
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
      source: 'mentioned',
    });
  });

  it('create and mutate in the same assistant turn are handled independently', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const assistantEvent = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_create',
            name: 'Bash',
            input: { command: 'gh pr create --title "feat"' },
          },
          {
            type: 'tool_use',
            id: 'tu_edit',
            name: 'Bash',
            input: { command: 'gh pr edit https://github.com/org/repo/pull/10 --add-label priority' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(assistantEvent) + '\n'), sink);

    expect(session.state.pendingPrCreates.has('tu_create')).toBe(true);
    expect(session.state.pendingPrMutations.has('tu_edit')).toBe(true);

    const userEvent = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_create',
            content: 'https://github.com/org/repo/pull/11',
          },
          {
            type: 'tool_result',
            tool_use_id: 'tu_edit',
            content: '✓ Edited',
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(userEvent) + '\n'), sink);

    expect(sink.onPrDetected).toHaveBeenCalledWith({
      url: 'https://github.com/org/repo/pull/11',
      owner: 'org',
      repo: 'repo',
      number: 11,
      source: 'created',
    });
    expect(sink.onPrDetected).toHaveBeenCalledWith({
      url: 'https://github.com/org/repo/pull/10',
      owner: 'org',
      repo: 'repo',
      number: 10,
      source: 'mentioned',
    });
  });

  it('emits only once when tool_result output also contains the same URL (dedup handled by frontend, core still fires twice)', () => {
    const sink = createMockSink();
    const session = createMockSession();

    session.state.pendingPrMutations.set('tu_overlap', {
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
    });

    const userEvent = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_overlap',
            content: '✓ https://github.com/org/repo/pull/42',
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(userEvent) + '\n'), sink);

    // Path A emits 'mentioned' from the URL in output; Path B also emits 'mentioned'.
    // Both calls are to onPrDetected with source:'mentioned' for the same PR.
    // The frontend dedup (chats.addDetectedPr) collapses them; core does not.
    expect(sink.onPrDetected).toHaveBeenCalledTimes(2);
    expect(sink.onPrDetected).toHaveBeenNthCalledWith(1, {
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
      source: 'mentioned',
    });
    expect(sink.onPrDetected).toHaveBeenNthCalledWith(2, {
      url: 'https://github.com/org/repo/pull/42',
      owner: 'org',
      repo: 'repo',
      number: 42,
      source: 'mentioned',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts -t "consumes pending mutations"`
Expected: FAIL. `onPrDetected` not called for the mutation cases.

- [ ] **Step 3: Wire consumption in `handleUserEvent`**

In `packages/core/src/plugins/builtin/claude/events.ts`, find the existing tool_result branch inside `handleUserEvent` (around lines 213-226):

```ts
  for (const block of message.content) {
    if (block.type === 'tool_result') {
      const text = typeof block.content === 'string' ? block.content : '';
      const planMatch = text.match(/Your plan has been saved to: (\/\S+\.md)/);
      if (planMatch?.[1]) {
        sink.onPlanFile(planMatch[1].trim());
      }
      const pr = extractPrFromToolResult(text);
      if (pr) {
        const toolUseId = block.tool_use_id as string | undefined;
        const source = toolUseId && session.state.pendingPrCreates.has(toolUseId) ? 'created' : 'mentioned';
        if (source === 'created') session.state.pendingPrCreates.delete(toolUseId!);
        sink.onPrDetected({ ...pr, source });
      }
    } else if (block.type === 'text') {
```

Add a Path B consumption block right after the existing Path A emission (after `sink.onPrDetected({ ...pr, source });`), still inside the `if (block.type === 'tool_result')` branch:

```ts
  for (const block of message.content) {
    if (block.type === 'tool_result') {
      const text = typeof block.content === 'string' ? block.content : '';
      const planMatch = text.match(/Your plan has been saved to: (\/\S+\.md)/);
      if (planMatch?.[1]) {
        sink.onPlanFile(planMatch[1].trim());
      }
      const pr = extractPrFromToolResult(text);
      if (pr) {
        const toolUseId = block.tool_use_id as string | undefined;
        const source = toolUseId && session.state.pendingPrCreates.has(toolUseId) ? 'created' : 'mentioned';
        if (source === 'created') session.state.pendingPrCreates.delete(toolUseId!);
        sink.onPrDetected({ ...pr, source });
      }

      // Path B: command-arg-based mutation detection. Consume any pending stash
      // keyed by this tool_use_id, regardless of whether the output contained a URL.
      const mutationToolUseId = block.tool_use_id as string | undefined;
      if (mutationToolUseId && session.state.pendingPrMutations.has(mutationToolUseId)) {
        const stashed = session.state.pendingPrMutations.get(mutationToolUseId)!;
        session.state.pendingPrMutations.delete(mutationToolUseId);
        if (block.is_error !== true) {
          sink.onPrDetected({ ...stashed, source: 'mentioned' });
        }
      }
    } else if (block.type === 'text') {
```

The `mutationToolUseId` local is separate from `toolUseId` so the two paths remain visually independent — they can be refactored later if needed, but keeping them distinct now makes the control flow easier to read during review.

- [ ] **Step 4: Run full test file to verify all tests pass**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts`
Expected: all tests pass.

- [ ] **Step 5: Run the existing PR detection tests to verify no regression**

Run: `pnpm --filter @qlan-ro/mainframe-core exec vitest run src/plugins/builtin/claude/__tests__/pr-detection.test.ts`
Expected: all existing tests still pass (no changes to create-path behavior).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/plugins/builtin/claude/events.ts packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts
git commit -m "feat(core): emit source:mentioned for successful PR mutation commands"
```

---

## Task 5: Update `PR_TRACKING.md` docs

**Files:**
- Modify: `docs/adapters/claude/PR_TRACKING.md:152-154` (the "What Mainframe Currently Does" section)

The doc currently says "Nothing — we don't detect or display PRs" which is stale. Replace it with a description of both paths.

- [ ] **Step 1: Replace the stale section**

In `docs/adapters/claude/PR_TRACKING.md`, find the final section:

```markdown
## What Mainframe Currently Does

Nothing — we don't detect or display PRs. Tool results flow through `sink.onToolResult()` but we don't scan them for PR URLs.
```

Replace it with:

```markdown
## What Mainframe Currently Does

Two detection paths in `packages/core/src/plugins/builtin/claude/events.ts`:

**Path A — tool_result URL scraping.** `extractPrFromToolResult()` scans Bash tool_result text for GitHub, GitLab, or Azure PR URLs. If the originating tool_use_id was stashed as a PR-create command (`gh pr create`, `glab mr create`, `az repos pr create`), the detection emits `source: 'created'`; otherwise `source: 'mentioned'`.

**Path B — command-args parsing for mutations.** When a Bash tool_use's command matches a PR mutation command and its args contain a parseable identifier (full URL or GitHub's compact `owner/repo#N`), the PR info is stashed under the `tool_use_id` in `session.state.pendingPrMutations`. On the matching tool_result, if `is_error !== true`, the PR is emitted with `source: 'mentioned'`.

Tracked mutation commands: `gh pr edit|ready|merge|close|reopen|comment|review`, `glab mr update|merge|close|reopen|note`, `az repos pr update`. Number-only args (e.g. `gh pr edit 42`) are not handled by Path B — they fall through to Path A when the command's output prints the PR URL.

Events emit via `sink.onPrDetected(pr)`. The frontend store (`packages/desktop/src/renderer/store/chats.ts`) dedups by `(owner, repo, number)` and upgrades `'mentioned'` → `'created'` when the same PR is later detected via a create command.
```

- [ ] **Step 2: Commit**

```bash
git add docs/adapters/claude/PR_TRACKING.md
git commit -m "docs: refresh PR_TRACKING.md to describe current detection paths"
```

---

## Task 6: Add changeset, run typecheck, run full tests

**Files:**
- Create: `.changeset/<generated-name>.md` (via `pnpm changeset`)

Per project rules, every PR must ship with a changeset.

- [ ] **Step 1: Create a changeset**

Run: `pnpm changeset`

Select: `@qlan-ro/mainframe-core` (space to toggle, enter to confirm). Bump type: `patch`. Summary text:

```
Detect PR mutation commands (gh pr edit/ready/merge/close/reopen/comment/review and GitLab/Azure equivalents) so the PR badge appears when the agent mutates a PR, not only when it creates one.
```

- [ ] **Step 2: Typecheck via build**

Run: `pnpm --filter @qlan-ro/mainframe-core build`
Expected: exits 0. This runs `tsc -p tsconfig.build.json` which is the project's typecheck gate for core.

- [ ] **Step 3: Run core tests**

Run: `pnpm --filter @qlan-ro/mainframe-core test`
Expected: all tests pass, including both `pr-detection.test.ts` and the new `pr-mutation-detection.test.ts`.

- [ ] **Step 4: Verify no test file exceeds 300 lines**

Run: `wc -l packages/core/src/plugins/builtin/claude/__tests__/pr-mutation-detection.test.ts`
Expected: under 300 lines. If over, split into `pr-mutation-detection.parser.test.ts` and `pr-mutation-detection.flow.test.ts`.

- [ ] **Step 5: Commit the changeset**

```bash
git add .changeset/
git commit -m "chore: add changeset for PR mutation detection"
```

---

## Task 7: Push branch and open PR

- [ ] **Step 1: Verify branch state**

Run:

```bash
git branch --show-current
git log --oneline origin/main..HEAD
```

Expected: branch is `feat/pr-mutation-detection`; commits include the spec, session-state, parser, stash, consume, docs, and changeset commits.

- [ ] **Step 2: Push**

```bash
git push -u origin feat/pr-mutation-detection
```

- [ ] **Step 3: Open PR**

```bash
gh pr create --title "feat(core): detect PR mutation commands (gh pr edit/ready/merge/close/...)" --body "$(cat <<'EOF'
## Summary

- Adds a second PR detection path that parses the PR identifier from Bash **command args** for `gh pr edit|ready|merge|close|reopen|comment|review`, `glab mr update|merge|close|reopen|note`, and `az repos pr update`.
- Emits `source: 'mentioned'` — no new source state, no UI change.
- Complements the existing tool_result URL scraper; the frontend dedup handles overlap.
- Number-only args (`gh pr edit 42`) are intentionally not handled by the new path; they still fall through to the existing URL scraper when output contains the PR URL.

Spec: `docs/superpowers/specs/2026-04-21-pr-mutation-detection-design.md`

## Test plan

- [ ] Run `pnpm --filter @qlan-ro/mainframe-core test` — all tests pass
- [ ] Open a chat and have the agent run `gh pr edit <url> --add-label …` — PR appears in the detected list as a faded badge
- [ ] Open a chat and have the agent run `gh pr ready org/repo#42` — PR appears
- [ ] Have the agent run a mutation that fails (`is_error: true`) — PR does **not** appear
- [ ] Verify existing `gh pr create` flow still emits `source: 'created'` (green badge)

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-review notes

**Spec coverage check:**
- Scope (gh/glab/az mutation commands, excludes git push) → Task 2 regex list and Task 3 tests cover all commands.
- `pendingPrMutations` session state → Task 1.
- Path B args parser (URL + `owner/repo#N`) → Task 2 with dedicated tests.
- Stash at tool_use → Task 3.
- Consume at tool_result with `is_error` filter → Task 4.
- No new source state, `'mentioned'` reused → Task 4 implementation.
- Frontend dedup absorbs overlap → Task 4's "overlap" test documents the core-level behavior; no frontend changes needed.
- Docs update → Task 5.
- Changeset → Task 6.

**Placeholder scan:** No TBDs, no "add appropriate handling", every code block is literal.

**Type consistency:** `DetectedPrCore` shape `{url, owner, repo, number}` matches between `session.ts` field, `parsePrIdentifierFromArgs` return type, and `pendingPrMutations.set(...)` calls. `isPrMutationCommand` and `parsePrIdentifierFromArgs` signatures match usage sites in Task 3.

**File-size check:** `events.ts` current length ~352 lines; added code ~15 lines → ~367, still under the 300-line soft ceiling? No — `events.ts` is already over 300. The project's soft rule is 300 lines and this file is pre-existing. Not adding a decomposition task here because: the file has a single coherent responsibility (Claude event → sink dispatch), splitting it mid-feature would expand the diff significantly, and the new additions are small. If review flags the file size, a follow-up PR can split by event type.
