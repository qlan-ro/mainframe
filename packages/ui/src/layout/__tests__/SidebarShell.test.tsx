import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The shell composes chrome around the sessions list; mock the heavy children so
// this test asserts only composition + DOM order (list → resize → panel → footer).
vi.mock('@/features/sessions/sidebar/SessionSidebar', () => ({
  SessionSidebar: () => <div data-testid="session-list-stub" />,
}));
vi.mock('@/features/context-panel/BottomPanel', () => ({
  BottomPanel: () => <div data-testid="bottom-panel-stub" />,
}));
vi.mock('@/features/context-panel/PanelResizeHandle', () => ({
  PanelResizeHandle: () => <div data-testid="sidebar-bottom-resize" />,
}));
vi.mock('@/layout/SidebarFooter', () => ({ SidebarFooter: () => <div data-testid="sidebar-footer-stub" /> }));
vi.mock('../SidebarHeader', () => ({ SidebarHeader: () => <div data-testid="sidebar-header-stub" /> }));

import { SidebarShell } from '../SidebarShell';

describe('SidebarShell composition', () => {
  it('mounts the bottom panel and footer as sidebar chrome, after the session list', () => {
    render(<SidebarShell />);
    const list = screen.getByTestId('session-list-stub');
    const resize = screen.getByTestId('sidebar-bottom-resize');
    const panel = screen.getByTestId('bottom-panel-stub');
    const footer = screen.getByTestId('sidebar-footer-stub');

    expect(resize).toBeInTheDocument();
    expect(panel).toBeInTheDocument();
    expect(footer).toBeInTheDocument();

    // DOM order: list → resize handle → panel → footer.
    expect(list.compareDocumentPosition(resize) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(resize.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(panel.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Regression: without min-h-0 this flex item keeps its content height, so a
  // tall session list overflows the sidebar and the bottom panel + footer get
  // clipped out of view. jsdom can't verify flex layout, so guard the class.
  it('keeps min-h-0 on the content frame so the inner list scrolls (panel/footer stay visible)', () => {
    render(<SidebarShell />);
    const frame = screen.getByTestId('sessions-sidebar-content-frame');
    expect(frame.className).toContain('min-h-0');
  });
});
