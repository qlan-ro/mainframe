import { describe, it, expect, beforeEach } from 'vitest';
import { getActiveDaemon, setActiveDaemon, subscribeActiveDaemon, updateActiveDaemonToken } from '../active-daemon';

describe('active-daemon', () => {
  beforeEach(() =>
    setActiveDaemon({ id: 'local', kind: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:31500', token: null }),
  );

  it('returns the current target', () => {
    expect(getActiveDaemon().baseUrl).toBe('http://127.0.0.1:31500');
    expect(getActiveDaemon().token).toBeNull();
  });

  it('notifies subscribers on change and stops after unsubscribe', () => {
    const seen: string[] = [];
    const off = subscribeActiveDaemon((t) => seen.push(t.id));
    setActiveDaemon({
      id: 'studio',
      kind: 'remote',
      label: 'Studio',
      baseUrl: 'https://studio.example.com',
      token: 'jwt',
    });
    off();
    setActiveDaemon({ id: 'local', kind: 'local', label: 'Local', baseUrl: 'http://127.0.0.1:31500', token: null });
    expect(seen).toEqual(['studio']);
  });
});

describe('updateActiveDaemonToken', () => {
  const STUDIO = {
    id: 'studio',
    kind: 'remote',
    label: 'Studio',
    baseUrl: 'https://studio.example.com',
    token: 'old-token',
  } as const;

  beforeEach(() => setActiveDaemon({ ...STUDIO }));

  it('replaces the token of the active target and keeps every other field', () => {
    updateActiveDaemonToken('studio', 'new-token');

    expect(getActiveDaemon()).toEqual({ ...STUDIO, token: 'new-token' });
  });

  it('notifies subscribers with the re-tokened target', () => {
    const seen: (string | null)[] = [];
    const off = subscribeActiveDaemon((t) => seen.push(t.token));

    updateActiveDaemonToken('studio', 'new-token');
    off();

    expect(seen).toEqual(['new-token']);
  });

  it('is a no-op for a target that is not active', () => {
    const off = subscribeActiveDaemon(() => {
      throw new Error('must not notify for an inactive daemon');
    });

    updateActiveDaemonToken('laptop', 'new-token');
    off();

    expect(getActiveDaemon().token).toBe('old-token');
  });
});
