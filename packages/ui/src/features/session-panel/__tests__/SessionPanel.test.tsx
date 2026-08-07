/**
 * SessionPanel — unit tests.
 *
 * Behaviors covered:
 *  - inline mode renders the inset card and no overlay
 *  - rail mode renders neither card — the rail alone
 *  - overlay mode renders the floating card, named for a screen reader since it
 *    has no visible title
 *  - the rail renders in every mode EXCEPT inline, where the card replaces it
 *  - only the inline card is handed a collapse control
 *  - the root floats: it is absolutely positioned and click-through, so it takes
 *    no width from the transcript and does not eat wheel events over its gutter
 *  - a card going away — dismissed, collapsed, or squeezed out — hands focus to
 *    the rail button that replaced it
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

// The stub reports whether it was handed a collapse control — the real control
// lives in SummarySection's own suite; this one only checks who gets offered it.
vi.mock('../SummarySection', () => ({
  SummarySection: ({ onCollapse }: { onCollapse?: () => void }) => (
    <div data-testid="stub-summary" data-collapsible={onCollapse != null} />
  ),
}));
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
    surfaceWidth: mode === 'inline' ? 1600 : 1000,
    mode,
    focusRequest: focusId,
    isSectionOpen: () => true,
    toggleSection: vi.fn(),
    selectSection: vi.fn(),
    collapsePanel: vi.fn(),
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

  it('renders nothing at all when hidden — no card, no rail, no root', () => {
    render(<SessionPanel state={panelState('hidden')} />);
    expect(screen.queryByTestId('session-panel-root')).toBeNull();
    expect(screen.queryByTestId('session-panel')).toBeNull();
    expect(screen.queryByTestId('session-panel-rail')).toBeNull();
    expect(screen.queryByTestId('session-panel-overlay')).toBeNull();
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

  it('hides the rail inline — the card is the only way in when it is showing', () => {
    render(<SessionPanel state={panelState('inline')} />);
    expect(screen.queryByTestId('session-panel-rail')).toBeNull();
  });

  it('keeps the rail beside the floating card, and alone in rail mode', () => {
    const { rerender } = render(<SessionPanel state={panelState('rail')} />);
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
    rerender(<SessionPanel state={panelState('overlay', { id: 'activity', seq: 1 })} />);
    expect(screen.getByTestId('session-panel-rail')).toBeInTheDocument();
  });

  it('floats over the surface instead of taking width from it', () => {
    render(<SessionPanel state={panelState('inline')} />);
    const root = screen.getByTestId('session-panel-root');
    expect(root).toHaveClass('absolute', 'inset-y-0', 'right-0');
    // Click-through, so the empty strip below a content-height card still
    // scrolls the transcript underneath; each surface opts back in.
    expect(root).toHaveClass('pointer-events-none');
    expect(screen.getByTestId('session-panel')).toHaveClass('pointer-events-auto');
  });
});

describe('SessionPanel — collapse control', () => {
  it('offers the inline card a collapse control', () => {
    render(<SessionPanel state={panelState('inline')} />);
    expect(screen.getByTestId('stub-summary')).toHaveAttribute('data-collapsible', 'true');
  });

  it('offers the floating card none — its exit is the light dismiss', () => {
    render(<SessionPanel state={panelState('overlay', { id: 'summary', seq: 1 })} />);
    expect(screen.getByTestId('stub-summary')).toHaveAttribute('data-collapsible', 'false');
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

describe('SessionPanel — focus return when a card goes away', () => {
  it('hands focus to the rail when the inline card collapses into it', () => {
    // The collapse control unmounts with the card, so focus lands nowhere —
    // and the rail it collapsed into has only just appeared.
    const { rerender } = render(<SessionPanel state={panelState('inline')} />);
    rerender(<SessionPanel state={panelState('rail')} />);
    expect(document.activeElement).toBe(screen.getByTestId('session-panel-rail-open'));
  });

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
