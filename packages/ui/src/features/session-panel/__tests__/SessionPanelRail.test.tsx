/**
 * SessionPanelRail — unit tests.
 *
 * The rail is the switchboard for the stacked panels: every button TOGGLES its
 * panel, and reads engaged only while that panel is actually showing.
 *
 * Behaviors covered:
 *  - the five controls render, top-down: session · activity · context · tasks ·
 *    launch
 *  - each button toggles its own panel id
 *  - `aria-pressed` follows isPanelVisible, not the raw open bit
 *  - the activity dot appears only while background work is running, and the
 *    button's name carries the running count
 *  - the launch glyph is a Rocket, with a dot when a config is live — the old
 *    one-click run/stop moved into the Launch panel's rows
 *  - the context meter renders the percentage, vanishes when it is unknown, and
 *    is a plain indicator — not a control
 *
 * Mocked dependencies:
 *  - ./use-context-percent — the resolved context fill
 *  - @/features/run/use-launch-actions — configs and statuses
 *  - @/features/sessions/use-active-identity — projectId / chatId
 *  - @/features/chat/runtime/use-chat-thread-runtime — background tasks
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { BackgroundActivityTask, LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { SessionPanelId } from '@/store/ui-prefs';
import type { SessionPanelState } from '../use-session-panel-state';

// v2 Hint/Tooltip require the v2 TooltipProvider (app-root concern live).
const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: TooltipProvider });

// ── mocks ────────────────────────────────────────────────────────────────────
let mockPercent: number | null = 42;
vi.mock('../use-context-percent', () => ({ useContextPercent: () => mockPercent }));

let mockConfigs: LaunchConfiguration[] = [];
let mockStatuses: Record<string, LaunchProcessStatus> = {};
let mockSelected: string | null = null;

vi.mock('@/features/run/use-launch-actions', () => ({
  useLaunchActions: () => ({
    configs: mockConfigs,
    scopeStatuses: mockStatuses,
    selectedConfigName: mockSelected,
    handleLaunch: vi.fn(),
    handleStop: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectName: 'repo', projectId: 'proj-1', chatId: 'chat-9', isWorktree: false }),
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

const togglePanel = vi.fn();

/** `visible` lists the panels the stack is currently showing. */
function panelState(visible: SessionPanelId[] = []): SessionPanelState {
  return {
    hostRef: () => {},
    rootRef: { current: null },
    surfaceWidth: 1600,
    mode: 'inline',
    isPanelOpen: (id: SessionPanelId) => visible.includes(id),
    isPanelVisible: (id: SessionPanelId) => visible.includes(id),
    togglePanel,
    isSectionOpen: () => true,
    toggleSection: vi.fn(),
    closeOverlay: vi.fn(),
  } as unknown as SessionPanelState;
}

const rail = (visible: SessionPanelId[] = []) => <SessionPanelRail state={panelState(visible)} port={31415} />;

beforeEach(() => {
  mockPercent = 42;
  mockConfigs = configs;
  mockStatuses = {};
  mockSelected = null;
  mockTasks = {};
  togglePanel.mockReset();
});

describe('SessionPanelRail — shape', () => {
  it('renders the session, activity, context, tasks and launch controls', () => {
    render(rail());
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-open')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-activity')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-context')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-tasks')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-launch')).toBeInTheDocument();
  });

  it('renders the context percentage', () => {
    mockPercent = 73;
    render(rail());
    expect(screen.getByTestId('session-panel-rail-context')).toHaveTextContent('73%');
  });

  it('drops the context meter when the percentage is unknown', () => {
    mockPercent = null;
    render(rail());
    expect(screen.queryByTestId('session-panel-rail-context')).toBeNull();
  });
});

describe('SessionPanelRail — toggling panels', () => {
  it('toggles the session card from the session button', () => {
    render(rail());
    fireEvent.click(screen.getByTestId('session-panel-rail-open'));
    expect(togglePanel).toHaveBeenCalledWith('session');
  });

  it('toggles the activity panel from the activity button', () => {
    render(rail());
    fireEvent.click(screen.getByTestId('session-panel-rail-activity'));
    expect(togglePanel).toHaveBeenCalledWith('activity');
  });

  it('toggles the tasks panel from the tasks button', () => {
    render(rail());
    fireEvent.click(screen.getByTestId('session-panel-rail-tasks'));
    expect(togglePanel).toHaveBeenCalledWith('tasks');
  });

  it('toggles the launch panel from the launch button — it no longer runs anything', () => {
    render(rail());
    fireEvent.click(screen.getByTestId('session-panel-rail-launch'));
    expect(togglePanel).toHaveBeenCalledWith('launch');
  });

  it('reads engaged only for the panels that are showing', () => {
    render(rail(['activity', 'tasks']));
    expect(screen.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('session-panel-rail-tasks')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('session-panel-rail-open')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('session-panel-rail-launch')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('SessionPanelRail — the context meter is an indicator', () => {
  it('is not a control: clicking it drives no panel state', () => {
    render(rail());
    const meter = screen.getByTestId('session-panel-rail-context');
    expect(meter.tagName).toBe('DIV');
    fireEvent.click(meter);
    expect(togglePanel).not.toHaveBeenCalled();
  });
});

describe('SessionPanelRail — background activity', () => {
  it('shows no live dot when nothing is running', () => {
    render(rail());
    expect(screen.queryByTestId('session-panel-rail-activity-dot')).toBeNull();
    expect(screen.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-label', 'Background Activity');
  });

  it('shows the live dot and the running count once work is running', () => {
    mockTasks = { a: task('a'), b: task('b'), c: task('c') };
    render(rail());
    expect(screen.getByTestId('session-panel-rail-activity-dot')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-label', '3 tasks running');
  });

  it('says "1 task running" in the singular', () => {
    mockTasks = { a: task('a') };
    render(rail());
    expect(screen.getByTestId('session-panel-rail-activity')).toHaveAttribute('aria-label', '1 task running');
  });
});

describe('SessionPanelRail — the launch glyph', () => {
  it('is a Rocket, not a run control', () => {
    render(rail());
    const launch = screen.getByTestId('session-panel-rail-launch');
    expect(launch.querySelector('.lucide-rocket')).toBeTruthy();
    expect(launch.querySelector('.lucide-play')).toBeNull();
    expect(launch.querySelector('.lucide-square')).toBeNull();
  });

  it('carries no dot while every config is stopped', () => {
    render(rail());
    expect(screen.queryByTestId('session-panel-rail-launch-dot')).toBeNull();
  });

  it('dots the glyph while a config is live — the run signal survived the move', () => {
    mockStatuses = { 'preview-app': 'running' };
    render(rail());
    expect(screen.getByTestId('session-panel-rail-launch-dot')).toBeInTheDocument();
  });

  it('dots the glyph for a live NON-selected config too (#206)', () => {
    mockSelected = 'dev server';
    mockStatuses = { 'preview-app': 'running' };
    render(rail());
    expect(screen.getByTestId('session-panel-rail-launch-dot')).toBeInTheDocument();
  });

  it('carries no dot when the project has no launch configs at all', () => {
    mockConfigs = [];
    render(rail());
    expect(screen.queryByTestId('session-panel-rail-launch-dot')).toBeNull();
    // …and the button still toggles the panel, so the empty state is reachable.
    fireEvent.click(screen.getByTestId('session-panel-rail-launch'));
    expect(togglePanel).toHaveBeenCalledWith('launch');
  });
});
