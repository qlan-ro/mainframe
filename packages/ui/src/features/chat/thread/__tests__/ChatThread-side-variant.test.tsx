/**
 * ChatThread — `variant="side"` (todo #344, UI rules 5 and 6).
 *
 * Covers:
 *  - the full-size, side-chat-keyed `ContextNotPreservedNotice` never renders
 *    inside the side variant (AC 15 — the panel shows its own compact notice
 *    instead, elsewhere);
 *  - `Composer` receives the `variant` prop, so the composer's own
 *    adapter/worktree/Temporary hiding (ComposerToolbar) gets the right value;
 *  - the binding spike (UI rule 5): inside a `SideChatScope`, `ChatThread`'s
 *    internal id reads (surfaced here through `ThreadFooterInput`'s composer
 *    mount, which the scope's id must not suppress) resolve to the scope's
 *    `sideChatId` rather than the (here, absent) bound `threadListItem`.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ReactNode } from 'react';

vi.mock('../ProgressiveMessages', () => ({ ProgressiveMessages: () => <div data-testid="tp-messages" /> }));
vi.mock('@assistant-ui/react', () => ({
  ThreadPrimitive: {
    Root: ({ children }: { children?: ReactNode }) => <div data-testid="tp-root">{children}</div>,
    Viewport: ({ children }: { children?: ReactNode }) => <div data-testid="tp-viewport">{children}</div>,
    ViewportFooter: ({ children }: { children?: ReactNode }) => <div data-testid="tp-viewport-footer">{children}</div>,
    ScrollToBottom: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Messages: () => <div data-testid="tp-messages" />,
  },
  // No bound threadListItem at all — the scope is the only source of an id.
  useAuiState: (sel: (s: { thread: { isRunning: boolean; messages: unknown[] } }) => unknown) =>
    sel({ thread: { isRunning: false, messages: [] } }),
}));

vi.mock('../../messages/bounded-messages', () => ({ boundedMessageComponents: {} }));
vi.mock('../../composer/WorktreeSwitchBanner', () => ({
  WorktreeSwitchBanner: () => <div data-testid="worktree-banner" />,
}));
vi.mock('../../orchestration/AgentOutboxChip', () => ({
  AgentOutboxChip: () => <div data-testid="agent-outbox-chip" />,
}));
vi.mock('../ChatSelectionToolbar', () => ({ ChatSelectionToolbar: () => null }));
vi.mock('../../composer/edit/composer-edit-context', () => ({
  ComposerEditProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => null }));
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
vi.mock('../use-rotating-phrase', () => ({ useRotatingPhrase: () => '' }));
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../find/FindBar', () => ({ FindBar: () => null }));
vi.mock('../../tools/register-cards', () => ({}));
vi.mock('@/features/sessions/runtime/draft-config', () => ({
  useDraftConfigStore: () => false,
}));

let __chatConfig: { id: string; contextLostAt: string | null } | undefined;
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () =>
    __chatConfig
      ? { state: { chatConfig: __chatConfig, loadState: { type: 'idle' }, runState: { type: 'idle' } } }
      : undefined,
}));

let capturedComposerProps: { variant?: string } | null = null;
vi.mock('../../composer/Composer', () => ({
  Composer: (props: { variant?: string }) => {
    capturedComposerProps = props;
    return <div data-testid="composer-stub" />;
  },
}));

import { ChatThread } from '../ChatThread';
import { SideChatScopeProvider } from '@/features/side-chat/side-chat-scope';

describe('ChatThread — variant="side" (todo #344)', () => {
  it('never renders the full-size ContextNotPreservedNotice', () => {
    __chatConfig = { id: 'side-1', contextLostAt: '2026-09-24T00:00:00.000Z' };
    render(<ChatThread variant="side" />);

    expect(screen.queryByTestId('chat-context-not-preserved-side-1')).toBeNull();
  });

  it('renders the full-size notice for the default (main) variant', () => {
    __chatConfig = { id: 'main-1', contextLostAt: '2026-09-24T00:00:00.000Z' };
    render(<ChatThread />);

    expect(screen.getByTestId('chat-context-not-preserved-main-1')).toBeInTheDocument();
  });

  it('passes the variant through to the composer', () => {
    __chatConfig = undefined;
    render(<ChatThread variant="side" />);

    expect(capturedComposerProps?.variant).toBe('side');
  });

  it('hides the worktree-switch banner in the side variant', () => {
    __chatConfig = undefined;
    render(<ChatThread variant="side" />);

    expect(screen.queryByTestId('worktree-banner')).toBeNull();
  });

  it('hides the agent-outbox chip in the side variant (nothing is ever held for a side chat)', () => {
    __chatConfig = undefined;
    render(<ChatThread variant="side" />);

    expect(screen.queryByTestId('agent-outbox-chip')).toBeNull();
  });

  it('binding spike: reads the thread id from SideChatScope, not a bound threadListItem', () => {
    __chatConfig = undefined;
    render(
      <SideChatScopeProvider value={{ parentChatId: 'parent-1', sideChatId: 'side-9' }}>
        <ChatThread variant="side" />
      </SideChatScopeProvider>,
    );

    // A `__LOCALID_*`-prefixed scope id would suppress the composer via the
    // projectless-draft guard — a real side-chat id never does, proving the
    // scope's id (not `undefined` from the absent threadListItem) was read.
    expect(screen.getByTestId('composer-stub')).toBeInTheDocument();
  });
});
