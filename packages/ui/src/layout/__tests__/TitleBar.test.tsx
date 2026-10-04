/**
 * TitleBar — unit tests.
 *
 * D1/D2/D6: the 48px strip spanning the window, the ONE drag region, in
 * normal flow (nothing `fixed`). Three sections: the 80px traffic-light
 * reserve, the sidebar section (`calc(56px + var(--sidebar-width) - 80px)`,
 * collapsing to 0), and the chat column (session tabs + right cluster). The
 * surface toggle pill (`SurfaceRail`, testid `surface-rail`) renders ONCE —
 * inside the sidebar section while open, re-anchored to the chat column
 * (after the show-sidebar button) while collapsed.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';

vi.mock('@/features/session-tabs/SessionTabs', () => ({ SessionTabs: () => <div data-testid="session-tabs-stub" /> }));
vi.mock('../TitleBarActions', () => ({
  TitleBarActions: ({ projectId }: { projectId?: string }) => (
    <div data-testid="title-bar-actions-stub" data-project-id={projectId ?? ''} />
  ),
}));

import { TitleBar } from '../TitleBar';

function renderBar(open: boolean, props: Parameters<typeof TitleBar>[0] = {}) {
  return render(
    <SidebarProvider open={open} onOpenChange={() => {}}>
      <TooltipProvider>
        <TitleBar {...props} />
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

describe('TitleBar — the surface toggle pill renders exactly once', () => {
  it('sits inside the sidebar section while open', () => {
    renderBar(true);
    const section = screen.getByTestId('title-bar-sidebar-section');
    expect(screen.getAllByTestId('surface-rail')).toHaveLength(1);
    expect(section.contains(screen.getByTestId('surface-rail'))).toBe(true);
  });

  it('re-anchors to the chat column, after the show-sidebar button, while collapsed', () => {
    renderBar(false);
    expect(screen.getAllByTestId('surface-rail')).toHaveLength(1);
    const column = screen.getByTestId('title-bar-chat-column');
    expect(column.contains(screen.getByTestId('surface-rail'))).toBe(true);
    const showSidebar = screen.getByTestId('show-sidebar-button');
    const rail = screen.getByTestId('surface-rail');
    expect(showSidebar.compareDocumentPosition(rail) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no show-sidebar button while open', () => {
    renderBar(true);
    expect(screen.queryByTestId('show-sidebar-button')).toBeNull();
  });
});

describe('TitleBar — composition', () => {
  it('renders the session tabs and the right-cluster actions in the chat column, passed the projectId', () => {
    renderBar(true, { projectId: 'proj-9' });
    const column = screen.getByTestId('title-bar-chat-column');
    expect(column.contains(screen.getByTestId('session-tabs-stub'))).toBe(true);
    const actions = screen.getByTestId('title-bar-actions-stub');
    expect(column.contains(actions)).toBe(true);
    expect(actions).toHaveAttribute('data-project-id', 'proj-9');
  });
});
