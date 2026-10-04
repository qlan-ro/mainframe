/**
 * SessionPanel — unit tests.
 *
 * The shell: an always-present rail plus the stack of cards it toggles.
 *
 * D8 (v8): the panel is ONE bit for the whole stack — there is no per-card
 * open state anymore. Whenever the bit is on and the mode shows a stack, ALL
 * FOUR cards render together; whenever it is off, none do.
 *
 * Behaviors covered:
 *  - the rail renders in EVERY measured mode — it is the switchboard, so it
 *    never hides behind the thing it switches
 *  - the stack renders all four cards together, in order, whenever the bit is
 *    open and the mode shows a stack
 *  - the stack only shows inline and in overlay: rail mode keeps the bit but
 *    puts nothing on screen
 *  - the floating stack is a dialog, named for a screen reader since it has no
 *    visible title
 *  - 'hidden' (nothing measured yet) renders nothing at all
 *  - the root floats: absolutely positioned and click-through, so it takes no
 *    width from the transcript and does not eat wheel events over its gutter
 *  - a card's close X toggles the whole panel off
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
function cardStub(id: string) {
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

/** `open` is the one bit; visibility follows the mode. */
function panelState(mode: PanelMode, open = true): SessionPanelState {
  return {
    hostRef: () => {},
    rootRef: { current: null },
    surfaceWidth: mode === 'inline' ? 1600 : 1000,
    mode,
    isPanelOpen: () => open,
    isPanelVisible: () => (mode === 'inline' || mode === 'overlay') && open,
    togglePanel,
    isSectionOpen: () => true,
    toggleSection: vi.fn(),
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

  it('renders no stack at all in rail mode, even though the bit is open', () => {
    render(<SessionPanel state={panelState('rail', true)} />);
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

  it('renders no stack when the bit is closed, but keeps the rail', () => {
    render(<SessionPanel state={panelState('inline', false)} />);
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

describe('SessionPanel — the stack (D8: all four cards together, one bit)', () => {
  it('renders all four cards together, in order, when open', () => {
    render(<SessionPanel state={panelState('inline', true)} />);
    const rendered = Array.from(
      screen
        .getByTestId('session-panel')
        .querySelectorAll(
          '[data-testid="session-panel-card-session"],[data-testid^="stub-activity"],[data-testid^="stub-launch"],[data-testid^="stub-tasks"]',
        ),
    ).map((el) => el.getAttribute('data-testid'));
    expect(rendered).toEqual(['session-panel-card-session', 'stub-activity', 'stub-launch', 'stub-tasks']);
  });

  it('renders none of the four cards when the bit is closed', () => {
    render(<SessionPanel state={panelState('inline', false)} />);
    expect(screen.queryByTestId('session-panel-card-session')).toBeNull();
    expect(screen.queryByTestId('stub-activity')).toBeNull();
    expect(screen.queryByTestId('stub-launch')).toBeNull();
    expect(screen.queryByTestId('stub-tasks')).toBeNull();
  });

  it('puts Summary, Plan and Context inside the session card', () => {
    render(<SessionPanel state={panelState('inline', true)} />);
    const card = screen.getByTestId('session-panel-card-session');
    const rendered = Array.from(card.querySelectorAll('[data-testid^="stub-"]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(rendered).toEqual(['stub-summary', 'stub-plan', 'stub-context']);
  });
});

describe('SessionPanel — closing a card closes the whole panel', () => {
  it('toggles the panel off from the session card header X', () => {
    render(<SessionPanel state={panelState('inline', true)} />);
    fireEvent.click(screen.getByTestId('session-panel-card-close-session'));
    expect(togglePanel).toHaveBeenCalledTimes(1);
  });

  it('every list card closes through the same togglePanel, with no argument', () => {
    render(<SessionPanel state={panelState('inline', true)} />);
    fireEvent.click(screen.getByTestId('stub-close-activity'));
    fireEvent.click(screen.getByTestId('stub-close-launch'));
    fireEvent.click(screen.getByTestId('stub-close-tasks'));
    expect(togglePanel.mock.calls).toEqual([[], [], []]);
  });
});
