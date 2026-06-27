import { describe, it, expect, vi } from 'vitest';
import { handleControlResponseEvent } from '../events.js';

function makeSession(): any {
  return {
    id: 's1',
    state: { pendingStopTaskCallbacks: new Map() },
  };
}

function mkEvent(requestId: string, inner: Record<string, unknown>) {
  return {
    type: 'control_response',
    response: { request_id: requestId, response: inner },
  };
}

describe('stop_task control_response routing', () => {
  it('invokes pending callback with ok:true on subtype=success', () => {
    const session = makeSession();
    const cb = vi.fn();
    session.state.pendingStopTaskCallbacks.set('req-1', cb);
    handleControlResponseEvent(session, mkEvent('req-1', { subtype: 'success' }) as any, {} as any);
    expect(cb).toHaveBeenCalledWith({ ok: true });
    expect(session.state.pendingStopTaskCallbacks.has('req-1')).toBe(false);
  });

  it('invokes pending callback with ok:false + error on subtype=error', () => {
    const session = makeSession();
    const cb = vi.fn();
    session.state.pendingStopTaskCallbacks.set('req-2', cb);
    handleControlResponseEvent(
      session,
      mkEvent('req-2', { subtype: 'error', error: 'no such task' }) as any,
      {} as any,
    );
    expect(cb).toHaveBeenCalledWith({ ok: false, error: 'no such task' });
  });

  it('ignores unknown request_id without throwing', () => {
    const session = makeSession();
    expect(() =>
      handleControlResponseEvent(session, mkEvent('unknown', { subtype: 'success' }) as any, {} as any),
    ).not.toThrow();
  });
});
