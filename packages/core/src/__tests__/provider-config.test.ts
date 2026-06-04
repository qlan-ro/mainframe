import { describe, it, expect } from 'vitest';
import { getProviderConfig } from '../settings/provider-config.js';

const fakeDb = (rows: Record<string, string>) => ({
  settings: { get: (ns: string, key: string) => rows[`${ns}:${key}`] ?? null },
});

describe('getProviderConfig', () => {
  it('assembles flat provider.* settings into a typed ProviderConfig', () => {
    const db = fakeDb({
      'provider:claude.defaultModel': 'opus',
      'provider:claude.defaultEffort': 'high',
      'provider:claude.defaultFast': 'true',
    }) as never;
    const cfg = getProviderConfig(db, 'claude');
    expect(cfg.defaultModel).toBe('opus');
    expect(cfg.defaultEffort).toBe('high');
    expect(cfg.defaultFast).toBe('true');
  });

  it('returns an empty object when no settings are present', () => {
    const db = fakeDb({}) as never;
    expect(getProviderConfig(db, 'codex')).toEqual({});
  });
});
