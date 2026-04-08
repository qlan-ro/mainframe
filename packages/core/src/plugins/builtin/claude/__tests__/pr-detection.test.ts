import { describe, it, expect, vi } from 'vitest';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import { handleStdout, parsePrUrl, PR_URL_REGEX } from '../events.js';
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

describe('PR detection via handleStdout', () => {
  it('calls sink.onPrDetected when tool_result contains a GitHub PR URL', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: 'Pull request created: https://github.com/myorg/myrepo/pull/99',
          },
        ],
      },
    };

    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(sink.onPrDetected).toHaveBeenCalledWith({
      url: 'https://github.com/myorg/myrepo/pull/99',
      owner: 'myorg',
      repo: 'myrepo',
      number: 99,
    });
  });

  it('does not call sink.onPrDetected when tool_result has no PR URL', () => {
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

  it('does not call sink.onPrDetected for non-PR GitHub URLs in tool_result', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_1',
            content: 'See https://github.com/org/repo/issues/5 for context',
          },
        ],
      },
    };

    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(sink.onPrDetected).not.toHaveBeenCalled();
  });
});
