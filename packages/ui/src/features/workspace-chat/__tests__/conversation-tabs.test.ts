/** Opening and closing chat and agent tabs: one tab per conversation, never a copy of the chat column's own. */
import { beforeEach, describe, expect, it } from 'vitest';
import { useLayoutStore } from '@/store/layout';
import { closeChatTab, findChatTab, openChatTab, openSubagentTab, sessionRun } from '../conversation-tabs';

const tabs = () => useLayoutStore.getState().run?.panes.flatMap((p) => p.tabs) ?? [];
const front = () => useLayoutStore.getState().run?.panes[0]?.active;

beforeEach(() => {
  useLayoutStore.setState({
    layout: { top: ['chat'], topFlex: {} },
    run: null,
    sessions: new Map(),
    activeSessionId: 'main',
  });
});

describe('openChatTab', () => {
  it('shows a chat beside the session and lights the workspace', () => {
    expect(openChatTab({ chatId: 'fork-1', role: 'fork', title: 'Fork' })).toBe(true);
    expect(tabs()).toEqual([{ id: 'chat-fork-1', kind: 'chat', title: 'Fork', chatId: 'fork-1', role: 'fork' }]);
    expect(useLayoutStore.getState().layout.top).toEqual(['chat', 'workspace']);
  });

  it('brings its tab to the front the second time', () => {
    openChatTab({ chatId: 'fork-1', role: 'fork', title: 'Fork' });
    openChatTab({ chatId: 'fork-2', role: 'fork', title: 'Other' });
    openChatTab({ chatId: 'fork-1', role: 'fork', title: 'Fork' });
    expect(tabs().map((t) => t.chatId)).toEqual(['fork-1', 'fork-2']);
    expect(front()).toBe('chat-fork-1');
  });

  it('does not open the conversation beside itself', () => {
    expect(openChatTab({ chatId: 'main', role: 'session', title: 'Main' })).toBe(false);
    expect(tabs()).toEqual([]);
  });

  it('opens in another session’s workspace when told to, off screen', () => {
    openChatTab({ chatId: 'side-1', role: 'side', title: 'Side chat' }, 'other');
    expect(tabs()).toEqual([]);
    expect(findChatTab(sessionRun('other'), 'side-1')?.tab.role).toBe('side');
  });
});

describe('openSubagentTab', () => {
  it('reuses the tab of the same agent, and opens another for a second one', () => {
    const agent = { chatId: 'main', messageId: 'm-1', title: 'reviewer' };
    openSubagentTab({ ...agent, toolCallId: 'call-1' });
    openSubagentTab({ ...agent, toolCallId: 'call-2' });
    openSubagentTab({ ...agent, toolCallId: 'call-1' });
    expect(tabs().map((t) => t.toolCallId)).toEqual(['call-1', 'call-2']);
    expect(front()).toBe('agent-call-1');
  });
});

describe('closeChatTab', () => {
  it('takes the tab away and collapses an emptied workspace', () => {
    openChatTab({ chatId: 'fork-1', role: 'fork', title: 'Fork' });
    closeChatTab('fork-1');
    expect(tabs()).toEqual([]);
    expect(useLayoutStore.getState().layout.top).toEqual(['chat']);
  });

  it('is inert for a chat with no tab', () => {
    openChatTab({ chatId: 'fork-1', role: 'fork', title: 'Fork' });
    closeChatTab('fork-9');
    expect(tabs()).toHaveLength(1);
  });
});
