/**
 * useFilesStore unit tests.
 *
 * Covers the consume-once revealTarget pattern: setRevealTarget, getRevealTarget,
 * consumeRevealTarget (reads + clears in one call), and clearing on consume.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useFilesStore } from '../files';

function store() {
  return useFilesStore.getState();
}

beforeEach(() => {
  useFilesStore.setState({ revealTarget: null });
});

describe('setRevealTarget', () => {
  it('stores the path', () => {
    store().setRevealTarget('src/lib/util.ts');
    expect(store().revealTarget).toBe('src/lib/util.ts');
  });

  it('overwrites a previous reveal target', () => {
    store().setRevealTarget('a.ts');
    store().setRevealTarget('b.ts');
    expect(store().revealTarget).toBe('b.ts');
  });
});

describe('consumeRevealTarget', () => {
  it('returns the path and clears it', () => {
    store().setRevealTarget('src/index.ts');
    const result = store().consumeRevealTarget();
    expect(result).toBe('src/index.ts');
    expect(store().revealTarget).toBeNull();
  });

  it('returns null when no target is set', () => {
    expect(store().consumeRevealTarget()).toBeNull();
  });

  it('calling consume twice returns null on the second call', () => {
    store().setRevealTarget('src/a.ts');
    store().consumeRevealTarget();
    expect(store().consumeRevealTarget()).toBeNull();
  });
});
