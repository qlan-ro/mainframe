import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { ThemeEffect } from '../ThemeEffect';
import { useTheme, UI_SCALE_FACTORS } from '@/store/theme';

// The zoom and window-theme effects delegate to native host calls (no-ops in
// jsdom); mock the host so we can assert what they're called with.
const { setZoomMock, setWindowThemeMock } = vi.hoisted(() => ({
  setZoomMock: vi.fn(),
  setWindowThemeMock: vi.fn(),
}));
vi.mock('@/lib/host', () => ({ getHost: () => ({ setZoom: setZoomMock, setWindowTheme: setWindowThemeMock }) }));

let colorSchemeListener: ((event: MediaQueryListEvent) => void) | undefined;
const addEventListenerMock = vi.fn();
const removeEventListenerMock = vi.fn();

function installMatchMedia(matches: boolean) {
  colorSchemeListener = undefined;
  addEventListenerMock.mockImplementation((_type, listener) => {
    colorSchemeListener = listener as (event: MediaQueryListEvent) => void;
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      matches,
      media: '(prefers-color-scheme: dark)',
      onchange: null,
      addEventListener: addEventListenerMock,
      removeEventListener: removeEventListenerMock,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

describe('ThemeEffect', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    useTheme.setState({ mode: 'light', resolvedMode: 'light', uiScale: 'normal' });
    setZoomMock.mockClear();
    setWindowThemeMock.mockClear();
    addEventListenerMock.mockReset();
    removeEventListenerMock.mockReset();
    installMatchMedia(false);
  });

  it('applies dark class for dark mode', () => {
    useTheme.setState({ mode: 'dark', resolvedMode: 'dark' });
    render(<ThemeEffect />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('updates the resolved appearance when the operating-system theme changes in System mode', () => {
    useTheme.setState({ mode: 'system', resolvedMode: 'light' });
    render(<ThemeEffect />);

    act(() => colorSchemeListener?.({ matches: true } as MediaQueryListEvent));

    expect(useTheme.getState()).toMatchObject({ mode: 'system', resolvedMode: 'dark' });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('ignores operating-system theme changes in a fixed mode', () => {
    render(<ThemeEffect />);

    act(() => colorSchemeListener?.({ matches: true } as MediaQueryListEvent));

    expect(useTheme.getState()).toMatchObject({ mode: 'light', resolvedMode: 'light' });
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('removes the operating-system theme listener on unmount', () => {
    const { unmount } = render(<ThemeEffect />);
    const registeredListener = colorSchemeListener;

    unmount();

    expect(removeEventListenerMock).toHaveBeenCalledWith('change', registeredListener);
  });

  it('applies native zoom for the active uiScale', () => {
    useTheme.setState({ uiScale: 'large' });
    render(<ThemeEffect />);
    expect(setZoomMock).toHaveBeenCalledWith(UI_SCALE_FACTORS.large);
  });

  describe('native window theme sync', () => {
    it('syncs the native window to a fixed light mode', () => {
      useTheme.setState({ mode: 'light', resolvedMode: 'light' });
      render(<ThemeEffect />);
      expect(setWindowThemeMock).toHaveBeenCalledWith('light');
    });

    it('syncs the native window to a fixed dark mode', () => {
      useTheme.setState({ mode: 'dark', resolvedMode: 'dark' });
      render(<ThemeEffect />);
      expect(setWindowThemeMock).toHaveBeenCalledWith('dark');
    });

    it('lets the OS drive the native window in system mode', () => {
      useTheme.setState({ mode: 'system', resolvedMode: 'dark' });
      render(<ThemeEffect />);
      expect(setWindowThemeMock).toHaveBeenCalledWith(null);
    });

    it('keeps the native window on null across an OS theme change in system mode', () => {
      useTheme.setState({ mode: 'system', resolvedMode: 'light' });
      render(<ThemeEffect />);
      expect(setWindowThemeMock).toHaveBeenLastCalledWith(null);

      act(() => colorSchemeListener?.({ matches: true } as MediaQueryListEvent));

      expect(useTheme.getState().resolvedMode).toBe('dark');
      expect(setWindowThemeMock).toHaveBeenLastCalledWith(null);
    });
  });
});
