/** The keyboard follows a chat or agent tab whose opener goes away, and stays with one that doesn't. */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetSideChatRegistryForTests } from '@/features/side-chat/side-chat-ids';
import type { ActivityEntry } from '@/features/session-panel/activity-model';
import { selectOverlayOpen, usePanelControl } from '@/features/session-panel/panel-control-store';
import { useActivityActions } from '@/features/session-panel/use-activity-actions';
import { useLayoutStore } from '@/store/layout';

const threads = {
  getState: () => ({
    mainThreadId: 'main',
    threadItems: [{ id: 'kid', remoteId: 'kid', status: 'regular', title: 'Task', custom: { delegation: {} } }],
  }),
  switchToThread: vi.fn(),
};
vi.mock('@assistant-ui/react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@assistant-ui/react')>()),
  useAui: () => ({ threads }),
}));
const composer = vi.hoisted(() => ({ takesFocus: false }));
vi.mock('../ChatTabBody', () => ({
  ChatTabBody: () => (
    <div data-testid="chat-viewport" data-mf-chat-thread tabIndex={-1}>
      <textarea aria-label="Message" autoFocus={composer.takesFocus} />
    </div>
  ),
}));
vi.mock('../SideChatTabBody', () => ({ SideChatTabBody: () => null }));
vi.mock('../SubagentTabBody', () => ({
  SubagentTabBody: ({ toolCallId }: { toolCallId: string }) =>
    toolCallId === 'bare' ? (
      <p>Nothing to scroll</p>
    ) : (
      <div data-testid="agent" data-conversation-scroller tabIndex={-1} />
    ),
}));

import { ConversationTabBody } from '../ConversationTabBody';
import { openChatTab, openSubagentTab } from '../conversation-tabs';

const entry = (overrides: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 'r',
  kind: 'subagent',
  title: 'Review',
  detail: '',
  state: 'completed',
  startedAt: 1,
  source: { toolCallId: 'call-1', messageId: 'm-1' },
  ...overrides,
});
const task = entry({ kind: 'delegated', delegated: { itemId: 'kid', taskId: 't' } as never });

function Row({ row }: { row: ActivityEntry }) {
  const jumps = { jump: vi.fn(), cancel: vi.fn() };
  const { onActivate } = useActivityActions(row, { chatId: 'main', columnId: 'main', jumps });
  return <button onClick={onActivate}>Row</button>;
}

/** The floating panel over the chat column, a transcript row in it, and the workspace beside. */
function Window({ row = entry() }: { row?: ActivityEntry }) {
  const floating = usePanelControl(selectOverlayOpen('main'));
  const panes = useLayoutStore((s) => s.run?.panes);
  return (
    <>
      {floating && <Row row={row} />}
      <button onClick={() => openSubagentTab({ chatId: 'main', toolCallId: 'call-1', title: 'Review' })}>
        Transcript
      </button>
      <button onClick={() => openChatTab({ chatId: 'other', role: 'session', title: 'Other' })}>Strip</button>
      {panes?.flatMap((pane) =>
        pane.tabs.map((tab) => <ConversationTabBody key={tab.id} tab={tab} active={tab.id === pane.active} />),
      )}
    </>
  );
}

function press(name: string) {
  const button = screen.getByRole('button', { name });
  act(() => button.focus());
  fireEvent.click(button);
  return button;
}

beforeEach(() => {
  composer.takesFocus = false;
  __resetSideChatRegistryForTests();
  usePanelControl.setState({ overlayOpen: { main: true } });
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: 'main',
  });
});

describe('from the floating session panel', () => {
  it('goes to a sub-agent’s steps', () => {
    render(<Window />);
    press('Row');
    expect(screen.queryByRole('button', { name: 'Row' })).toBeNull();
    expect(screen.getByTestId('agent')).toHaveFocus();
  });

  it('goes to a tab that was already open behind another', () => {
    openSubagentTab({ chatId: 'main', toolCallId: 'call-1', title: 'Review' });
    openChatTab({ chatId: 'other', role: 'session', title: 'Other' });
    render(<Window />);
    press('Row');
    expect(screen.getByTestId('agent')).toHaveFocus();
  });

  it('goes to a tab that was already in front', () => {
    openSubagentTab({ chatId: 'main', toolCallId: 'call-1', title: 'Review' });
    render(<Window />);
    press('Row');
    expect(screen.getByTestId('agent')).toHaveFocus();
  });

  it('goes to a delegated task’s transcript', () => {
    render(<Window row={task} />);
    press('Row');
    expect(screen.getByTestId('chat-viewport')).toHaveFocus();
  });

  it('leaves it in the composer that took it on opening', () => {
    composer.takesFocus = true;
    render(<Window row={task} />);
    press('Row');
    expect(screen.getByLabelText('Message')).toHaveFocus();
  });

  it('goes to the body itself while it has nothing to scroll', () => {
    render(<Window row={entry({ source: { toolCallId: 'bare' } })} />);
    press('Row');
    expect(screen.getByTestId('workspace-conversation-agent-bare')).toHaveFocus();
  });

  it('is asked for once: the same tab opened again from the transcript leaves it there', () => {
    render(<Window />);
    press('Row');
    const transcript = press('Transcript');
    expect(transcript).toHaveFocus();
  });
});

describe('from what stays on screen', () => {
  it.each(['Transcript', 'Strip'])('stays on the %s', (name) => {
    render(<Window />);
    expect(press(name)).toHaveFocus();
  });
});

describe('unclaimed keyboard handoff', () => {
  const target = { chatId: 'main', toolCallId: 'call-1', title: 'Review' };

  it('does not move focus on a later open of the same tab', () => {
    openSubagentTab(target, { focus: true });
    render(<button onClick={() => openSubagentTab(target)}>Open elsewhere</button>);
    const opener = press('Open elsewhere');
    render(<Window />);
    expect(opener).toHaveFocus();
  });

  it('does not move focus after the handoff expires', () => {
    vi.useFakeTimers();
    try {
      openSubagentTab(target, { focus: true });
      act(() => vi.advanceTimersByTime(1000));
      render(<Window />);
      expect(screen.getByTestId('agent')).not.toHaveFocus();
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the request when its opener disappears before the tab mounts', async () => {
    const view = render(<button onClick={() => openSubagentTab(target, { focus: true })}>Temporary</button>);
    press('Temporary');
    view.unmount();
    await act(async () => undefined);
    render(<Window />);
    expect(screen.getByTestId('agent')).not.toHaveFocus();
  });

  it('drops the request when another tab becomes active', () => {
    openChatTab({ chatId: 'other', role: 'session', title: 'Other' });
    openSubagentTab(target, { focus: true });
    const initial = useLayoutStore.getState().run!;
    const switched = { ...initial, panes: initial.panes.map((pane) => ({ ...pane, active: 'chat-other' })) };
    useLayoutStore.setState({ run: switched });
    useLayoutStore.setState({ run: initial });
    render(<Window />);
    expect(screen.getByTestId('agent')).not.toHaveFocus();
  });

  it('gives focus to the latest of two opens', () => {
    openSubagentTab(target, { focus: true });
    openChatTab({ chatId: 'other', role: 'session', title: 'Other' }, 'main', { focus: true });
    render(<Window />);
    expect(screen.getByTestId('chat-viewport')).toHaveFocus();
  });
});
