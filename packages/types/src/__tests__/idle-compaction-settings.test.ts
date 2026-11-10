import { describe, expect, it } from 'vitest';
import { GENERAL_DEFAULTS, GeneralConfigSchema, GeneralConfigPatchSchema } from '../settings.js';
describe('idle compaction settings boundary', () => {
  it('defaults existing installs to disabled', () => {
    const old = { ...GENERAL_DEFAULTS } as Partial<typeof GENERAL_DEFAULTS>;
    delete old.idleCompaction;
    expect(GeneralConfigSchema.parse(old).idleCompaction).toEqual({ enabled: false });
  });
  it('accepts partial patches and rejects invalid enabled values', () => {
    expect(GeneralConfigPatchSchema.parse({ idleCompaction: { enabled: true } })).toEqual({
      idleCompaction: { enabled: true },
    });
    expect(GeneralConfigPatchSchema.parse({})).toEqual({});
    for (const enabled of ['true', 1, null, [], {}]) {
      expect(GeneralConfigPatchSchema.safeParse({ idleCompaction: { enabled } }).success).toBe(false);
      expect(GeneralConfigSchema.safeParse({ ...GENERAL_DEFAULTS, idleCompaction: { enabled } }).success).toBe(false);
    }
  });
});
