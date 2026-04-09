import { describe, it, expect, vi } from 'vitest';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import {
  handleStdout,
  parsePrUrl,
  parseAzurePrUrl,
  parseGitlabMrUrl,
  extractPrFromToolResult,
  PR_URL_REGEX,
  AZURE_PR_URL_REGEX,
  GITLAB_MR_URL_REGEX,
  PR_CREATE_COMMANDS,
} from '../events.js';
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
    },
    clearInterruptTimer: vi.fn(),
    requestContextUsage: vi.fn(),
  } as unknown as ClaudeSession;
}

describe('PR_URL_REGEX', () => {
  it('matches a standard GitHub PR URL', () => {
    const url = 'https://github.com/owner/repo/pull/123';
    expect(PR_URL_REGEX.test(url)).toBe(true);
  });

  it('does not match a non-PR GitHub URL', () => {
    expect(PR_URL_REGEX.test('https://github.com/owner/repo/issues/123')).toBe(false);
    expect(PR_URL_REGEX.test('https://github.com/owner/repo')).toBe(false);
    expect(PR_URL_REGEX.test('https://example.com/pull/123')).toBe(false);
  });

  it('matches PR URL embedded in surrounding text', () => {
    const text = 'Pull request created at https://github.com/foo/bar/pull/42 — done!';
    expect(PR_URL_REGEX.test(text)).toBe(true);
  });
});

describe('AZURE_PR_URL_REGEX', () => {
  it('matches an Azure DevOps PR URL', () => {
    const url = 'https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/42';
    expect(AZURE_PR_URL_REGEX.test(url)).toBe(true);
  });

  it('does not match other Azure URLs', () => {
    expect(AZURE_PR_URL_REGEX.test('https://dev.azure.com/myorg/myproject/_git/myrepo/commit/abc')).toBe(false);
    expect(AZURE_PR_URL_REGEX.test('https://dev.azure.com/myorg')).toBe(false);
  });
});

describe('parsePrUrl', () => {
  it('parses a valid PR URL into structured data', () => {
    const result = parsePrUrl('https://github.com/acme/my-repo/pull/456');
    expect(result).toEqual({
      url: 'https://github.com/acme/my-repo/pull/456',
      owner: 'acme',
      repo: 'my-repo',
      number: 456,
    });
  });

  it('returns null for non-matching text', () => {
    expect(parsePrUrl('https://github.com/owner/repo/issues/10')).toBeNull();
    expect(parsePrUrl('no URL here')).toBeNull();
  });

  it('extracts the first PR URL when multiple are present', () => {
    const text = 'https://github.com/org/alpha/pull/1 and https://github.com/org/beta/pull/2';
    const result = parsePrUrl(text);
    expect(result?.repo).toBe('alpha');
    expect(result?.number).toBe(1);
  });
});

describe('parseAzurePrUrl', () => {
  it('parses an Azure DevOps PR URL', () => {
    const result = parseAzurePrUrl('https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/42');
    expect(result).toEqual({
      url: 'https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/42',
      owner: 'myorg',
      repo: 'myrepo',
      number: 42,
    });
  });

  it('returns null for non-matching text', () => {
    expect(parseAzurePrUrl('https://github.com/owner/repo/pull/1')).toBeNull();
    expect(parseAzurePrUrl('no URL here')).toBeNull();
  });
});

describe('GITLAB_MR_URL_REGEX', () => {
  it('matches a GitLab MR URL', () => {
    const url = 'https://gitlab.com/mygroup/myrepo/-/merge_requests/42';
    expect(GITLAB_MR_URL_REGEX.test(url)).toBe(true);
  });

  it('does not match other GitLab URLs', () => {
    expect(GITLAB_MR_URL_REGEX.test('https://gitlab.com/mygroup/myrepo/-/issues/1')).toBe(false);
    expect(GITLAB_MR_URL_REGEX.test('https://gitlab.com/mygroup')).toBe(false);
  });
});

describe('parseGitlabMrUrl', () => {
  it('parses a GitLab MR URL', () => {
    const result = parseGitlabMrUrl('https://gitlab.com/acme/backend/-/merge_requests/99');
    expect(result).toEqual({
      url: 'https://gitlab.com/acme/backend/-/merge_requests/99',
      owner: 'acme',
      repo: 'backend',
      number: 99,
    });
  });

  it('returns null for non-matching text', () => {
    expect(parseGitlabMrUrl('https://github.com/owner/repo/pull/1')).toBeNull();
    expect(parseGitlabMrUrl('no URL here')).toBeNull();
  });
});

