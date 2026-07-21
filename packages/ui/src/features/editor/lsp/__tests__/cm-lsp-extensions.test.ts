/**
 * cm-lsp-extensions — extension-factory contract tests.
 *
 * jsdom cannot mount a live EditorView with CM6 DOM APIs, so these tests
 * cover the factory's public contract (extension array shape, diagnostics
 * opt-in). The keymap/navigation integration is tested in navigation.test.ts.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LspProviders } from '@/lib/lsp';
import { createLspExtensions } from '../cm-lsp-extensions';

function makeProviders(overrides: Partial<LspProviders> = {}): LspProviders {
  return {
    getDefinition: vi.fn().mockResolvedValue([]),
    getReferences: vi.fn().mockResolvedValue([]),
    getHover: vi.fn().mockResolvedValue(null),
    getWorkspaceSymbols: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

const baseOpts = {
  projectId: 'proj1',
  language: 'typescript',
  filePath: '/src/auth.ts',
  lspReady: true,
};

describe('createLspExtensions', () => {
  it('returns a non-empty array of extensions', () => {
    const providers = makeProviders();
    const extensions = createLspExtensions(providers, baseOpts);
    expect(Array.isArray(extensions)).toBe(true);
    expect(extensions.length).toBeGreaterThan(0);
  });

  it('includes a diagnostics extension when diagnosticsProvider is provided', () => {
    const providers = makeProviders();
    const diagnosticsProvider = {
      getDiagnostics: vi.fn().mockResolvedValue([]),
    };
    const extensions = createLspExtensions(providers, { ...baseOpts, diagnosticsProvider });
    // More extensions than without the diagnostics provider.
    const baseExtensions = createLspExtensions(providers, baseOpts);
    expect(extensions.length).toBeGreaterThan(baseExtensions.length);
  });
});
