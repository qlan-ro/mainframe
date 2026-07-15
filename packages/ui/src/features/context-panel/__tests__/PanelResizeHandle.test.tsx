import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PanelResizeHandle } from '../PanelResizeHandle';
import { useUiPrefs, BOTTOM_PANEL_DEFAULT_HEIGHT } from '@/store/ui-prefs';

beforeEach(() => {
  useUiPrefs.setState({ bottomPanelTab: 'context', bottomPanelHeight: BOTTOM_PANEL_DEFAULT_HEIGHT });
});

describe('PanelResizeHandle', () => {
  it('renders the row-resize separator with its testid', () => {
    render(<PanelResizeHandle />);
    const handle = screen.getByTestId('sidebar-bottom-resize');
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
  });

  it('increases the panel height when dragged upward', () => {
    render(<PanelResizeHandle />);
    const handle = screen.getByTestId('sidebar-bottom-resize');
    fireEvent.pointerDown(handle, { clientY: 500 });
    fireEvent.pointerMove(window, { clientY: 460 }); // dragged up 40px
    fireEvent.pointerUp(window, { clientY: 460 });
    expect(useUiPrefs.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_DEFAULT_HEIGHT + 40);
  });

  it('accepts a custom containerTestId so a non-sidebar ancestor (e.g. the Inspector) bounds the drag', () => {
    render(
      <div data-testid="inspector-pane">
        <PanelResizeHandle containerTestId="inspector-pane" />
      </div>,
    );
    const handle = screen.getByTestId('sidebar-bottom-resize');
    fireEvent.pointerDown(handle, { clientY: 500 });
    fireEvent.pointerMove(window, { clientY: 460 }); // dragged up 40px
    fireEvent.pointerUp(window, { clientY: 460 });
    // Same drag math applies regardless of which ancestor testid was matched.
    expect(useUiPrefs.getState().bottomPanelHeight).toBe(BOTTOM_PANEL_DEFAULT_HEIGHT + 40);
  });
});
