/**
 * RunTabStrip — strip height regression (finding 15.5: FilesTabStrip/RunTabStrip/
 * ChatCardHeader must share one uniform 36px strip height, matching the design's
 * `SurfaceTabStrip` and chat surface header, both height:36) plus the running-
 * config Stop affordance (todo #206 part 2): a launch-config tab whose process is
 * live must flip its leading glyph into a red Stop button, consistent with the
 * toolbar's Stop, without disturbing the tab's close (×) control.
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
const paneWith = (tabs: RunPane['tabs']): RunPane => ({ id: 'pane-1', tabs, active: tabs[0]?.id ?? null });

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

describe('RunTabStrip — running-config Stop affordance', () => {
  it('renders a Stop button on a launch-config tab whose process is running', () => {
    launch.configs = [cfg('Sleeper')];
    launch.scopeStatuses = { Sleeper: 'running' };
    const { queryByTestId } = render(<RunTabStrip pane={paneWith([consoleTab])} primary />);
    expect(queryByTestId(`run-tab-stop-${consoleTab.id}`)).not.toBeNull();
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
    const terminalTab = { id: 'term-1', kind: 'terminal' as const, title: 'zsh' };
    const { queryByTestId } = render(<RunTabStrip pane={paneWith([terminalTab])} primary />);
    expect(queryByTestId('run-tab-stop-term-1')).toBeNull();
  });
});
