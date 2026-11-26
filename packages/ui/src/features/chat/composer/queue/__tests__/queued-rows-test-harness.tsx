import { vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { QueuedMessageRef } from '@qlan-ro/mainframe-types';
import { TooltipProvider } from '@/components/ui/tooltip';

export const composer = { getState: () => ({ text: 'draft' }), setText: vi.fn() };
export const mockChat = { transcriptIds: [] as string[], queued: {} as Record<string, QueuedMessageRef> };
vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({ composer }),
  useAuiState: (select: (s: { thread: { messages: { id: string }[] } }) => unknown) =>
    select({ thread: { messages: mockChat.transcriptIds.map((id) => ({ id })) } }),
}));

export const cancelQueued = vi.fn().mockResolvedValue(undefined);
export const editQueued = vi.fn().mockResolvedValue(undefined);
export const sendHeld = vi.fn().mockResolvedValue(undefined);
const resumeQueuedMessages = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const confirmQueuedMessage = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const cancelQueuedMessage = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('@/lib/api/chats', () => ({
  cancelQueuedMessage,
  confirmQueuedMessage,
  resumeQueuedMessages,
}));
vi.mock('../../../runtime/chat-extras', () => ({
  useChatExtras: () => ({
    queued: mockChat.queued,
    port: 4200,
    state: { chatId: 'chat-1' },
    cancelQueued,
    editQueued,
    sendHeld,
  }),
}));

export const startEdit = vi.fn();
vi.mock('../../edit/composer-edit-context', () => ({ useComposerEdit: () => ({ startEdit }) }));
const toastError = vi.hoisted(() => vi.fn());
vi.mock('@/lib/toast', () => ({ mfToast: { error: toastError } }));
const focusVisibleComposer = vi.hoisted(() => vi.fn());
vi.mock('../../focus-composer', () => ({ focusVisibleComposer }));

import { useHeldQueue } from '../held-queue-store';
import { QueuedRows } from '../QueuedRows';

export const ref = (id: string, second: number, overrides: Partial<QueuedMessageRef> = {}): QueuedMessageRef => ({
  messageId: id,
  chatId: 'chat-1',
  uuid: `u-${id}`,
  content: `text ${id}`,
  timestamp: `2026-11-24T10:00:0${second}.000Z`,
  ...overrides,
});

export const queue = (...refs: QueuedMessageRef[]) => Object.fromEntries(refs.map((r) => [r.messageId, r]));
export const renderRows = () =>
  render(
    <TooltipProvider>
      <QueuedRows />
    </TooltipProvider>,
  );
export const rows = () => screen.getAllByTestId('chat-queued-message');

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useHeldQueue.setState({ byChat: {} });
  mockChat.queued = {};
  mockChat.transcriptIds = [];
});

export { cancelQueuedMessage, confirmQueuedMessage, focusVisibleComposer, resumeQueuedMessages, toastError };
