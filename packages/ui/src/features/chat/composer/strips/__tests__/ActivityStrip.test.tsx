/**
 * ActivityStrip (K4, K5, K10) — the session's ongoing work above the card:
 * every item a row, a chevron folds them to one and the choice is remembered;
 * while a request shows above the composer the strip steps back to one line
 * ("Also ongoing") and leaves out the item being answered.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ActivityEntry } from '@/features/session-panel/activity-model';
import { useUiPrefs } from '@/store/ui-prefs';

const threads = { getState: vi.fn() };
vi.mock('@assistant-ui/react', () => ({ useAui: () => ({ threads }) }));
const openTaskTab = vi.fn();
vi.mock('@/features/workspace-chat/open-session', () => ({ openTaskTab: (...a: unknown[]) => openTaskTab(...a) }));
const openSubagentTab = vi.fn();
vi.mock('@/features/workspace-chat/conversation-tabs', () => ({
  openSubagentTab: (...a: unknown[]) => openSubagentTab(...a),
}));
const jumpToActivitySource = vi.fn().mockResolvedValue('shown');
const cancelActivityJump = vi.fn();
vi.mock('@/features/session-panel/activity-source', () => ({
  jumpToActivitySource: (...a: unknown[]) => jumpToActivitySource(...a),
  cancelActivityJump: () => cancelActivityJump(),
}));
vi.mock('@/lib/api/background-tasks', () => ({
  stopBackgroundTask: vi.fn().mockResolvedValue(undefined),
  cancelDelegatedTask: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/toast', () => ({ mfToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

let mockActivity: { entries: ActivityEntry[]; chatId: string | null; adapterId: string | undefined; now: number };
vi.mock('@/features/session-panel/use-activity-entries', () => ({ useActivityEntries: () => mockActivity }));

type Front = { entry: { requestId: string }; from: { matches: (e: ActivityEntry) => boolean } | null };
let mockGates: { front: Front | undefined; more: number; waitingCalls: ReadonlySet<string> };
vi.mock('../../../gates/use-gate-queue', () => ({ useGateQueue: () => mockGates }));

import { cancelDelegatedTask, stopBackgroundTask } from '@/lib/api/background-tasks';
import { mfToast } from '@/lib/toast';
import { ActivityStrip } from '../ActivityStrip';

const NOW = 100_000;

function entry(id: string, overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    id,
    kind: 'subagent',
    title: `Title ${id}`,
    detail: '',
    state: 'running',
    startedAt: NOW - 5_000,
    ...overrides,
  };
}

const renderStrip = () =>
  render(
    <TooltipProvider>
      <ActivityStrip />
    </TooltipProvider>,
  );
const rowIds = () => screen.getAllByRole('listitem').map((el) => el.dataset.testid);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useUiPrefs.setState({ activityStripCollapsed: false });
  mockActivity = { entries: [], chatId: 'chat-1', adapterId: 'claude', now: NOW };
  mockGates = { front: undefined, more: 0, waitingCalls: new Set() };
});

describe('ActivityStrip — rows', () => {
  it('renders nothing with no ongoing work', () => {
    const { container } = renderStrip();

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when only finished work and wake-ups exist', () => {
    mockActivity.entries = [
      entry('done', { state: 'completed' }),
      entry('wake', { kind: 'scheduled', state: 'scheduled' }),
    ];

    const { container } = renderStrip();

    expect(container).toBeEmptyDOMElement();
  });

  it('lists running items oldest first, with elapsed time', () => {
    mockActivity.entries = [entry('late', { startedAt: NOW - 2_000 }), entry('early', { startedAt: NOW - 65_000 })];

    renderStrip();

    expect(rowIds()).toEqual(['composer-activity-early', 'composer-activity-late']);
    expect(screen.getByTestId('composer-activity-early')).toHaveTextContent('Title early');
    expect(screen.getByTestId('composer-activity-early')).toHaveTextContent('1m');
  });

  it('puts an item that needs the user first, with "needs you" and Open instead of a timer', () => {
    mockActivity.entries = [
      entry('busy', { startedAt: NOW - 90_000 }),
      entry('asking', {
        startedAt: NOW - 1_000,
        state: 'needs-you',
        delegated: { taskId: 't1', itemId: 'child-1', title: 'Asking', status: 'running', waiting: true, updatedAt: 0 },
      }),
    ];

    renderStrip();

    expect(rowIds()).toEqual(['composer-activity-asking', 'composer-activity-busy']);
    const asking = screen.getByTestId('composer-activity-asking');
    expect(asking).toHaveAttribute('data-needs-you', 'true');
    expect(asking).toHaveTextContent('needs you');
    expect(within(asking).getByTestId('composer-activity-open')).toHaveTextContent('Open');
  });

  it('shows a queued delegated task as "queued", with no timer', () => {
    mockActivity.entries = [
      entry('line', {
        state: 'queued',
        delegated: { taskId: 't1', itemId: 'c', title: 'T', status: 'queued', waiting: false, updatedAt: 0 },
      }),
    ];

    renderStrip();

    expect(screen.getByTestId('composer-activity-line')).toHaveTextContent('queued');
  });

  it('Open on a delegated task opens its chat in the workspace, and leaves the keyboard here', () => {
    mockActivity.entries = [
      entry('asking', {
        state: 'needs-you',
        delegated: { taskId: 't1', itemId: 'child-1', title: 'A', status: 'running', waiting: true, updatedAt: 0 },
      }),
    ];
    renderStrip();

    fireEvent.click(screen.getByTestId('composer-activity-open'));

    expect(openTaskTab).toHaveBeenCalledExactlyOnceWith(threads, 'child-1');
    // A jump still on its way would move the transcript behind it.
    expect(cancelActivityJump).toHaveBeenCalledBefore(openTaskTab);
  });

  it('Open on a sub-agent opens its tab, and leaves the keyboard here', () => {
    mockActivity.entries = [entry('sub', { source: { messageId: 'm1', toolCallId: 'call-1' }, title: 'Sub' })];
    mockGates = { front: undefined, more: 0, waitingCalls: new Set(['call-1']) };
    renderStrip();

    fireEvent.click(screen.getByTestId('composer-activity-open'));

    expect(openSubagentTab).toHaveBeenCalledExactlyOnceWith({
      chatId: 'chat-1',
      toolCallId: 'call-1',
      messageId: 'm1',
      title: 'Sub',
    });
    expect(jumpToActivitySource).not.toHaveBeenCalled();
  });

  it('Open on anything else jumps to its place in the transcript', () => {
    mockActivity.entries = [entry('run', { kind: 'command', state: 'needs-you', source: { toolCallId: 'call-1' } })];
    renderStrip();

    fireEvent.click(screen.getByTestId('composer-activity-open'));

    expect(jumpToActivitySource).toHaveBeenCalledExactlyOnceWith('chat-1', { toolCallId: 'call-1' });
  });

  const openCommandRow = async () => {
    mockActivity.entries = [
      entry('run', { kind: 'command', state: 'needs-you', source: { toolCallId: 'call-1' }, title: 'Sub' }),
    ];
    renderStrip();
    fireEvent.click(screen.getByTestId('composer-activity-open'));
    await act(async () => {});
  };

  it('Open says so when the history does not hold it', async () => {
    jumpToActivitySource.mockResolvedValueOnce('missing');
    await openCommandRow();

    expect(mfToast.info).toHaveBeenCalledExactlyOnceWith('“Sub” started before the history shown here');
  });

  it('Open says nothing for a jump something else replaced', async () => {
    jumpToActivitySource.mockResolvedValueOnce('superseded');
    await openCommandRow();

    expect(mfToast.info).not.toHaveBeenCalled();
    expect(mfToast.error).not.toHaveBeenCalled();
  });

  it('Open says when the history could not be loaded', async () => {
    jumpToActivitySource.mockRejectedValueOnce(new Error('offline'));
    await openCommandRow();

    expect(mfToast.error).toHaveBeenCalledExactlyOnceWith('Could not load the message', { description: 'offline' });
  });

  it('a delegated task carries the panel’s filled robot', () => {
    mockActivity.entries = [entry('d', { kind: 'delegated' })];
    renderStrip();

    expect(screen.getByTestId('composer-activity-d').querySelector('.lucide-bot-filled')).not.toBeNull();
  });

  it('sends one Stop until it takes effect, and keeps the button’s focus', async () => {
    mockActivity.entries = [entry('a', { task: { id: 'bg-1', kind: 'agent' } as never })];
    renderStrip();
    const stop = screen.getByTestId('composer-activity-stop');
    stop.focus();

    fireEvent.click(stop);
    await act(async () => {});
    fireEvent.click(stop);

    expect(stopBackgroundTask).toHaveBeenCalledTimes(1);
    expect(stop).toHaveAttribute('aria-disabled', 'true');
    expect(stop).toHaveAccessibleName('Stopping Title a');
    expect(stop).toHaveFocus();
  });

  it('Stop on a delegated task cancels it, with no confirmation', () => {
    mockActivity.entries = [
      entry('d', {
        delegated: { taskId: 't9', itemId: 'c', title: 'D', status: 'running', waiting: false, updatedAt: 0 },
      }),
    ];
    renderStrip();

    fireEvent.click(screen.getByTestId('composer-activity-stop'));

    expect(cancelDelegatedTask).toHaveBeenCalledExactlyOnceWith('chat-1', 't9');
  });

  it('Stop on a background agent stops that task when the adapter can', () => {
    mockActivity.entries = [entry('a', { task: { id: 'bg-1', kind: 'agent' } as never })];
    renderStrip();

    fireEvent.click(screen.getByTestId('composer-activity-stop'));

    expect(stopBackgroundTask).toHaveBeenCalledExactlyOnceWith('chat-1', 'bg-1');
  });

  it('offers no Stop for a task on an adapter that cannot stop one', () => {
    mockActivity.adapterId = 'codex';
    mockActivity.entries = [entry('a', { task: { id: 'bg-1', kind: 'agent' } as never })];
    renderStrip();

    expect(screen.queryByTestId('composer-activity-stop')).toBeNull();
  });
});

describe('ActivityStrip — fold (K5)', () => {
  beforeEach(() => {
    mockActivity.entries = [
      entry('a', { startedAt: NOW - 30_000 }),
      entry('b', { startedAt: NOW - 20_000 }),
      entry('c', { startedAt: NOW - 10_000 }),
    ];
  });

  it('shows every row expanded by default, with a "Collapse to one row" chevron on the first', () => {
    renderStrip();

    expect(rowIds()).toEqual(['composer-activity-a', 'composer-activity-b', 'composer-activity-c']);
    expect(screen.getByTestId('composer-activity-toggle')).toHaveAttribute('aria-label', 'Collapse to one row');
    expect(screen.getByTestId('composer-activity-toggle')).toHaveAttribute('aria-expanded', 'true');
  });

  it('folds to the first row and says how many are hidden', () => {
    renderStrip();

    fireEvent.click(screen.getByTestId('composer-activity-toggle'));

    expect(rowIds()).toEqual(['composer-activity-a']);
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(screen.getByTestId('composer-activity-toggle')).toHaveAttribute('aria-label', 'Show all 3 ongoing items');
    expect(useUiPrefs.getState().activityStripCollapsed).toBe(true);
  });

  it('expands again from the folded row', () => {
    useUiPrefs.setState({ activityStripCollapsed: true });
    renderStrip();

    fireEvent.click(screen.getByTestId('composer-activity-toggle'));

    expect(rowIds()).toHaveLength(3);
    expect(useUiPrefs.getState().activityStripCollapsed).toBe(false);
  });

  it('remembers a fold from an earlier session', () => {
    useUiPrefs.setState({ activityStripCollapsed: true });

    renderStrip();

    expect(rowIds()).toEqual(['composer-activity-a']);
  });

  it('has no fold control for a single item', () => {
    mockActivity.entries = [entry('only')];
    renderStrip();

    expect(screen.queryByTestId('composer-activity-toggle')).toBeNull();
  });

  it('a lone item stays one row even when the fold preference is on', () => {
    useUiPrefs.setState({ activityStripCollapsed: true });
    mockActivity.entries = [entry('only')];
    renderStrip();

    expect(rowIds()).toEqual(['composer-activity-only']);
    expect(screen.queryByText(/^\+\d/)).toBeNull();
  });
});

describe('ActivityStrip — while a request shows above the composer (K10)', () => {
  const askedBy = (id: string): Front => ({
    entry: { requestId: 'req-1' },
    from: { matches: (e) => e.id === id },
  });

  beforeEach(() => {
    mockActivity.entries = [
      entry('a'),
      entry('b'),
      entry('waiting', {
        state: 'needs-you',
        delegated: { taskId: 't1', itemId: 'c', title: 'W', status: 'running', waiting: true, updatedAt: 0 },
      }),
    ];
  });

  it('steps back to one "Also ongoing" line with the running count and waiting count', () => {
    mockGates = { front: askedBy('nothing'), more: 0, waitingCalls: new Set() };

    renderStrip();

    const summary = screen.getByTestId('composer-activity-summary');
    expect(summary).toHaveTextContent('Also ongoing');
    expect(summary).toHaveTextContent('2 running');
    expect(summary).toHaveTextContent('1 more needs you');
    expect(rowIds()).toEqual(['composer-activity-summary']);
  });

  it('leaves out the item that is asking', () => {
    mockGates = { front: askedBy('waiting'), more: 0, waitingCalls: new Set() };

    renderStrip();

    const summary = screen.getByTestId('composer-activity-summary');
    expect(summary).toHaveTextContent('2 running');
    expect(summary).not.toHaveTextContent('needs you');
  });

  it('shows nothing when the only item is the one asking', () => {
    mockActivity.entries = [entry('asker')];
    mockGates = { front: askedBy('asker'), more: 0, waitingCalls: new Set() };

    const { container } = renderStrip();

    expect(container).toBeEmptyDOMElement();
  });

  it('says "Show N ongoing items" and unfolds the full list for this request', () => {
    mockGates = { front: askedBy('nothing'), more: 0, waitingCalls: new Set() };
    renderStrip();

    const toggle = screen.getByTestId('composer-activity-gate-toggle');
    expect(toggle).toHaveAttribute('aria-label', 'Show 3 ongoing items');
    fireEvent.click(toggle);

    expect(rowIds()).toEqual(['composer-activity-waiting', 'composer-activity-a', 'composer-activity-b']);
    expect(screen.getByTestId('composer-activity-gate-toggle')).toHaveAttribute('aria-label', 'Collapse to one line');
  });

  it('folds back to one line when collapsed again', () => {
    mockGates = { front: askedBy('nothing'), more: 0, waitingCalls: new Set() };
    renderStrip();
    fireEvent.click(screen.getByTestId('composer-activity-gate-toggle'));

    fireEvent.click(screen.getByTestId('composer-activity-gate-toggle'));

    expect(screen.getByTestId('composer-activity-summary')).toBeInTheDocument();
  });

  it('does not touch the remembered fold preference', () => {
    mockGates = { front: askedBy('nothing'), more: 0, waitingCalls: new Set() };
    renderStrip();

    fireEvent.click(screen.getByTestId('composer-activity-gate-toggle'));

    expect(useUiPrefs.getState().activityStripCollapsed).toBe(false);
  });
});
