/**
 * SessionPanelRail — unit tests.
 *
 * Behaviors covered:
 *  - the four buttons render, top-down: panel · activity · context · launch
 *  - the live dot appears only while background work is running, and the
 *    activity tooltip/name carries the running count
 *  - a rail click selects its section; the button reads engaged only while the
 *    panel it opened is floating
 *  - the context meter renders the percentage, and vanishes when the percentage
 *    is unknown
 *  - the launch quick action starts when idle and stops when live
 *  - the launch button is disabled with no configs, and with no chatId — the
 *    daemon resolves the worktree path from the chat, so a call without one
 *    would act on the wrong tree
 *  - right-clicking the launch button opens the Launch section instead of acting
 *  - todo #206, ported from ToolbarLaunchControls.test.tsx (:246, :270): a
 *    running NON-selected config still offers STOP, stops THAT config, and the
 *    label follows the running config
 *
 * Mocked dependencies:
 *  - ./use-context-percent — the resolved context fill
 *  - @/features/run/use-launch-actions — configs, statuses, start/stop
 *  - @/features/sessions/use-active-identity — projectId / chatId
 *  - @/features/chat/runtime/use-chat-thread-runtime — background tasks
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { BackgroundActivityTask, LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@v2/components/ui/tooltip';
import type { SessionPanelState } from '../use-session-panel-state';
import type { PanelMode } from '../panel-mode';

// v2 Hint/Tooltip require the v2 TooltipProvider (app-root concern live).
const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: TooltipProvider });

// ── mocks ────────────────────────────────────────────────────────────────────
let mockPercent: number | null = 42;
vi.mock('../use-context-percent', () => ({ useContextPercent: () => mockPercent }));

let mockConfigs: LaunchConfiguration[] = [];
let mockStatuses: Record<string, LaunchProcessStatus> = {};
let mockSelected: string | null = null;
const handleLaunch = vi.fn();
const handleStop = vi.fn();

vi.mock('@/features/run/use-launch-actions', () => ({
  useLaunchActions: () => ({
    configs: mockConfigs,
    scopeStatuses: mockStatuses,
    selectedConfigName: mockSelected,
    handleLaunch,
    handleStop,
    refetch: vi.fn(),
  }),
}));

let mockChatId: string | undefined = 'chat-9';
vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectName: 'repo', projectId: 'proj-1', chatId: mockChatId, isWorktree: false }),
}));

let mockTasks: Record<string, BackgroundActivityTask> = {};
vi.mock('@/features/chat/runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => ({ state: { backgroundTasks: mockTasks } }),
}));

const { SessionPanelRail } = await import('../SessionPanelRail');

// ── fixtures ─────────────────────────────────────────────────────────────────
const configs: LaunchConfiguration[] = [
  { name: 'dev server', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'], port: null, url: null },
  {
    name: 'preview-app',
    runtimeExecutable: 'npm',
    runtimeArgs: ['run', 'preview'],
    port: 3000,
    url: 'http://localhost:3000',
    preview: true,
  },
];

const task = (id: string): BackgroundActivityTask => ({ id, kind: 'agent', description: `work ${id}`, startedAt: 0 });

const selectSection = vi.fn();

function panelState(mode: PanelMode, focusId?: SessionPanelState['focusRequest'] extends null ? never : string) {
  return {
    hostRef: { current: null },
    rootRef: { current: null },
    surfaceWidth: mode === 'inline' ? 1200 : 800,
    mode,
    focusRequest: focusId ? { id: focusId as 'summary', seq: 1 } : null,
    isSectionOpen: () => true,
    toggleSection: vi.fn(),
    selectSection,
    closeOverlay: vi.fn(),
    registerSection: () => () => {},
  } as unknown as SessionPanelState;
}

beforeEach(() => {
  mockPercent = 42;
  mockConfigs = configs;
  mockStatuses = {};
  mockSelected = null;
  mockChatId = 'chat-9';
  mockTasks = {};
  handleLaunch.mockReset();
  handleStop.mockReset();
  selectSection.mockReset();
});

describe('SessionPanelRail — shape', () => {
  it('renders the panel, activity, context and launch buttons', () => {
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-open')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-activity')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-context')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-launch')).toBeInTheDocument();
  });

  it('renders the context percentage', () => {
    mockPercent = 73;
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    expect(screen.getByTestId('session-panel-rail-context')).toHaveTextContent('73%');
  });

  it('drops the context meter when the percentage is unknown', () => {
    mockPercent = null;
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    expect(screen.queryByTestId('session-panel-rail-context')).toBeNull();
  });
});

describe('SessionPanelRail — background activity', () => {
  it('shows no live dot when nothing is running', () => {
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    expect(screen.queryByTestId('session-panel-rail-activity-dot')).toBeNull();
    expect(screen.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-label', 'Background Activity');
  });

  it('shows the live dot and the running count once work is running', () => {
    mockTasks = { a: task('a'), b: task('b'), c: task('c') };
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    expect(screen.getByTestId('session-panel-rail-activity-dot')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-label', '3 tasks running');
  });

  it('says "1 task running" in the singular', () => {
    mockTasks = { a: task('a') };
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    expect(screen.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-label', '1 task running');
  });
});

describe('SessionPanelRail — section selection', () => {
  it('selects the summary section from the panel button', () => {
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    fireEvent.click(screen.getByTestId('session-panel-rail-open'));
    expect(selectSection).toHaveBeenCalledWith('summary');
  });

  it('selects the activity section from the activity button', () => {
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    fireEvent.click(screen.getByTestId('session-panel-rail-activity'));
    expect(selectSection).toHaveBeenCalledWith('activity');
  });

  it('selects the summary section from the context meter', () => {
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    fireEvent.click(screen.getByTestId('session-panel-rail-context'));
    expect(selectSection).toHaveBeenCalledWith('summary');
  });

  it('reads engaged only while the panel it opened is floating', () => {
    const { rerender } = render(<SessionPanelRail state={panelState('overlay', 'activity')} port={31415} />);
    expect(screen.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('session-panel-rail-open')).toHaveAttribute('aria-pressed', 'false');
    // Same target, but the panel is inline — nothing was opened by this button.
    rerender(<SessionPanelRail state={panelState('inline', 'activity')} port={31415} />);
    expect(screen.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SessionPanelRail — launch quick action', () => {
  it('starts the selected config when nothing is live', () => {
    mockSelected = 'preview-app';
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    expect(screen.getByTestId('session-panel-rail-launch')).toHaveAttribute('aria-label', 'Start preview-app');
    fireEvent.click(screen.getByTestId('session-panel-rail-launch'));
    expect(handleLaunch).toHaveBeenCalledWith(configs[1]);
    expect(handleStop).not.toHaveBeenCalled();
  });

  it('stops the config when it is running', () => {
    mockSelected = 'dev server';
    mockStatuses = { 'dev server': 'running' };
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    expect(screen.getByTestId('session-panel-rail-launch')).toHaveAttribute('aria-label', 'Stop dev server');
    fireEvent.click(screen.getByTestId('session-panel-rail-launch'));
    expect(handleStop).toHaveBeenCalledWith(configs[0]);
    expect(handleLaunch).not.toHaveBeenCalled();
  });

  it('is disabled when there are no launch configs', () => {
    mockConfigs = [];
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    const launch = screen.getByTestId('session-panel-rail-launch');
    expect(launch).toBeDisabled();
    fireEvent.click(launch);
    expect(handleLaunch).not.toHaveBeenCalled();
  });

  it('is disabled without a chatId — the daemon resolves the worktree from it', () => {
    mockChatId = undefined;
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    const launch = screen.getByTestId('session-panel-rail-launch');
    expect(launch).toBeDisabled();
    fireEvent.click(launch);
    expect(handleLaunch).not.toHaveBeenCalled();
  });

  it('right-click opens the Launch section instead of acting', () => {
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    fireEvent.contextMenu(screen.getByTestId('session-panel-rail-launch'));
    expect(selectSection).toHaveBeenCalledWith('launch');
    expect(handleLaunch).not.toHaveBeenCalled();
    expect(handleStop).not.toHaveBeenCalled();
  });
});

// ── todo #206, ported from ToolbarLaunchControls.test.tsx (:246, :270) ────────
// The selection is "dev server" (stopped) while "preview-app" is live. The
// quick action must still reach the live process, and say so.

describe('SessionPanelRail — a running NON-selected config (#206)', () => {
  beforeEach(() => {
    mockSelected = 'dev server';
    mockStatuses = { 'preview-app': 'running' };
  });

  it('stops THAT config rather than the selected one', () => {
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    fireEvent.click(screen.getByTestId('session-panel-rail-launch'));
    expect(handleStop).toHaveBeenCalledWith(configs[1]);
    expect(handleLaunch).not.toHaveBeenCalled();
  });

  it('labels the button with the running config, not the selected one', () => {
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    expect(screen.getByTestId('session-panel-rail-launch')).toHaveAttribute('aria-label', 'Stop preview-app');
  });

  it('renders a STOP square, not a play triangle', () => {
    render(<SessionPanelRail state={panelState('rail')} port={31415} />);
    const launch = screen.getByTestId('session-panel-rail-launch');
    expect(launch.querySelector('.lucide-square')).toBeTruthy();
    expect(launch.querySelector('.lucide-play')).toBeNull();
  });
});
