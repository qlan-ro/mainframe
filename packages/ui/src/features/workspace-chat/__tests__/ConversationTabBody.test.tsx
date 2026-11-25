/** A chat tab's body stays mounted behind another tab, so what it holds is not lost. */
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { RunTab } from '@/store/run-pane';

vi.mock('../ChatTabBody', () => ({
  ChatTabBody: ({ active }: { active: boolean }) => {
    const [text, setText] = useState('');
    return <input aria-label="Message" data-active={active} value={text} onChange={(e) => setText(e.target.value)} />;
  },
}));
vi.mock('../SideChatTabBody', () => ({
  SideChatTabBody: ({ active }: { active: boolean }) => <div data-testid="side" data-active={active} />,
}));
vi.mock('../SubagentTabBody', () => ({
  SubagentTabBody: ({ toolCallId, active }: { toolCallId: string; active: boolean }) => (
    <div data-testid={`agent-${toolCallId}`} data-active={active} />
  ),
}));

import { conversationProps, heldConversation, trackConversationFocus } from '@/lib/conversation-focus';
import { ConversationTabBody } from '../ConversationTabBody';

const fork: RunTab = { id: 'chat-f', kind: 'chat', title: 'Fork', chatId: 'f', role: 'fork' };
const field = () => screen.getByLabelText<HTMLInputElement>('Message');
const body = () => screen.getByTestId('workspace-conversation-chat-f');

it('keeps its content while another tab is in front, out of reach', () => {
  const { rerender } = render(<ConversationTabBody tab={fork} active />);
  fireEvent.change(field(), { target: { value: 'half a thought' } });

  rerender(<ConversationTabBody tab={fork} active={false} />);
  expect(body()).toHaveAttribute('inert');
  expect(body()).toHaveAttribute('data-conversation-tab', 'hidden');

  rerender(<ConversationTabBody tab={fork} active />);
  expect(body()).not.toHaveAttribute('inert');
  expect(field().value).toBe('half a thought');
});

it.each([
  ['a chat', fork, () => field()],
  ['a side chat', { ...fork, role: 'side' } as RunTab, () => screen.getByTestId('side')],
  [
    'an agent',
    { id: 'agent-c', kind: 'agent', title: 'Agent', chatId: 'p', toolCallId: 'c' } as RunTab,
    () => screen.getByTestId('agent-c'),
  ],
])('tells the body of %s whether it is in front', (_, tab, shown) => {
  const { rerender } = render(<ConversationTabBody tab={tab} active />);
  expect(shown()).toHaveAttribute('data-active', 'true');
  rerender(<ConversationTabBody tab={tab} active={false} />);
  expect(shown()).toHaveAttribute('data-active', 'false');
});

it('mounts nothing for a tab that was never shown', () => {
  render(<ConversationTabBody tab={fork} active={false} />);
  expect(screen.queryByLabelText('Message')).toBeNull();
});

it.each([
  [{ ...fork, role: 'side' } as RunTab, 'side'],
  [{ id: 'agent-c', kind: 'agent', title: 'Agent', chatId: 'p', toolCallId: 'c' } as RunTab, 'agent-c'],
])('shows what the tab is', (tab, testId) => {
  render(<ConversationTabBody tab={tab} active />);
  expect(screen.getByTestId(testId)).toBeInTheDocument();
});

it.each([
  [{ ...fork, chatId: undefined }, 'Fork: no chat to show'],
  [{ id: 'agent-c', kind: 'agent', title: 'Agent', chatId: 'p' } as RunTab, 'Agent: no agent to show'],
])('says so for a corrupt remembered tab', (tab, text) => {
  render(<ConversationTabBody tab={tab} active />);
  expect(screen.getByText(text)).toBeInTheDocument();
});

it.each([
  ['a chat', fork, 'f'],
  ['a side chat', { ...fork, role: 'side' } as RunTab, 'f'],
  [
    'no conversation, an agent',
    { id: 'agent-c', kind: 'agent', title: 'A', chatId: 'p', toolCallId: 'c' } as RunTab,
    null,
  ],
])('is, to the focus, %s', (_, tab, held) => {
  const untrack = trackConversationFocus();
  render(
    <>
      <div data-testid="other" tabIndex={-1} />
      <div {...conversationProps('main')} tabIndex={-1} data-testid="main" />
      <ConversationTabBody tab={tab} active />
    </>,
  );
  act(() => screen.getByTestId('main').focus());
  expect(heldConversation()).toBe('main');
  act(() => screen.getByTestId(`workspace-conversation-${tab.id}`).focus());
  expect(heldConversation()).toBe(held);
  act(() => screen.getByTestId('other').focus());
  expect(heldConversation()).toBeNull();
  untrack();
});
