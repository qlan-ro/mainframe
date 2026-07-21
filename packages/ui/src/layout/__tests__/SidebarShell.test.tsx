import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// The shell composes chrome around the sessions list; mock the heavy children so
// this test asserts only composition + DOM order (list → footer). SessionSidebar
// itself now composes TasksSidebarSection + TagFilterBar as a bottom cluster
// below its list — covered by SessionSidebar's own tests, not the shell's.
vi.mock('@/features/sessions/sidebar/SessionSidebar', () => ({
  SessionSidebar: () => <div data-testid="session-list-stub" />,
}));
vi.mock('@/layout/SidebarFooter', () => ({ SidebarFooter: () => <div data-testid="sidebar-footer-stub" /> }));
vi.mock('../SidebarHeader', () => ({ SidebarHeader: () => <div data-testid="sidebar-header-stub" /> }));

import { SidebarShell } from '../SidebarShell';

describe('SidebarShell composition', () => {
  it('mounts the footer as sidebar chrome, after the session list', () => {
    render(<SidebarShell />);
    const list = screen.getByTestId('session-list-stub');
    const footer = screen.getByTestId('sidebar-footer-stub');

    expect(footer).toBeInTheDocument();

    // DOM order: list → footer.
    expect(list.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Regression: without min-h-0 this flex item keeps its content height, so a
  // tall session list overflows the sidebar and the footer gets clipped out of
  // view. jsdom can't verify flex layout, so guard the class.
  it('keeps min-h-0 on the content frame so the inner list scrolls (footer stays visible)', () => {
    render(<SidebarShell />);
    const frame = screen.getByTestId('sessions-sidebar-content-frame');
    expect(frame.className).toContain('min-h-0');
  });
});
