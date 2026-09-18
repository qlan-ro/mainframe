/**
 * SessionPanel — unit tests.
 *
 * The shell: an always-present rail plus the stack of cards it toggles.
 *
 * Behaviors covered:
 *  - the rail renders in EVERY measured mode — it is the switchboard, so it
 *    never hides behind the thing it switches
 *  - one card per open panel, in render order; a closed panel renders nothing
 *  - the stack only shows inline and in overlay: rail mode keeps the bits but
 *    puts nothing on screen
 *  - the floating stack is a dialog, named for a screen reader since it has no
 *    visible title
 *  - 'hidden' (nothing measured yet) renders nothing at all
 *  - the root floats: absolutely positioned and click-through, so it takes no
 *    width from the transcript and does not eat wheel events over its gutter
 *  - a card's close X toggles that panel off
 *  - the session card holds Summary, Plan and Context
 *
 * Mocked dependencies (the rail's data sources — the real rail renders here):
 *  - ./use-context-percent, @/features/run/use-launch-actions,
 *    @/features/sessions/use-active-identity,
 *    @/features/chat/runtime/chat-extras
 *
 * The section/card bodies are stubbed: each owns its own suite, and this one is
 * about the shell. The session card's PanelCard chrome is REAL, so its close X
 * is the live one.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen, fireEvent } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import type { SessionPanelId } from '@/store/ui-prefs';
import type { SessionPanelState } from '../use-session-panel-state';
import type { PanelMode } from '../panel-mode';

vi.mock('../use-context-percent', () => ({ useContextPercent: () => 42 }));

vi.mock('@/features/run/use-launch-actions', () => ({
  useLaunchActions: () => ({
    configs: [],
    scopeStatuses: {},
    selectedConfigName: null,
    handleLaunch: vi.fn(),
    handleStop: vi.fn(),
    refetch: vi.fn(),
  }),
}));

vi.mock('@/features/sessions/use-active-identity', () => ({
  useActiveIdentity: () => ({ projectName: 'repo', projectId: 'proj-1', chatId: 'chat-9', isWorktree: false }),
}));

vi.mock('@/features/chat/runtime/chat-extras', () => ({
  useChatExtras: () => ({ state: { backgroundTasks: {} } }),
}));

vi.mock('../SummarySection', () => ({ SummarySection: () => <div data-testid="stub-summary" /> }));
vi.mock('../PlanSection', () => ({ PlanSection: () => <div data-testid="stub-plan" /> }));
vi.mock('../ContextSection', () => ({ ContextSection: () => <div data-testid="stub-context" /> }));

// The three list cards are stubbed whole — each carries its own close button so
// the shell's onClose wiring stays assertable.
function cardStub(id: SessionPanelId) {
  return ({ onClose }: { onClose: () => void }) => (
    <div data-testid={`stub-${id}`}>
      <button type="button" data-testid={`stub-close-${id}`} onClick={onClose} />
    </div>
  );
}
vi.mock('../ActivityCard', () => ({ ActivityCard: cardStub('activity') }));
vi.mock('../LaunchCard', () => ({ LaunchCard: cardStub('launch') }));
vi.mock('../TasksCard', () => ({ TasksCard: cardStub('tasks') }));

const { SessionPanel } = await import('../SessionPanel');

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DaemonPortProvider port={31415}>
      <TooltipProvider>{children}</TooltipProvider>
    </DaemonPortProvider>
  );
}

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: Wrapper });

const togglePanel = vi.fn();

/** `open` lists the panels whose bit is set; visibility follows the mode. */
function panelState(mode: PanelMode, open: SessionPanelId[] = ['session']): SessionPanelState {
  const isOpen = (id: SessionPanelId) => open.includes(id);
  return {
    hostRef: () => {},
    rootRef: { current: null },
    surfaceWidth: mode === 'inline' ? 1600 : 1000,
    mode,
    isPanelOpen: isOpen,
    isPanelVisible: (id: SessionPanelId) => (mode === 'inline' || mode === 'overlay') && isOpen(id),
    togglePanel,
    isSectionOpen: () => true,
    toggleSection: vi.fn(),
    closeOverlay: vi.fn(),
  } as unknown as SessionPanelState;
}

beforeEach(() => {
  document.body.innerHTML = '';
  togglePanel.mockReset();
});

