import { describe, expect, it } from 'vitest';
import { normalizeSavedDefaultModel } from '../model-default.js';

describe('normalizeSavedDefaultModel', () => {
  it('preserves a configured model present in the catalog', () => {
    expect(normalizeSavedDefaultModel('sonnet', [{ id: 'sonnet', label: 'Sonnet 5' }])).toBe('sonnet');
  });

  it('preserves a configured model while the catalog is empty', () => {
    expect(normalizeSavedDefaultModel('opus', [])).toBe('opus');
  });

  it('omits a configured model absent from a non-empty catalog', () => {
    expect(
      normalizeSavedDefaultModel('opus', [
        { id: 'default', label: 'Default - Opus 4.8', isDefault: true },
        { id: 'sonnet', label: 'Sonnet 5' },
      ]),
    ).toBeUndefined();
  });
});
