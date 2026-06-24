import { describe, it, expect } from 'vitest';
import { UpdateStatusSchema } from '../host-contract.js';

describe('UpdateStatusSchema', () => {
  it('accepts the checking variant', () => {
    expect(UpdateStatusSchema.parse({ state: 'checking' })).toEqual({ state: 'checking' });
  });
  it('accepts available with a version', () => {
    expect(UpdateStatusSchema.parse({ state: 'available', version: '1.2.3' })).toEqual({
      state: 'available',
      version: '1.2.3',
    });
  });
  it('accepts downloading with a percent', () => {
    expect(UpdateStatusSchema.parse({ state: 'downloading', percent: 42 })).toEqual({
      state: 'downloading',
      percent: 42,
    });
  });
  it('accepts downloaded / not-available / error', () => {
    expect(UpdateStatusSchema.parse({ state: 'downloaded', version: '9.9.9' }).state).toBe('downloaded');
    expect(UpdateStatusSchema.parse({ state: 'not-available' }).state).toBe('not-available');
    expect(UpdateStatusSchema.parse({ state: 'error', message: 'boom' }).state).toBe('error');
  });
  it('rejects available without a version', () => {
    expect(() => UpdateStatusSchema.parse({ state: 'available' })).toThrow();
  });
  it('rejects an unknown state', () => {
    expect(() => UpdateStatusSchema.parse({ state: 'paused' })).toThrow();
  });
});
