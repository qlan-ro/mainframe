import { it, expect, vi, beforeEach, describe } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PreviewHandle, InspectResult } from '@qlan-ro/mainframe-types';

let inspectResultCallback: ((result: InspectResult) => void) | null = null;

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

function makeFakeHandle(): PreviewHandle {
  return {
    setVisible: vi.fn(),
    navigate: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71])),
    startInspect: vi.fn().mockResolvedValue(undefined),
    onInspect: vi.fn().mockImplementation((cb: (result: InspectResult) => void) => {
      inspectResultCallback = cb;
      return () => {};
    }),
    startRegionSelect: vi.fn().mockResolvedValue(undefined),
    onRegionSelect: vi.fn().mockReturnValue(() => {}),
    refit: vi.fn(),
    setDevice: vi.fn(),
    destroy: vi.fn(),
  };
}

describe('usePreviewCapture', () => {
  const mockSetOverlayMounted = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    inspectResultCallback = null;
    mockSandboxGetState.captures = [];
  });

  it('full capture: calls capture and addCapture with screenshot type', async () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    expect(fakeHandle.capture).toHaveBeenCalledWith();
    expect(mockAddCapture).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'screenshot', imageDataUrl: expect.stringContaining('data:image/png;base64,') }),
    );
  });

  it('full capture: opens annotation popover after capture', async () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    expect(result.current.annotationPopoverOpen).toBe(false);
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    expect(result.current.annotationPopoverOpen).toBe(true);
  });

  it('region overlay: toggles open on onRegionClick', () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    expect(result.current.regionOverlayOpen).toBe(false);
    act(() => {
      result.current.onRegionClick();
    });
    expect(result.current.regionOverlayOpen).toBe(true);
  });

  it('region overlay: toggles closed when called again', () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    act(() => {
      result.current.onRegionClick();
    });
    act(() => {
      result.current.onRegionClick();
    });
    expect(result.current.regionOverlayOpen).toBe(false);
  });

  it('inspect: calls startInspect on first toggle', () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    act(() => {
      result.current.onInspectClick();
    });
    expect(result.current.inspectActive).toBe(true);
    expect(fakeHandle.startInspect).toHaveBeenCalled();
  });

  it('inspect: null selector exits inspect mode', async () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    act(() => {
      result.current.onInspectClick();
    });
    await act(async () => {});
    await act(async () => {
      inspectResultCallback?.({ tabId: 'tab-1', selector: null, rect: null, viewport: null });
    });
    expect(result.current.inspectActive).toBe(false);
  });

  it('inspect: result with rect computes padded region and captures element', async () => {
    const fakeHandle = makeFakeHandle();
    renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    await act(async () => {});
    await act(async () => {
      inspectResultCallback?.({
        tabId: 'tab-1',
        selector: '.btn',
        rect: { x: 100, y: 100, w: 200, h: 50 },
        viewport: { x: 0, y: 0, w: 800, h: 600 },
      });
    });
    await act(async () => {});
    expect(fakeHandle.capture).toHaveBeenCalledWith({ x: 80, y: 80, w: 240, h: 90 });
    expect(mockAddCapture).toHaveBeenCalledWith(expect.objectContaining({ type: 'element', selector: '.btn' }));
  });

  it('annotation submit: calls sendCaptures and clearCaptures and closes popover', async () => {
    const fakeHandle = makeFakeHandle();
    mockSandboxGetState.captures = [{ id: 'cap-1', type: 'screenshot', imageDataUrl: 'data:image/png;base64,abc' }];
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
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
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
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
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    expect(mockSetOverlayMounted).toHaveBeenCalledWith(true);
  });

  it('setOverlayMounted: called with false when both overlays closed', () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    void result.current;
    expect(mockSetOverlayMounted).toHaveBeenCalledWith(false);
  });
});
