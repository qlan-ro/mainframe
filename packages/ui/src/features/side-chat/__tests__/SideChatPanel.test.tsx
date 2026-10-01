/**
 * SideChatPanel — the binding spike (todo #344, UI rule 5) plus placement.
 *
 * Settles the risk called out in the plan: the panel's nested `AuiProvider`
 * leaves `threadListItem` unbound (a side chat is never in the aui thread
 * list, so a bound item resolves with no state); `ChatThread`'s descendants
 * must instead read the side chat's identity through `SideChatScope`. This
 * test renders the real `SideChatScopeProvider` wiring and a stub `ChatThread`
 * that reads `useSideChatScope()` directly, proving the value reaches it.
 *
 * Also covers: the panel's root test id (`side-chat-panel-<parentChatId>`,
 * keyed by the PARENT id per the approved design direction), that it hands
 * `ChatThread` `variant="side"`, and that the header receives the side chat's
 * own id (not the parent's).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('@assistant-ui/react', () => ({
  AuiProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
  AuiConfig: (v: unknown) => v,
  ExternalThread: (v: unknown) => v,
  useAui: () => ({}),
}));

vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

const fakeController = {
  getState: () => ({ runState: { type: 'idle' }, loadState: { type: 'idle' }, interactions: { permissions: {} } }),
  subscribeState: () => () => undefined,
  sendMessage: vi.fn(),
  cancel: vi.fn(),
};

vi.mock('@/features/chat/runtime/use-chat-thread-runtime', () => ({
  CHAT_ATTACHMENT_ADAPTER: {},
  useControllerState: (c: typeof fakeController) => c.getState(),
}));
vi.mock('@/features/chat/runtime/chat-extras', () => ({
  buildChatExtras: () => ({}),
  isRunningFromState: () => false,
}));
vi.mock('@/features/chat/controller/project-messages', () => ({
  projectChatThreadMessages: () => [],
}));

let capturedVariant: string | undefined;
vi.mock('@/features/chat/thread/ChatThread', async () => {
  const { useSideChatScope } = await import('../side-chat-scope');
  return {
    ChatThread: ({ variant }: { variant?: string }) => {
      capturedVariant = variant;
      const scope = useSideChatScope();
      return <div data-testid="thread-stub">{scope?.sideChatId ?? 'no-scope'}</div>;
    },
  };
});

vi.mock('../SideChatPanelHeader', () => ({
  SideChatPanelHeader: ({ parentChatId, sideChatId }: { parentChatId: string; sideChatId: string }) => (
    <div data-testid="header-stub" data-parent={parentChatId} data-side={sideChatId} />
  ),
}));

import { SideChatPanel } from '../SideChatPanel';

describe('SideChatPanel — binding spike (UI rule 5)', () => {
  it('provides the side chat id to descendants via SideChatScope, not a bound threadListItem', () => {
    render(<SideChatPanel parentChatId="parent-1" sideChatId="side-9" controller={fakeController as never} />);

    expect(screen.getByTestId('thread-stub')).toHaveTextContent('side-9');
  });

  it('renders the panel root keyed by the PARENT chat id', () => {
    render(<SideChatPanel parentChatId="parent-1" sideChatId="side-9" controller={fakeController as never} />);

    expect(screen.getByTestId('side-chat-panel-parent-1')).toBeInTheDocument();
  });

  it('renders ChatThread with variant="side"', () => {
    render(<SideChatPanel parentChatId="parent-1" sideChatId="side-9" controller={fakeController as never} />);

    expect(capturedVariant).toBe('side');
  });

  it('hands the header the side chat id, not the parent id, as its own identity', () => {
    render(<SideChatPanel parentChatId="parent-1" sideChatId="side-9" controller={fakeController as never} />);

    const header = screen.getByTestId('header-stub');
    expect(header).toHaveAttribute('data-parent', 'parent-1');
    expect(header).toHaveAttribute('data-side', 'side-9');
  });
});
