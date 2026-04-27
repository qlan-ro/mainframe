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
    onCliMessage: vi.fn(),
    onSkillLoaded: vi.fn(),
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
      parsePrIdentifierFromArgs('az repos pr update https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/5'),
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

  it('emits twice when tool_result output contains the same URL — frontend dedup absorbs', () => {
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
