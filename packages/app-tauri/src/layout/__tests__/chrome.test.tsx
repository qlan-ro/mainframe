import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@assistant-ui/react', () => ({
  AssistantRuntimeProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuiState: vi.fn(() => 'Fixture Chat'),
}));

vi.mock('@/features/sessions/sidebar/SessionSidebar', () => ({
  SessionSidebar: () => <div data-testid="session-sidebar-content" />,
}));

vi.mock('../../features/sessions/runtime/use-sessions-thread-list', () => ({
  useSessionsThreadList: () => ({}),
}));

vi.mock('../../features/sessions/ws/use-session-list-router', () => ({
  useSessionListRouter: vi.fn(),
}));

vi.mock('../../features/sessions/sidebar/ArchiveWorktreeDialog', () => ({
  ArchiveWorktreeDialog: () => null,
}));

vi.mock('../../features/sessions/tags/TagPopoverHost', () => ({
  TagPopoverHost: () => null,
}));

vi.mock('../SurfaceHost', () => ({
  SurfaceHost: ({ mainChromeInset = 0, port }: { mainChromeInset?: number; port: number }) => (
    <div data-testid="surface-host" data-main-chrome-inset={mainChromeInset} data-port={port} />
  ),
}));

import { ChatHeader } from '../ChatHeader';
import { SidebarHeader, TRAFFIC_LIGHTS_SPACER_WIDTH } from '../SidebarHeader';
import { SIDEBAR_EXPANDED_WIDTH, SIDEBAR_MAX_WIDTH, SidebarShell } from '../SidebarShell';
import { useLayoutStore } from '@/store/layout';
import { AppShell, COLLAPSED_CHROME_INSET, SHOW_SIDEBAR_BUTTON_LEFT } from '../../app/AppShell';

beforeEach(() => {
  if (!useLayoutStore.getState().sidebarVisible) {
    useLayoutStore.getState().toggleSidebar();
  }
  document.body.style.removeProperty('user-select');
  document.body.style.removeProperty('cursor');
});

describe('layout chrome drag regions', () => {
  it('puts the Tauri drag region on the chat header itself', () => {
    render(<ChatHeader />);

    expect(screen.getByTestId('chat-header').hasAttribute('data-tauri-drag-region')).toBe(true);
  });

  it('can push only chat header contents clear of native traffic lights', () => {
    render(<ChatHeader leadingInset={TRAFFIC_LIGHTS_SPACER_WIDTH} />);

    expect(screen.getByTestId('chat-header')).toHaveStyle({ paddingLeft: `${TRAFFIC_LIGHTS_SPACER_WIDTH}px` });
  });

  it('matches the sidebar header height', () => {
    render(<ChatHeader />);

    expect(screen.getByTestId('chat-header')).toHaveClass('h-[38px]');
  });
});

describe('layout chrome borders', () => {
  it('draws the sidebar header bottom hairline from the prototype', () => {
    render(<SidebarHeader />);

    expect(screen.getByTestId('sidebar-header').className).toContain('[border-bottom:0.5px_solid_var(--border)]');
  });
});

describe('sidebar instant collapse button', () => {
  it('keeps the header button wired to the instant sidebar visibility toggle', () => {
    render(<SidebarHeader />);

    fireEvent.click(screen.getByTestId('sidebar-hide-button'));

    expect(useLayoutStore.getState().sidebarVisible).toBe(false);
    useLayoutStore.getState().toggleSidebar();
  });
});

describe('sidebar drag collapse', () => {
  it('keeps the sidebar responsive container at the full expanded width while dragging', () => {
    render(<SidebarShell dragging />);

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: `${SIDEBAR_EXPANDED_WIDTH}px` });
    expect(screen.getByTestId('sessions-sidebar')).toHaveClass('select-none');
    expect(screen.getByTestId('sessions-sidebar-content-frame')).toHaveStyle({
      width: `${SIDEBAR_EXPANDED_WIDTH}px`,
    });
    expect(screen.getByTestId('sessions-sidebar-content-frame')).toHaveClass('@container');
  });

  it('renders the drag handle on the main surface side with a small vertical rounded indicator', () => {
    render(<AppShell port={31415} />);

    const mainSurface = screen.getByTestId('main-surface-shell');
    const sidebar = screen.getByTestId('sessions-sidebar');
    const handle = screen.getByTestId('sidebar-collapse-handle');
    const indicator = screen.getByTestId('sidebar-collapse-indicator');

    expect(mainSurface.contains(handle)).toBe(true);
    expect(sidebar.contains(handle)).toBe(false);
    expect(indicator.className).toContain('rounded-full');
  });

  it('prevents text selection while dragging the split handle', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });

    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('ew-resize');

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });

    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('increases the main chrome inset dynamically while dragging under the traffic-light zone', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 30 });

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: `${SIDEBAR_EXPANDED_WIDTH}px` });
    expect(screen.getByTestId('main-surface-shell')).toHaveStyle({
      marginLeft: `-${SIDEBAR_EXPANDED_WIDTH - 30}px`,
    });
    expect(screen.getByTestId('surface-host')).toHaveAttribute(
      'data-main-chrome-inset',
      String(TRAFFIC_LIGHTS_SPACER_WIDTH - 30),
    );
  });

  it('removes the session panel completely when dragged left past the collapse threshold', () => {
    render(<AppShell port={31415} />);

    const mainSurface = screen.getByTestId('main-surface-shell');
    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 70 });

    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();
    expect(screen.getByTestId('sidebar-collapse-handle')).toBeDefined();
    expect(mainSurface).not.toHaveStyle({ paddingLeft: `${TRAFFIC_LIGHTS_SPACER_WIDTH}px` });
    expect(handle).toHaveStyle({ left: '0px' });
    expect(screen.getByTestId('surface-host')).toHaveAttribute(
      'data-main-chrome-inset',
      String(COLLAPSED_CHROME_INSET),
    );
    expect(screen.getByTestId('show-sidebar-button')).toBeDefined();
  });

  it('expands the session panel when the collapsed main-side handle is dragged right past the threshold', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 12 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 180 });
    fireEvent.pointerUp(handle, { pointerId: 2, clientX: 180 });

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: `${SIDEBAR_EXPANDED_WIDTH}px` });
  });

  it('reveals the session panel underneath while dragging right from the collapsed state', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 12 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 90 });

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: `${SIDEBAR_EXPANDED_WIDTH}px` });
    expect(screen.getByTestId('main-surface-shell')).toHaveStyle({
      marginLeft: `-${SIDEBAR_EXPANDED_WIDTH - 78}px`,
    });
  });

  it('keeps the main surface clear of traffic lights when the instant button hides the sidebar', () => {
    render(<AppShell port={31415} />);

    fireEvent.click(screen.getByTestId('sidebar-hide-button'));

    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();
    expect(screen.getByTestId('main-surface-shell')).not.toHaveStyle({
      paddingLeft: `${TRAFFIC_LIGHTS_SPACER_WIDTH}px`,
    });
    expect(screen.getByTestId('surface-host')).toHaveAttribute(
      'data-main-chrome-inset',
      String(COLLAPSED_CHROME_INSET),
    );
    expect(screen.getByTestId('show-sidebar-button')).toHaveStyle({
      left: `${SHOW_SIDEBAR_BUTTON_LEFT}px`,
    });
  });
});

