/**
 * SessionPanel — unit tests.
 *
 * D20/D21: the panel is ONE scrolling column of sections
 * (`session-panel-sections`); there is no separate rail, no per-card close
 * button, and no stack of floating cards. The mode decides how that column is
 * presented:
 *  - `inline`  — a 300px flex sibling, `<aside data-mode="inline">`, holding
 *    `session-panel` → `session-panel-sections`.
 *  - `overlay` — `session-panel-root[data-mode=overlay]` with a
 *    `session-panel-scrim` and a `session-panel-overlay` dialog
 *    (role=dialog, aria-label "Session panel") that carries `rootRef`.
 *  - `hidden`  — renders nothing at all.
 *
 * Section order inside `session-panel-sections`: the Session card (a real
 * `PanelEyebrow` labelled "Session" wrapping the stubbed `SummarySection`),
 * then PullRequestsSection, ContextSection, ActivitySection, TasksSection,
 * LaunchSection, PlanSection — each stubbed since it owns its own test file.
 *
 * Mocked dependencies: every section component (`../SummarySection`,
 * `../PullRequestsSection`, `../ContextSection`, `../ActivitySection`,
 * `../TasksSection`, `../LaunchSection`, `../PlanSection`) — this suite is
 * about the shell, not their bodies.
 */
import { createRef } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render as rtlRender, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import type { SessionPanelState } from '../use-session-panel-state';
import type { PanelMode } from '../panel-mode';

const sectionCalls: Record<string, unknown[]> = {};
function sectionStub(id: string) {
  sectionCalls[id] = [];
  return (props: unknown) => {
    sectionCalls[id]!.push(props);
    return <div data-testid={`stub-${id}`} />;
  };
}

vi.mock('../SummarySection', () => ({ SummarySection: sectionStub('summary') }));
vi.mock('../PullRequestsSection', () => ({ PullRequestsSection: sectionStub('prs') }));
vi.mock('../ContextSection', () => ({ ContextSection: sectionStub('context') }));
vi.mock('../ActivitySection', () => ({ ActivitySection: sectionStub('activity') }));
vi.mock('../TasksSection', () => ({ TasksSection: sectionStub('tasks') }));
vi.mock('../LaunchSection', () => ({ LaunchSection: sectionStub('launch') }));
vi.mock('../PlanSection', () => ({ PlanSection: sectionStub('plan') }));

function callsFor(id: string): unknown[] {
  return sectionCalls[id]!;
}

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
const toggleSection = vi.fn();

function panelState(mode: PanelMode, overrides: Partial<SessionPanelState> = {}): SessionPanelState {
  return {
    hostRef: () => {},
    rootRef: createRef<HTMLDivElement>(),
    surfaceWidth: mode === 'inline' ? 1600 : 1000,
    mode,
    togglePanel,
    isSectionOpen: () => true,
    toggleSection,
    ...overrides,
  } as unknown as SessionPanelState;
}

beforeEach(() => {
  document.body.innerHTML = '';
  togglePanel.mockReset();
  toggleSection.mockReset();
  for (const key of Object.keys(sectionCalls)) sectionCalls[key]!.length = 0;
});

