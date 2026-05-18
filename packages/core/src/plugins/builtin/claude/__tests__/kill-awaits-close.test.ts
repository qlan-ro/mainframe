import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClaudeSession } from '../session.js';

describe('ClaudeSession.kill() awaits close', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves only after the child emits close', async () => {
    const session = new ClaudeSession({ projectPath: '/tmp' } as any);
    const listeners: Record<string, ((...args: any[]) => void)[]> = {};
    const fakeChild: any = {
      kill: vi.fn(),
      exitCode: null,
      once(event: string, callback: (...args: any[]) => void) {
        (listeners[event] ||= []).push(callback);
      },
    };
    session.state.child = fakeChild;

    let resolved = false;
    const pending = session.kill().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');

    listeners.close?.[0]?.();
    await pending;

    expect(resolved).toBe(true);
    expect(session.state.child).toBeNull();
  });

  it('falls back to SIGKILL after 3s if close never fires', async () => {
    vi.useFakeTimers();
    const session = new ClaudeSession({ projectPath: '/tmp' } as any);
    const fakeChild: any = {
      kill: vi.fn(),
      exitCode: null,
      once: vi.fn(),
    };
    session.state.child = fakeChild;

    const pending = session.kill();
    await vi.advanceTimersByTimeAsync(3000);
    await pending;

    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
