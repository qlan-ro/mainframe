import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '@/store/theme';
import { useLayoutStore } from '@/store/layout';
import { useActiveBasesStore } from '@/store/active-bases-store';
import { useWorkspaceFilesPanel } from '@/store/workspace-files-panel';

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));

// The tab strip needs the aui runtime, which is not this suite's subject; its
// own suite covers it for real (features/session-tabs/__tests__).
vi.mock('@/features/session-tabs/SessionTabs', () => ({
  SessionTabs: () => <div data-testid="mock-session-tabs" />,
}));

// The search chip renders off the live platform; pin macOS so the glyph
// assertion below reads ⌘K rather than jsdom's Ctrl+K.
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => true }));

import { MainToolbar } from '../MainToolbar';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { TooltipProvider } from '@/components/ui/tooltip';

// v2 Hint/Tooltip require the v2 TooltipProvider (app-root concern; SidebarProvider mounts it live).
const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

type ToolbarProps = Parameters<typeof MainToolbar>[0];

const renderToolbar = (overrides: Partial<ToolbarProps> = {}) =>
  render(<MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} {...overrides} />);

beforeEach(() => {
  localStorage.clear();
  useTheme.getState().setMode('light');
  useLayoutStore.setState({
    layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
  });
  useActiveBasesStore.setState({ bases: {}, scopeKey: null });
  useWorkspaceFilesPanel.setState({ openByScope: {} });
  useSetupAdvisor.setState({ open: false });
  mockEmit.mockReset();
});

describe('MainToolbar — root element', () => {
  it('renders the main-toolbar root with a drag region', () => {
    renderToolbar();

    const toolbar = screen.getByTestId('main-toolbar');
    expect(toolbar).toBeDefined();
    expect(toolbar.hasAttribute('data-drag-region')).toBe(true);
  });
});

describe('MainToolbar — show-sidebar button', () => {
  it('renders show-sidebar-button and calls onExpandSidebar when sidebarRendered is false', () => {
    const onExpandSidebar = vi.fn();
    renderToolbar({ sidebarRendered: false, onExpandSidebar, leadingInset: 78 });

    fireEvent.click(screen.getByTestId('show-sidebar-button'));

    expect(onExpandSidebar).toHaveBeenCalledTimes(1);
  });

  it('does not render show-sidebar-button when sidebarRendered is true', () => {
    renderToolbar({ sidebarRendered: true });

    expect(screen.queryByTestId('show-sidebar-button')).toBeNull();
  });
});

describe('MainToolbar — search button', () => {
  it('clicking main-toolbar-search emits open-search-palette', () => {
    renderToolbar();

    fireEvent.click(screen.getByTestId('main-toolbar-search'));

    expect(mockEmit).toHaveBeenCalledWith({ type: 'open-search-palette' });
  });

  it('renders the ⌘K keyboard hint chip inside the search button', () => {
    renderToolbar();

    const hint = screen.getByTestId('main-toolbar-search-hint');
    expect(screen.getByTestId('main-toolbar-search')).toContainElement(hint);
    expect(hint.textContent).toBe('⌘K');
  });
});

describe('MainToolbar — theme toggle', () => {
  it('clicking main-toolbar-theme flips the theme mode from light to dark', () => {
    renderToolbar();

    expect(useTheme.getState().mode).toBe('light');

    fireEvent.click(screen.getByTestId('main-toolbar-theme'));

    expect(useTheme.getState().mode).toBe('dark');
  });

  it('uses the resolved System appearance for its icon and fixed override', () => {
    useTheme.setState({ mode: 'system', resolvedMode: 'dark' });
    renderToolbar();

    expect(screen.getByTestId('main-toolbar-theme').querySelector('.lucide-sun')).not.toBeNull();
    fireEvent.click(screen.getByTestId('main-toolbar-theme'));

    expect(useTheme.getState()).toMatchObject({ mode: 'light', resolvedMode: 'light' });
  });
});

describe('MainToolbar — files toggle is GONE', () => {
  it('renders no main-toolbar-files control — the workspace strip owns the Files button', () => {
    renderToolbar();

    expect(screen.queryByTestId('main-toolbar-files')).toBeNull();
  });
});

describe('MainToolbar — Setup Advisor button', () => {
  it('renders automation-recommender-open when projectId is set', () => {
    renderToolbar({ projectId: 'p1' });

    expect(screen.getByTestId('automation-recommender-open')).toBeDefined();
  });

  it('does not render automation-recommender-open when there is no projectId', () => {
    renderToolbar();

    expect(screen.queryByTestId('automation-recommender-open')).toBeNull();
  });
});

describe('MainToolbar — trailing controls shift for the docked Files sidebar', () => {
  /** The right control group is the parent of the theme button. */
  function trailingGroup() {
    return screen.getByTestId('main-toolbar-theme').parentElement as HTMLElement;
  }

  it('does not shift when the Files sidebar is closed', () => {
    renderToolbar();

    expect(trailingGroup().className).not.toContain('mr-2');
  });

  it('does not shift when the workspace surface is not lit', () => {
    useActiveBasesStore.setState({ scopeKey: 'proj-1:/repo' });
    useWorkspaceFilesPanel.getState().setOpen(true);
    // layout.top stays ['chat'] — workspace is not present at all.
    renderToolbar();

    expect(trailingGroup().className).not.toContain('mr-2');
  });

  it('shifts left when the Files sidebar is open and workspace is the sole/rightmost surface', () => {
    useActiveBasesStore.setState({ scopeKey: 'proj-1:/repo' });
    useWorkspaceFilesPanel.getState().setOpen(true);
    useLayoutStore.setState({
      layout: { top: ['chat', 'workspace'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    });
    renderToolbar();

    expect(trailingGroup().className).toContain('mr-2');
  });

  it('does not shift when the workspace is the LEFT column of a split (sidebar docks mid-window)', () => {
    useActiveBasesStore.setState({ scopeKey: 'proj-1:/repo' });
    useWorkspaceFilesPanel.getState().setOpen(true);
    useLayoutStore.setState({
      layout: { top: ['workspace', 'chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
    });
    renderToolbar();

    expect(trailingGroup().className).not.toContain('mr-2');
  });
});
