/**
 * buildReferenceForCm — the `path:line (word)` reference string that both
 * Copy Reference (clipboard) and Add Agent Context (composer setQuote) emit.
 * The menu wiring itself is exercised via EditorTab.test.tsx
 * (editor-context-menu testid).
 */
import { describe, expect, it } from 'vitest';
import { buildReferenceForCm } from '@/lib/editor/copy-reference';

describe('buildReferenceForCm', () => {
  it('builds path:line (word) for a known position', () => {
    // CM6 line 4 (0-based) → display line 5, word "validate"
    const ref = buildReferenceForCm('/src/auth.ts', 4, 'validate');
    expect(ref).toBe('/src/auth.ts:5 (validate)');
  });

  it('builds path:line when no word is found', () => {
    const ref = buildReferenceForCm('/src/auth.ts', 0);
    expect(ref).toBe('/src/auth.ts:1');
  });

  it('handles undefined filePath', () => {
    const ref = buildReferenceForCm(undefined, 0);
    expect(ref).toBe('untitled:1');
  });
});
