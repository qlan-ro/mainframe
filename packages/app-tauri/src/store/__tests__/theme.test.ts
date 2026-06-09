import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    const { useTheme } = await import('../theme');
    useTheme.getState().setMode('dark');
    expect(useTheme.getState().mode).toBe('dark');
    expect(localStorage.getItem('mf-theme')).toBe('dark');
  });
});