describe('SessionPanel — mode rendering', () => {
  it('renders the inline stack, and no overlay', () => {
    render(<SessionPanel state={panelState('inline')} />);
    expect(screen.getByTestId('session-panel-root')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-overlay')).toBeNull();
  });

  it('renders no stack at all in rail mode, even with panels open', () => {
    render(<SessionPanel state={panelState('rail', ['session', 'tasks'])} />);
    expect(screen.queryByTestId('session-panel')).toBeNull();
    expect(screen.queryByTestId('session-panel-overlay')).toBeNull();
    expect(screen.queryByTestId('session-panel-card-session')).toBeNull();
    expect(screen.queryByTestId('stub-tasks')).toBeNull();
  });

  it('renders the floating stack in overlay mode, and not the inline one', () => {
    render(<SessionPanel state={panelState('overlay')} />);
    expect(screen.getByTestId('session-panel-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel')).toBeNull();
  });

  it('names the floating stack for a screen reader — it has no visible title', () => {
    render(<SessionPanel state={panelState('overlay')} />);
    const overlay = screen.getByTestId('session-panel-overlay');
    expect(overlay).toHaveAttribute('role', 'dialog');
    expect(overlay).toHaveAttribute('aria-label', 'Session panel');
  });

  it('renders nothing at all when hidden — no stack, no rail, no root', () => {
    render(<SessionPanel state={panelState('hidden')} />);
    expect(screen.queryByTestId('session-panel-root')).toBeNull();
    expect(screen.queryByTestId('session-panel')).toBeNull();
    expect(screen.queryByTestId('session-panel-rail')).toBeNull();
    expect(screen.queryByTestId('session-panel-overlay')).toBeNull();
  });

  it('renders no stack when every panel is closed, but keeps the rail', () => {
    render(<SessionPanel state={panelState('inline', [])} />);
    expect(screen.queryByTestId('session-panel')).toBeNull();
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
  });

  it('floats over the surface instead of taking width from it', () => {
    render(<SessionPanel state={panelState('inline')} />);
    const root = screen.getByTestId('session-panel-root');
    expect(root).toHaveClass('absolute', 'inset-y-0', 'right-0');
    // Click-through, so the empty strip below a content-height stack still
    // scrolls the transcript underneath; each surface opts back in.
    expect(root).toHaveClass('pointer-events-none');
    expect(screen.getByTestId('session-panel')).toHaveClass('pointer-events-auto');
  });
});

describe('SessionPanel — the rail is always there', () => {
  it('renders beside the inline stack', () => {
    render(<SessionPanel state={panelState('inline')} />);
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
  });

  it('renders alone in rail mode', () => {
    render(<SessionPanel state={panelState('rail')} />);
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
  });

  it('renders beside the floating stack', () => {
    render(<SessionPanel state={panelState('overlay')} />);
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
  });
});

describe('SessionPanel — the stack', () => {
  it('renders one card per open panel, matching the rail order', () => {
    render(<SessionPanel state={panelState('inline', ['session', 'activity', 'launch', 'tasks'])} />);
    const rendered = Array.from(
      screen
        .getByTestId('session-panel')
        .querySelectorAll(
          '[data-testid="session-panel-card-session"],[data-testid^="stub-activity"],[data-testid^="stub-launch"],[data-testid^="stub-tasks"]',
        ),
    ).map((el) => el.getAttribute('data-testid'));
    expect(rendered).toEqual(['session-panel-card-session', 'stub-activity', 'stub-launch', 'stub-tasks']);
  });

  it('renders only the panels that are open', () => {
    render(<SessionPanel state={panelState('inline', ['tasks'])} />);
    expect(screen.getByTestId('stub-tasks')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-card-session')).toBeNull();
    expect(screen.queryByTestId('stub-activity')).toBeNull();
    expect(screen.queryByTestId('stub-launch')).toBeNull();
  });

  it('puts Summary, Plan and Context inside the session card', () => {
    render(<SessionPanel state={panelState('inline', ['session'])} />);
    const card = screen.getByTestId('session-panel-card-session');
    const rendered = Array.from(card.querySelectorAll('[data-testid^="stub-"]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(rendered).toEqual(['stub-summary', 'stub-plan', 'stub-context']);
  });
});

describe('SessionPanel — closing a card', () => {
  it('toggles the session panel off from its header X', () => {
    render(<SessionPanel state={panelState('inline', ['session'])} />);
    fireEvent.click(screen.getByTestId('session-panel-card-close-session'));
    expect(togglePanel).toHaveBeenCalledWith('session');
  });

  it('hands each list card a close that targets its own panel', () => {
    render(<SessionPanel state={panelState('inline', ['activity', 'launch', 'tasks'])} />);
    fireEvent.click(screen.getByTestId('stub-close-activity'));
    fireEvent.click(screen.getByTestId('stub-close-launch'));
    fireEvent.click(screen.getByTestId('stub-close-tasks'));
    expect(togglePanel.mock.calls).toEqual([['activity'], ['launch'], ['tasks']]);
  });
});
