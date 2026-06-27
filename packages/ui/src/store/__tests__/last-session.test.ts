import { describe, it, expect, beforeEach } from 'vitest';
import { useLastSessionStore } from '../last-session';

describe('useLastSessionStore', () => {
  beforeEach(() => {
    useLastSessionStore.setState({ lastSessionId: null, lastByProject: {} });
  });

  it('defaults lastSessionId to null', () => {
    expect(useLastSessionStore.getState().lastSessionId).toBeNull();
  });

  it('setLastSessionId stores the id', () => {
    useLastSessionStore.getState().setLastSessionId('chat-42');
    expect(useLastSessionStore.getState().lastSessionId).toBe('chat-42');
  });

  it('setLastSessionId(null) clears the id', () => {
    useLastSessionStore.getState().setLastSessionId('chat-42');
    useLastSessionStore.getState().setLastSessionId(null);
    expect(useLastSessionStore.getState().lastSessionId).toBeNull();
  });

  it('setLastForProject records the per-project last session', () => {
    useLastSessionStore.getState().setLastForProject('proj-1', 'chat-9');
    expect(useLastSessionStore.getState().lastByProject['proj-1']).toBe('chat-9');
  });

  it('setLastForProject overwrites a previous entry for the same project', () => {
    useLastSessionStore.getState().setLastForProject('proj-1', 'chat-9');
    useLastSessionStore.getState().setLastForProject('proj-1', 'chat-10');
    expect(useLastSessionStore.getState().lastByProject['proj-1']).toBe('chat-10');
  });

  it('setLastForProject records entries for different projects independently', () => {
    useLastSessionStore.getState().setLastForProject('proj-1', 'chat-9');
    useLastSessionStore.getState().setLastForProject('proj-2', 'chat-5');
    expect(useLastSessionStore.getState().lastByProject['proj-1']).toBe('chat-9');
    expect(useLastSessionStore.getState().lastByProject['proj-2']).toBe('chat-5');
  });

  it('lastByProject defaults to an empty object', () => {
    expect(typeof useLastSessionStore.getState().lastByProject).toBe('object');
    expect(useLastSessionStore.getState().lastByProject).not.toBeNull();
  });
});
