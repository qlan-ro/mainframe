import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { expect, it, vi } from 'vitest';
import type { AcpChatController } from '@/features/chat/controller/acp-chat-controller';
import { shortcutAction, useShortcutAction } from '@/features/shortcuts/action-store';
import { SubagentFind } from '../SubagentFind';

it('runs the Find shortcut inside the agent and leaves the chat shortcut available outside it', async () => {
  const mainFind = vi.fn();
  const search = vi.fn().mockResolvedValue({
    total: 1,
    matches: [{ containerId: 'old-step', itemId: 'child-text', occurrence: 0 }],
  });
  const controller = { subagentHistory: { search } } as unknown as AcpChatController;
  function Fixture() {
    const root = useRef<HTMLDivElement>(null);
    useShortcutAction('chat.find', mainFind);
    return (
      <>
        <button>Parent chat</button>
        <div ref={root} tabIndex={0} aria-label="Agent tab">
          <SubagentFind controller={controller} agentId="tool-child" chatId="parent" root={root} active />
        </div>
      </>
    );
  }

  render(<Fixture />);
  screen.getByRole('button', { name: 'Parent chat' }).focus();
  act(() => shortcutAction('chat.find')?.(0));
  expect(mainFind).toHaveBeenCalledTimes(1);
  screen.getByLabelText('Agent tab').focus();
  act(() => shortcutAction('chat.find')?.(0));
  const input = screen.getByRole('searchbox', { name: 'Find in sub-agent' });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'older match' } });
  expect(await screen.findByText('1/1')).toBeVisible();
  expect(search).toHaveBeenCalledExactlyOnceWith('tool-child', 'older match');
  expect(mainFind).toHaveBeenCalledTimes(1);
});
