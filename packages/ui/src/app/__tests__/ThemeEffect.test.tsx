import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeEffect } from '../ThemeEffect';
import { useTheme, UI_SCALE_FACTORS } from '@/store/theme';

// The zoom effect delegates to the host's native page zoom (no-op in jsdom);
// mock the host so we can assert the factor setZoom is called with.
const { setZoomMock } = vi.hoisted(() => ({ setZoomMock: vi.fn() }));
vi.mock('@/lib/host', () => ({ getHost: () => ({ setZoom: setZoomMock }) }));

describe('ThemeEffect', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-scheme');
    useTheme.setState({ mode: 'light', scheme: 'classic', windowStyle: 'glass', uiScale: 'normal' });
    setZoomMock.mockClear();
  });

  it('applies dark class for dark mode', () => {
    useTheme.setState({ mode: 'dark' });
    render(<ThemeEffect />);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('applies data-scheme for non-classic schemes and removes it for classic', () => {
    useTheme.setState({ scheme: 'velvet' });
    const { rerender } = render(<ThemeEffect />);
    expect(document.documentElement.getAttribute('data-scheme')).toBe('velvet');
    useTheme.setState({ scheme: 'classic' });
    rerender(<ThemeEffect />);
    expect(document.documentElement.hasAttribute('data-scheme')).toBe(false);
  });

  it('applies native zoom for the active uiScale', () => {
    useTheme.setState({ uiScale: 'large' });
    render(<ThemeEffect />);
    expect(setZoomMock).toHaveBeenCalledWith(UI_SCALE_FACTORS.large);
  });
});
