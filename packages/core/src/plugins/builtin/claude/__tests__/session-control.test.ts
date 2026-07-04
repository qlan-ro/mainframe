import { describe, it, expect, vi } from 'vitest';
import { ControlRequestChannel } from '../session-control.js';
import { createChildLogger } from '../../../../logger.js';

function fakeStdin() {
  return { write: vi.fn() } as any;
}

describe('ControlRequestChannel', () => {
  it('correlates a response to its awaiting caller by request_id', async () => {
    const ch = new ControlRequestChannel(createChildLogger('t'), 's1');
    const stdin = fakeStdin();
    const promise = ch.sendAwaiting(
      stdin,
      { subtype: 'set_model', model: 'x' },
      { label: 'set_model', timeoutMs: 1000 },
    );
    const written = JSON.parse(stdin.write.mock.calls[0][0]);
    expect(ch.resolve(written.request_id, { subtype: 'success' })).toBe(true);
    await expect(promise).resolves.toEqual({ subtype: 'success' });
  });

  it('resolves undefined on timeout (caller treats as failure)', async () => {
    vi.useFakeTimers();
    const ch = new ControlRequestChannel(createChildLogger('t'), 's1');
    const promise = ch.sendAwaiting(fakeStdin(), { subtype: 'x' }, { label: 'x', timeoutMs: 50 });
    vi.advanceTimersByTime(60);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });

  it('ignores a non-terminal intermediate ack, then resolves on the terminal shape', async () => {
    const ch = new ControlRequestChannel(createChildLogger('t'), 's1');
    const stdin = fakeStdin();
    const promise = ch.sendAwaiting(
      stdin,
      { subtype: 'cancel_async_message' },
      {
        label: 'cancel_async_message',
        timeoutMs: 5000,
        isTerminal: (r) => typeof (r as any)?.cancelled === 'boolean',
      },
    );
    const written = JSON.parse(stdin.write.mock.calls[0][0]);
    expect(ch.resolve(written.request_id, { ack: true })).toBe(false); // intermediate — caller keeps waiting
    expect(ch.resolve(written.request_id, { cancelled: true })).toBe(true);
    await expect(promise).resolves.toEqual({ cancelled: true });
  });

  it('drainAllAsFailed resolves every pending caller with undefined', async () => {
    const ch = new ControlRequestChannel(createChildLogger('t'), 's1');
    const p = ch.sendAwaiting(fakeStdin(), { subtype: 'x' }, { label: 'x', timeoutMs: 10_000 });
    ch.drainAllAsFailed();
    await expect(p).resolves.toBeUndefined();
  });
});
