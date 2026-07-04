import { describe, it, expect, vi } from 'vitest';
import { handleControlResponseEvent } from '../events.js';
import { ControlRequestChannel } from '../session-control.js';
import { createChildLogger } from '../../../../logger.js';

// stop_task/set_model/cancel_async_message routing all funnel through ONE shared
// ControlRequestChannel now (Task 8) — events.ts is a thin, subtype-agnostic forwarder.
// Per-subtype interpretation (ok/error shape, terminal predicates) lives on the
// session.ts caller side (see session-control.test.ts and the stopBackgroundTask/
// cancelQueuedMessage tests), not here.
function makeSession(): any {
  return { id: 's1', control: new ControlRequestChannel(createChildLogger('t'), 's1') };
}

function mkEvent(requestId: string, response: Record<string, unknown>) {
  return { type: 'control_response', response: { request_id: requestId, ...response } };
}

describe('control_response routing into the shared ControlRequestChannel', () => {
  it('forwards the outer envelope to control.resolve() by request_id', () => {
    const session = makeSession();
    const resolveSpy = vi.spyOn(session.control, 'resolve');
    const event = mkEvent('req-1', { subtype: 'success', response: {} });
    handleControlResponseEvent(session, event as any, {} as any);
    expect(resolveSpy).toHaveBeenCalledWith('req-1', event.response);
  });

  it('resolves a real pending stop_task awaiter on the outer envelope subtype', async () => {
    const session = makeSession();
    const stdin = { write: vi.fn() } as any;
    const promise = session.control.sendAwaiting(
      stdin,
      { subtype: 'stop_task', task_id: 't1' },
      {
        label: 'stop_task',
        isTerminal: (r: any) => r?.subtype === 'success' || r?.subtype === 'error',
      },
    );
    const requestId = JSON.parse(stdin.write.mock.calls[0][0]).request_id;

    handleControlResponseEvent(
      session,
      mkEvent(requestId, { subtype: 'error', error: 'no such task' }) as any,
      {} as any,
    );

    await expect(promise).resolves.toEqual({ request_id: requestId, subtype: 'error', error: 'no such task' });
  });

  it('ignores unknown request_id without throwing', () => {
    const session = makeSession();
    expect(() =>
      handleControlResponseEvent(session, mkEvent('unknown', { subtype: 'success' }) as any, {} as any),
    ).not.toThrow();
  });
});
