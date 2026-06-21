import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PanelResizeHandle } from '../PanelResizeHandle';
import { useBottomPanel, BOTTOM_PANEL_DEFAULT_HEIGHT } from '@/store/bottom-panel';

beforeEach(() => {
  useBottomPanel.setState({ tab: 'context', height: BOTTOM_PANEL_DEFAULT_HEIGHT });
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
    expect(useBottomPanel.getState().height).toBe(BOTTOM_PANEL_DEFAULT_HEIGHT + 40);
  });
});
