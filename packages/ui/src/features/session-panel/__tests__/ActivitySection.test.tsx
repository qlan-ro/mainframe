import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ActivityEntry } from '../activity-model';

const state = vi.hoisted(() => ({ entries: [] as ActivityEntry[], jump: vi.fn(), stop: vi.fn(), cancel: vi.fn() }));
vi.mock('../use-activity-entries', () => ({
  useActivityEntries: () => ({
    entries: state.entries,
    chatId: 'chat-1',
    adapterId: 'claude',
    now: 600_000,
    loadError: null,
  }),
}));
vi.mock('../activity-source', () => ({ jumpToActivitySource: state.jump }));
vi.mock('@/lib/api/background-tasks', () => ({
  stopBackgroundTask: state.stop,
  cancelDelegatedTask: state.cancel,
  readBackgroundTaskOutput: vi.fn(),
}));
vi.mock('@/features/chat/runtime/chat-extras', () => ({ useChatExtras: () => undefined }));
vi.mock('@assistant-ui/react', () => ({ useAui: () => ({ threads: { switchToThread: vi.fn() } }) }));
vi.mock('@/features/side-chat/side-chat-scope', () => ({ useSideAwareThreadId: () => 'parent' }));
vi.mock('@/features/chat/workflow/use-workflow-run', () => ({ useWorkflowRun: () => undefined }));
vi.mock('@/features/chat/zones/open-in-split', () => ({ openInSplit: vi.fn() }));

const { ActivitySection } = await import('../ActivitySection');
const row = (id: string, overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id,
  kind: 'subagent',
  title: id,
  detail: 'explorer',
  state: 'running',
  startedAt: 300_000,
  ...overrides,
});

beforeEach(() => {
  state.entries = [];
  vi.clearAllMocks();
});

describe('ActivitySection', () => {
  it('shows running and waiting counts and retains the empty section', () => {
    const view = render(<ActivitySection />);
    expect(screen.getByTestId('session-panel-activity-empty')).toHaveTextContent('Nothing running');
    state.entries = [row('agent'), row('schedule', { kind: 'scheduled', state: 'waiting' })];
    view.rerender(<ActivitySection />);
    expect(screen.getByTestId('session-panel-activity-counts')).toHaveTextContent('1 running · 1 waiting');
    expect(screen.getByText('Waiting')).toBeInTheDocument();
  });

  it('starts with Earlier collapsed, then previews and reveals all finished work', () => {
    state.entries = Array.from({ length: 8 }, (_, index) =>
      row(`done-${index}`, { state: 'completed', endedAt: index * 60_000 }),
    );
    render(<ActivitySection />);
    const earlier = screen.getByRole('button', { name: 'Earlier, 8 items' });
    expect(earlier).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('session-panel-activity-empty')).toBeNull();
    expect(screen.queryByTestId('session-panel-activity-done-7')).toBeNull();
    fireEvent.click(earlier);
    expect(earlier).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('session-panel-activity-done-7')).toBeInTheDocument();
    expect(screen.queryByTestId('session-panel-activity-done-0')).toBeNull();
    fireEvent.click(screen.getByText('Show all 8'));
    expect(screen.getByTestId('session-panel-activity-done-0')).toBeInTheDocument();
    fireEvent.click(earlier);
    expect(earlier).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('session-panel-activity-done-0')).toBeNull();
  });

  it('jumps from an Activity row to its tool call in the transcript', () => {
    state.entries = [row('agent', { source: { messageId: 'message-1', toolCallId: 'call-1' } })];
    render(<ActivitySection />);
    fireEvent.click(screen.getByRole('button', { name: 'Go to agent in transcript' }));
    expect(state.jump).toHaveBeenCalledWith('chat-1', { messageId: 'message-1', toolCallId: 'call-1' });
  });
});
