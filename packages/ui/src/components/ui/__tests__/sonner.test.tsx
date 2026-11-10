import { describe, it, expect, afterEach } from 'vitest';
import { render, act, cleanup, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { Toaster } from '../sonner';
import { useTheme } from '@/store/theme';

afterEach(() => {
  cleanup();
  useTheme.setState({ resolvedMode: 'light' });
});

describe('Toaster theme', () => {
  it('data-sonner-theme follows resolvedMode and updates without a remount', async () => {
    useTheme.setState({ resolvedMode: 'light' });
    render(<Toaster />);
    act(() => {
      toast('hello');
    });
    const el = () => document.querySelector('[data-sonner-toaster]');
    await waitFor(() => expect(el()?.getAttribute('data-sonner-theme')).toBe('light'));
    const node = el();
    act(() => useTheme.setState({ resolvedMode: 'dark' }));
    await waitFor(() => expect(el()?.getAttribute('data-sonner-theme')).toBe('dark'));
    expect(el()).toBe(node);
  });
});
