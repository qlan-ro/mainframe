/**
 * use-skills-revalidation.test.ts — the shared skills invalidation nonce.
 *
 * Three independent fetchers (the composer `/`-trigger provider, the sidebar
 * hook, and the setup-advisor Skills section) each mount-fetch skills with no
 * daemon broadcast on change. `bumpSkillsRevalidation()` is the one signal all
 * three subscribe to and re-run on after a successful (or failed) delete.
 *
 * Behaviors covered:
 *   1. Initial state is `{ nonce: 0 }`.
 *   2. `bumpSkillsRevalidation()`, called outside any React tree, increments it.
 *   3. Two bumps produce two distinct nonce values (never the same value twice).
 *   4. A subscriber added via `useSkillsRevalidation.subscribe` fires once per bump.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useSkillsRevalidation, bumpSkillsRevalidation } from '../use-skills-revalidation';

beforeEach(() => {
  useSkillsRevalidation.setState({ nonce: 0 });
});

describe('useSkillsRevalidation — initial state', () => {
  it('starts at nonce 0', () => {
    expect(useSkillsRevalidation.getState().nonce).toBe(0);
  });
});

describe('bumpSkillsRevalidation', () => {
  it('increments the nonce when called outside a React tree', () => {
    bumpSkillsRevalidation();

    expect(useSkillsRevalidation.getState().nonce).toBe(1);
  });

  it('produces two distinct nonce values across two bumps', () => {
    bumpSkillsRevalidation();
    const first = useSkillsRevalidation.getState().nonce;

    bumpSkillsRevalidation();
    const second = useSkillsRevalidation.getState().nonce;

    expect(second).not.toBe(first);
  });
});

describe('useSkillsRevalidation.subscribe', () => {
  it('fires once per bump with the updated nonce', () => {
    const seen: number[] = [];
    const unsubscribe = useSkillsRevalidation.subscribe((state) => seen.push(state.nonce));

    bumpSkillsRevalidation();
    bumpSkillsRevalidation();

    expect(seen).toEqual([1, 2]);
    unsubscribe();
  });
});
