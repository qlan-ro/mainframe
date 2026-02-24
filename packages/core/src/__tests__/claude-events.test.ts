import { describe, it, expect, vi } from 'vitest';
import { handleStdout, handleStderr } from '../plugins/builtin/claude/events.js';
import { ClaudeSession } from '../plugins/builtin/claude/session.js';
import type { SessionSink } from '@mainframe/types';

function createSession() {
  return new ClaudeSession({ projectPath: '/tmp', chatId: '' });
}

function createSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
  };
}

describe('handleStdout', () => {
  it('parses complete JSON lines', () => {
    const session = createSession();
    const sink = createSink();

    const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude', tools: [] });
    handleStdout(session, Buffer.from(event + '\n'), sink);

    expect(sink.onInit).toHaveBeenCalledWith('s1');
  });

  it('handles partial chunks by buffering', () => {
    const session = createSession();
    const sink = createSink();

    const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude', tools: [] });
    const half1 = event.slice(0, 20);
    const half2 = event.slice(20) + '\n';

    handleStdout(session, Buffer.from(half1), sink);
    expect(sink.onInit).not.toHaveBeenCalled();

    handleStdout(session, Buffer.from(half2), sink);
    expect(sink.onInit).toHaveBeenCalledWith('s1');
  });

  it('skips non-JSON lines', () => {
    const session = createSession();
    const sink = createSink();

    handleStdout(session, Buffer.from('not json at all\n'), sink);
    expect(sink.onInit).not.toHaveBeenCalled();
    expect(sink.onMessage).not.toHaveBeenCalled();
  });

  it('skips empty lines', () => {
    const session = createSession();
    const sink = createSink();

    handleStdout(session, Buffer.from('\n\n\n'), sink);
    expect(sink.onInit).not.toHaveBeenCalled();
    expect(sink.onMessage).not.toHaveBeenCalled();
  });
});

describe('handleStderr', () => {
  it('emits error for non-informational messages', () => {
    const session = createSession();
    const sink = createSink();

    handleStderr(session, Buffer.from('Something went wrong\n'), sink);
    expect(sink.onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('filters informational patterns', () => {
    const session = createSession();
    const sink = createSink();

    handleStderr(session, Buffer.from('Warning: some deprecation\n'), sink);
    expect(sink.onError).not.toHaveBeenCalled();
  });

  it('ignores empty stderr', () => {
    const session = createSession();
    const sink = createSink();

    handleStderr(session, Buffer.from('   \n'), sink);
    expect(sink.onError).not.toHaveBeenCalled();
  });
});