describe('extractPrFromToolResult', () => {
  it('extracts GitHub PR URL', () => {
    const result = extractPrFromToolResult('Created https://github.com/acme/repo/pull/7');
    expect(result).toEqual({ url: 'https://github.com/acme/repo/pull/7', owner: 'acme', repo: 'repo', number: 7 });
  });

  it('extracts GitLab MR URL', () => {
    const result = extractPrFromToolResult('Created https://gitlab.com/acme/backend/-/merge_requests/99');
    expect(result).toEqual({
      url: 'https://gitlab.com/acme/backend/-/merge_requests/99',
      owner: 'acme',
      repo: 'backend',
      number: 99,
    });
  });

  it('extracts Azure DevOps PR URL', () => {
    const result = extractPrFromToolResult('https://dev.azure.com/myorg/proj/_git/myrepo/pullrequest/5');
    expect(result).toEqual({
      url: 'https://dev.azure.com/myorg/proj/_git/myrepo/pullrequest/5',
      owner: 'myorg',
      repo: 'myrepo',
      number: 5,
    });
  });

  it('returns null for text without PR URLs', () => {
    expect(extractPrFromToolResult('just some output')).toBeNull();
  });
});

describe('command-level PR detection', () => {
  it('detects source: created when gh pr create tool_use precedes tool_result with PR URL', () => {
    const sink = createMockSink();
    const session = createMockSession();

    // Step 1: assistant event with gh pr create tool_use
    const assistantEvent = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_pr_1',
            name: 'Bash',
            input: { command: 'gh pr create --title "feat" --body "desc"' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(assistantEvent) + '\n'), sink);

    // Verify tool_use_id was stashed
    expect(session.state.pendingPrCreates.has('tu_pr_1')).toBe(true);

    // Step 2: user event with tool_result containing PR URL
    const userEvent = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_pr_1',
            content: 'https://github.com/myorg/myrepo/pull/99',
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(userEvent) + '\n'), sink);

    expect(sink.onPrDetected).toHaveBeenCalledWith({
      url: 'https://github.com/myorg/myrepo/pull/99',
      owner: 'myorg',
      repo: 'myrepo',
      number: 99,
      source: 'created',
    });

    // pendingPrCreates should be consumed
    expect(session.state.pendingPrCreates.has('tu_pr_1')).toBe(false);
  });

  it('detects source: mentioned when no matching tool_use preceded tool_result', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const userEvent = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_other',
            content: 'See https://github.com/myorg/myrepo/pull/50 for context',
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(userEvent) + '\n'), sink);

    expect(sink.onPrDetected).toHaveBeenCalledWith({
      url: 'https://github.com/myorg/myrepo/pull/50',
      owner: 'myorg',
      repo: 'myrepo',
      number: 50,
      source: 'mentioned',
    });
  });

  it('stashes tool_use_id for glab mr create', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_gl_1',
            name: 'BashTool',
            input: { command: 'glab mr create --fill' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(session.state.pendingPrCreates.has('tu_gl_1')).toBe(true);
  });

  it('stashes tool_use_id for az repos pr create', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_az_1',
            name: 'Bash',
            input: { command: 'az repos pr create --source-branch feat --target-branch main' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(session.state.pendingPrCreates.has('tu_az_1')).toBe(true);
  });

  it('parses Azure DevOps URL in tool_result', () => {
    const sink = createMockSink();
    const session = createMockSession();

    // Stash the az command
    session.state.pendingPrCreates.add('tu_az_2');

    const userEvent = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_az_2',
            content: 'Created: https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/7',
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(userEvent) + '\n'), sink);

    expect(sink.onPrDetected).toHaveBeenCalledWith({
      url: 'https://dev.azure.com/myorg/myproject/_git/myrepo/pullrequest/7',
      owner: 'myorg',
      repo: 'myrepo',
      number: 7,
      source: 'created',
    });
  });

  it('parses Azure JSON output with pullRequestId', () => {
    const sink = createMockSink();
    const session = createMockSession();

    session.state.pendingPrCreates.add('tu_az_3');

    const jsonOutput =
      '{"pullRequestId": 42, "name": "my-repo", "url": "https://dev.azure.com/myorg/myproject/_apis/git/repositories/my-repo/pullRequests/42"}';
    const userEvent = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_az_3',
            content: jsonOutput,
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(userEvent) + '\n'), sink);

    expect(sink.onPrDetected).toHaveBeenCalledWith(
      expect.objectContaining({
        number: 42,
        repo: 'my-repo',
        source: 'created',
      }),
    );
  });

  it('does not call onPrDetected when tool_result has no PR URL', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: 'Command ran successfully with exit code 0',
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(sink.onPrDetected).not.toHaveBeenCalled();
  });

  it('does not stash tool_use_id for non-Bash tools', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_edit_1',
            name: 'Edit',
            input: { command: 'gh pr create' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(session.state.pendingPrCreates.size).toBe(0);
  });

  it('does not stash tool_use_id for non-create gh commands', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_view_1',
            name: 'Bash',
            input: { command: 'gh pr view 123' },
          },
        ],
      },
    };
    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(session.state.pendingPrCreates.size).toBe(0);
  });
});