describe('sidebar collapse handle — unmount cleanup + keyboard', () => {
  it('unmount mid-drag resets body styles (leak guard)', () => {
    const { unmount } = render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });

    // drag is now active — body styles must be locked
    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('ew-resize');

    // unmount WITHOUT firing pointerUp — simulates tab close / component removal mid-drag
    unmount();

    // cleanup effect must have reset both styles
    expect(document.body.style.userSelect).toBe('');
    expect(document.body.style.cursor).toBe('');
  });

  it('ArrowLeft on the focused handle collapses the sidebar', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });

    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();
    expect(screen.getByTestId('sidebar-collapse-handle')).toBeDefined();
  });

  it('ArrowRight on the focused handle expands the sidebar from collapsed state', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    // first collapse via keyboard
    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();

    // then expand via keyboard
    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: `${SIDEBAR_EXPANDED_WIDTH}px` });
  });

  it('Enter toggles collapse: expanded → collapsed → expanded', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    // first Enter collapses
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();

    // second Enter expands
    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(screen.getByTestId('sessions-sidebar')).toBeDefined();
  });
});

describe('sidebar drag dim-on-will-collapse', () => {
  it('dims the sidebar while dragging below the collapse threshold', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    // drag from the right edge of the expanded sidebar to width=70, which is below SIDEBAR_COLLAPSE_THRESHOLD (150)
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });

    expect(screen.getByTestId('sessions-sidebar')).toHaveClass('opacity-30');
  });

  it('does not dim the sidebar while dragging at or above the collapse threshold', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    // drag from the right edge of the expanded sidebar to width=200, which is above SIDEBAR_COLLAPSE_THRESHOLD (150)
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 });

    expect(screen.getByTestId('sessions-sidebar')).not.toHaveClass('opacity-30');
  });

  it('does not dim the sidebar when idle (no drag in progress)', () => {
    render(<AppShell port={31415} />);

    // sidebar is visible and expanded; no drag has started
    expect(screen.getByTestId('sessions-sidebar')).not.toHaveClass('opacity-30');
  });

  it('un-dims the sidebar when dragged back above the collapse threshold after being below it', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    // drag below threshold first (should dim)
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });

    // drag back above threshold (should un-dim)
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 220 });

    expect(screen.getByTestId('sessions-sidebar')).not.toHaveClass('opacity-30');
  });
});

describe('sidebar drag resize-larger (capped)', () => {
  it('drag right past the default grows the panel and persists on release', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    // start at the right edge of the 300px default; delta +60 → width 360, below the 400 cap
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 360 });

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: '360px' });

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 360 });

    // must persist after release — NOT snap back to 300
    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: '360px' });
  });

  it('drag far right is capped at SIDEBAR_MAX_WIDTH', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 1200 });

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: `${SIDEBAR_MAX_WIDTH}px` });

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 1200 });

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: `${SIDEBAR_MAX_WIDTH}px` });
  });
});

describe('sidebar expand from collapsed', () => {
  it('one-click expand after drag-collapse re-shows the sidebar', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    // drag past the collapse threshold so the sidebar disappears
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 70 });

    // sidebar is gone and the show button must be visible
    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();
    expect(screen.getByTestId('show-sidebar-button')).toBeDefined();

    // one click must re-expand — no drag required
    fireEvent.click(screen.getByTestId('show-sidebar-button'));

    expect(screen.getByTestId('sessions-sidebar')).toBeDefined();
  });

  it('one-click expand after button-collapse re-shows the sidebar', () => {
    render(<AppShell port={31415} />);

    // collapse via the header hide button
    fireEvent.click(screen.getByTestId('sidebar-hide-button'));

    // sidebar is gone and the show button must be visible
    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();
    expect(screen.getByTestId('show-sidebar-button')).toBeDefined();

    // one click must re-expand
    fireEvent.click(screen.getByTestId('show-sidebar-button'));

    expect(screen.getByTestId('sessions-sidebar')).toBeDefined();
  });
});
