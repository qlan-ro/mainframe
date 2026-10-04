/**
 * SessionPanelToggle — unit tests.
 *
 * The title bar's "session details" switch: `focusedPanelColumn` resolves
 * `main` for the single surface, or `zone:<id>` once the focused thread is a
 * member of a visible split. The click calls `usePanelControl.togglePanel`
 * for that column, carrying its measured `fits`. `aria-pressed` follows the
 * persisted `sessionPanelOpen` bit, and the button carries the tour's
 * `data-tut="session-rail"` anchor.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUiPrefs } from '@/store/ui-prefs';
import { useZonesStore } from '@/features/chat/zones/zones-store';
import { usePanelControl } from '../panel-control-store';

let mockMainThreadId: string | null = null;
vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: { threads: { mainThreadId: string | null } }) => unknown) =>
    selector({ threads: { mainThreadId: mockMainThreadId } }),
}));

import { SessionPanelToggle, focusedPanelColumn } from '../SessionPanelToggle';

const render_ = () =>
  render(
    <TooltipProvider>
      <SessionPanelToggle />
    </TooltipProvider>,
  );

beforeEach(() => {
  mockMainThreadId = null;
  useUiPrefs.setState({ sessionPanelOpen: true });
  useZonesStore.setState({ zones: null, focusedIndex: 0 });
  usePanelControl.setState({ overlayOpen: {}, fits: {} });
});

describe('focusedPanelColumn', () => {
  it("resolves 'main' with no split", () => {
    expect(focusedPanelColumn(null, 'chat-a')).toBe('main');
  });

  it('resolves the zone column when the main thread is a member of a visible pair', () => {
    expect(focusedPanelColumn(['chat-a', 'chat-b'], 'chat-a')).toBe('zone:chat-a');
    expect(focusedPanelColumn(['chat-a', 'chat-b'], 'chat-b')).toBe('zone:chat-b');
  });

  it("falls back to 'main' when the focused thread is not a pair member", () => {
    expect(focusedPanelColumn(['chat-a', 'chat-b'], 'chat-c')).toBe('main');
  });

  it("falls back to 'main' with no main thread id", () => {
    expect(focusedPanelColumn(['chat-a', 'chat-b'], null)).toBe('main');
  });
});

describe('SessionPanelToggle — aria-pressed', () => {
  it('is pressed when the panel is open', () => {
    useUiPrefs.setState({ sessionPanelOpen: true });
    render_();
    expect(screen.getByTestId('title-bar-details')).toHaveAttribute('aria-pressed', 'true');
  });

  it('is not pressed when the panel is closed', () => {
    useUiPrefs.setState({ sessionPanelOpen: false });
    render_();
    expect(screen.getByTestId('title-bar-details')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SessionPanelToggle — click', () => {
  it("toggles the 'main' column when there is no visible split", () => {
    mockMainThreadId = 'chat-a';
    useUiPrefs.setState({ sessionPanelOpen: true });
    usePanelControl.setState({ fits: { main: true } });
    render_();

    fireEvent.click(screen.getByTestId('title-bar-details'));

    expect(useUiPrefs.getState().sessionPanelOpen).toBe(false);
  });

  it('toggles the focused zone column when the focused thread is a member of a visible pair', () => {
    mockMainThreadId = 'chat-a';
    useZonesStore.setState({ zones: ['chat-a', 'chat-b'], focusedIndex: 0 });
    useUiPrefs.setState({ sessionPanelOpen: true });
    usePanelControl.setState({ fits: { 'zone:chat-a': false } });
    render_();

    fireEvent.click(screen.getByTestId('title-bar-details'));

    // Open + does not fit + not already floating → floats rather than closes
    // (the float-when-narrow rule togglePanel carries).
    expect(useUiPrefs.getState().sessionPanelOpen).toBe(true);
    expect(usePanelControl.getState().overlayOpen['zone:chat-a']).toBe(true);
    expect(usePanelControl.getState().overlayOpen.main).toBeUndefined();
  });
});

describe('SessionPanelToggle — tour anchor and label', () => {
  it('carries the session-rail tour anchor', () => {
    render_();
    expect(screen.getByTestId('title-bar-details')).toHaveAttribute('data-tut', 'session-rail');
  });

  it('labels itself by the open state', () => {
    useUiPrefs.setState({ sessionPanelOpen: true });
    render_();
    expect(screen.getByTestId('title-bar-details')).toHaveAttribute('aria-label', 'Hide session details');
  });
});
