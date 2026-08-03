// @vitest-environment jsdom
/**
 * use-skills-revalidation.test.ts
 *
 * Red until `../use-skills-revalidation` exists (todo #243, plan Group D,
 * task C3). Pins the revalidation nonce to D9: it starts at 0, a bump made
 * from outside React (no store action, no hook) is observable through the
 * `useSkillsNonce()` selector, and the counter is monotonic — it never resets
 * to 0, so two bumps never collide on the same value.
 */
import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSkillsNonce, bumpSkillsRevalidation } from '../use-skills-revalidation';

describe('useSkillsNonce / bumpSkillsRevalidation', () => {
  it('starts at 0', () => {
    const { result } = renderHook(() => useSkillsNonce());

    expect(result.current).toBe(0);
  });

  it('increments when bumpSkillsRevalidation is called from outside React', () => {
    const { result } = renderHook(() => useSkillsNonce());
    const before = result.current;

    act(() => {
      bumpSkillsRevalidation();
    });

    expect(result.current).toBe(before + 1);
  });

  it('two bumps produce two distinct, non-zero values', () => {
    const { result } = renderHook(() => useSkillsNonce());

    act(() => {
      bumpSkillsRevalidation();
    });
    const afterFirst = result.current;

    act(() => {
      bumpSkillsRevalidation();
    });
    const afterSecond = result.current;

    expect(afterSecond).not.toBe(afterFirst);
    expect(afterFirst).not.toBe(0);
    expect(afterSecond).not.toBe(0);
  });
});
