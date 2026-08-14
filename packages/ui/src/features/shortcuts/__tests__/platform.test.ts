import { afterEach, describe, expect, it } from 'vitest';
import { isMacPlatform } from '../platform';

function stubNavigator(value: Partial<Navigator & { userAgentData?: { platform?: string } }>) {
  Object.defineProperty(globalThis, 'navigator', {
    value,
    configurable: true,
    writable: true,
  });
}

describe('isMacPlatform', () => {
  const originalNavigator = globalThis.navigator;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
  });

  it('recognizes the lowercase "macOS" that Chromium userAgentData.platform reports', () => {
    stubNavigator({ userAgentData: { platform: 'macOS' }, platform: 'MacIntel', userAgent: '' });
    expect(isMacPlatform()).toBe(true);
  });

  it('still recognizes the legacy navigator.platform fallback', () => {
    stubNavigator({ platform: 'MacIntel', userAgent: '' });
    expect(isMacPlatform()).toBe(true);
  });

  it('returns false for a non-mac Chromium platform', () => {
    stubNavigator({ userAgentData: { platform: 'Windows' }, platform: 'Win32', userAgent: '' });
    expect(isMacPlatform()).toBe(false);
  });
});
