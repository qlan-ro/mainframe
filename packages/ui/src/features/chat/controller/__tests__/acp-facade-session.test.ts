import { describe, expect, it, vi } from 'vitest';
import type {
  PromptResponse,
  RequestPermissionRequest,
  RequestPermissionResponse,
  ResumeSessionResponse,
  SessionUpdate,
} from '@qlan-ro/mainframe-types';
import type {
  GapListener,
  GateResolvedListener,
  PermissionRequestListener,
  ReplayCursor,
  SessionUpdateListener,
} from '../../../../lib/daemon/acp-client';
import { AcpFacadeSession, type AcpSessionClientPort } from '../acp-facade-session';

/**
 * A hand-written fake, not the real `AcpFacadeClient`: `AcpSessionClientPort`
 * exists so the session's dependency is exactly the surface it uses, and
 * tests exercise that seam directly — firing `sessionUpdate`/`permission`/
 * `gap` the way the real client would, and recording `resume`/`prompt`/
 * `cancel`/`respondPermission` calls for assertions.
 */
class FakeClient implements AcpSessionClientPort {
  private sessionUpdateListener: SessionUpdateListener | null = null;
  private permissionListener: PermissionRequestListener | null = null;
  private gateResolvedListener: GateResolvedListener | null = null;
  private gapListener: GapListener | null = null;
  resumeCalls: Array<{ sessionId: string; cwd: string; replayFrom?: ReplayCursor }> = [];
  promptCalls: Array<{ sessionId: string; text: string }> = [];
  cancelCalls: string[] = [];
  respondCalls: Array<{ id: unknown; response: RequestPermissionResponse }> = [];
  nextResumeResponse: ResumeSessionResponse = {};
  nextPromptResponse: PromptResponse = {};

  onSessionUpdate(listener: SessionUpdateListener): () => void {
    this.sessionUpdateListener = listener;
    return () => (this.sessionUpdateListener = null);
  }
  onPermissionRequest(listener: PermissionRequestListener): () => void {
    this.permissionListener = listener;
    return () => (this.permissionListener = null);
  }
  onGateResolved(listener: GateResolvedListener): () => void {
    this.gateResolvedListener = listener;
    return () => (this.gateResolvedListener = null);
  }
  onGap(listener: GapListener): () => void {
    this.gapListener = listener;
    return () => (this.gapListener = null);
  }
  async prompt(sessionId: string, text: string): Promise<PromptResponse> {
    this.promptCalls.push({ sessionId, text });
    return this.nextPromptResponse;
  }
  cancel(sessionId: string): void {
    this.cancelCalls.push(sessionId);
  }
  async resume(sessionId: string, cwd: string, replayFrom?: ReplayCursor): Promise<ResumeSessionResponse> {
    this.resumeCalls.push({ sessionId, cwd, replayFrom });
    return this.nextResumeResponse;
  }
  respondPermission(id: unknown, response: RequestPermissionResponse): void {
    this.respondCalls.push({ id, response });
  }

  emitUpdate(sessionId: string, update: SessionUpdate): void {
    this.sessionUpdateListener?.(sessionId, update);
  }
  emitPermissionRequest(id: unknown, request: RequestPermissionRequest): void {
    this.permissionListener?.(id as never, request);
  }
  emitGateResolved(sessionId: string, requestId: string): void {
    this.gateResolvedListener?.(sessionId, requestId);
  }
  emitGap(): void {
    this.gapListener?.();
  }
}

function textBlock(text: string) {
  return { type: 'text' as const, text };
}

function session(overrides: Partial<{ sessionId: string; cwd: string }> = {}) {
  const client = new FakeClient();
  const s = new AcpFacadeSession({ client, sessionId: overrides.sessionId ?? 'chat_1', cwd: overrides.cwd ?? '/repo' });
  return { client, session: s };
}

describe('AcpFacadeSession — attach() replaces subscribe:ack re-seed + REST history refresh', () => {
  it('resumes with a full-replay cursor and renders whatever session/update frames follow', async () => {
    const { client, session: s } = session();
    const attachPromise = s.attach();
    client.emitUpdate('chat_1', { sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: textBlock('hi') });
    await attachPromise;

    expect(client.resumeCalls).toEqual([{ sessionId: 'chat_1', cwd: '/repo', replayFrom: { type: 'start' } }]);
    expect(s.getState().messages).toHaveLength(1);
    expect(s.getState().messages[0]).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'hi' }] });
  });

  it('ignores session/update frames for a different sessionId (multi-session multiplexing)', () => {
    const { client, session: s } = session({ sessionId: 'chat_1' });
    client.emitUpdate('chat_other', {
      sessionUpdate: 'agent_message_chunk',
      messageId: 'a1',
      content: textBlock('hi'),
    });

    expect(s.getState().messages).toEqual([]);
  });
});

describe('AcpFacadeSession — sendMessage() renders queue state from acceptance metadata', () => {
  it('an immediate acceptance (no _meta) marks the turn running with no queued position', async () => {
    const { client, session: s } = session();
    client.nextPromptResponse = {};
    await s.sendMessage('hello');

    expect(client.promptCalls).toEqual([{ sessionId: 'chat_1', text: 'hello' }]);
    expect(s.getState()).toMatchObject({ runState: 'running', queuedPosition: null });
  });

  it('a queued acceptance renders the position from _meta without a separate queue-snapshot fetch', async () => {
    const { session: s, client } = session();
    client.nextPromptResponse = { _meta: { '_mainframe.dev': { position: 2 } } };
    await s.sendMessage('hello');

    expect(s.getState().queuedPosition).toBe(2);
  });
});

