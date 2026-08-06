/**
 * SessionPanel — unit tests.
 *
 * Behaviors covered:
 *  - inline mode renders the inset card and no overlay
 *  - rail mode renders neither card — the rail alone
 *  - overlay mode renders the floating card, named for a screen reader since it
 *    has no visible title
 *  - the rail renders in every mode
 *  - dismissing the overlay hands focus back to the rail button that opened it
 *  - dismissal does NOT steal focus when the user has already moved it (the
 *    outside-click path)
 *  - the body carries the five sections, in render order
 *
 * Mocked dependencies (the rail's data sources — the real rail renders here, so
 * the focus-return assertion lands on a real button):
 *  - ./use-context-percent, @/features/run/use-launch-actions,
 *    @/features/sessions/use-active-identity,
 *    @/features/chat/runtime/use-chat-thread-runtime
 *
 * The five sections are stubbed: each owns its own suite, and this one is about
 * the shell.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@v2/components/ui/tooltip';
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

vi.mock('@/features/chat/runtime/use-chat-thread-runtime', () => ({
  useChatExtras: () => ({ state: { backgroundTasks: {} } }),
}));

vi.mock('../SummarySection', () => ({ SummarySection: () => <div data-testid="stub-summary" /> }));
vi.mock('../PlanSection', () => ({ PlanSection: () => <div data-testid="stub-plan" /> }));
vi.mock('../ActivitySection', () => ({ ActivitySection: () => <div data-testid="stub-activity" /> }));
vi.mock('../LaunchSection', () => ({ LaunchSection: () => <div data-testid="stub-launch" /> }));
vi.mock('../ContextSection', () => ({ ContextSection: () => <div data-testid="stub-context" /> }));

const { SessionPanel } = await import('../SessionPanel');

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <DaemonPortProvider port={31415}>
      <TooltipProvider>{children}</TooltipProvider>
    </DaemonPortProvider>
  );
}

const render = (ui: Parameters<typeof rtlRender>[0]) => rtlRender(ui, { wrapper: Wrapper });

function panelState(mode: PanelMode, focusId: SessionPanelState['focusRequest'] = null): SessionPanelState {
  return {
    hostRef: { current: null },
    rootRef: { current: null },
    surfaceWidth: mode === 'inline' ? 1200 : 800,
    mode,
    focusRequest: focusId,
    isSectionOpen: () => true,
    toggleSection: vi.fn(),
    selectSection: vi.fn(),
    closeOverlay: vi.fn(),
    registerSection: () => () => {},
  } as unknown as SessionPanelState;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('SessionPanel — mode rendering', () => {
  it('renders the inset card inline, and no overlay', () => {
    render(<SessionPanel state={panelState('inline')} />);
    expect(screen.getByTestId('session-panel-root')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-overlay')).toBeNull();
  });

  it('renders no card at all in rail mode', () => {
    render(<SessionPanel state={panelState('rail')} />);
    expect(screen.queryByTestId('session-panel')).toBeNull();
    expect(screen.queryByTestId('session-panel-overlay')).toBeNull();
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
  });

  it('renders the floating card in overlay mode, and not the inline one', () => {
    render(<SessionPanel state={panelState('overlay', { id: 'summary', seq: 1 })} />);
    expect(screen.getByTestId('session-panel-overlay')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel')).toBeNull();
  });

  it('names the floating card for a screen reader — it has no visible title', () => {
    render(<SessionPanel state={panelState('overlay', { id: 'summary', seq: 1 })} />);
    const overlay = screen.getByTestId('session-panel-overlay');
    expect(overlay).toHaveAttribute('role', 'dialog');
    expect(overlay).toHaveAttribute('aria-label', 'Session panel');
  });

  it('keeps the rail in every mode', () => {
    const { rerender } = render(<SessionPanel state={panelState('inline')} />);
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
    rerender(<SessionPanel state={panelState('overlay', { id: 'activity', seq: 1 })} />);
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
  });
});

describe('SessionPanel — body', () => {
  it('renders the five sections in order', () => {
    render(<SessionPanel state={panelState('inline')} />);
    const rendered = Array.from(document.querySelectorAll('[data-testid^="stub-"]')).map((el) =>
      el.getAttribute('data-testid'),
    );
    expect(rendered).toEqual(['stub-summary', 'stub-plan', 'stub-activity', 'stub-launch', 'stub-context']);
  });

  it('renders no section body in rail mode', () => {
    render(<SessionPanel state={panelState('rail')} />);
    expect(screen.queryByTestId('stub-summary')).toBeNull();
  });
});

describe('SessionPanel — focus return on dismiss', () => {
  it('returns focus to the rail button that opened the overlay', () => {
    const { rerender } = render(<SessionPanel state={panelState('overlay', { id: 'activity', seq: 1 })} />);
    // Escape closes the overlay from inside the panel, so focus lands nowhere.
    expect(document.activeElement).toBe(document.body);

    rerender(<SessionPanel state={panelState('rail', { id: 'activity', seq: 1 })} />);
    expect(document.activeElement).toBe(screen.getByTestId('session-panel-rail-activity'));
  });

  it('falls back to the panel button when no section was targeted', () => {
    const { rerender } = render(<SessionPanel state={panelState('overlay')} />);
    rerender(<SessionPanel state={panelState('rail')} />);
    expect(document.activeElement).toBe(screen.getByTestId('session-panel-rail-open'));
  });

  it('leaves focus alone when the dismissal already moved it elsewhere', () => {
    const outside = document.createElement('button');
    document.body.append(outside);

    const { rerender } = render(<SessionPanel state={panelState('overlay', { id: 'activity', seq: 1 })} />);
    outside.focus();

    rerender(<SessionPanel state={panelState('rail', { id: 'activity', seq: 1 })} />);
    expect(document.activeElement).toBe(outside);
  });

  it('does not grab focus when the surface simply grew back to inline', () => {
    const { rerender } = render(<SessionPanel state={panelState('overlay', { id: 'activity', seq: 1 })} />);
    rerender(<SessionPanel state={panelState('inline', { id: 'activity', seq: 1 })} />);
    expect(document.activeElement).toBe(document.body);
  });
});
