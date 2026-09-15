/**
 * UserMessage — failed-send copy and retry suppression (task 4, todo #219).
 *
 * Mirrors the mock setup in the existing `UserMessage.test.tsx` (do not
 * modify that file). Covers:
 *  - the classified sentence renders in a new `chat-user-message-send-error`
 *    element alongside the existing `chat-user-message-send-failed` label.
 *  - `attachmentsRestored: true` hides Retry (text-only retry would silently
 *    drop the attachments already restored to the composer).
 *  - without `attachmentsRestored`, Retry stays and still calls retryMessage.
 *  - no error → neither testid renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const { retryMessageSpy } = vi.hoisted(() => ({ retryMessageSpy: vi.fn() }));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({ retryMessage: retryMessageSpy }),
  useChatQueuedMessages: () => [],
}));

interface SyntheticMainframeMeta {
  pending?: boolean;
  clientId?: string;
  error?: string;
  attachmentsRestored?: boolean;
}

interface SyntheticMessageState {
  id: string;
  content: Array<{ type: string; text?: string; image?: string }>;
  metadata: {
    custom: {
      mainframe?: SyntheticMainframeMeta;
    };
  };
}

let __messageFixture: SyntheticMessageState = {
  id: 'msg-1',
  content: [{ type: 'text', text: 'Hello world' }],
  metadata: { custom: {} },
};

vi.mock('@assistant-ui/react', () => ({
  useAuiState: (selector: (s: { message: SyntheticMessageState }) => unknown) =>
    selector({ message: __messageFixture }),
  MessagePrimitive: {
    Root: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => <div {...rest}>{children}</div>,
  },
}));

vi.mock('../UserAttachments', () => ({
  UserAttachments: () => <div data-testid="chat-user-attachments" />,
}));

vi.mock('../QueuedUserTurn', () => ({
  QueuedUserTurn: ({ children, extrasSlot }: { children?: React.ReactNode; extrasSlot?: React.ReactNode }) => (
    <div data-testid="chat-queued-message">
      {children}
      {extrasSlot}
    </div>
  ),
}));

vi.mock('@/features/skills/use-chat-skills', async (importActual) => {
  const actual = await importActual<typeof import('@/features/skills/use-chat-skills')>();
  return { ...actual, useChatSkills: () => ({ skills: [], loading: false }) };
});

import { UserMessage } from '../UserMessage';

function renderUserMessage() {
  return render(<UserMessage />);
}

function makeFixture(mainframe?: SyntheticMainframeMeta): SyntheticMessageState {
  return {
    id: 'msg-test',
    content: [{ type: 'text', text: 'Hello' }],
    metadata: { custom: { mainframe } },
  };
}

const AUTH_SENTENCE = 'Not authorized on this daemon. Re-pair it from the daemon menu, then send again.';

describe('UserMessage — send-failure copy and retry suppression', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the classified sentence in chat-user-message-send-error alongside the existing label', () => {
    __messageFixture = makeFixture({ pending: true, clientId: 'c1', error: AUTH_SENTENCE });
    renderUserMessage();
    expect(screen.getByTestId('chat-user-message-send-failed')).toHaveTextContent('Failed to send');
    expect(screen.getByTestId('chat-user-message-send-error')).toHaveTextContent(AUTH_SENTENCE);
  });

  it('hides Retry when attachmentsRestored is true', () => {
    __messageFixture = makeFixture({
      pending: true,
      clientId: 'c1',
      error: AUTH_SENTENCE,
      attachmentsRestored: true,
    });
    renderUserMessage();
    expect(screen.queryByTestId('chat-user-message-retry')).not.toBeInTheDocument();
  });

  it('keeps Retry, calling retryMessage(clientId), when attachmentsRestored is absent', () => {
    __messageFixture = makeFixture({ pending: true, clientId: 'c1', error: AUTH_SENTENCE });
    renderUserMessage();
    fireEvent.click(screen.getByTestId('chat-user-message-retry'));
    expect(retryMessageSpy).toHaveBeenCalledWith('c1');
  });

  it('renders neither testid for a message with no error', () => {
    __messageFixture = makeFixture(undefined);
    renderUserMessage();
    expect(screen.queryByTestId('chat-user-message-send-failed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('chat-user-message-send-error')).not.toBeInTheDocument();
  });
});
