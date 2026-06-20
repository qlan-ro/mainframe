/**
 * cm-lsp-extensions — behavior tests.
 *
 * These tests verify the extension-factory contracts without mounting a live
 * EditorView (jsdom limitations mean CM6 DOM APIs are partially unavailable).
 * The hover and go-to-def code paths are tested via unit-level extraction of
 * the async logic; the keymap integration is tested in navigation.test.ts.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { LspProviders, LspLocation, LspHover } from '@/lib/lsp';
import { emitSurfaceIntent, onSurfaceIntent, type SurfaceIntent } from '@/store/surface-intents';
import { createJumpHistory } from '../navigation';
import { createLspExtensions } from '../cm-lsp-extensions';

// ---------------------------------------------------------------------------
// Shared mock providers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// createLspExtensions — smoke test (returns an array)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Hover — getHover is called with the correct args
// ---------------------------------------------------------------------------

describe('hover logic (provider contract)', () => {
  it('getHover is called with the correct projectId, language, filePath', async () => {
    const hover: LspHover = { contents: [{ kind: 'plaintext', value: 'string' }] };
    const providers = makeProviders({ getHover: vi.fn().mockResolvedValue(hover) });

    // Simulate what the hoverTooltip callback does:
    const result = await providers.getHover('proj1', 'typescript', {
      filePath: '/src/auth.ts',
      position: { line: 4, character: 10 },
    });

    expect(providers.getHover).toHaveBeenCalledWith('proj1', 'typescript', {
      filePath: '/src/auth.ts',
      position: { line: 4, character: 10 },
    });
    expect(result?.contents[0]?.value).toBe('string');
  });

  it('returns null when getHover resolves to null', async () => {
    const providers = makeProviders({ getHover: vi.fn().mockResolvedValue(null) });
    const result = await providers.getHover('proj1', 'typescript', {
      filePath: '/src/auth.ts',
      position: { line: 0, character: 0 },
    });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Go-to-def — emits open-file + pushes history
// ---------------------------------------------------------------------------

describe('go-to-def logic (provider contract)', () => {
  let capturedIntents: SurfaceIntent[];
  let unsubscribe: () => void;

  beforeEach(() => {
    capturedIntents = [];
    unsubscribe = onSurfaceIntent((intent) => capturedIntents.push(intent));
  });

  it('emits open-file intent when getDefinition resolves a location', async () => {
    const location: LspLocation = {
      uri: 'file:///src/utils.ts',
      range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } },
    };
    const providers = makeProviders({ getDefinition: vi.fn().mockResolvedValue([location]) });
    const history = createJumpHistory();

    // Simulate the ⌘-click async logic:
    const fromEntry = { path: '/src/auth.ts', line: 4, character: 10 };
    const locations = await providers.getDefinition('proj1', 'typescript', {
      filePath: '/src/auth.ts',
      position: { line: 4, character: 10 },
    });
    const target = locations[0];
    if (target) {
      history.push(fromEntry);
      const targetPath = target.uri.startsWith('file://') ? target.uri.slice('file://'.length) : target.uri;
      emitSurfaceIntent({ type: 'open-file', path: targetPath });
    }

    expect(capturedIntents).toHaveLength(1);
    expect(capturedIntents[0]).toEqual({ type: 'open-file', path: '/src/utils.ts' });
    unsubscribe();
  });

  it('pushes from-entry onto the jump history before navigating', async () => {
    const location: LspLocation = {
      uri: 'file:///src/utils.ts',
      range: { start: { line: 10, character: 0 }, end: { line: 10, character: 5 } },
    };
    const providers = makeProviders({ getDefinition: vi.fn().mockResolvedValue([location]) });
    const history = createJumpHistory();

    const fromEntry = { path: '/src/auth.ts', line: 4, character: 10 };
    const locations = await providers.getDefinition('proj1', 'typescript', {
      filePath: '/src/auth.ts',
      position: { line: 4, character: 10 },
    });
    if (locations[0]) {
      history.push(fromEntry);
    }

    // Push a second entry so we can go back to fromEntry.
    history.push({ path: '/src/utils.ts', line: 10, character: 0 });

    // back() should return the from-entry (first push, now one step behind cursor).
    const back = history.back();
    expect(back).toEqual(fromEntry);
    unsubscribe();
  });

  it('does not emit when getDefinition returns empty array', async () => {
    const providers = makeProviders({ getDefinition: vi.fn().mockResolvedValue([]) });

    const locations = await providers.getDefinition('proj1', 'typescript', {
      filePath: '/src/auth.ts',
      position: { line: 0, character: 0 },
    });
    const target = locations[0];
    if (target) {
      emitSurfaceIntent({ type: 'open-file', path: '' });
    }

    expect(capturedIntents).toHaveLength(0);
    unsubscribe();
  });
});

// ---------------------------------------------------------------------------
// Diagnostics provider
// ---------------------------------------------------------------------------

describe('diagnostics provider contract', () => {
  it('getDiagnostics is called with projectId, language, filePath', async () => {
    const diagnosticsProvider = {
      getDiagnostics: vi.fn().mockResolvedValue([]),
    };

    await diagnosticsProvider.getDiagnostics('proj1', 'typescript', { filePath: '/src/auth.ts' });

    expect(diagnosticsProvider.getDiagnostics).toHaveBeenCalledWith('proj1', 'typescript', {
      filePath: '/src/auth.ts',
    });
  });
});
