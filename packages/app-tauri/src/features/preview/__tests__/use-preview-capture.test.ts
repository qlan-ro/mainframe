import { it, expect, vi, beforeEach, afterEach, describe } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { HostProvider, setHostForTesting, resetHostForTesting } from '@/lib/host';

let inspectResultCallback: ((result: unknown) => void) | null = null;
const mockUnlisten = vi.fn();

const mockAddCapture = vi.fn();
const mockClearCaptures = vi.fn();
const mockSandboxGetState = {
  addCapture: mockAddCapture,
  clearCaptures: mockClearCaptures,
  captures: [] as Array<{
    id: string;
    type: 'screenshot' | 'element';
    imageDataUrl: string;
    selector?: string;
    annotation?: string;
  }>,
};

vi.mock('@/store/sandbox', () => ({
  useSandboxStore: Object.assign(
    (selector: (s: typeof mockSandboxGetState) => unknown) => selector(mockSandboxGetState),
    { getState: () => mockSandboxGetState },
  ),
}));

const mockSendCaptures = vi.fn().mockResolvedValue(undefined);
vi.mock('../use-send-captures', () => ({
  useSendCaptures: () => mockSendCaptures,
}));

import { usePreviewCapture } from '../use-preview-capture';

let fakeHost: FakeHostBridge;

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(HostProvider, { host: fakeHost, children });
}

describe('usePreviewCapture', () => {
  const tabId = 'tab-test-1';
  const mockSetOverlayMounted = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    inspectResultCallback = null;
    mockSandboxGetState.captures = [];

    fakeHost = new FakeHostBridge();
    fakeHost.preview.capture = vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71]));
    fakeHost.preview.eval = vi.fn().mockResolvedValue(undefined);
    fakeHost.preview.onInspectResult = vi.fn().mockImplementation((cb: (result: unknown) => void) => {
      inspectResultCallback = cb;
      return Promise.resolve(mockUnlisten);
    });
    setHostForTesting(fakeHost);
  });

  afterEach(() => {
    resetHostForTesting();
  });

  it('full capture: calls capture and addCapture with screenshot type', async () => {
    const { result } = renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    expect(fakeHost.preview.capture).toHaveBeenCalledWith(tabId);
    expect(mockAddCapture).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'screenshot', imageDataUrl: expect.stringContaining('data:image/png;base64,') }),
    );
  });

  it('full capture: opens annotation popover after capture', async () => {
    const { result } = renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    expect(result.current.annotationPopoverOpen).toBe(false);
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    expect(result.current.annotationPopoverOpen).toBe(true);
  });

  it('region overlay: toggles open on onRegionClick', () => {
    const { result } = renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    expect(result.current.regionOverlayOpen).toBe(false);
    act(() => {
      result.current.onRegionClick();
    });
    expect(result.current.regionOverlayOpen).toBe(true);
  });

  it('region overlay: toggles closed when called again', () => {
    const { result } = renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    act(() => {
      result.current.onRegionClick();
    });
    act(() => {
      result.current.onRegionClick();
    });
    expect(result.current.regionOverlayOpen).toBe(false);
  });

  it('inspect: calls preview.eval with install script on first toggle', () => {
    const { result } = renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    act(() => {
      result.current.onInspectClick();
    });
    expect(result.current.inspectActive).toBe(true);
    expect(fakeHost.preview.eval).toHaveBeenCalledWith(tabId, expect.stringContaining('__mfInspectInstall'));
  });

  it('inspect: ignores result for different tabId', async () => {
    renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    await act(async () => {});
    await act(async () => {
      inspectResultCallback?.({
        tabId: 'other-tab',
        selector: '.btn',
        rect: { x: 10, y: 10, w: 100, h: 50 },
        viewport: { x: 0, y: 0, w: 800, h: 600 },
      });
    });
    expect(fakeHost.preview.capture).not.toHaveBeenCalled();
  });

  it('inspect: null selector exits inspect mode', async () => {
    const { result } = renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    act(() => {
      result.current.onInspectClick();
    });
    await act(async () => {});
    await act(async () => {
      inspectResultCallback?.({ tabId, selector: null, rect: null, viewport: null });
    });
    expect(result.current.inspectActive).toBe(false);
  });

  it('inspect: result with rect computes padded region and captures element', async () => {
    renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    await act(async () => {});
    await act(async () => {
      inspectResultCallback?.({
        tabId,
        selector: '.btn',
        rect: { x: 100, y: 100, w: 200, h: 50 },
        viewport: { x: 0, y: 0, w: 800, h: 600 },
      });
    });
    await act(async () => {});
    expect(fakeHost.preview.capture).toHaveBeenCalledWith(tabId, { x: 80, y: 80, w: 240, h: 90 });
    expect(mockAddCapture).toHaveBeenCalledWith(expect.objectContaining({ type: 'element', selector: '.btn' }));
  });

  it('annotation submit: calls sendCaptures and clearCaptures and closes popover', async () => {
    mockSandboxGetState.captures = [{ id: 'cap-1', type: 'screenshot', imageDataUrl: 'data:image/png;base64,abc' }];
    const { result } = renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    await act(async () => {
      await result.current.onAnnotationSubmit();
    });
    expect(mockSendCaptures).toHaveBeenCalled();
    expect(mockClearCaptures).toHaveBeenCalled();
    expect(result.current.annotationPopoverOpen).toBe(false);
  });

  it('annotation cancel: calls clearCaptures and closes popover', async () => {
    const { result } = renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    act(() => {
      result.current.onAnnotationCancel();
    });
    expect(mockClearCaptures).toHaveBeenCalled();
    expect(result.current.annotationPopoverOpen).toBe(false);
  });

  it('setOverlayMounted: called with true when annotationPopoverOpen', async () => {
    const { result } = renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    expect(mockSetOverlayMounted).toHaveBeenCalledWith(true);
  });

  it('setOverlayMounted: called with false when both overlays closed', () => {
    const { result } = renderHook(() => usePreviewCapture(tabId, mockSetOverlayMounted), { wrapper });
    void result.current;
    expect(mockSetOverlayMounted).toHaveBeenCalledWith(false);
  });
});
