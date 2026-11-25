/**
 * SessionPanel — unit tests.
 *
 * Behaviors covered:
 *  - the mode decides the presentation: `inline` docks an aside beside the
 *    transcript, `overlay` floats the same card as a dialog over a scrim, and
 *    `hidden` renders nothing
 *  - the "Session" title and its Sections menu, which turns sections on and
 *    off for this viewer
 *  - the section order, and only project-level sections before the first
 *    message
 *  - the floating panel ends above the composer
 *
 * Every section is stubbed; each owns its own test file.
 */
import { createRef } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, render as rtlRender, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { DaemonPortProvider } from '@/features/sessions/runtime/daemon-port-context';
import type { SessionPanelState } from '../use-session-panel-state';
import { useUiPrefs } from '@/store/ui-prefs';
import type { PanelMode } from '../panel-mode';

const sectionCalls: Record<string, unknown[]> = {};
function sectionStub(id: string) {
  sectionCalls[id] = [];
  return (props: unknown) => {
    sectionCalls[id]!.push(props);
    return <div data-testid={`stub-${id}`} />;
  };
}

vi.mock('../PullRequestsSection', () => ({ PullRequestsSection: sectionStub('prs') }));
vi.mock('../ContextSections', () => ({
  SessionContextProvider: ({ children }: { children: ReactNode }) => children,
  MemorySection: sectionStub('memory'),
  MentionsSection: sectionStub('mentions'),
  SkillsSection: sectionStub('skills'),
  AttachmentsSection: sectionStub('attachments'),
}));

let mockChatId: string | undefined = 'chat-9';
vi.mock('@/features/sessions/use-active-identity', () => ({ useActiveIdentity: () => ({ chatId: mockChatId }) }));
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
  mockChatId = 'chat-9';
  useUiPrefs.setState({ sessionPanelHiddenSections: [] });
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
    expect(screen.getByTestId('session-panel').style.width).toBe('300px');
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

const shownSections = () =>
  Array.from(screen.getByTestId('session-panel-sections').querySelectorAll('[data-testid^="stub-"]')).map((el) =>
    el.getAttribute('data-testid')!.replace('stub-', ''),
  );

describe('SessionPanel — sections', () => {
  it('titles the panel and lists every section in order', () => {
    render(<SessionPanel state={panelState('inline')} />);
    expect(screen.getByRole('heading', { name: 'Session' })).toBeInTheDocument();
    expect(shownSections()).toEqual([
      'prs',
      'plan',
      'activity',
      'launch',
      'memory',
      'mentions',
      'skills',
      'attachments',
      'tasks',
    ]);
  });

  it('shows only project-level sections before the first message', () => {
    mockChatId = undefined;
    render(<SessionPanel state={panelState('inline')} />);
    expect(shownSections()).toEqual(['memory', 'skills', 'tasks']);
  });

  it('turns a section off and on from the Sections menu, which stays open', async () => {
    const user = userEvent.setup();
    render(<SessionPanel state={panelState('inline')} />);
    await user.click(screen.getByRole('button', { name: 'Sections' }));
    expect(screen.getAllByRole('menuitemcheckbox').map((item) => item.textContent)).toEqual([
      'Pull requests',
      'Plan',
      'Activity',
      'Launch',
      'Memory files',
      'Mentioned files',
      'Skills',
      'Attachments',
      'Project tasks',
    ]);
    const launch = screen.getByRole('menuitemcheckbox', { name: 'Launch' });
    expect(launch).toBeChecked();

    await user.click(launch);
    expect(shownSections()).not.toContain('launch');
    expect(screen.getByRole('menuitemcheckbox', { name: 'Launch' })).not.toBeChecked();

    await user.click(screen.getByRole('menuitemcheckbox', { name: 'Launch' }));
    expect(shownSections()).toContain('launch');
  });

  it('says so when every section is off', () => {
    mockChatId = undefined;
    useUiPrefs.setState({ sessionPanelHiddenSections: ['memory', 'skills', 'tasks'] });
    render(<SessionPanel state={panelState('inline')} />);
    expect(screen.getByTestId('session-panel-none')).toHaveTextContent('Every section is turned off');
  });
});

describe('SessionPanel — floating above the composer', () => {
  const rect = (top: number, bottom: number) => ({ top, bottom, height: bottom - top }) as DOMRect;

  it('ends 8px above the column footer, scrim included', () => {
    const { rerender } = render(
      <div data-chat-column>
        <div data-chat-footer />
      </div>,
    );
    const measured = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.hasAttribute('data-chat-column')) return rect(0, 800);
      if (this.hasAttribute('data-chat-footer')) return rect(640, 800);
      return rect(0, 0);
    });
    act(() =>
      rerender(
        <div data-chat-column>
          <div data-chat-footer />
          <SessionPanel state={panelState('overlay')} />
        </div>,
      ),
    );
    expect(screen.getByTestId('session-panel-root').style.bottom).toBe('168px');
    measured.mockRestore();
  });
});

describe('SessionPanel — section wiring', () => {
  it('passes the daemon port to the sections that need it', () => {
    render(<SessionPanel state={panelState('inline')} />);
    expect(callsFor('launch')[0]).toMatchObject({ port: 31415 });
    expect(callsFor('attachments')[0]).toMatchObject({ port: 31415 });
  });

  it("derives PlanSection's open/onToggle from the state's plan section", () => {
    const isSectionOpen = vi.fn((id: string) => id === 'plan');
    render(<SessionPanel state={panelState('inline', { isSectionOpen })} />);
    expect(callsFor('plan')[0]).toMatchObject({ open: true });
    (callsFor('plan')[0] as { onToggle: () => void }).onToggle();
    expect(toggleSection).toHaveBeenCalledWith('plan');
  });
});
