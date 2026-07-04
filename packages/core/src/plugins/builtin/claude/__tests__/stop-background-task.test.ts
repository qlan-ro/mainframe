import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClaudeSession } from '../session.js';

describe('ClaudeSession.stopBackgroundTask()', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns stdin-unavailable when child has no stdin', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp', mainframeChatId: 'test-chat-id' } as any);
    session.state.child = { stdin: undefined } as any;

    const result = await session.stopBackgroundTask('task-1');

    expect(result).toEqual({ ok: false, error: 'stdin unavailable' });
  });

  it('returns stdin-unavailable when stdin is destroyed', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp', mainframeChatId: 'test-chat-id' } as any);
    session.state.child = { stdin: { destroyed: true, write: vi.fn() } } as any;

    const result = await session.stopBackgroundTask('task-2');

    expect(result).toEqual({ ok: false, error: 'stdin unavailable' });
  });

  it('resolves timeout after 5s when no response arrives', async () => {
    vi.useFakeTimers();
    const session = new ClaudeSession({ projectPath: '/tmp', mainframeChatId: 'test-chat-id' } as any);
    const fakeStdin = { destroyed: false, write: vi.fn() };
    session.state.child = { stdin: fakeStdin } as any;

    const pending = session.stopBackgroundTask('task-3');

    await vi.advanceTimersByTimeAsync(5001);
    const result = await pending;

    expect(result).toEqual({ ok: false, error: 'timeout' });
  });

  // Live-verified against CLI 2.1.198 (2026-07-05): stop_task's success/failure signal is the
  // OUTER envelope's subtype — the nested `response.response` is always `{}`, even for a real
  // task that was genuinely killed. See session.ts's isTerminalControlResponse / stopBackgroundTask.
  it('resolves with ok:true when control.resolve() delivers a success envelope', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp', mainframeChatId: 'test-chat-id' } as any);
    const fakeStdin = { destroyed: false, write: vi.fn() };
    session.state.child = { stdin: fakeStdin } as any;

    const pending = session.stopBackgroundTask('task-4');
    await Promise.resolve();

    const requestId = JSON.parse(fakeStdin.write.mock.calls[0]![0]).request_id;
    expect(session.control.resolve(requestId, { request_id: requestId, subtype: 'success', response: {} })).toBe(true);

    const result = await pending;
    expect(result).toEqual({ ok: true });
  });

  it('resolves with ok:false + the CLI error message on an error envelope', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp', mainframeChatId: 'test-chat-id' } as any);
    const fakeStdin = { destroyed: false, write: vi.fn() };
    session.state.child = { stdin: fakeStdin } as any;

    const pending = session.stopBackgroundTask('task-4b');
    await Promise.resolve();

    const requestId = JSON.parse(fakeStdin.write.mock.calls[0]![0]).request_id;
    session.control.resolve(requestId, { request_id: requestId, subtype: 'error', error: 'no such task' });

    const result = await pending;
    expect(result).toEqual({ ok: false, error: 'no such task' });
  });

  it('writes a JSON stop_task control_request to stdin', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp', mainframeChatId: 'test-chat-id' } as any);
    const writes: string[] = [];
    const fakeStdin = {
      destroyed: false,
      write: (data: string) => writes.push(data),
    };
    session.state.child = { stdin: fakeStdin } as any;

    // Start the call but don't await — we just want to inspect what was written
    const pending = session.stopBackgroundTask('task-5');

    await Promise.resolve();

    expect(writes).toHaveLength(1);
    const parsed = JSON.parse(writes[0]!);
    expect(parsed.type).toBe('control_request');
    expect(parsed.request.subtype).toBe('stop_task');
    expect(parsed.request.task_id).toBe('task-5');

    // Clean up: resolve so the promise settles
    session.control.resolve(parsed.request_id, { request_id: parsed.request_id, subtype: 'success', response: {} });
    await pending;
  });
});
