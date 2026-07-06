import { describe, it, expect, beforeEach } from 'vitest';
import { getActiveDaemon, setActiveDaemon, subscribeActiveDaemon } from '../active-daemon';

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
