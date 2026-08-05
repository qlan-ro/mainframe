/**
 * WorkspaceTabStrip — tab-type glyph + running-config Stop affordance (todo #206,
 * revised per user feedback):
 *
 * The tab's leading glyph is a STATIC type identifier — it never flips with the
 * process's running/stopped state. Each of the three launch/terminal tab kinds
 * carries its own glyph: console (cli) = square-terminal, preview = eye, terminal =
 * terminal. A live launch-config tab additionally shows a red Stop button as a
 * SEPARATE control between the label and the close (×), not in the glyph slot.
 */
import { fireEvent, render as rtlRender } from '@testing-library/react';
import { TooltipProvider } from '@v2/components/ui/tooltip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import type { RunPane } from '@/store/run-pane';

interface MockLaunch {
  configs: LaunchConfiguration[];
  scopeStatuses: Record<string, LaunchProcessStatus>;
  handleLaunch: ReturnType<typeof vi.fn>;
  handleStop: ReturnType<typeof vi.fn>;
}

const launch: MockLaunch = {
  configs: [],
  scopeStatuses: {},
  handleLaunch: vi.fn(),
  handleStop: vi.fn(),
};

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectId: 'proj-1', chatId: 'chat-1' }),
}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({
  useDaemonPort: () => 31415,
}));
vi.mock('@/features/run/use-launch-actions', () => ({
  useLaunchActions: () => launch,
}));

import { WorkspaceTabStrip } from '../WorkspaceTabStrip';

// v2 `Hint` needs the v2 TooltipProvider — the v1 provider satisfies nothing.
const render = (ui: React.ReactElement) => rtlRender(ui, { wrapper: TooltipProvider });

const cfg = (name: string, over: Partial<LaunchConfiguration> = {}): LaunchConfiguration =>
  ({ name, runtimeExecutable: 'pnpm', runtimeArgs: [], port: null, url: null, ...over }) as LaunchConfiguration;

const consoleTab = { id: 'console-Sleeper-abcd', kind: 'console' as const, title: 'Sleeper', config: 'Sleeper' };
const previewTab = { id: 'preview-Web-abcd', kind: 'preview' as const, title: 'Web', config: 'Web' };
const terminalTab = { id: 'term-1', kind: 'terminal' as const, title: 'zsh' };
const paneWith = (tabs: RunPane['tabs']): RunPane => ({ id: 'pane-1', tabs, active: tabs[0]?.id ?? null });

/** The lucide glyph name(s) inside a single tab pill (scoped, not the surface icon). */
const pillGlyphs = (root: HTMLElement, tabId: string): string[] =>
  Array.from(root.querySelector(`[data-testid="workspace-tab-${tabId}"]`)!.querySelectorAll('svg.lucide'))
    .flatMap((svg) => Array.from(svg.classList))
    .filter((c) => c.startsWith('lucide-') && c !== 'lucide-square');

beforeEach(() => {
  launch.configs = [];
  launch.scopeStatuses = {};
  launch.handleLaunch = vi.fn();
  launch.handleStop = vi.fn();
});

afterEach(() => vi.clearAllMocks());

describe('WorkspaceTabStrip — static type glyph (independent of run state)', () => {
  it('console (cli) tab keeps its square-terminal glyph whether stopped or running — never Play, never flips to Square', () => {
    launch.configs = [cfg('Sleeper')];

    launch.scopeStatuses = { Sleeper: 'stopped' };
    const idle = render(<WorkspaceTabStrip pane={paneWith([consoleTab])} primary />);
    expect(pillGlyphs(idle.container, consoleTab.id)).toContain('lucide-square-terminal');
    expect(pillGlyphs(idle.container, consoleTab.id)).not.toContain('lucide-play');
    idle.unmount();

    launch.scopeStatuses = { Sleeper: 'running' };
    const live = render(<WorkspaceTabStrip pane={paneWith([consoleTab])} primary />);
    // The static glyph stays put while running — it no longer flips into the Stop.
    expect(pillGlyphs(live.container, consoleTab.id)).toContain('lucide-square-terminal');
  });

  it('preview tab keeps its Eye glyph whether stopped or running', () => {
    launch.configs = [cfg('Web', { preview: true } as Partial<LaunchConfiguration>)];

    launch.scopeStatuses = { Web: 'stopped' };
    const idle = render(<WorkspaceTabStrip pane={paneWith([previewTab])} primary />);
    expect(pillGlyphs(idle.container, previewTab.id)).toContain('lucide-eye');
    idle.unmount();

    launch.scopeStatuses = { Web: 'running' };
    const live = render(<WorkspaceTabStrip pane={paneWith([previewTab])} primary />);
    expect(pillGlyphs(live.container, previewTab.id)).toContain('lucide-eye');
  });

  it('terminal tab shows the static Terminal glyph', () => {
    const { container } = render(<WorkspaceTabStrip pane={paneWith([terminalTab])} primary />);
    expect(pillGlyphs(container, terminalTab.id)).toContain('lucide-terminal');
  });
});

