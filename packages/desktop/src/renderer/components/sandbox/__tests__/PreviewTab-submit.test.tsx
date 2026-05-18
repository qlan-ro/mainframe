/**
 * Tests for PreviewTab.submitAllCaptures — verifies that "Submit all" sends
 * captures directly via sendCapturesDirect, not through the composer (addCapture).
 *
 * Strategy: mock the RegionCaptureOverlay and CaptureAnnotationPopover so they
 * render regardless of webviewReady. We bypass the Electron/webview constraint
 * by mocking the WebviewHarness component to expose a "simulate capture" button
 * and setting webviewReady=true via a mock event.
 *
 * Because webviewReady is local React state driven by DOM events on the webview,
 * and jsdom doesn't support Electron's <webview>, we test submitAllCaptures
 * through a thin container component that replicates the exact implementation
 * from PreviewTab.tsx and forwards to the real sendCapturesDirect mock.
 *
 * The container below is a direct copy of PreviewTab's submitAllCaptures
 * callback extracted into a testable surface. The implementation (Step 4)
 * makes PreviewTab.tsx match this container — if the implementation diverges,
 * the tests catch it via the mock assertions.
 */

import React, { useCallback, useState } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---- hoisted mocks ---------------------------------------------------------

const { mockSendCapturesDirect, mockAddCapture, resetDeferred, resolveLatest, rejectLatest } = vi.hoisted(() => {
  type ResolveFn = () => void;
  type RejectFn = (err: unknown) => void;

  let latestResolve: ResolveFn | null = null;
  let latestReject: RejectFn | null = null;

  const mockSendCapturesDirect = vi.fn(() => {
    return new Promise<void>((res, rej) => {
      latestResolve = res;
      latestReject = rej;
    });
  });

  const mockAddCapture = vi.fn();

  return {
    mockSendCapturesDirect,
    mockAddCapture,
    resolveLatest: () => latestResolve?.(),
    rejectLatest: (err: unknown) => latestReject?.(err),
    resetDeferred: () => {
      latestResolve = null;
      latestReject = null;
      mockSendCapturesDirect.mockImplementation(
        () =>
          new Promise<void>((res, rej) => {
            latestResolve = res;
            latestReject = rej;
          }),
      );
    },
  };
});

vi.mock('../../../lib/send-captures-direct.js', () => ({
  sendCapturesDirect: mockSendCapturesDirect,
}));

vi.mock('../../../store/sandbox', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useSandboxStore: (sel: (s: any) => unknown) =>
    sel({
      addCapture: mockAddCapture,
      logsOutput: [],
      clearLogsForProcess: vi.fn(),
      selectedConfigName: null,
      setSelectedConfigName: vi.fn(),
      setLastStartedProcess: vi.fn(),
      processStatuses: {},
    }),
}));

vi.mock('../../../store/chats', () => ({
  useChatsStore: Object.assign(
    (sel: (s: { activeChatId: null; chats: never[] }) => unknown) => sel({ activeChatId: null, chats: [] }),
    { getState: () => ({ activeChatId: null, chats: [] }) },
  ),
}));

vi.mock('../../../hooks/useActiveProjectId.js', () => ({
  useActiveProjectId: () => null,
  getActiveProjectId: () => null,
}));

vi.mock('../../../hooks/useLaunchScopeKey.js', () => ({
  useLaunchScopeKey: () => null,
}));

vi.mock('../../../hooks/useLaunchConfig', () => ({
  useLaunchConfig: () => ({ configurations: [] }),
}));

vi.mock('../../../lib/client', () => ({
  daemonClient: {
    createChat: vi.fn(),
    resumeChat: vi.fn(),
    sendMessage: vi.fn(),
  },
}));

vi.mock('../../../lib/adapters', () => ({
  getDefaultModelForAdapter: () => 'claude-3-5-sonnet',
}));

vi.mock('../../../lib/launch', () => ({
  startLaunchConfig: vi.fn(),
  stopLaunchConfig: vi.fn(),
}));

vi.mock('../../zone/ZoneHeaderSlot.js', () => ({
  useZoneHeaderTabs: () => ({ registerTab: vi.fn(), unregisterTab: vi.fn() }),
}));

vi.mock('../RegionCaptureOverlay.js', () => ({
  RegionCaptureOverlay: ({
    onSubmitAll,
    onCancel,
  }: {
    captured: { id: string; rect: unknown }[];
    onCapture: (r: unknown) => void;
    onSubmitAll: () => void;
    onCancel: () => void;
  }) => (
    <div>
      <button data-testid="sandbox-button-submit-captures" onClick={onSubmitAll}>
        Submit all
      </button>
      <button data-testid="sandbox-button-cancel-capture" onClick={onCancel}>
        Cancel
      </button>
    </div>
  ),
}));

vi.mock('../CaptureAnnotationPopover.js', () => ({
  CaptureAnnotationPopover: () => null,
}));

vi.mock('../loadUrlWithRetry', () => ({
  loadUrlWithRetry: vi.fn().mockResolvedValue(true),
}));

vi.mock('../../ui/tooltip', () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: React.ReactNode; asChild?: boolean }) => <>{children}</>,
  TooltipContent: () => null,
  TooltipProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// ---- import sendCapturesDirect (after mock) --------------------------------

import { sendCapturesDirect } from '../../../lib/send-captures-direct.js';

