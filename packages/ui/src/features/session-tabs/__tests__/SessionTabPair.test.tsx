/**
 * SessionTabPair — unit tests.
 *
 * The split pair as one fused pill: the focused segment is filled, a parked
 * pair fills neither (the fill means "this is live", not "this is the active
 * member"). Each segment is a full `SessionTabPill` (role=tab, its own
 * testid). While a third tab is dragged, the whole pair is a drop target —
 * dropping calls `onDropTab` with the dragged id.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useTabDragStore } from '@/features/chat/zones/tab-drag-store';
import { SessionTabPair } from '../SessionTabPair';
import type { SessionTabEntry, SessionTabPillActions } from '../SessionTabPill';

function tab(id: string, over: Partial<SessionTabEntry> = {}): SessionTabEntry {
  return {
    id,
    title: id,
    projectId: undefined,
    projectName: undefined,
    adapterId: 'claude',
    active: false,
    preview: false,
    forkAvailability: { enabled: false, reason: 'not a fork' },
    hasPending: false,
    canOpenSideChat: true,
    ...over,
  };
}

function actions(): SessionTabPillActions {
  return {
    onActivate: vi.fn(),
    onClose: vi.fn(),
    onPin: vi.fn(),
    onOpenInSplit: vi.fn(),
    onCloseSplit: vi.fn(),
    onFork: vi.fn(),
    onOpenSideChat: vi.fn(),
    onDropTab: vi.fn(),
    surface: { canSplit: true, onSplitRight: vi.fn(), onSplitDown: vi.fn(), canHide: true, onHide: vi.fn() },
  };
}

function renderPair(overrides: Partial<Parameters<typeof SessionTabPair>[0]> = {}) {
  const acts = actions();
  const hintOf = vi.fn(() => null);
  const props = {
    tabs: [tab('chat-a'), tab('chat-b')] as [SessionTabEntry, SessionTabEntry],
    focused: 0 as const,
    visible: true,
    hintOf,
    ...acts,
    ...overrides,
  };
  render(<SessionTabPair {...props} />);
  return acts;
}

beforeEach(() => {
  useTabDragStore.setState({ draggingId: null });
});

describe('SessionTabPair — segment fill', () => {
  it('fills segment 0 when focused is 0', () => {
    renderPair({ focused: 0, visible: true });
    const segmentA = screen.getByTestId('session-tab-chat-a');
    const segmentB = screen.getByTestId('session-tab-chat-b');
    expect(segmentA.className).toContain('bg-accent');
    expect(segmentB.className).not.toContain('bg-accent');
  });

  it('fills segment 1 when focused is 1', () => {
    renderPair({ focused: 1, visible: true });
    const segmentA = screen.getByTestId('session-tab-chat-a');
    const segmentB = screen.getByTestId('session-tab-chat-b');
    expect(segmentA.className).not.toContain('bg-accent');
    expect(segmentB.className).toContain('bg-accent');
  });

  it('fills NEITHER segment while parked — the fill means "live", not "active member"', () => {
    renderPair({ focused: 0, visible: false });
    const segmentA = screen.getByTestId('session-tab-chat-a');
    const segmentB = screen.getByTestId('session-tab-chat-b');
    expect(segmentA.className).not.toContain('bg-accent');
    expect(segmentB.className).not.toContain('bg-accent');
  });
});

describe('SessionTabPair — each member is a full tab', () => {
  it('keeps session-tab-<id> role=tab for both members', () => {
    renderPair();
    const segmentA = screen.getByTestId('session-tab-chat-a');
    const segmentB = screen.getByTestId('session-tab-chat-b');
    expect(segmentA).toHaveAttribute('role', 'tab');
    expect(segmentB).toHaveAttribute('role', 'tab');
  });

  it("clicking a member activates it through the pair's own actions", () => {
    const acts = renderPair();
    fireEvent.mouseDown(screen.getByTestId('session-tab-chat-b'));
    fireEvent.click(screen.getByTestId('session-tab-chat-b'));
    expect(acts.onActivate).toHaveBeenCalledWith('chat-b', false);
  });
});

describe('SessionTabPair — drop target', () => {
  it('calls onDropTab with the dragged id when a third tab is dropped on the pair', () => {
    const acts = renderPair({ visible: true });
    act(() => useTabDragStore.setState({ draggingId: 'chat-c' }));

    const group = screen.getByTestId('session-tabs-zone-group');
    fireEvent.pointerEnter(group);
    fireEvent.pointerUp(group);

    expect(acts.onDropTab).toHaveBeenCalledWith('chat-c');
  });

  it('is not a drop target for a member of the pair itself', () => {
    const acts = renderPair({ visible: true });
    act(() => useTabDragStore.setState({ draggingId: 'chat-a' }));

    const group = screen.getByTestId('session-tabs-zone-group');
    fireEvent.pointerEnter(group);
    fireEvent.pointerUp(group);

    expect(acts.onDropTab).not.toHaveBeenCalled();
  });

  it('is not a drop target while parked', () => {
    const acts = renderPair({ visible: false });
    act(() => useTabDragStore.setState({ draggingId: 'chat-c' }));

    const group = screen.getByTestId('session-tabs-zone-group');
    fireEvent.pointerEnter(group);
    fireEvent.pointerUp(group);

    expect(acts.onDropTab).not.toHaveBeenCalled();
  });
});
