/**
 * Editor store unit tests — behavior-based, hardcoded expectations.
 *
 * Covers:
 *  - setBuffer / getBuffer / clearBuffer semantics
 *  - dirty-flag tracking (save clears dirty)
 *  - cache eviction: buffers and viewStates are capped at 50 entries
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../editor';

function store() {
  return useEditorStore.getState();
}

beforeEach(() => {
  useEditorStore.setState({ buffers: new Map(), viewStates: new Map() });
});

// ── setBuffer / getBuffer / clearBuffer ──────────────────────────────────────

describe('setBuffer', () => {
  it('stores a clean buffer by default', () => {
    store().setBuffer('/a.ts', 'hello');
    const buf = store().getBuffer('/a.ts');
    expect(buf).toEqual({ value: 'hello', dirty: false });
  });

  it('stores a dirty buffer when dirty=true', () => {
    store().setBuffer('/a.ts', 'edited', true);
    const buf = store().getBuffer('/a.ts');
    expect(buf).toEqual({ value: 'edited', dirty: true });
  });

  it('overwrites an existing entry', () => {
    store().setBuffer('/a.ts', 'v1', false);
    store().setBuffer('/a.ts', 'v2', true);
    expect(store().getBuffer('/a.ts')).toEqual({ value: 'v2', dirty: true });
  });

  it('clearing dirty after save: setBuffer with dirty=false clears the flag', () => {
    store().setBuffer('/a.ts', 'v1', true);
    expect(store().getBuffer('/a.ts')?.dirty).toBe(true);
    store().setBuffer('/a.ts', 'v1', false);
    expect(store().getBuffer('/a.ts')?.dirty).toBe(false);
  });
});

describe('getBuffer', () => {
  it('returns undefined for an unknown path', () => {
    expect(store().getBuffer('/nope.ts')).toBeUndefined();
  });
});

describe('clearBuffer', () => {
  it('removes the buffer for the path', () => {
    store().setBuffer('/a.ts', 'x');
    store().clearBuffer('/a.ts');
    expect(store().getBuffer('/a.ts')).toBeUndefined();
  });

  it('is a no-op when the path was never set', () => {
    expect(() => store().clearBuffer('/nope.ts')).not.toThrow();
  });
});

// ── cache eviction: cap at 50 ─────────────────────────────────────────────────

describe('buffer cache eviction', () => {
  it('evicts the oldest entry when 51st entry is added', () => {
    for (let i = 0; i < 50; i++) {
      store().setBuffer(`/file-${i}.ts`, `content-${i}`);
    }
    // All 50 should be present.
    expect(store().buffers.size).toBe(50);
    expect(store().getBuffer('/file-0.ts')).toBeDefined();

    // Adding the 51st should evict /file-0.ts (oldest).
    store().setBuffer('/file-50.ts', 'content-50');
    expect(store().buffers.size).toBe(50);
    expect(store().getBuffer('/file-0.ts')).toBeUndefined();
    expect(store().getBuffer('/file-50.ts')).toEqual({ value: 'content-50', dirty: false });
  });

  it('preserves all entries when count stays at or below 50', () => {
    for (let i = 0; i < 50; i++) {
      store().setBuffer(`/file-${i}.ts`, `v${i}`);
    }
    expect(store().buffers.size).toBe(50);
    // Re-setting an existing key does NOT grow the map beyond 50.
    store().setBuffer('/file-0.ts', 'updated');
    expect(store().buffers.size).toBe(50);
  });
});

describe('viewState cache eviction', () => {
  it('evicts the oldest viewState when 51st entry is saved', () => {
    for (let i = 0; i < 50; i++) {
      store().saveViewState(`/file-${i}.ts`, { selectionAnchor: i, selectionHead: i, scrollTop: 0 });
    }
    expect(store().viewStates.size).toBe(50);
    expect(store().getViewState('/file-0.ts')).toBeDefined();

    store().saveViewState('/file-50.ts', { selectionAnchor: 50, selectionHead: 50, scrollTop: 0 });
    expect(store().viewStates.size).toBe(50);
    expect(store().getViewState('/file-0.ts')).toBeUndefined();
    expect(store().getViewState('/file-50.ts')).toEqual({ selectionAnchor: 50, selectionHead: 50, scrollTop: 0 });
  });
});
