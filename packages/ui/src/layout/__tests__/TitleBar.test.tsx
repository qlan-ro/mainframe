/**
 * TitleBar — unit tests.
 *
 * D1/D2/D6: the 48px strip spanning the window, the ONE drag region, in
 * normal flow (nothing `fixed`). Three sections: the 80px traffic-light
 * reserve, the sidebar section (`calc(56px + var(--sidebar-width) - 80px)`,
 * collapsing to 0), and the chat column (session tabs + right cluster). The
 * surface toggle pill lives in the chat column's right cluster.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/features/session-tabs/SessionTabs', () => ({ SessionTabs: () => <div data-testid="session-tabs-stub" /> }));

import { TitleBar } from '../TitleBar';

function renderBar(open: boolean) {
  return render(
    <SidebarProvider open={open} onOpenChange={() => {}}>
      <TooltipProvider>
        <TitleBar />
      </TooltipProvider>
    </SidebarProvider>,
  );
}

describe('TitleBar — drag region', () => {
  it('carries data-drag-region on the root, in normal flow', () => {
    renderBar(true);
    const bar = screen.getByTestId('title-bar');
    expect(bar).toHaveAttribute('data-drag-region');
    expect(bar.className).not.toContain('fixed');
  });
});

describe('TitleBar — sidebar section width', () => {
  it('sizes the sidebar section to calc(56px + var(--sidebar-width) - 80px) while open', () => {
    renderBar(true);
    const section = screen.getByTestId('title-bar-sidebar-section');
    expect(section.style.width).toBe('calc(56px + var(--sidebar-width) - 80px)');
    expect(section).not.toHaveAttribute('data-collapsed');
  });

  it('collapses the sidebar section to 0 while closed', () => {
    renderBar(false);
    const section = screen.getByTestId('title-bar-sidebar-section');
    expect(section.style.width).toBe('0px');
    expect(section).toHaveAttribute('data-collapsed', '');
  });
});

describe('TitleBar — surface controls', () => {
  it('renders the chat/workspace pill in the right cluster', () => {
    renderBar(true);
    const actions = screen.getByTestId('title-bar-actions');
    expect(actions.contains(screen.getByTestId('surface-rail'))).toBe(true);
  });

  it('keeps the sidebar section free of controls while open', () => {
    renderBar(true);
    const section = screen.getByTestId('title-bar-sidebar-section');
    expect(section.querySelector('button')).toBeNull();
  });

  it('keeps the right cluster in the chat column while collapsed', () => {
    renderBar(false);
    const column = screen.getByTestId('title-bar-chat-column');
    const actions = screen.getByTestId('title-bar-actions');
    expect(column.contains(actions)).toBe(true);
    const showSidebar = screen.getByTestId('show-sidebar-button');
    expect(showSidebar.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no show-sidebar button while open', () => {
    renderBar(true);
    expect(screen.queryByTestId('show-sidebar-button')).toBeNull();
  });
});

describe('TitleBar — composition', () => {
  it('renders the session tabs and the right-cluster actions in the chat column', () => {
    renderBar(true);
    const column = screen.getByTestId('title-bar-chat-column');
    expect(column.contains(screen.getByTestId('session-tabs-stub'))).toBe(true);
    expect(column.contains(screen.getByTestId('title-bar-actions'))).toBe(true);
  });
});
