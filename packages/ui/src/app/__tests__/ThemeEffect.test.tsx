import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { ThemeEffect } from '../ThemeEffect';
import { useTheme, UI_SCALE_FACTORS } from '@/store/theme';

describe('ThemeEffect', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-scheme');
    useTheme.setState({ mode: 'light', scheme: 'classic', windowStyle: 'glass', uiScale: 'normal' });
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

  it('applies the zoom factor for the active uiScale', () => {
    useTheme.setState({ uiScale: 'large' });
    render(<ThemeEffect />);
    expect(document.documentElement.style.zoom).toBe(String(UI_SCALE_FACTORS.large));
  });
});
