import { describe, it, expect } from 'vitest';
import { PresenceStateSchema, PresenceSchema } from '../host-contract.js';

describe('PresenceSchema', () => {
  it('accepts active and idle', () => {
    expect(PresenceStateSchema.parse('active')).toBe('active');
    expect(PresenceStateSchema.parse('idle')).toBe('idle');
    expect(PresenceSchema.parse({ state: 'idle' })).toEqual({ state: 'idle' });
  });
  it('rejects other states', () => {
    expect(() => PresenceStateSchema.parse('away')).toThrow();
  });
});
