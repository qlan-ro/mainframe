// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { usePreviewAddress } from '../use-preview-address';

function makeHandle(over: Partial<PreviewHandle> = {}): PreviewHandle {
  return {
    setVisible: vi.fn(),
    compositesAboveDom: true,
    navigate: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(new Uint8Array()),
    startInspect: vi.fn().mockResolvedValue(undefined),
    onInspect: vi.fn().mockReturnValue(() => {}),
    startRegionSelect: vi.fn().mockResolvedValue(undefined),
    onRegionSelect: vi.fn().mockReturnValue(() => {}),
    onNavigate: vi.fn().mockReturnValue(() => {}),
    refit: vi.fn(),
    setDevice: vi.fn(),
    destroy: vi.fn(),
    ...over,
  };
}

describe('usePreviewAddress', () => {
  it('seeds currentUrl from the seed URL', () => {
    const { result } = renderHook(({ h, u }) => usePreviewAddress(h, u), {
      initialProps: { h: makeHandle(), u: 'http://localhost:3000' as string | null },
    });
    expect(result.current.currentUrl).toBe('http://localhost:3000');
  });

  it('re-seeds when the seed URL changes', () => {
    const { result, rerender } = renderHook(({ h, u }) => usePreviewAddress(h, u), {
      initialProps: { h: makeHandle(), u: 'http://localhost:3000' as string | null },
    });
    rerender({ h: makeHandle(), u: 'https://example.com/docs' });
    expect(result.current.currentUrl).toBe('https://example.com/docs');
  });

  it('keeps the current URL when the seed goes null', () => {
    const { result, rerender } = renderHook(({ h, u }) => usePreviewAddress(h, u), {
      initialProps: { h: makeHandle(), u: 'http://localhost:3000' as string | null },
    });
    rerender({ h: makeHandle(), u: null });
    expect(result.current.currentUrl).toBe('http://localhost:3000');
  });

  it('navigateTo normalizes + calls handle.navigate and updates currentUrl', () => {
    const handle = makeHandle();
    const { result } = renderHook(() => usePreviewAddress(handle, 'http://localhost:3000'));
    let ok = false;
    act(() => {
      ok = result.current.navigateTo('localhost:3000/dashboard');
    });
    expect(ok).toBe(true);
    expect(handle.navigate).toHaveBeenCalledWith('http://localhost:3000/dashboard');
    expect(result.current.currentUrl).toBe('http://localhost:3000/dashboard');
  });

  it('navigateTo returns false and does not navigate on invalid input', () => {
    const handle = makeHandle();
    const { result } = renderHook(() => usePreviewAddress(handle, 'http://localhost:3000'));
    let ok = true;
    act(() => {
      ok = result.current.navigateTo('   ');
    });
    expect(ok).toBe(false);
    expect(handle.navigate).not.toHaveBeenCalled();
  });

  it('reflects an onNavigate event into currentUrl', () => {
    let emit: ((url: string) => void) | null = null;
    const handle = makeHandle({
      onNavigate: (cb: (url: string) => void) => {
        emit = cb;
        return () => {};
      },
    });
    const { result } = renderHook(() => usePreviewAddress(handle, 'http://localhost:3000'));
    act(() => emit!('http://localhost:3000/from-page'));
    expect(result.current.currentUrl).toBe('http://localhost:3000/from-page');
  });
});
