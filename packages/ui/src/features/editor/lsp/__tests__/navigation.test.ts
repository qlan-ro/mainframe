/**
 * navigation — jump-history stack + findReferences tests.
 */
import { describe, expect, it, vi } from 'vitest';
import { createJumpHistory, findReferences } from '../navigation';
import type { LspProviders } from '@/lib/lsp';

// ---------------------------------------------------------------------------
// JumpHistory
// ---------------------------------------------------------------------------

describe('createJumpHistory', () => {
  it('starts empty (cursor = -1, size = 0)', () => {
    const h = createJumpHistory();
    expect(h.cursor).toBe(-1);
    expect(h.size).toBe(0);
  });

  it('back() returns null when empty', () => {
    expect(createJumpHistory().back()).toBeNull();
  });

  it('forward() returns null when empty', () => {
    expect(createJumpHistory().forward()).toBeNull();
  });

  it('push adds entries and advances cursor', () => {
    const h = createJumpHistory();
    h.push({ path: '/a.ts', line: 1, character: 0 });
    h.push({ path: '/b.ts', line: 2, character: 0 });
    expect(h.size).toBe(2);
    expect(h.cursor).toBe(1);
  });

  it('back() moves to the previous entry', () => {
    const h = createJumpHistory();
    h.push({ path: '/a.ts', line: 1, character: 0 });
    h.push({ path: '/b.ts', line: 2, character: 0 });
    const prev = h.back();
    expect(prev).toEqual({ path: '/a.ts', line: 1, character: 0 });
    expect(h.cursor).toBe(0);
  });

  it('forward() moves to the next entry after back()', () => {
    const h = createJumpHistory();
    h.push({ path: '/a.ts', line: 1, character: 0 });
    h.push({ path: '/b.ts', line: 2, character: 0 });
    h.back();
    const next = h.forward();
    expect(next).toEqual({ path: '/b.ts', line: 2, character: 0 });
    expect(h.cursor).toBe(1);
  });

  it('forward() returns null when at the end', () => {
    const h = createJumpHistory();
    h.push({ path: '/a.ts', line: 1, character: 0 });
    expect(h.forward()).toBeNull();
  });

  it('back() returns null when at the start (cursor = 0)', () => {
    const h = createJumpHistory();
    h.push({ path: '/a.ts', line: 1, character: 0 });
    h.push({ path: '/b.ts', line: 2, character: 0 });
    h.back();
    // now at cursor 0 — one more back() should return null
    expect(h.back()).toBeNull();
  });

  it('push discards forward entries after back()', () => {
    const h = createJumpHistory();
    h.push({ path: '/a.ts', line: 1, character: 0 });
    h.push({ path: '/b.ts', line: 2, character: 0 });
    h.back(); // cursor = 0
    // push from the middle → /c.ts replaces /b.ts
    h.push({ path: '/c.ts', line: 3, character: 0 });
    expect(h.size).toBe(2);
    expect(h.forward()).toBeNull(); // nothing ahead
  });

  it('caps at MAX_HISTORY (100) entries', () => {
    const h = createJumpHistory();
    for (let i = 0; i < 110; i++) {
      h.push({ path: `/file${i}.ts`, line: i, character: 0 });
    }
    expect(h.size).toBe(100);
  });

  // --- review #7: both endpoints recorded ---

  it('jump A→B: back() returns A, forward() returns B', () => {
    const h = createJumpHistory();
    const a = { path: '/a.ts', line: 1, character: 0 };
    const b = { path: '/b.ts', line: 5, character: 3 };
    // Caller pushes both "from" and "to" when recording a jump.
    h.push(a);
    h.push(b);
    // Cursor now points at B (index 1).
    expect(h.cursor).toBe(1);
    // back() → A
    expect(h.back()).toEqual(a);
    expect(h.cursor).toBe(0);
    // forward() → B
    expect(h.forward()).toEqual(b);
    expect(h.cursor).toBe(1);
  });

  it('two sequential jumps then two backs returns intermediate then origin', () => {
    const h = createJumpHistory();
    const a = { path: '/a.ts', line: 0, character: 0 };
    const b = { path: '/b.ts', line: 10, character: 0 };
    const c = { path: '/c.ts', line: 20, character: 0 };
    // First jump: A → B (push A, then B)
    h.push(a);
    h.push(b);
    // Second jump: B → C (push C; B is already last entry so no double-push)
    h.push(c);
    // cursor=2, stack=[A,B,C]
    expect(h.cursor).toBe(2);
    expect(h.size).toBe(3);
    // first back() → B
    expect(h.back()).toEqual(b);
    // second back() → A
    expect(h.back()).toEqual(a);
    // back at origin
    expect(h.back()).toBeNull();
  });

  it('first back() after a single jump returns the origin (not null)', () => {
    const h = createJumpHistory();
    const origin = { path: '/origin.ts', line: 0, character: 0 };
    const dest = { path: '/dest.ts', line: 42, character: 0 };
    h.push(origin);
    h.push(dest);
    // First back should give us the origin, not null.
    const result = h.back();
    expect(result).toEqual(origin);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findReferences
// ---------------------------------------------------------------------------

describe('findReferences', () => {
  function makeProviders(refs: ReturnType<LspProviders['getReferences']>): LspProviders {
    return {
      getDefinition: vi.fn().mockResolvedValue([]),
      getReferences: vi.fn().mockReturnValue(refs),
      getHover: vi.fn().mockResolvedValue(null),
      getWorkspaceSymbols: vi.fn().mockResolvedValue([]),
    };
  }

  it('returns the locations from providers.getReferences', async () => {
    const locations = [
      { uri: 'file:///src/a.ts', range: { start: { line: 5, character: 0 }, end: { line: 5, character: 5 } } },
      { uri: 'file:///src/b.ts', range: { start: { line: 10, character: 2 }, end: { line: 10, character: 7 } } },
    ];
    const providers = makeProviders(Promise.resolve(locations));

    const result = await findReferences(providers, 'proj1', 'typescript', '/src/a.ts', {
      line: 5,
      character: 0,
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.uri).toBe('file:///src/a.ts');
    expect(result[1]?.uri).toBe('file:///src/b.ts');
  });

  it('passes includeDeclaration=false by default', async () => {
    const providers = makeProviders(Promise.resolve([]));
    await findReferences(providers, 'proj1', 'typescript', '/src/a.ts', { line: 0, character: 0 });
    expect(providers.getReferences).toHaveBeenCalledWith('proj1', 'typescript', {
      filePath: '/src/a.ts',
      position: { line: 0, character: 0 },
      includeDeclaration: false,
    });
  });

  it('returns [] and logs a warning when providers.getReferences throws', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const providers = makeProviders(Promise.reject(new Error('oops')));

    const result = await findReferences(providers, 'proj1', 'typescript', '/src/a.ts', {
      line: 0,
      character: 0,
    });

    expect(result).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[navigation]'), expect.any(Error));
    warnSpy.mockRestore();
  });
});
