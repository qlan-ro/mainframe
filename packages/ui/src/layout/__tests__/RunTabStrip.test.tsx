/**
 * RunTabStrip — strip height regression (finding 15.5: FilesTabStrip/RunTabStrip/
 * ChatCardHeader must share one uniform 36px strip height, matching the design's
 * `SurfaceTabStrip` and chat surface header, both height:36) plus the tab-type
 * glyph + running-config Stop affordance (todo #206, revised per user feedback):
 *
 * The tab's leading glyph is a STATIC type identifier — it never flips with the
 * process's running/stopped state. Each of the three launch/terminal tab kinds
 * carries its own glyph: console (logs) = scroll-text, preview = eye, terminal =
 * terminal. A live launch-config tab additionally shows a red Stop button as a
 * SEPARATE control between the label and the close (×), not in the glyph slot.
 */
import { fireEvent, render } from '@testing-library/react';
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

import { RunTabStrip } from '../RunTabStrip';

const cfg = (name: string, over: Partial<LaunchConfiguration> = {}): LaunchConfiguration =>
  ({ name, runtimeExecutable: 'pnpm', runtimeArgs: [], port: null, url: null, ...over }) as LaunchConfiguration;

const consoleTab = { id: 'console-Sleeper-abcd', kind: 'console' as const, title: 'Sleeper', config: 'Sleeper' };
const previewTab = { id: 'preview-Web-abcd', kind: 'preview' as const, title: 'Web', config: 'Web' };
const terminalTab = { id: 'term-1', kind: 'terminal' as const, title: 'zsh' };
const paneWith = (tabs: RunPane['tabs']): RunPane => ({ id: 'pane-1', tabs, active: tabs[0]?.id ?? null });

/** The lucide glyph name(s) inside a single tab pill (scoped, not the surface icon). */
const pillGlyphs = (root: HTMLElement, tabId: string): string[] =>
  Array.from(root.querySelector(`[data-testid="run-tab-${tabId}"]`)!.querySelectorAll('svg.lucide'))
    .flatMap((svg) => Array.from(svg.classList))
    .filter((c) => c.startsWith('lucide-') && c !== 'lucide-square');

beforeEach(() => {
  launch.configs = [];
  launch.scopeStatuses = {};
  launch.handleLaunch = vi.fn();
  launch.handleStop = vi.fn();
});

afterEach(() => vi.clearAllMocks());

describe('RunTabStrip — strip height', () => {
  it('has the fixed h-[36px] height class', () => {
    const { container } = render(<RunTabStrip pane={paneWith([])} primary />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain('h-[36px]');
  });
});

describe('RunTabStrip — static type glyph (independent of run state)', () => {
  it('console (logs) tab keeps its scroll-text glyph whether stopped or running — never Play, never flips to Square', () => {
    launch.configs = [cfg('Sleeper')];

    launch.scopeStatuses = { Sleeper: 'stopped' };
    const idle = render(<RunTabStrip pane={paneWith([consoleTab])} primary />);
    expect(pillGlyphs(idle.container, consoleTab.id)).toContain('lucide-scroll-text');
    expect(pillGlyphs(idle.container, consoleTab.id)).not.toContain('lucide-play');
    idle.unmount();

    launch.scopeStatuses = { Sleeper: 'running' };
    const live = render(<RunTabStrip pane={paneWith([consoleTab])} primary />);
    // The static glyph stays put while running — it no longer flips into the Stop.
    expect(pillGlyphs(live.container, consoleTab.id)).toContain('lucide-scroll-text');
  });

  it('preview tab keeps its Eye glyph whether stopped or running', () => {
    launch.configs = [cfg('Web', { preview: true } as Partial<LaunchConfiguration>)];

    launch.scopeStatuses = { Web: 'stopped' };
    const idle = render(<RunTabStrip pane={paneWith([previewTab])} primary />);
    expect(pillGlyphs(idle.container, previewTab.id)).toContain('lucide-eye');
    idle.unmount();

    launch.scopeStatuses = { Web: 'running' };
    const live = render(<RunTabStrip pane={paneWith([previewTab])} primary />);
    expect(pillGlyphs(live.container, previewTab.id)).toContain('lucide-eye');
  });

  it('terminal tab shows the static Terminal glyph', () => {
    const { container } = render(<RunTabStrip pane={paneWith([terminalTab])} primary />);
    expect(pillGlyphs(container, terminalTab.id)).toContain('lucide-terminal');
  });
});

describe('RunTabStrip — running-config Stop affordance', () => {
  it('renders a Stop button ALONGSIDE the static glyph on a running launch-config tab', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'running' };
    const { queryByTestId, container } = render(<RunTabStrip pane={paneWith([consoleTab])} primary />);
    expect(queryByTestId(`run-tab-stop-${consoleTab.id}`)).not.toBeNull();
    // The type glyph is NOT displaced by the Stop.
    expect(pillGlyphs(container, consoleTab.id)).toContain('lucide-scroll-text');
  });

  it('treats a "starting" config as live (Stop shown)', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'starting' };
    const { queryByTestId } = render(<RunTabStrip pane={paneWith([consoleTab])} primary />);
    expect(queryByTestId(`run-tab-stop-${consoleTab.id}`)).not.toBeNull();
  });

  it('shows NO Stop button when the config is stopped', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'stopped' };
    const { queryByTestId } = render(<RunTabStrip pane={paneWith([consoleTab])} primary />);
    expect(queryByTestId(`run-tab-stop-${consoleTab.id}`)).toBeNull();
  });

  it('clicking Stop calls handleStop with the config and does NOT close the tab', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'running' };
    const { getByTestId, queryByTestId } = render(<RunTabStrip pane={paneWith([consoleTab])} primary />);
    fireEvent.click(getByTestId(`run-tab-stop-${consoleTab.id}`));
    expect(launch.handleStop).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sleeper' }));
    // The close control is untouched and still present.
    expect(queryByTestId(`run-tab-close-${consoleTab.id}`)).not.toBeNull();
  });

  it('a terminal tab never shows a Stop button even if a same-named config is live', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'running' };
    const term = { id: 'term-1', kind: 'terminal' as const, title: 'zsh' };
    const { queryByTestId } = render(<RunTabStrip pane={paneWith([term])} primary />);
    expect(queryByTestId('run-tab-stop-term-1')).toBeNull();
  });
});
