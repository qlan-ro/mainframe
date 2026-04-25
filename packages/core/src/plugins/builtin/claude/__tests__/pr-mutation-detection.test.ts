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
