import { describe, expect, it } from 'vitest';
import { GENERAL_DEFAULTS, GeneralConfigSchema, GeneralConfigPatchSchema } from '../settings.js';

describe('history release settings boundary', () => {
  it('defaults existing installs to ten minutes', () => {
    const old = { ...GENERAL_DEFAULTS } as Partial<typeof GENERAL_DEFAULTS>;
    delete old.historyRelease;
    expect(GeneralConfigSchema.parse(old).historyRelease).toEqual({ idleMinutes: 10 });
  });

  it('accepts whole minutes in range and null for never', () => {
    for (const idleMinutes of [1, 5, 60, 1440, null]) {
      expect(GeneralConfigPatchSchema.parse({ historyRelease: { idleMinutes } })).toEqual({
        historyRelease: { idleMinutes },
      });
    }
  });

  it('rejects a missing, fractional or out-of-range idle time', () => {
    for (const historyRelease of [
      {},
      { idleMinutes: 0 },
      { idleMinutes: 1441 },
      { idleMinutes: 2.5 },
      { idleMinutes: '10' },
    ]) {
      expect(GeneralConfigPatchSchema.safeParse({ historyRelease }).success).toBe(false);
    }
  });
});
