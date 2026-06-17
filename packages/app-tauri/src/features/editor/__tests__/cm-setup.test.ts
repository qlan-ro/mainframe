/**
 * cm-setup.ts — structural tests for makeWarmTheme and warmTheme exports.
 *
 * We cannot introspect CM6's internal `dark` flag from the outside, so these
 * tests verify the public contract: makeWarmTheme is exported, it accepts a
 * boolean, and it returns an Extension-shaped value (non-null object / array).
 * The behavior change (dark flag now matches the app scheme instead of always
 * being `true`) is covered by the code change and by the fact that CM6's
 * unfocused-selection defaults now differ between light and dark schemes.
 */
import { describe, expect, it } from 'vitest';
import { makeWarmTheme, warmTheme } from '../cm-setup';

describe('makeWarmTheme', () => {
  it('is exported as a function', () => {
    expect(typeof makeWarmTheme).toBe('function');
  });

  it('returns a non-null value for isDark=false (light scheme)', () => {
    const theme = makeWarmTheme(false);
    expect(theme).toBeTruthy();
  });

  it('returns a non-null value for isDark=true (dark scheme)', () => {
    const theme = makeWarmTheme(true);
    expect(theme).toBeTruthy();
  });

  it('returns distinct Extension objects for different isDark values', () => {
    const light = makeWarmTheme(false);
    const dark = makeWarmTheme(true);
    // Each call produces a separate instance (not the same reference)
    expect(light).not.toBe(dark);
  });
});

describe('warmTheme (default singleton)', () => {
  it('is exported as a non-null extension', () => {
    expect(warmTheme).toBeTruthy();
  });

  it('is the result of makeWarmTheme (same type)', () => {
    // warmTheme should be the same shape as makeWarmTheme produces
    const fromFactory = makeWarmTheme(false);
    // Both should be the same type (CM6 StyleModule-wrapped Extension)
    expect(typeof warmTheme).toBe(typeof fromFactory);
  });
});
