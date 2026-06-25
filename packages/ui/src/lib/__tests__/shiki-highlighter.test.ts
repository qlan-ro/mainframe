import { describe, it, expect } from 'vitest';
import { invalidateShikiTheme, getShikiThemeVersion, subscribeShikiTheme } from '../shiki-highlighter';

describe('shiki theme invalidation', () => {
  it('bumps the version and notifies subscribers', () => {
    const before = getShikiThemeVersion();
    let notified = 0;
    const unsub = subscribeShikiTheme(() => {
      notified += 1;
    });
    invalidateShikiTheme();
    expect(getShikiThemeVersion()).toBe(before + 1);
    expect(notified).toBe(1);
    unsub();
    invalidateShikiTheme();
    expect(notified).toBe(1); // no longer subscribed
  });
});
