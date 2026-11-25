// @vitest-environment jsdom
import { it, expect, vi, beforeEach, describe, type Mock } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { PreviewHandle, InspectResult, RegionSelectResult } from '@qlan-ro/mainframe-types';

let inspectResultCallback: ((result: InspectResult) => void) | null = null;
let regionResultCallback: ((result: RegionSelectResult) => void) | null = null;

const mockAddToDraft = vi.fn();
vi.mock('@/features/chat/composer/draft-content/use-add-to-draft', () => ({
  useAddToDraft: () => mockAddToDraft,
}));

import { useSandboxStore, type Capture } from '@/store/sandbox';
import { usePreviewCapture } from '../use-preview-capture';

const store = useSandboxStore.getState();
const mockAddCapture = vi.fn(store.addCapture);
const mockClearCaptures = vi.fn(store.clearCaptures);

function makeFakeHandle(): PreviewHandle {
  return {
    setVisible: vi.fn(),
    compositesAboveDom: true,
    navigate: vi.fn().mockResolvedValue(undefined),
    capture: vi.fn().mockResolvedValue(new Uint8Array([137, 80, 78, 71])),
    startInspect: vi.fn().mockResolvedValue(undefined),
    cancelInspect: vi.fn().mockResolvedValue(undefined),
    onInspect: vi.fn().mockImplementation((cb: (result: InspectResult) => void) => {
      inspectResultCallback = cb;
      return () => {};
    }),
    startRegionSelect: vi.fn().mockResolvedValue(undefined),
    cancelRegionSelect: vi.fn().mockResolvedValue(undefined),
    onRegionSelect: vi.fn().mockImplementation((cb: (result: RegionSelectResult) => void) => {
      regionResultCallback = cb;
      return () => {};
    }),
    onNavigate: vi.fn().mockReturnValue(() => {}),
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
    regionResultCallback = null;
    useSandboxStore.setState({ captures: [], addCapture: mockAddCapture, clearCaptures: mockClearCaptures });
    mockAddToDraft.mockReturnValue(true);
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

  it('region select: onRegionClick starts the in-webview picker and sets active', () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    act(() => {
      result.current.onRegionClick();
    });
    expect(fakeHandle.startRegionSelect).toHaveBeenCalled();
    expect(result.current.regionSelectActive).toBe(true);
  });

  it('region select: a selected region captures it and opens the annotation popover', async () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    await act(async () => {}); // let the onRegionSelect subscription register
    act(() => {
      result.current.onRegionClick();
    });
    await act(async () => {
      regionResultCallback?.({ tabId: 'tab-1', region: { x: 10, y: 20, w: 30, h: 40 } });
    });
    await act(async () => {});
    expect(fakeHandle.capture).toHaveBeenCalledWith({ x: 10, y: 20, w: 30, h: 40 });
    expect(mockAddCapture).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'screenshot', region: { w: 30, h: 40 } }),
    );
    expect(result.current.annotationPopoverOpen).toBe(true);
    expect(result.current.regionSelectActive).toBe(false);
  });

  it('region select: a cancelled (null) region clears active and does not capture', async () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    await act(async () => {});
    act(() => {
      result.current.onRegionClick();
    });
    await act(async () => {
      regionResultCallback?.({ tabId: 'tab-1', region: null });
    });
    expect(fakeHandle.capture).not.toHaveBeenCalled();
    expect(result.current.regionSelectActive).toBe(false);
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

  it('mutual exclusion: onRegionClick while inspect is active cancels inspect and starts region select', () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    act(() => {
      result.current.onInspectClick();
    });
    expect(result.current.inspectActive).toBe(true);
    act(() => {
      result.current.onRegionClick();
    });
    expect(result.current.inspectActive).toBe(false);
    expect(result.current.regionSelectActive).toBe(true);
    expect(fakeHandle.cancelInspect).toHaveBeenCalled();
    expect(fakeHandle.startRegionSelect).toHaveBeenCalled();
  });

  it('inspect: clicking onInspectClick again while active toggles it off without starting a new inspect', () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    act(() => {
      result.current.onInspectClick();
    });
    expect(result.current.inspectActive).toBe(true);
    act(() => {
      result.current.onInspectClick();
    });
    expect(result.current.inspectActive).toBe(false);
    expect(fakeHandle.cancelInspect).toHaveBeenCalled();
    expect(fakeHandle.startInspect).toHaveBeenCalledTimes(1);
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

  it('inspect: a successful pick clears inspectActive', async () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    act(() => {
      result.current.onInspectClick();
    });
    await act(async () => {});
    expect(result.current.inspectActive).toBe(true);
    await act(async () => {
      inspectResultCallback?.({
        tabId: 'tab-1',
        selector: 'h1#hello',
        rect: { x: 48, y: 48, w: 416, h: 110 },
        viewport: { x: 0, y: 0, w: 512, h: 706 },
      });
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

  const submitWith = async (captures: Capture[], notes: Record<string, string> = {}) => {
    const handle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(handle, mockSetOverlayMounted));
    await act(async () => {
      result.current.onCaptureClick();
    });
    act(() => useSandboxStore.setState({ captures }));
    for (const [id, note] of Object.entries(notes)) act(() => result.current.onAnnotationChange(id, note));
    act(() => result.current.onAnnotationSubmit());
    return result;
  };

  it('annotation submit: adds each capture to the message with its note, and sends nothing', async () => {
    const image = 'data:image/png;base64,abc';
    const result = await submitWith(
      [
        { id: 'cap-1', type: 'element', imageDataUrl: image, selector: '.btn', annotation: 'old' },
        { id: 'cap-2', type: 'screenshot', imageDataUrl: image, region: { w: 30, h: 40 } },
      ],
      { 'cap-1': 'new note' },
    );
    expect(mockAddToDraft).toHaveBeenCalledExactlyOnceWith([
      { kind: 'capture', type: 'element', imageDataUrl: image, selector: '.btn', note: 'new note' },
      { kind: 'capture', type: 'screenshot', imageDataUrl: image, region: { w: 30, h: 40 }, note: '' },
    ]);
    expect(mockClearCaptures).toHaveBeenCalled();
    expect(result.current.annotationPopoverOpen).toBe(false);
  });

  it('annotation submit: keeps the captures and the panel when there is no message to add to', async () => {
    mockAddToDraft.mockReturnValue(false);
    const result = await submitWith([{ id: 'cap-1', type: 'screenshot', imageDataUrl: 'data:image/png;base64,abc' }]);
    expect(mockClearCaptures).not.toHaveBeenCalled();
    expect(result.current.annotationPopoverOpen).toBe(true);
  });

  it('closes the panel when a project switch takes the captures, and gives notes back with them', async () => {
    const handle = makeFakeHandle();
    const { result, unmount } = renderHook(() => usePreviewCapture(handle, mockSetOverlayMounted));
    await act(async () => {
      result.current.onCaptureClick();
    });
    const { id } = result.current.pendingCaptures[0]!;
    act(() => result.current.onAnnotationChange(id, 'half a note'));
    const taken = useSandboxStore.getState().captures;
    act(() => useSandboxStore.setState({ captures: [] }));
    expect(result.current).toMatchObject({ annotationPopoverOpen: false, annotationBackdrop: null });
    expect(mockSetOverlayMounted).toHaveBeenLastCalledWith(false);

    unmount();
    expect(taken).toEqual([expect.objectContaining({ id, annotation: 'half a note' })]);
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

  it('captures a full-preview backdrop before opening annotation when compositesAboveDom (Tauri)', async () => {
    const fakeHandle = makeFakeHandle(); // compositesAboveDom: true
    (fakeHandle.capture as Mock).mockResolvedValue(new Uint8Array([1, 2, 3]));
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    expect(result.current.annotationPopoverOpen).toBe(true);
    expect(result.current.annotationBackdrop).toMatch(/^data:image\/png;base64,/);
  });

  it('does NOT capture a backdrop when compositesAboveDom is false (Electron)', async () => {
    const fakeHandle = { ...makeFakeHandle(), compositesAboveDom: false };
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    expect(result.current.annotationBackdrop).toBeNull();
  });

  it('clears the backdrop when annotation is cancelled', async () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    act(() => {
      result.current.onAnnotationCancel();
    });
    expect(result.current.annotationBackdrop).toBeNull();
  });

  it('clears the backdrop when annotation is submitted', async () => {
    const fakeHandle = makeFakeHandle();
    const { result } = renderHook(() => usePreviewCapture(fakeHandle, mockSetOverlayMounted));
    await act(async () => {
      result.current.onCaptureClick();
    });
    await act(async () => {});
    await act(async () => {
      await result.current.onAnnotationSubmit();
    });
    expect(result.current.annotationBackdrop).toBeNull();
  });
});
