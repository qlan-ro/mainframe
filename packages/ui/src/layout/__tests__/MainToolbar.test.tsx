import { fireEvent, render as rtlRender, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTheme } from '@/store/theme';
import { useLayoutStore } from '@/store/layout';
import { useUiPrefs } from '@/store/ui-prefs';

const mockEmit = vi.fn();
vi.mock('@/store/surface-intents', () => ({ emitSurfaceIntent: (...a: unknown[]) => mockEmit(...a) }));

// The tab strip needs the aui runtime, and the branch chip needs a live git
// read — neither is this suite's subject. Their own suites cover them for real
// (features/session-tabs/__tests__, features/git/__tests__/BranchChip.test.tsx).
vi.mock('@/features/session-tabs/SessionTabs', () => ({
  SessionTabs: () => <div data-testid="mock-session-tabs" />,
}));
vi.mock('@/features/git/BranchChip', () => ({
  BranchChip: () => <div data-testid="mock-branch-chip" />,
}));

import { MainToolbar } from '../MainToolbar';
import { useSetupAdvisor } from '@/features/setup-advisor/use-setup-advisor';
import { TooltipProvider } from '@v2/components/ui/tooltip';

// v2 Hint/Tooltip require the v2 TooltipProvider (app-root concern; SidebarProvider mounts it live).
const render = (ui: Parameters<typeof rtlRender>[0], options?: Parameters<typeof rtlRender>[1]) =>
  rtlRender(ui, { wrapper: TooltipProvider, ...options });

type ToolbarProps = Parameters<typeof MainToolbar>[0];

const renderToolbar = (overrides: Partial<ToolbarProps> = {}) =>
  render(<MainToolbar leadingInset={0} sidebarRendered={true} onExpandSidebar={vi.fn()} port={31415} {...overrides} />);

beforeEach(() => {
  localStorage.clear();
  useTheme.getState().setMode('light');
  useUiPrefs.setState({ workspaceFilesCollapsed: false });
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

  it('renders the ⌘O keyboard hint chip inside the search button', () => {
    renderToolbar();

    const hint = screen.getByTestId('main-toolbar-search-hint');
    expect(screen.getByTestId('main-toolbar-search')).toContainElement(hint);
    expect(hint.textContent).toBe('⌘O');
  });
});

describe('MainToolbar — theme toggle', () => {
  it('clicking main-toolbar-theme flips the theme mode from light to dark', () => {
    renderToolbar();

    expect(useTheme.getState().mode).toBe('light');

    fireEvent.click(screen.getByTestId('main-toolbar-theme'));

    expect(useTheme.getState().mode).toBe('dark');
  });
});

describe('MainToolbar — files toggle', () => {
  // Pressed means "the tree is ON SCREEN": expanded AND the workspace surface
  // lit. An expanded pref with the surface unlit still reads un-pressed.
  it.each([
    { collapsed: false, workspaceLit: true, pressed: 'true' },
    { collapsed: true, workspaceLit: true, pressed: 'false' },
    { collapsed: false, workspaceLit: false, pressed: 'false' },
  ])('collapsed=$collapsed lit=$workspaceLit → aria-pressed=$pressed', ({ collapsed, workspaceLit, pressed }) => {
    useUiPrefs.setState({ workspaceFilesCollapsed: collapsed });
    useLayoutStore.setState({
      layout: {
        top: workspaceLit ? ['chat', 'workspace'] : ['chat'],
        bottom: null,
        topFlex: {},
        vFlex: { top: 1, bottom: 0.4 },
      },
    });

    renderToolbar();

    expect(screen.getByTestId('main-toolbar-files').getAttribute('aria-pressed')).toBe(pressed);
  });

  it('clicking main-toolbar-files emits toggle-workspace-files rather than writing the pref directly', () => {
    // The intent carries the expand-also-lights-the-workspace rule; the toggle
    // must not shortcut it (store/__tests__/intent-subscriber.commands owns the effect).
    renderToolbar();

    fireEvent.click(screen.getByTestId('main-toolbar-files'));

    expect(mockEmit).toHaveBeenCalledWith({ type: 'toggle-workspace-files' });
    expect(useUiPrefs.getState().workspaceFilesCollapsed).toBe(false);
  });

  it('is live, not disabled', () => {
    renderToolbar();

    expect(screen.getByTestId('main-toolbar-files')).not.toBeDisabled();
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
