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
  Reflect.deleteProperty(window, 'matchMedia');
});

function installMatchMedia(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({ matches })),
  });
}

// ---------------------------------------------------------------------------
// theme store — initial mode defaults to 'system' when localStorage is empty
// ---------------------------------------------------------------------------

describe('theme store — default mode is system when localStorage has no entry', () => {
  it("mode is 'system' and resolves light when matchMedia is unavailable", async () => {
    const { useTheme } = await import('../theme');
    expect(useTheme.getState()).toMatchObject({ mode: 'system', resolvedMode: 'light' });
  });
});

// ---------------------------------------------------------------------------
// theme store — initial mode reads stored 'dark'
// ---------------------------------------------------------------------------

describe("theme store — initial mode is 'dark' when localStorage holds 'dark'", () => {
  it("mode is 'dark' after seeding localStorage with 'dark'", async () => {
    localStorage.setItem('mf-theme', 'dark');
    const { useTheme } = await import('../theme');
    expect(useTheme.getState()).toMatchObject({ mode: 'dark', resolvedMode: 'dark' });
  });
});

// ---------------------------------------------------------------------------
// theme store — system and invalid stored values follow the operating system
// ---------------------------------------------------------------------------

describe('theme store — system preference resolution', () => {
  it("mode is 'system' when localStorage holds an unrecognised value", async () => {
    localStorage.setItem('mf-theme', 'purple');
    const { useTheme } = await import('../theme');
    expect(useTheme.getState()).toMatchObject({ mode: 'system', resolvedMode: 'light' });
  });

  it('resolves System to the current dark operating-system theme', async () => {
    installMatchMedia(true);
    localStorage.setItem('mf-theme', 'system');
    const { useTheme } = await import('../theme');
    expect(useTheme.getState()).toMatchObject({ mode: 'system', resolvedMode: 'dark' });
  });

  it('updates the resolved mode for operating-system changes only in System mode', async () => {
    const { useTheme } = await import('../theme');
    useTheme.getState().syncSystemMode(true);
    expect(useTheme.getState().resolvedMode).toBe('dark');

    useTheme.getState().setMode('light');
    useTheme.getState().syncSystemMode(true);
    expect(useTheme.getState()).toMatchObject({ mode: 'light', resolvedMode: 'light' });
  });
});

// ---------------------------------------------------------------------------
// theme store — toggle() flips light → dark and persists to localStorage
// ---------------------------------------------------------------------------

describe('theme store — toggle() selects the opposite fixed resolved mode', () => {
  it('selects light when System currently resolves dark', async () => {
    installMatchMedia(true);
    const { useTheme } = await import('../theme');
    useTheme.getState().toggle();
    expect(useTheme.getState()).toMatchObject({ mode: 'light', resolvedMode: 'light' });
    expect(localStorage.getItem('mf-theme')).toBe('light');
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
    expect(freshTheme.getState()).toMatchObject({ mode: 'dark', resolvedMode: 'dark' });
    expect(localStorage.getItem('mf-theme')).toBe('dark');
  });

  it("setMode('system') persists and resolves the current operating-system theme", async () => {
    installMatchMedia(true);
    localStorage.setItem('mf-theme', 'light');
    const { useTheme: freshTheme } = await import('../theme');
    freshTheme.getState().setMode('system');
    expect(freshTheme.getState()).toMatchObject({ mode: 'system', resolvedMode: 'dark' });
    expect(localStorage.getItem('mf-theme')).toBe('system');
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

  it('writes the dark class from a dark operating-system theme in System mode', async () => {
    installMatchMedia(true);
    localStorage.setItem('mf-theme', 'system');
    const { applyStoredTheme: applyFreshStoredTheme } = await import('../theme');
    applyFreshStoredTheme();
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