describe('SessionPanel — mode rendering', () => {
  it('docks inline as a 300px aside holding session-panel, and renders no overlay', () => {
    render(<SessionPanel state={panelState('inline')} />);
    const root = screen.getByTestId('session-panel-root');
    expect(root.tagName).toBe('ASIDE');
    expect(root).toHaveAttribute('data-mode', 'inline');
    expect(root.style.width).toBe('300px');
    expect(root.contains(screen.getByTestId('session-panel'))).toBe(true);
    expect(screen.queryByTestId('session-panel-overlay')).toBeNull();
    expect(screen.queryByTestId('session-panel-scrim')).toBeNull();
  });

  it('D20: docks as a 300px flex sibling inline; overlays — instead of floating stacked cards — otherwise', () => {
    const { rerender } = render(<SessionPanel state={panelState('inline')} />);
    expect(screen.getByTestId('session-panel-root')).toHaveAttribute('data-mode', 'inline');

    rerender(<SessionPanel state={panelState('overlay')} />);
    const root = screen.getByTestId('session-panel-root');
    expect(root).toHaveAttribute('data-mode', 'overlay');
    expect(screen.getByTestId('session-panel-scrim')).toBeInTheDocument();
    expect(screen.getByTestId('session-panel-overlay')).toBeInTheDocument();
  });

  it('renders the overlay as a dialog, scrim, and no inline column', () => {
    render(<SessionPanel state={panelState('overlay')} />);
    expect(screen.getByTestId('session-panel-root')).toHaveAttribute('data-mode', 'overlay');
    expect(screen.getByTestId('session-panel-scrim')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel')).toBeNull();
    const overlay = screen.getByTestId('session-panel-overlay');
    expect(overlay).toHaveAttribute('role', 'dialog');
    expect(overlay).toHaveAttribute('aria-label', 'Session panel');
    expect(overlay.style.width).toBe('300px');
  });

  it('attaches rootRef to the panel root in inline mode, and to the dialog in overlay mode', () => {
    const inlineRef = createRef<HTMLDivElement>();
    render(<SessionPanel state={panelState('inline', { rootRef: inlineRef })} />);
    expect(inlineRef.current).toBe(screen.getByTestId('session-panel-root'));

    document.body.innerHTML = '';
    const overlayRef = createRef<HTMLDivElement>();
    render(<SessionPanel state={panelState('overlay', { rootRef: overlayRef })} />);
    expect(overlayRef.current).toBe(screen.getByTestId('session-panel-overlay'));
  });

  it('renders nothing at all when hidden', () => {
    const { container } = render(<SessionPanel state={panelState('hidden')} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId('session-panel-root')).toBeNull();
  });
});

describe('SessionPanel — section order', () => {
  it('renders the Session card, then PRs, Context, Activity, Tasks, Launch, Plan, in that order', () => {
    render(<SessionPanel state={panelState('inline')} />);
    const sections = screen.getByTestId('session-panel-sections');
    const rendered = Array.from(
      sections.querySelectorAll('[data-testid="session-panel-card-session"],[data-testid^="stub-"]'),
    ).map((el) => el.getAttribute('data-testid'));
    expect(rendered).toEqual([
      'session-panel-card-session',
      'stub-summary',
      'stub-prs',
      'stub-context',
      'stub-activity',
      'stub-tasks',
      'stub-launch',
      'stub-plan',
    ]);
  });

  it('puts the "Session" eyebrow and the stubbed SummarySection inside the session card', () => {
    render(<SessionPanel state={panelState('inline')} />);
    const card = screen.getByTestId('session-panel-card-session');
    expect(card).toHaveTextContent('Session');
    expect(card.querySelector('[data-testid="stub-summary"]')).not.toBeNull();
  });
});

describe('SessionPanel — section wiring', () => {
  it('passes the daemon port to SummarySection and LaunchSection', () => {
    render(<SessionPanel state={panelState('inline')} />);
    expect(callsFor('summary')[0]).toMatchObject({ port: 31415 });
    expect(callsFor('launch')[0]).toMatchObject({ port: 31415 });
  });

  it("derives ContextSection's open/onToggle from the state's context section", () => {
    const isSectionOpen = vi.fn((id: string) => id === 'context');
    render(<SessionPanel state={panelState('inline', { isSectionOpen })} />);
    expect(callsFor('context')[0]).toMatchObject({ port: 31415, open: true });
    (callsFor('context')[0] as { onToggle: () => void }).onToggle();
    expect(toggleSection).toHaveBeenCalledWith('context');
  });

  it("derives PlanSection's open/onToggle from the state's plan section", () => {
    const isSectionOpen = vi.fn((id: string) => id === 'plan');
    render(<SessionPanel state={panelState('inline', { isSectionOpen })} />);
    expect(callsFor('plan')[0]).toMatchObject({ open: true });
    (callsFor('plan')[0] as { onToggle: () => void }).onToggle();
    expect(toggleSection).toHaveBeenCalledWith('plan');
  });
});
