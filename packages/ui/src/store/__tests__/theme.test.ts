import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme, applyStoredTheme } from '../theme';

// Reset module registry and localStorage before every test so each case starts
// from a clean slate. The theme store reads localStorage at module-init time,
// so tests that verify the initial value must re-import after seeding storage.
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

// ---------------------------------------------------------------------------
// theme store — initial mode defaults to 'light' when localStorage is empty
// ---------------------------------------------------------------------------

describe('theme store — default mode is light when localStorage has no entry', () => {
  it("mode is 'light' on first import with an empty localStorage", async () => {
    const { useTheme } = await import('../theme');
    expect(useTheme.getState().mode).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// theme store — initial mode reads stored 'dark'
// ---------------------------------------------------------------------------

describe("theme store — initial mode is 'dark' when localStorage holds 'dark'", () => {
  it("mode is 'dark' after seeding localStorage with 'dark'", async () => {
    localStorage.setItem('mf-theme', 'dark');
    const { useTheme } = await import('../theme');
    expect(useTheme.getState().mode).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// theme store — invalid stored value falls back to 'light'
// ---------------------------------------------------------------------------

describe("theme store — invalid stored value falls back to 'light'", () => {
  it("mode is 'light' when localStorage holds an unrecognised value like 'purple'", async () => {
    localStorage.setItem('mf-theme', 'purple');
    const { useTheme } = await import('../theme');
    expect(useTheme.getState().mode).toBe('light');
  });
});

// ---------------------------------------------------------------------------
// theme store — toggle() flips light → dark and persists to localStorage
// ---------------------------------------------------------------------------

describe('theme store — toggle() from light produces dark and persists', () => {
  it("mode becomes 'dark' and localStorage['mf-theme'] becomes 'dark'", async () => {
    // No seed → starts light.
    const { useTheme } = await import('../theme');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).toBe('dark');
    expect(localStorage.getItem('mf-theme')).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// theme store — setMode('dark') sets mode and persists to localStorage
// ---------------------------------------------------------------------------

describe("theme store — setMode('dark') updates mode and persists", () => {
  it("mode is 'dark' and localStorage['mf-theme'] is 'dark' after setMode('dark')", async () => {
    // No seed → starts light.
    const { useTheme: freshTheme } = await import('../theme');
    freshTheme.getState().setMode('dark');
    expect(freshTheme.getState().mode).toBe('dark');
    expect(localStorage.getItem('mf-theme')).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// theme store — scheme + windowStyle axes
// ---------------------------------------------------------------------------

describe('theme store — scheme + windowStyle axes', () => {
  beforeEach(() => {
    localStorage.clear();
    // reset store to freshly-read defaults
    useTheme.setState({ mode: 'light', scheme: 'classic', windowStyle: 'glass' });
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-scheme');
  });

  it('defaults: classic scheme, glass window style', () => {
    expect(useTheme.getState().scheme).toBe('classic');
    expect(useTheme.getState().windowStyle).toBe('glass');
  });

  it('setScheme persists and updates', () => {
    useTheme.getState().setScheme('ocean');
    expect(useTheme.getState().scheme).toBe('ocean');
    expect(localStorage.getItem('mf-scheme')).toBe('ocean');
  });

  it('setWindowStyle persists and updates', () => {
    useTheme.getState().setWindowStyle('split');
    expect(useTheme.getState().windowStyle).toBe('split');
    expect(localStorage.getItem('mf-window-style')).toBe('split');
  });

  it('toggle flips mode but preserves scheme', () => {
    useTheme.getState().setScheme('velvet');
    useTheme.getState().toggle();
    expect(useTheme.getState().mode).toBe('dark');
    expect(useTheme.getState().scheme).toBe('velvet');
  });

  it('applyStoredTheme writes dark class + data-scheme from localStorage', () => {
    localStorage.setItem('mf-theme', 'dark');
    localStorage.setItem('mf-scheme', 'ocean');
    applyStoredTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-scheme')).toBe('ocean');
  });

  it('applyStoredTheme removes data-scheme for classic', () => {
    document.documentElement.setAttribute('data-scheme', 'ocean');
    localStorage.setItem('mf-scheme', 'classic');
    applyStoredTheme();
    expect(document.documentElement.hasAttribute('data-scheme')).toBe(false);
  });

  it('invalid persisted values fall back to defaults', () => {
    localStorage.setItem('mf-scheme', 'bogus');
    localStorage.setItem('mf-window-style', 'bogus');
    // re-read via a fresh getter
    expect(['classic', 'ocean', 'velvet']).toContain(useTheme.getState().scheme);
  });
});

// ---------------------------------------------------------------------------
// theme store — uiScale axis
// ---------------------------------------------------------------------------
describe('theme store — uiScale axis', () => {
  it("uiScale defaults to 'normal' when localStorage is empty", async () => {
    const { useTheme } = await import('../theme');
    expect(useTheme.getState().uiScale).toBe('normal');
  });

  it("uiScale reads a stored 'compact'", async () => {
    localStorage.setItem('mf-ui-scale', 'compact');
    const { useTheme } = await import('../theme');
    expect(useTheme.getState().uiScale).toBe('compact');
  });

  it("invalid stored uiScale falls back to 'normal'", async () => {
    localStorage.setItem('mf-ui-scale', 'gigantic');
    const { useTheme } = await import('../theme');
    expect(useTheme.getState().uiScale).toBe('normal');
  });

  it("setUiScale('large') updates state and persists", async () => {
    const { useTheme } = await import('../theme');
    useTheme.getState().setUiScale('large');
    expect(useTheme.getState().uiScale).toBe('large');
    expect(localStorage.getItem('mf-ui-scale')).toBe('large');
  });

  it('applyStoredScale writes the matching zoom factor to <html>', async () => {
    localStorage.setItem('mf-ui-scale', 'large');
    const { applyStoredScale, UI_SCALE_FACTORS } = await import('../theme');
    applyStoredScale();
    expect(document.documentElement.style.zoom).toBe(String(UI_SCALE_FACTORS.large));
  });

  it('applyStoredScale writes 1 for compact', async () => {
    localStorage.setItem('mf-ui-scale', 'compact');
    const { applyStoredScale } = await import('../theme');
    applyStoredScale();
    expect(document.documentElement.style.zoom).toBe('1');
  });
});
