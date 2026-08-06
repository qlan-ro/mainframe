// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme, applyStoredTheme } from '../theme';

// applyStoredScale delegates to the host's native page zoom (no-op in jsdom);
// mock the host so we can assert the factor setZoom is called with.
const { setZoomMock } = vi.hoisted(() => ({ setZoomMock: vi.fn() }));
vi.mock('@/lib/host', () => ({ getHost: () => ({ setZoom: setZoomMock }) }));

// Reset module registry and localStorage before every test so each case starts
// from a clean slate. The theme store reads localStorage at module-init time,
// so tests that verify the initial value must re-import after seeding storage.
beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
  setZoomMock.mockClear();
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
// theme store — applyStoredTheme
// ---------------------------------------------------------------------------

describe('theme store — applyStoredTheme', () => {
  beforeEach(() => {
    localStorage.clear();
    useTheme.setState({ mode: 'light' });
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-scheme');
  });

  it('writes the dark class from localStorage', () => {
    localStorage.setItem('mf-theme', 'dark');
    applyStoredTheme();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('removes a lingering data-scheme from an older build unconditionally', () => {
    document.documentElement.setAttribute('data-scheme', 'ocean');
    applyStoredTheme();
    expect(document.documentElement.hasAttribute('data-scheme')).toBe(false);
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

  it('applyStoredScale calls host.setZoom with the matching factor', async () => {
    localStorage.setItem('mf-ui-scale', 'large');
    const { applyStoredScale, UI_SCALE_FACTORS } = await import('../theme');
    applyStoredScale();
    expect(setZoomMock).toHaveBeenCalledWith(UI_SCALE_FACTORS.large);
  });

  it('applyStoredScale calls host.setZoom with the compact factor', async () => {
    localStorage.setItem('mf-ui-scale', 'compact');
    const { applyStoredScale, UI_SCALE_FACTORS } = await import('../theme');
    applyStoredScale();
    expect(setZoomMock).toHaveBeenCalledWith(UI_SCALE_FACTORS.compact);
  });
});