describe('AcpFacadeSession — turn lifecycle', () => {
  it('a state_update:idle with a stop reason clears queuedPosition and sets runState', () => {
    const { client, session: s } = session();
    client.emitUpdate('chat_1', { sessionUpdate: 'state_update', state: 'running' });
    expect(s.getState().runState).toBe('running');

    client.emitUpdate('chat_1', { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });
    expect(s.getState()).toMatchObject({ runState: 'idle', stopReason: 'end_turn', queuedPosition: null });
  });
});

describe('AcpFacadeSession — permission gates (pending-permission recovery falls out of onPermissionRequest)', () => {
  it('a live session/request_permission request populates pendingPermission', () => {
    const { client, session: s } = session();
    const request: RequestPermissionRequest = {
      sessionId: 'chat_1',
      title: 'Allow Bash to run this command?',
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    };
    client.emitPermissionRequest('gate-1', request);

    expect(s.getState().pendingPermission).toEqual({ id: 'gate-1', request });
  });

  it('a resume-redelivered gate (same request shape) also populates pendingPermission — no special-casing needed', () => {
    const { client, session: s } = session();
    const request: RequestPermissionRequest = {
      sessionId: 'chat_1',
      title: 'Redelivered gate',
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    };
    client.emitPermissionRequest('gate-redelivered', request);
    expect(s.getState().pendingPermission?.id).toBe('gate-redelivered');
  });

  it('respondPermission() answers the request and clears the pending gate', () => {
    const { client, session: s } = session();
    client.emitPermissionRequest('gate-1', {
      sessionId: 'chat_1',
      title: 'x',
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    });

    const answer: RequestPermissionResponse = { outcome: { outcome: 'selected', optionId: 'allow-once' } };
    s.respondPermission(answer);

    expect(client.respondCalls).toEqual([{ id: 'gate-1', response: answer }]);
    expect(s.getState().pendingPermission).toBeNull();
  });

  it('respondPermission() is a no-op when there is no pending gate', () => {
    const { client, session: s } = session();
    s.respondPermission({ outcome: { outcome: 'selected', optionId: 'allow-once' } });
    expect(client.respondCalls).toEqual([]);
  });

  it('a _mainframe.dev/gate_resolved push clears the matching pending gate without a resume', () => {
    const { client, session: s } = session();
    client.emitPermissionRequest('gate-1', {
      sessionId: 'chat_1',
      title: 'x',
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    });
    expect(s.getState().pendingPermission).not.toBeNull();

    client.emitGateResolved('chat_1', 'gate-1');

    expect(s.getState().pendingPermission).toBeNull();
    expect(client.resumeCalls).toEqual([]);
    expect(client.respondCalls).toEqual([]);
  });

  it('a gate_resolved for another session or another request leaves the pending gate alone', () => {
    const { client, session: s } = session();
    client.emitPermissionRequest('gate-1', {
      sessionId: 'chat_1',
      title: 'x',
      options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }],
    });

    client.emitGateResolved('chat_other', 'gate-1');
    client.emitGateResolved('chat_1', 'gate-2');

    expect(s.getState().pendingPermission?.id).toBe('gate-1');
  });
});

describe('AcpFacadeSession — reconnect convergence on a gap', () => {
  it('resumes from the last settled item id once the turn has gone idle at least once', async () => {
    const { client } = session();
    client.emitUpdate('chat_1', { sessionUpdate: 'agent_message', messageId: 'a1', content: [textBlock('done')] });
    client.emitUpdate('chat_1', { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });

    client.emitGap();
    await vi.waitFor(() => expect(client.resumeCalls).toHaveLength(1));

    expect(client.resumeCalls[0]).toEqual({
      sessionId: 'chat_1',
      cwd: '/repo',
      replayFrom: { type: 'item', itemId: 'a1' },
    });
  });

  it('falls back to a full-start replay when no turn has ever settled', async () => {
    const { client } = session(); // no updates applied — nothing has settled yet
    client.emitGap();
    await vi.waitFor(() => expect(client.resumeCalls).toHaveLength(1));

    expect(client.resumeCalls[0]?.replayFrom).toEqual({ type: 'start' });
  });

  it('resetting the accumulator when the daemon answers with a fullReplay marker converges without duplicating items', async () => {
    const { client, session: s } = session();
    client.emitUpdate('chat_1', { sessionUpdate: 'agent_message', messageId: 'a1', content: [textBlock('stale')] });
    client.emitUpdate('chat_1', { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' });

    client.nextResumeResponse = { _meta: { '_mainframe.dev': { fullReplay: true } } };
    client.emitGap();
    await vi.waitFor(() => expect(client.resumeCalls).toHaveLength(1));

    client.emitUpdate('chat_1', { sessionUpdate: 'agent_message', messageId: 'a1', content: [textBlock('replayed')] });
    expect(s.getState().messages).toHaveLength(1);
    expect(s.getState().messages[0]).toMatchObject({ content: [{ type: 'text', text: 'replayed' }] });
  });
});

describe('AcpFacadeSession — cancel() and dispose()', () => {
  it('cancel() sends session/cancel for this session', () => {
    const { client, session: s } = session();
    s.cancel();
    expect(client.cancelCalls).toEqual(['chat_1']);
  });

  it('dispose() unsubscribes so later client events no longer update state', () => {
    const { client, session: s } = session();
    s.dispose();
    client.emitUpdate('chat_1', { sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: textBlock('hi') });
    expect(s.getState().messages).toEqual([]);
  });
});

describe('AcpFacadeSession — subscribe()', () => {
  it('notifies listeners on every state change', () => {
    const { client, session: s } = session();
    const listener = vi.fn();
    s.subscribe(listener);

    client.emitUpdate('chat_1', { sessionUpdate: 'agent_message_chunk', messageId: 'a1', content: textBlock('hi') });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
