import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (select: (state: unknown) => unknown) =>
    select({ threadListItem: { id: 'chat-1', title: 'Test session' } }),
}));
vi.mock('@/features/side-chat/SideChatToggle', () => ({
  SideChatToggle: () => <button data-testid="side-chat-toggle" />,
}));
vi.mock('@/features/session-panel/SessionPanelToggle', () => ({
  SessionPanelToggle: () => <button data-testid="session-panel-toggle" />,
}));
vi.mock('../ChatHeaderParentLink', () => ({ ChatHeaderParentLink: () => null }));
vi.mock('../../orchestration/ChatHeaderTasksChip', () => ({ ChatHeaderTasksChip: () => null }));

import { ChatColumnHeader } from '../ChatColumnHeader';

it('places the side chat button immediately before the session panel button', () => {
  render(<ChatColumnHeader columnId="main" toggleTestId="session-panel-toggle" />);

  const sideChat = screen.getByTestId('side-chat-toggle');
  const panel = screen.getByTestId('session-panel-toggle');
  expect(sideChat.nextElementSibling).toBe(panel);
});
