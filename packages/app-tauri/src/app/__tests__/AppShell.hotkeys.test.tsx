import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));

const { useGlobalOverlayHotkeys } = await import('../use-global-overlay-hotkeys');

describe('useGlobalOverlayHotkeys', () => {
  beforeEach(() => {
    mockEmit.mockReset();
  });

  afterEach(() => {
    // clean up all keydown listeners by unmounting any rendered hooks
  });

  it('Cmd+O emits open-search-palette and calls preventDefault', () => {
    const { unmount } = renderHook(() => useGlobalOverlayHotkeys());
    const e = new KeyboardEvent('keydown', { metaKey: true, key: 'o', cancelable: true });
    window.dispatchEvent(e);
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-search-palette' });
    expect(e.defaultPrevented).toBe(true);
    unmount();
  });

  it('Ctrl+O also emits open-search-palette', () => {
    const { unmount } = renderHook(() => useGlobalOverlayHotkeys());
    const e = new KeyboardEvent('keydown', { ctrlKey: true, key: 'o', cancelable: true });
    window.dispatchEvent(e);
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-search-palette' });
    unmount();
  });

  it('Cmd+Shift+R emits open-review and calls preventDefault', () => {
    const { unmount } = renderHook(() => useGlobalOverlayHotkeys());
    const e = new KeyboardEvent('keydown', { metaKey: true, shiftKey: true, key: 'r', cancelable: true });
    window.dispatchEvent(e);
    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-review' });
    expect(e.defaultPrevented).toBe(true);
    unmount();
  });

  it('unrelated keydown does not emit', () => {
    const { unmount } = renderHook(() => useGlobalOverlayHotkeys());
    const e = new KeyboardEvent('keydown', { metaKey: true, key: 'k' });
    window.dispatchEvent(e);
    expect(mockEmit).not.toHaveBeenCalled();
    unmount();
  });

  it('removes the event listener on unmount', () => {
    const { unmount } = renderHook(() => useGlobalOverlayHotkeys());
    unmount();
    const e = new KeyboardEvent('keydown', { metaKey: true, key: 'o' });
    window.dispatchEvent(e);
    expect(mockEmit).not.toHaveBeenCalled();
  });
});
