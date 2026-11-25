/**
 * TitleBar — the 48px strip spanning the window, the ONE drag region, in normal
 * flow (nothing `fixed`), cut into segments whose separators stand on the column
 * edges below (W1). The columns report those edges; these tests report them by
 * hand, since jsdom has no layout.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useLayoutStore, type WorkspaceLayout } from '@/store/layout';
import { useUiPrefs } from '@/store/ui-prefs';
import { useColumnEdges } from '../column-edges';

vi.mock('@/features/session-tabs/SessionTabs', () => ({ SessionTabs: () => <div data-testid="session-tabs-stub" /> }));
vi.mock('../TitleBarWorkspace', () => ({ TitleBarWorkspace: () => <div data-testid="title-bar-workspace-stub" /> }));

import { TitleBar } from '../TitleBar';

const place = (top: WorkspaceLayout['top'], bottom: WorkspaceLayout['bottom'] = null) =>
  useLayoutStore.setState({ layout: { top, bottom, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } } });

function renderBar(open = true) {
  return render(
    <SidebarProvider open={open} onOpenChange={() => {}}>
      <TooltipProvider>
        <TitleBar />
      </TooltipProvider>
    </SidebarProvider>,
  );
}

beforeEach(() => {
  place(['chat']);
  useColumnEdges.setState({ content: 316, workspace: null });
  useUiPrefs.setState({ sidebarView: 'chats' });
});

describe('TitleBar — drag region', () => {
  it('carries data-drag-region on the root, in normal flow', () => {
    renderBar();
    const bar = screen.getByTestId('title-bar');
    expect(bar).toHaveAttribute('data-drag-region');
    expect(bar.className).not.toContain('fixed');
  });
});

describe('TitleBar — sidebar segment', () => {
  it('ends on the measured sidebar edge, its separator covering the last pixel', () => {
    renderBar();
    const segment = screen.getByTestId('title-bar-sidebar-segment');
    expect(segment.style.width).toBe('316px');
    expect(segment.lastElementChild).toBe(screen.getByTestId('title-bar-separator-sidebar'));
    expect(screen.getByTestId('usage-capsule').style.width).toBe('min(100%, 224px)');
  });

  it('lets the narrowest sidebar (208px, after the 56px rail) set the edge', () => {
    useColumnEdges.setState({ content: 264 });
    renderBar();
    const { width, minWidth } = screen.getByTestId('title-bar-sidebar-segment').style;
    expect(width).toBe('264px');
    expect(parseInt(minWidth, 10)).toBeLessThanOrEqual(264);
  });

  it('follows the sidebar as it is resized', () => {
    renderBar();
    act(() => useColumnEdges.getState().report('content', 402));
    expect(screen.getByTestId('title-bar-sidebar-segment').style.width).toBe('402px');
  });

  it('follows the capsule while the sidebar is collapsed', () => {
    useColumnEdges.setState({ content: 56 });
    renderBar(false);
    const segment = screen.getByTestId('title-bar-sidebar-segment');
    expect(segment.style.width).toBe('');
    expect(screen.getByTestId('usage-capsule').style.width).toBe('224px');
    expect(screen.getByTestId('title-bar-separator-sidebar')).toBeInTheDocument();
  });

  it('has no separator outside Chats, where there are no tabs to set apart', () => {
    useUiPrefs.setState({ sidebarView: 'tasks' });
    renderBar();
    expect(screen.queryByTestId('title-bar-separator-sidebar')).toBeNull();
    expect(screen.queryByTestId('title-bar-trailing')).toBeNull();
    expect(screen.getByTestId('title-bar-sidebar-segment').style.width).toBe('316px');
  });
});

describe('TitleBar — workspace segment', () => {
  it('is absent while the workspace is closed', () => {
    renderBar();
    expect(screen.queryByTestId('title-bar-separator-workspace')).toBeNull();
    expect(screen.queryByTestId('title-bar-separator-actions')).toBeNull();
    expect(screen.queryByTestId('title-bar-workspace-stub')).toBeNull();
  });

  it('starts on the measured workspace edge and is closed by the third separator', () => {
    place(['chat', 'workspace']);
    useColumnEdges.setState({ workspace: 879 });
    renderBar();

    const trailing = screen.getByTestId('title-bar-trailing');
    expect(trailing.style.width).toBe('calc(100% - 878px)');
    expect([...trailing.children].map((el) => el.getAttribute('data-testid'))).toEqual([
      'title-bar-separator-workspace',
      'title-bar-workspace-stub',
      'title-bar-separator-actions',
      'title-bar-actions',
    ]);
  });

  it.each([
    ['alone', ['workspace'] as const, null],
    ['in the bottom strip', ['chat'] as const, 'workspace' as const],
  ])('keeps the tabs but stands on no edge while the workspace is %s', (_, top, bottom) => {
    place([...top], bottom);
    renderBar();
    expect(screen.getByTestId('title-bar-workspace-stub')).toBeInTheDocument();
    expect(screen.getByTestId('title-bar-trailing').style.width).toBe('');
  });
});

describe('TitleBar — surface toggles', () => {
  it('are two independent toggles, both pressed while both surfaces show', () => {
    place(['chat', 'workspace']);
    renderBar();
    expect(screen.getByRole('button', { name: 'Chat' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Workspace' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps focus on the toggle that opened the workspace', () => {
    renderBar();
    const toggle = screen.getByTestId('surface-rail-workspace');
    toggle.focus();
    fireEvent.click(toggle);
    expect(screen.getByTestId('title-bar-workspace-stub')).toBeInTheDocument();
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('refuses to turn off the last lit surface, and says why', async () => {
    renderBar();
    const chat = screen.getByTestId('surface-rail-chat');
    expect(chat).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByTestId('surface-rail-workspace')).not.toHaveAttribute('aria-disabled');

    fireEvent.click(chat);
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);

    fireEvent.focus(chat);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Chat is the only surface left');
  });
});

describe('TitleBar — chat column', () => {
  it('renders the session tabs', () => {
    renderBar();
    expect(screen.getByTestId('title-bar-chat-column')).toContainElement(screen.getByTestId('session-tabs-stub'));
    expect(screen.queryByTestId('show-sidebar-button')).toBeNull();
  });

  it('leads with the show-sidebar button while the sidebar is collapsed', () => {
    renderBar(false);
    expect(screen.getByTestId('title-bar-chat-column')).toContainElement(screen.getByTestId('show-sidebar-button'));
  });
});
