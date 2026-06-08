// These tests run in Vitest (non-Tauri env — IS_TAURI is always false).
// They verify that every new wrapper returns the documented stub value
// instead of crashing or calling Tauri.
import { describe, it, expect } from 'vitest';
import { showItemInFolder, readFile, showNotification, log, getPlatform } from '../bridge';

describe('bridge stubs (browser/non-Tauri mode)', () => {
  it('showItemInFolder resolves without throwing', async () => {
    await expect(showItemInFolder('/some/path')).resolves.toBeUndefined();
  });

  it('readFile returns null', async () => {
    await expect(readFile('/some/path')).resolves.toBeNull();
  });

  it('showNotification resolves without throwing', async () => {
    await expect(showNotification('hello', 'world')).resolves.toBeUndefined();
  });

  it('log does not throw at any level', () => {
    expect(() => log('debug', 'mod', 'msg')).not.toThrow();
    expect(() => log('info', 'mod', 'msg', { extra: 1 })).not.toThrow();
    expect(() => log('warn', 'mod', 'msg')).not.toThrow();
    expect(() => log('error', 'mod', 'msg')).not.toThrow();
  });

  it('getPlatform returns "browser"', async () => {
    await expect(getPlatform()).resolves.toBe('browser');
  });
});
