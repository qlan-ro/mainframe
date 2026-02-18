import { describe, it, expect, vi } from 'vitest';
import { handleStdout, handleStderr } from '../adapters/claude-events.js';
import type { ClaudeProcess } from '../adapters/claude-types.js';

function createMockEmitter() {
  return { emit: vi.fn().mockReturnValue(true) };
}

function createProcess(overrides: Partial<ClaudeProcess> = {}): ClaudeProcess {
  return {
    id: 'p1',
    adapterId: 'claude',
    chatId: '',
    pid: 1234,
    status: 'ready',
    projectPath: '/tmp',
    model: 'test',
    child: {} as any,
    buffer: '',
    ...overrides,
  };
}

describe('handleStdout', () => {
  it('parses complete JSON lines', () => {
    const emitter = createMockEmitter();
    const processes = new Map([['p1', createProcess()]]);

    const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude', tools: [] });
    handleStdout('p1', Buffer.from(event + '\n'), processes, emitter as any);

    expect(emitter.emit).toHaveBeenCalledWith('init', 'p1', 's1', 'claude', []);
  });

  it('handles partial chunks by buffering', () => {
    const emitter = createMockEmitter();
    const cp = createProcess();
    const processes = new Map([['p1', cp]]);

    const event = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'claude', tools: [] });
    const half1 = event.slice(0, 20);
    const half2 = event.slice(20) + '\n';

    handleStdout('p1', Buffer.from(half1), processes, emitter as any);
    expect(emitter.emit).not.toHaveBeenCalled();

    handleStdout('p1', Buffer.from(half2), processes, emitter as any);
    expect(emitter.emit).toHaveBeenCalledWith('init', 'p1', 's1', 'claude', []);
  });

  it('skips non-JSON lines', () => {
    const emitter = createMockEmitter();
    const processes = new Map([['p1', createProcess()]]);

    handleStdout('p1', Buffer.from('not json at all\n'), processes, emitter as any);
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('skips empty lines', () => {
    const emitter = createMockEmitter();
    const processes = new Map([['p1', createProcess()]]);

    handleStdout('p1', Buffer.from('\n\n\n'), processes, emitter as any);
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});

describe('handleStderr', () => {
  it('emits error for non-informational messages', () => {
    const emitter = createMockEmitter();
    handleStderr('p1', Buffer.from('Something went wrong\n'), emitter as any);
    expect(emitter.emit).toHaveBeenCalledWith('error', 'p1', expect.any(Error));
  });

  it('filters informational patterns', () => {
    const emitter = createMockEmitter();
    handleStderr('p1', Buffer.from('Warning: some deprecation\n'), emitter as any);
    expect(emitter.emit).not.toHaveBeenCalled();
  });

  it('ignores empty stderr', () => {
    const emitter = createMockEmitter();
    handleStderr('p1', Buffer.from('   \n'), emitter as any);
    expect(emitter.emit).not.toHaveBeenCalled();
  });
});
