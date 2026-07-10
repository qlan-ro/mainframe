import { describe, it, expect, vi, beforeEach } from 'vitest';
import { invalidateShikiTheme, getShikiThemeVersion, subscribeShikiTheme } from '../shiki-highlighter';

describe('shiki theme invalidation', () => {
  it('bumps the version and notifies subscribers', () => {
    const before = getShikiThemeVersion();
    let notified = 0;
    const unsub = subscribeShikiTheme(() => {
      notified += 1;
    });
    invalidateShikiTheme();
    expect(getShikiThemeVersion()).toBe(before + 1);
    expect(notified).toBe(1);
    unsub();
    invalidateShikiTheme();
    expect(notified).toBe(1); // no longer subscribed
  });
});

// Real shiki's `createHighlighter` calls `(options.langs ?? []).map(...)` — a
// non-array `langs` (e.g. a Set) throws `TypeError: ...map is not a function`
// at init, which the singleton then swallows into a `.catch` (logged, engine
// stays null) so every consumer silently falls back to unstyled plain text.
vi.mock('shiki', async (importOriginal) => {
  const actual = await importOriginal<typeof import('shiki')>();
  return { ...actual, createHighlighter: vi.fn().mockResolvedValue({ loadTheme: vi.fn() }) };
});

const CODE_VARS = [
  '--mf-code-bg',
  '--mf-code-fg',
  '--mf-code-kw',
  '--mf-code-str',
  '--mf-code-fn',
  '--mf-code-type',
  '--mf-code-num',
  '--mf-code-cmt',
];

describe('getShikiHighlighter', () => {
  beforeEach(() => {
    for (const name of CODE_VARS) document.documentElement.style.setProperty(name, '#000000');
  });

  it('passes langs to createHighlighter as a real array', async () => {
    const { createHighlighter } = await import('shiki');
    // Fresh singleton per test file run; this is the first (and only) call site.
    const { getShikiHighlighter } = await import('../shiki-highlighter');
    await getShikiHighlighter();

    const call = vi.mocked(createHighlighter).mock.calls[0]![0]!;
    expect(Array.isArray(call.langs)).toBe(true);
  });
});
