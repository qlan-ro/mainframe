import { describe, it, expect, vi } from 'vitest';
import { handleStdout, handleStderr } from '../adapters/claude-events.js';
import { ClaudeSession } from '../adapters/claude-session.js';

function createSession() {
  return new ClaudeSession({ projectPath: '/tmp', chatId: '' });
}

describe('handleStdout', () => {
  it('parses complete JSON lines', () => {
    const session = createSession();
    const emitSpy = vi.spyOn(session, 'emit');

    const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude', tools: [] });
    handleStdout(session, Buffer.from(event + '\n'));

    expect(emitSpy).toHaveBeenCalledWith('init', 's1', 'claude', []);
  });

  it('handles partial chunks by buffering', () => {
    const session = createSession();
    const emitSpy = vi.spyOn(session, 'emit');

    const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude', tools: [] });
    const half1 = event.slice(0, 20);
    const half2 = event.slice(20) + '\n';

    handleStdout(session, Buffer.from(half1));
    expect(emitSpy).not.toHaveBeenCalled();

    handleStdout(session, Buffer.from(half2));
    expect(emitSpy).toHaveBeenCalledWith('init', 's1', 'claude', []);
  });

  it('skips non-JSON lines', () => {
    const session = createSession();
    const emitSpy = vi.spyOn(session, 'emit');

    handleStdout(session, Buffer.from('not json at all\n'));
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('skips empty lines', () => {
    const session = createSession();
    const emitSpy = vi.spyOn(session, 'emit');

    handleStdout(session, Buffer.from('\n\n\n'));
    expect(emitSpy).not.toHaveBeenCalled();
  });
});

describe('handleStderr', () => {
  it('emits error for non-informational messages', () => {
    const session = createSession();
    // Add a listener so the 'error' event doesn't cause an unhandled throw
    session.on('error', () => {});
    const emitSpy = vi.spyOn(session, 'emit');

    handleStderr(session, Buffer.from('Something went wrong\n'));
    expect(emitSpy).toHaveBeenCalledWith('error', expect.any(Error));
  });

  it('filters informational patterns', () => {
    const session = createSession();
    const emitSpy = vi.spyOn(session, 'emit');

    handleStderr(session, Buffer.from('Warning: some deprecation\n'));
    expect(emitSpy).not.toHaveBeenCalled();
  });

  it('ignores empty stderr', () => {
    const session = createSession();
    const emitSpy = vi.spyOn(session, 'emit');

    handleStderr(session, Buffer.from('   \n'));
    expect(emitSpy).not.toHaveBeenCalled();
  });
});
