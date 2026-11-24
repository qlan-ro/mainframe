/** A chat tab's body stays mounted behind another tab, so what it holds is not lost. */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { RunTab } from '@/store/run-pane';

vi.mock('../ChatTabBody', () => ({
  ChatTabBody: ({ active }: { active: boolean }) => {
    const [text, setText] = useState('');
    return <input aria-label="Message" data-active={active} value={text} onChange={(e) => setText(e.target.value)} />;
  },
}));
vi.mock('../SideChatTabBody', () => ({ SideChatTabBody: () => <div data-testid="side" /> }));
vi.mock('../SubagentTabBody', () => ({
  SubagentTabBody: ({ toolCallId }: { toolCallId: string }) => <div data-testid={`agent-${toolCallId}`} />,
}));

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
