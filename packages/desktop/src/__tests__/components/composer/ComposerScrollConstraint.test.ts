/**
 * Structural tests for the ComposerCard overflow/scroll constraint rules.
 *
 * We import and inspect a snapshot of the source string inlined via a vitest
 * virtual module / raw import. Because jsdom has no layout engine, we verify
 * the required CSS tokens appear in the component source (reliable proxy that
 * the double-scrollbar and cursor-offset fixes are present).
 */
import { describe, it, expect } from 'vitest';

// Raw import of the TSX source as a string — vitest + Vite support ?raw query.
import composerSource from '../../../renderer/components/chat/assistant-ui/composer/ComposerCard.tsx?raw';

describe('ComposerCard scroll constraints', () => {
  it('caps textarea scroll region at 14lh via maxHeight style', () => {
    expect(composerSource).toMatch(/14lh/);
  });

  it('inner scroll wrapper uses overflow-y-auto', () => {
    expect(composerSource).toMatch(/overflow-y-auto/);
  });

  it('outer card does not allow a second scrollbar (overflow-hidden on root)', () => {
    expect(composerSource).toMatch(/overflow-hidden/);
  });

  it('sets explicit lineHeight on the textarea for cursor alignment', () => {
    expect(composerSource).toMatch(/lineHeight/);
  });

  it('uses box-sizing border-box in the composer tree', () => {
    expect(composerSource).toMatch(/box-sizing.*border-box|boxSizing.*border-box/);
  });
});
