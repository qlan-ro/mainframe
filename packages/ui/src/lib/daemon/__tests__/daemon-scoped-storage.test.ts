import { describe, it, expect, beforeEach } from 'vitest';
import { setActiveDaemon } from '../active-daemon';
import { daemonScopedKey } from '../daemon-scoped-storage';

const LOCAL_TARGET = {
  id: 'local',
  kind: 'local' as const,
  label: 'Local',
  baseUrl: 'http://127.0.0.1:0',
  token: null,
};
const STUDIO_TARGET = {
  id: 'studio',
  kind: 'remote' as const,
  label: 'Studio',
  baseUrl: 'https://studio.example.com',
  token: 'jwt',
};

beforeEach(() => {
  setActiveDaemon(LOCAL_TARGET);
});

describe('daemonScopedKey', () => {
  it('appends the active daemon id to the base key when local', () => {
    expect(daemonScopedKey('mf:last-session')).toBe('mf:last-session::local');
  });

  it('reflects the new daemon id after setActiveDaemon', () => {
    setActiveDaemon(STUDIO_TARGET);
    expect(daemonScopedKey('mf:last-session')).toBe('mf:last-session::studio');
  });

  it('reflects different base keys with the same daemon id', () => {
    expect(daemonScopedKey('mf:filterProjectId')).toBe('mf:filterProjectId::local');
    expect(daemonScopedKey('mf:session-layout')).toBe('mf:session-layout::local');
  });

  it('is evaluated at call time, not at module load', () => {
    const keyBefore = daemonScopedKey('mf:last-session');
    setActiveDaemon(STUDIO_TARGET);
    const keyAfter = daemonScopedKey('mf:last-session');
    expect(keyBefore).toBe('mf:last-session::local');
    expect(keyAfter).toBe('mf:last-session::studio');
  });
});