describe('WorkspaceTabStrip — running-config Stop affordance', () => {
  it('renders a Stop button ALONGSIDE the static glyph on a running launch-config tab', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'running' };
    const { queryByTestId, container } = render(<WorkspaceTabStrip pane={paneWith([consoleTab])} primary />);
    expect(queryByTestId(`workspace-tab-stop-${consoleTab.id}`)).not.toBeNull();
    // The type glyph is NOT displaced by the Stop.
    expect(pillGlyphs(container, consoleTab.id)).toContain('lucide-square-terminal');
  });

  it('treats a "starting" config as live (Stop shown)', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'starting' };
    const { queryByTestId } = render(<WorkspaceTabStrip pane={paneWith([consoleTab])} primary />);
    expect(queryByTestId(`workspace-tab-stop-${consoleTab.id}`)).not.toBeNull();
  });

  it('shows NO Stop button when the config is stopped', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'stopped' };
    const { queryByTestId } = render(<WorkspaceTabStrip pane={paneWith([consoleTab])} primary />);
    expect(queryByTestId(`workspace-tab-stop-${consoleTab.id}`)).toBeNull();
  });

  it('clicking Stop calls handleStop with the config and does NOT close the tab', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'running' };
    const { getByTestId, queryByTestId } = render(<WorkspaceTabStrip pane={paneWith([consoleTab])} primary />);
    fireEvent.click(getByTestId(`workspace-tab-stop-${consoleTab.id}`));
    expect(launch.handleStop).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sleeper' }));
    // The close control is untouched and still present.
    expect(queryByTestId(`workspace-tab-close-${consoleTab.id}`)).not.toBeNull();
  });

  it('a terminal tab never shows a Stop button even if a same-named config is live', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'running' };
    const term = { id: 'term-1', kind: 'terminal' as const, title: 'zsh' };
    const { queryByTestId } = render(<WorkspaceTabStrip pane={paneWith([term])} primary />);
    expect(queryByTestId('workspace-tab-stop-term-1')).toBeNull();
  });
});

describe('WorkspaceTabStrip — add menu (native DropdownMenu)', () => {
  /** Radix menu triggers open on POINTERDOWN, not click. */
  const openAddMenu = (getByTestId: (id: string) => HTMLElement) =>
    fireEvent.pointerDown(getByTestId('workspace-tab-strip-add-pane-1'), { button: 0 });

  it('offers New terminal and URL rows, and one row per launch config', () => {
    launch.configs = [cfg('Web', { preview: true }), cfg('Sleeper')];
    const { getByTestId } = render(<WorkspaceTabStrip pane={paneWith([terminalTab])} primary />);

    openAddMenu(getByTestId);

    expect(getByTestId('workspace-pane-new-terminal-pane-1')).toBeInTheDocument();
    expect(getByTestId('workspace-pane-open-url-pane-1')).toBeInTheDocument();
    expect(getByTestId('workspace-pane-launch-Web-pane-1')).toBeInTheDocument();
    expect(getByTestId('workspace-pane-launch-Sleeper-pane-1')).toBeInTheDocument();
  });

  it('selecting a launch-config row launches that config', () => {
    launch.configs = [cfg('Sleeper')];
    const { getByTestId } = render(<WorkspaceTabStrip pane={paneWith([terminalTab])} primary />);

    openAddMenu(getByTestId);
    fireEvent.click(getByTestId('workspace-pane-launch-Sleeper-pane-1'));

    expect(launch.handleLaunch).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sleeper' }));
  });

  it('says so when the project has no launch configs', () => {
    launch.configs = [];
    const { getByTestId, queryByTestId } = render(<WorkspaceTabStrip pane={paneWith([terminalTab])} primary />);

    openAddMenu(getByTestId);

    expect(getByTestId('workspace-add-menu-pane-1')).toHaveTextContent('No launch configs found.');
    expect(queryByTestId('workspace-pane-launch-Sleeper-pane-1')).toBeNull();
  });

  it('the URL row swaps the pill row for the inline URL entry', () => {
    const { getByTestId, queryByTestId } = render(<WorkspaceTabStrip pane={paneWith([terminalTab])} primary />);

    openAddMenu(getByTestId);
    fireEvent.click(getByTestId('workspace-pane-open-url-pane-1'));

    expect(getByTestId('workspace-url-entry')).toBeInTheDocument();
    expect(queryByTestId(`workspace-tab-${terminalTab.id}`)).toBeNull();
  });
});
