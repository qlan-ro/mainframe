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

// MainToolbar (rendered by AppShell) resolves identity via useProjects → daemon port.
// Stub it so the shell renders without a live port.
vi.mock('../../features/sessions/use-projects', () => ({
  useProjects: () => ({ projects: [], loading: false }),
}));

vi.mock('../../features/sessions/sidebar/ArchiveWorktreeDialog', () => ({
  ArchiveWorktreeDialog: () => null,
}));

vi.mock('../../features/files/FilePickerDialog', () => ({
  FilePickerDialog: () => null,
}));

vi.mock('../../components/overlays/SearchPalette', () => ({
  SearchPalette: () => null,
}));

vi.mock('../../components/overlays/FindInPathModal', () => ({
  FindInPathModal: () => null,
}));

vi.mock('../../components/overlays/DirectoryPickerModal', () => ({
  DirectoryPickerModal: () => null,
}));

vi.mock('../../features/review/ReviewPanel', () => ({
  ReviewPanel: () => null,
}));

vi.mock('../../features/sessions/tags/TagPopoverHost', () => ({
  TagPopoverHost: () => null,
}));

vi.mock('../SurfaceHost', () => ({
  SurfaceHost: ({ port }: { port: number }) => <div data-testid="surface-host" data-port={port} />,
}));

import { SidebarHeader } from '../SidebarHeader';
import { SIDEBAR_EXPANDED_WIDTH, SIDEBAR_MAX_WIDTH, SidebarShell } from '../SidebarShell';
import { useLayoutStore } from '@/store/layout';
import { AppShell } from '../../app/AppShell';

beforeEach(() => {
  if (!useLayoutStore.getState().sidebarVisible) {
    useLayoutStore.getState().toggleSidebar();
  }
  document.body.style.removeProperty('user-select');
  document.body.style.removeProperty('cursor');
});

describe('main toolbar', () => {
  it('renders the shell toolbar above the surface host', () => {
    render(<AppShell port={31415} />);

    expect(screen.getByTestId('main-toolbar')).toBeDefined();
    expect(screen.getByTestId('surface-host')).toBeDefined();
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

  it('tracks the drag width via the main surface margin while collapsing', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 30 });

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: `${SIDEBAR_EXPANDED_WIDTH}px` });
    expect(screen.getByTestId('main-surface-shell')).toHaveStyle({
      marginLeft: `-${SIDEBAR_EXPANDED_WIDTH - 30}px`,
    });
  });

  it('removes the session panel completely when dragged left past the collapse threshold', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 70 });

    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();
    expect(screen.getByTestId('sidebar-collapse-handle')).toBeDefined();
    expect(handle).toHaveStyle({ left: '0px' });
    // the show-sidebar button now lives in the MainToolbar (in-flow), shown while collapsed
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

  it('shows the in-flow show-sidebar button when the instant button hides the sidebar', () => {
    render(<AppShell port={31415} />);

    fireEvent.click(screen.getByTestId('sidebar-hide-button'));

    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();
    expect(screen.getByTestId('show-sidebar-button')).toBeDefined();
  });
});

describe('sidebar collapse handle — unmount cleanup + keyboard', () => {
  it('unmount mid-drag resets body styles (leak guard)', () => {
    const { unmount } = render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });

    expect(document.body.style.userSelect).toBe('none');
    expect(document.body.style.cursor).toBe('ew-resize');

    unmount();

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

    fireEvent.keyDown(handle, { key: 'ArrowLeft' });
    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();

    fireEvent.keyDown(handle, { key: 'ArrowRight' });

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: `${SIDEBAR_EXPANDED_WIDTH}px` });
  });

  it('Enter toggles collapse: expanded → collapsed → expanded', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();

    fireEvent.keyDown(handle, { key: 'Enter' });
    expect(screen.getByTestId('sessions-sidebar')).toBeDefined();
  });
});

describe('sidebar drag dim-on-will-collapse', () => {
  it('dims the sidebar while dragging below the collapse threshold', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });

    expect(screen.getByTestId('sessions-sidebar')).toHaveClass('opacity-30');
  });

  it('does not dim the sidebar while dragging at or above the collapse threshold', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 200 });

    expect(screen.getByTestId('sessions-sidebar')).not.toHaveClass('opacity-30');
  });

  it('does not dim the sidebar when idle (no drag in progress)', () => {
    render(<AppShell port={31415} />);

    expect(screen.getByTestId('sessions-sidebar')).not.toHaveClass('opacity-30');
  });

  it('un-dims the sidebar when dragged back above the collapse threshold after being below it', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 220 });

    expect(screen.getByTestId('sessions-sidebar')).not.toHaveClass('opacity-30');
  });
});

describe('sidebar drag resize-larger (capped)', () => {
  it('drag right past the default grows the panel and persists on release', () => {
    render(<AppShell port={31415} />);

    const handle = screen.getByTestId('sidebar-collapse-handle');

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 360 });

    expect(screen.getByTestId('sessions-sidebar')).toHaveStyle({ width: '360px' });

    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 360 });

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

    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 70 });

    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();
    expect(screen.getByTestId('show-sidebar-button')).toBeDefined();

    fireEvent.click(screen.getByTestId('show-sidebar-button'));

    expect(screen.getByTestId('sessions-sidebar')).toBeDefined();
  });

  it('one-click expand after button-collapse re-shows the sidebar', () => {
    render(<AppShell port={31415} />);

    fireEvent.click(screen.getByTestId('sidebar-hide-button'));

    expect(screen.queryByTestId('sessions-sidebar')).toBeNull();
    expect(screen.getByTestId('show-sidebar-button')).toBeDefined();

    fireEvent.click(screen.getByTestId('show-sidebar-button'));

    expect(screen.getByTestId('sessions-sidebar')).toBeDefined();
  });

  it('keeps the in-flow show-sidebar button keyboard-reachable in both collapsed states', () => {
    // (a) drag-collapsed
    const drag = render(<AppShell port={31415} />);
    const handle = screen.getByTestId('sidebar-collapse-handle');
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: SIDEBAR_EXPANDED_WIDTH });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 70 });
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 70 });

    const dragBtn = screen.getByTestId('show-sidebar-button');
    expect(dragBtn.tagName).toBe('BUTTON');
    expect(dragBtn).not.toBeDisabled();
    dragBtn.focus();
    expect(document.activeElement).toBe(dragBtn);
    drag.unmount();

    // (b) instant-hidden
    render(<AppShell port={31415} />);
    fireEvent.click(screen.getByTestId('sidebar-hide-button'));
    const hiddenBtn = screen.getByTestId('show-sidebar-button');
    expect(hiddenBtn.tagName).toBe('BUTTON');
    hiddenBtn.focus();
    expect(document.activeElement).toBe(hiddenBtn);
  });
});
