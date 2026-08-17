/**
 * ChatThread — the composer gate for a projectless draft.
 *
 * A brand-new local thread whose draft has not resolved a project has nowhere
 * to create the chat, so the footer shows no Composer: the welcome screen's
 * picker resolves the project first, and the composer appears with it. Every
 * other thread — a seeded draft, a regular chat — keeps its composer.
 *
 * Same stub recipe as ChatThread.test.tsx, with the aui state made mutable per
 * test. The draft-config store is the REAL zustand store: seeding it is what a
 * project pick does, and mocking it would only mirror its own lookup.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

let __mainThreadId: string | null = '__LOCALID_1';
let __itemStatus: string | undefined = 'new';

vi.mock('@assistant-ui/react', () => ({
  ThreadPrimitive: {
    Root: ({ children }: { children?: ReactNode }) => <div data-testid="tp-root">{children}</div>,
    Viewport: ({ children }: { children?: ReactNode }) => <div data-testid="tp-viewport">{children}</div>,
    ViewportFooter: ({ children }: { children?: ReactNode }) => <div data-testid="tp-viewport-footer">{children}</div>,
    ScrollToBottom: ({ children }: { children?: ReactNode }) => <>{children}</>,
    Messages: () => <div data-testid="tp-messages" />,
  },
  useAuiState: (sel: (s: unknown) => unknown) =>
    sel({
      threads: { mainThreadId: __mainThreadId },
      threadListItem: { id: __mainThreadId, status: __itemStatus },
      thread: { isRunning: false, messages: [] },
    }),
}));

vi.mock('../../messages/bounded-messages', () => ({ boundedMessageComponents: {} }));
vi.mock('../../composer/Composer', () => ({ Composer: () => <div data-testid="composer-stub" /> }));
vi.mock('../../composer/WorktreeSwitchBanner', () => ({ WorktreeSwitchBanner: () => null }));
vi.mock('../ChatSelectionToolbar', () => ({ ChatSelectionToolbar: () => null }));
vi.mock('../../composer/edit/composer-edit-context', () => ({
  ComposerEditProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => null }));
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
vi.mock('../../runtime/use-chat-thread-runtime', () => ({ useChatExtras: () => undefined }));
vi.mock('../use-rotating-phrase', () => ({ useRotatingPhrase: () => 'Thinking…' }));
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../find/FindBar', () => ({ FindBar: () => null }));
vi.mock('../../tools/register-cards', () => ({}));

import { useDraftConfigStore } from '@/features/sessions/runtime/draft-config';
import { ChatThread } from '../ChatThread';

describe('ChatThread — composer gate on a projectless draft', () => {
  beforeEach(() => {
    __mainThreadId = '__LOCALID_1';
    __itemStatus = 'new';
    useDraftConfigStore.setState({ drafts: new Map() });
  });

  it('hides the composer on a new local thread with no draft config', () => {
    render(<ChatThread />);

    expect(screen.queryByTestId('composer-stub')).toBeNull();
  });

  it('shows the composer once the picked project seeds the draft', () => {
    useDraftConfigStore.getState().setDraft('__LOCALID_1', { projectId: 'proj-a', adapterId: 'claude' });

    render(<ChatThread />);

    expect(screen.getByTestId('composer-stub')).toBeInTheDocument();
  });

  it('shows the composer on a regular chat, which never carries a draft config', () => {
    __mainThreadId = 'chat-42';
    __itemStatus = 'regular';

    render(<ChatThread />);

    expect(screen.getByTestId('composer-stub')).toBeInTheDocument();
  });

  it('ignores a draft seeded for a different local thread', () => {
    useDraftConfigStore.getState().setDraft('__LOCALID_OTHER', { projectId: 'proj-a', adapterId: 'claude' });

    render(<ChatThread />);

    expect(screen.queryByTestId('composer-stub')).toBeNull();
  });
});
