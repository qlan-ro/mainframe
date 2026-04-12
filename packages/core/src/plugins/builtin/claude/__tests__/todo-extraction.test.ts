import { describe, it, expect, vi } from 'vitest';
import type { SessionSink } from '@qlan-ro/mainframe-types';
import { handleStdout } from '../events.js';
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

describe('TodoWrite extraction', () => {
  it('calls sink.onTodoUpdate when assistant event contains TodoWrite tool_use', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const todos = [
      { content: 'Write tests', status: 'in_progress', activeForm: 'Writing tests' },
      { content: 'Implement feature', status: 'pending', activeForm: 'Implementing feature' },
    ];

    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'TodoWrite', input: { todos } }],
      },
    };

    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(sink.onTodoUpdate).toHaveBeenCalledWith(todos);
    expect(sink.onMessage).toHaveBeenCalled();
  });

  it('does not call onTodoUpdate for non-TodoWrite tool_use', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const event = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tu_1', name: 'Read', input: { file_path: '/foo.ts' } }],
      },
    };

    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(sink.onTodoUpdate).not.toHaveBeenCalled();
    expect(sink.onMessage).toHaveBeenCalled();
  });

  it('extracts todos even when mixed with other tool_use blocks', () => {
    const sink = createMockSink();
    const session = createMockSession();

    const todos = [{ content: 'Task 1', status: 'completed', activeForm: 'Task 1' }];

    const event = {
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'Working on it...' },
          { type: 'tool_use', id: 'tu_1', name: 'TodoWrite', input: { todos } },
          { type: 'tool_use', id: 'tu_2', name: 'Read', input: { file_path: '/bar.ts' } },
        ],
      },
    };

    handleStdout(session, Buffer.from(JSON.stringify(event) + '\n'), sink);

    expect(sink.onTodoUpdate).toHaveBeenCalledWith(todos);
  });
});
