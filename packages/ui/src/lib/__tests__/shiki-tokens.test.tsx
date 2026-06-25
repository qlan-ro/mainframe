/**
 * Tests for the shared `useShikiTokens` hook and `ShikiCode` component.
 *
 * The shiki WASM engine is mocked to avoid loading grammars in jsdom.
 * The mock returns a predictable token structure so we can assert on rendered
 * output without depending on real shiki internals.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock shiki-highlighter (must be before the import under test)
// ---------------------------------------------------------------------------

let _themeVersion = 0;
const _themeListeners = new Set<() => void>();

vi.mock('@/lib/shiki-highlighter', () => {
  type FakeToken = { color?: string; content: string };
  type FakeResult = { tokens: FakeToken[][] };

  const SUPPORTED = new Set([
    'typescript',
    'javascript',
    'jsx',
    'tsx',
    'python',
    'rust',
    'go',
    'java',
    'json',
    'yaml',
    'toml',
    'xml',
    'bash',
    'css',
    'html',
    'sql',
    'markdown',
    'diff',
  ]);

  const ALIASES: Record<string, string> = {
    ts: 'typescript',
    js: 'javascript',
    py: 'python',
    sh: 'bash',
    shell: 'bash',
    zsh: 'bash',
    yml: 'yaml',
    md: 'markdown',
    rs: 'rust',
  };

  function resolveLanguage(raw: string | undefined): string | null {
    if (!raw) return null;
    const lower = raw.toLowerCase();
    const mapped = ALIASES[lower] ?? lower;
    return SUPPORTED.has(mapped) ? mapped : null;
  }

  const fakeHighlighter = {
    codeToTokens: (code: string, { lang }: { lang: string }): FakeResult => {
      if (lang === 'typescript') {
        return {
          tokens: [[{ color: '#c792ea', content: 'const' }, { content: ' x = 1' }]],
        };
      }
      return { tokens: [[{ content: code }]] };
    },
  };

  function getShikiHighlighter() {
    return Promise.resolve({ highlighter: fakeHighlighter, theme: `mf-warm-chrome-${_themeVersion}` });
  }

  function invalidateShikiTheme() {
    _themeVersion += 1;
    _themeListeners.forEach((l) => l());
  }

  function getShikiThemeVersion() {
    return _themeVersion;
  }

  function subscribeShikiTheme(cb: () => void) {
    _themeListeners.add(cb);
    return () => {
      _themeListeners.delete(cb);
    };
  }

  return {
    resolveLanguage,
    getShikiHighlighter,
    invalidateShikiTheme,
    getShikiThemeVersion,
    subscribeShikiTheme,
  };
});

beforeEach(() => {
  _themeVersion = 0;
  _themeListeners.clear();
  vi.restoreAllMocks();
});

import { useShikiTokens, ShikiCode } from '../shiki-tokens';
import * as hl from '@/lib/shiki-highlighter';

// ---------------------------------------------------------------------------
// useShikiTokens
// ---------------------------------------------------------------------------

describe('useShikiTokens', () => {
  it('returns null initially while the highlighter is loading', () => {
    const { result } = renderHook(() => useShikiTokens('const x = 1', 'typescript'));
    // Sync initial state — highlighter hasn't resolved yet
    expect(result.current).toBeNull();
  });

  it('returns token lines after the highlighter resolves', async () => {
    const { result } = renderHook(() => useShikiTokens('const x = 1', 'typescript'));

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    // Should be a 2D array: one line with two tokens
    expect(result.current).toHaveLength(1);
    expect(result.current![0]).toHaveLength(2);
    expect(result.current![0]![0]!.content).toBe('const');
    expect(result.current![0]![0]!.color).toBe('#c792ea');
  });

  it('returns null for an unknown language (no highlight, no crash)', async () => {
    const { result } = renderHook(() => useShikiTokens('some code', 'unknownlang'));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBeNull();
  });

  it('returns null when langHint is undefined', async () => {
    const { result } = renderHook(() => useShikiTokens('some code', undefined));

    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ShikiCode
// ---------------------------------------------------------------------------

describe('ShikiCode', () => {
  it('renders plain code initially before shiki resolves', () => {
    render(<ShikiCode code="const x = 1" lang="typescript" preClass="my-pre" />);
    // Plain <code> with raw text
    expect(screen.getByRole('code').textContent).toContain('const x = 1');
    // No colored spans yet
    expect(document.querySelector('span[style*="color"]')).toBeNull();
  });

  it('swaps in highlighted spans after the highlighter resolves', async () => {
    render(<ShikiCode code="const x = 1" lang="typescript" preClass="my-pre" />);

    await waitFor(() => {
      const colored = document.querySelector('span[style*="color"]');
      expect(colored).not.toBeNull();
    });
  });

  it('applies the preClass to the wrapping <pre> element', async () => {
    const { container } = render(<ShikiCode code="const x = 1" lang="typescript" preClass="custom-class another" />);

    const pre = container.querySelector('pre');
    expect(pre?.className).toContain('custom-class');
    expect(pre?.className).toContain('another');
  });

  it('renders plain pre for unknown language without crashing', async () => {
    render(<ShikiCode code="raw code here" lang="unknownlang" preClass="" />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByRole('code').textContent).toBe('raw code here');
    expect(document.querySelector('span[style*="color"]')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Theme invalidation: re-requests the highlighter when theme is invalidated
// ---------------------------------------------------------------------------

it('re-requests the highlighter when the theme is invalidated', async () => {
  const spy = vi.spyOn(hl, 'getShikiHighlighter').mockResolvedValue({
    // minimal stub
    highlighter: { codeToTokens: () => ({ tokens: [[{ content: 'x', color: '#fff' }]] }) } as never,
    theme: 'mf-warm-chrome-0',
  });
  render(<ShikiCode code="const x = 1" lang="ts" preClass="" />);
  await Promise.resolve();
  const callsBefore = spy.mock.calls.length;
  hl.invalidateShikiTheme();
  await Promise.resolve();
  expect(spy.mock.calls.length).toBeGreaterThan(callsBefore);
});