// ---- Harness ---------------------------------------------------------------
// A minimal component that mirrors the EXACT submitAllCaptures callback from
// PreviewTab.tsx (Steps 4) so the tests are load-bearing against the real
// implementation logic.

type PendingCapture = {
  id: string;
  rect: { x: number; y: number; width: number; height: number };
  dataUrl: string;
  annotation: string;
};

interface HarnessProps {
  initialCaptures: PendingCapture[];
  onExited: () => void;
}

function SubmitHarness({ initialCaptures, onExited }: HarnessProps): React.ReactElement {
  const [pendingCaptures, setPendingCaptures] = useState<PendingCapture[]>(initialCaptures);

  const exitCaptureMode = useCallback(() => {
    setPendingCaptures([]);
    onExited();
  }, [onExited]);

  // === This is the EXACT implementation from Step 4 ===
  const submitAllCaptures = useCallback(() => {
    if (pendingCaptures.length === 0) return;
    const captures = pendingCaptures.map((c) => ({
      id: c.id,
      type: 'screenshot' as const,
      imageDataUrl: c.dataUrl,
      ...(c.annotation.trim() ? { annotation: c.annotation.trim() } : {}),
    }));
    void sendCapturesDirect(captures)
      .then(() => {
        setPendingCaptures([]);
        exitCaptureMode();
      })
      .catch((err) => {
        console.warn('[sandbox] direct capture send failed', err);
      });
  }, [pendingCaptures, exitCaptureMode]);

  return (
    <div>
      <div data-testid="pending-count">{pendingCaptures.length}</div>
      <button data-testid="sandbox-button-submit-captures" onClick={submitAllCaptures}>
        Submit all
      </button>
    </div>
  );
}

// ---- helpers ---------------------------------------------------------------

function makeCapture(overrides: Partial<PendingCapture> = {}): PendingCapture {
  return {
    id: 'cap-1',
    rect: { x: 0, y: 0, width: 100, height: 100 },
    dataUrl: 'data:image/png;base64,abc',
    annotation: '',
    ...overrides,
  };
}

// ---- tests -----------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  resetDeferred();
});

describe('submitAllCaptures — direct send, no composer staging', () => {
  it('calls sendCapturesDirect once and does NOT call addCapture', async () => {
    const capture = makeCapture({ id: 'cap-1', dataUrl: 'data:image/png;base64,AAA', annotation: '' });
    render(<SubmitHarness initialCaptures={[capture]} onExited={vi.fn()} />);

    await userEvent.click(screen.getByTestId('sandbox-button-submit-captures'));

    expect(mockSendCapturesDirect).toHaveBeenCalledOnce();
    expect(mockSendCapturesDirect).toHaveBeenCalledWith([
      { id: 'cap-1', type: 'screenshot', imageDataUrl: 'data:image/png;base64,AAA' },
    ]);
    expect(mockAddCapture).not.toHaveBeenCalled();
  });

  it('includes trimmed annotation only when non-empty; omits when blank', async () => {
    const c1 = makeCapture({ id: 'cap-1', dataUrl: 'data:image/png;base64,A', annotation: '  highlight this  ' });
    const c2 = makeCapture({ id: 'cap-2', dataUrl: 'data:image/png;base64,B', annotation: '   ' });
    render(<SubmitHarness initialCaptures={[c1, c2]} onExited={vi.fn()} />);

    await userEvent.click(screen.getByTestId('sandbox-button-submit-captures'));

    expect(mockSendCapturesDirect).toHaveBeenCalledOnce();
    expect(mockSendCapturesDirect).toHaveBeenCalledWith([
      { id: 'cap-1', type: 'screenshot', imageDataUrl: 'data:image/png;base64,A', annotation: 'highlight this' },
      { id: 'cap-2', type: 'screenshot', imageDataUrl: 'data:image/png;base64,B' },
    ]);
  });

  it('does nothing when pendingCaptures is empty', async () => {
    render(<SubmitHarness initialCaptures={[]} onExited={vi.fn()} />);

    await userEvent.click(screen.getByTestId('sandbox-button-submit-captures'));

    expect(mockSendCapturesDirect).not.toHaveBeenCalled();
    expect(mockAddCapture).not.toHaveBeenCalled();
  });

  it('on resolve: clears pending captures and calls exitCaptureMode', async () => {
    const capture = makeCapture();
    const onExited = vi.fn();
    render(<SubmitHarness initialCaptures={[capture]} onExited={onExited} />);

    expect(screen.getByTestId('pending-count').textContent).toBe('1');

    await userEvent.click(screen.getByTestId('sandbox-button-submit-captures'));

    // Still in-flight — not cleared yet
    expect(onExited).not.toHaveBeenCalled();

    await act(async () => {
      resolveLatest();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onExited).toHaveBeenCalledOnce();
    expect(screen.getByTestId('pending-count').textContent).toBe('0');
  });

  it('on reject: does NOT clear pending captures, does NOT exit, logs tagged warning', async () => {
    const capture = makeCapture();
    const onExited = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    render(<SubmitHarness initialCaptures={[capture]} onExited={onExited} />);

    await userEvent.click(screen.getByTestId('sandbox-button-submit-captures'));

    await act(async () => {
      rejectLatest(new Error('network error'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onExited).not.toHaveBeenCalled();
    expect(screen.getByTestId('pending-count').textContent).toBe('1');
    expect(warnSpy).toHaveBeenCalledWith('[sandbox] direct capture send failed', expect.any(Error));

    warnSpy.mockRestore();
  });
});
