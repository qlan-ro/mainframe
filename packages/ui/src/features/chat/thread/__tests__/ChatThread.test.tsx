/**
 * ChatThread — footer composition and the ⌘F registration.
 *
 * The turn status row lives at the end of the transcript (`TurnStatusRow`, its
 * own tests), not in the sticky footer. We mock the assistant-ui primitives and
 * heavy children down to identifiable stubs to assert what the footer holds.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';

// ── assistant-ui primitives → identifiable stub wrappers ─────────────────────
vi.mock('../VirtualMessages', () => ({ VirtualMessages: () => <div data-testid="tp-messages" /> }));
vi.mock('@assistant-ui/react', () => {
  return {
    ThreadPrimitive: {
      Root: ({ children }: { children?: ReactNode }) => <div data-testid="tp-root">{children}</div>,
      Viewport: ({ children }: { children?: ReactNode }) => <div data-testid="tp-viewport">{children}</div>,
      ViewportFooter: ({ children }: { children?: ReactNode }) => (
        <div data-testid="tp-viewport-footer">{children}</div>
      ),
      ScrollToBottom: ({ children }: { children?: ReactNode }) => <>{children}</>,
      Messages: () => <div data-testid="tp-messages" />,
    },
    // isRunning selector → true; messages.length selector → 1.
    useAuiState: (
      sel: (s: {
        thread: { isRunning: boolean; messages: unknown[] };
        threadListItem?: { custom: unknown };
      }) => unknown,
    ) =>
      sel({
        thread: { isRunning: running, messages: [{}] },
        threadListItem: delegated ? { custom: { delegation: {} } } : undefined,
      }),
  };
});

// ── Heavy children → stubs ───────────────────────────────────────────────────
vi.mock('../../messages/bounded-messages', () => ({ boundedMessageComponents: {} }));
vi.mock('../../composer/Composer', () => ({ Composer: () => <div data-testid="composer-stub" /> }));
vi.mock('../../composer/WorktreeSwitchBanner', () => ({ WorktreeSwitchBanner: () => null }));
vi.mock('../../orchestration/AgentOutboxChip', () => ({ AgentOutboxChip: () => null }));
vi.mock('../ChatSelectionToolbar', () => ({ ChatSelectionToolbar: () => null }));
vi.mock('../../composer/edit/composer-edit-context', () => ({
  ComposerEditProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => <div data-testid="chat-thread-gate-slot" /> }));
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
// `undefined` (no extras) by default; a test sets a run state to drive "Stopping".
let __extras:
  | {
      state: {
        runState: { type: string; startedAtMs?: number };
        loadState: { type: string };
        backgroundTasks?: Record<string, unknown>;
      };
      permissions?: Record<string, unknown>;
    }
  | undefined;
let delegated = false;
let running = true;
// Subscribable, like the real context: a test can change extras after mount.
const extrasListeners = vi.hoisted(() => new Set<() => void>());
vi.mock('../../runtime/chat-extras', async () => {
  const { useSyncExternalStore } = await import('react');
  const subscribe = (listener: () => void) => {
    extrasListeners.add(listener);
    return () => void extrasListeners.delete(listener);
  };
  return { useChatExtras: () => useSyncExternalStore(subscribe, () => __extras) };
});
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../find/FindBar', () => ({ FindBar: () => null }));
vi.mock('../../tools/register-cards', () => ({}));

// jsdom reports a Linux-ish platform, so `mod` would resolve to Ctrl and the ⌘F
// case below would miss. The dispatcher reads this once at mount.
vi.mock('@/features/shortcuts/platform', () => ({ isMacPlatform: () => true }));

import { ChatThread } from '../ChatThread';
import { useFindInChatStore } from '../../find/find-in-chat-store';
import { useShortcutDispatcher } from '@/features/shortcuts/use-shortcut-dispatcher';

beforeEach(() => {
  __extras = undefined;
  delegated = false;
  running = true;
});

describe('ChatThread — footer', () => {
  it('keeps the approval gate and removes the composer in a delegated task split', () => {
    delegated = true;
    render(<ChatThread />);
    expect(screen.getByTestId('chat-thread-gate-slot')).toBeInTheDocument();
    expect(screen.queryByTestId('composer-stub')).toBeNull();
    expect(screen.getByTestId('chat-read-only-note')).toHaveTextContent('read-only');
  });
  it('keeps no turn status in the footer — it lives at the end of the transcript', () => {
    render(<ChatThread />);
    const footer = screen.getByTestId('chat-thread-footer');
    expect(within(footer).queryByTestId('chat-thread-running')).toBeNull();
    expect(within(footer).queryByTestId('chat-turn-status')).toBeNull();
  });
});

/**
 * ⌘F is a registry entry now, so the thread registers the ACTION and the app's
 * one dispatcher delivers the chord. The chord stays inert while no thread is
 * mounted, which is what keeps Find chat-scoped.
 */
describe('ChatThread — the ⌘F Find registration', () => {
  function Dispatcher() {
    useShortcutDispatcher();
    return null;
  }

  beforeEach(() => {
    useFindInChatStore.getState().close();
  });

  it('opens the Find bar on ⌘F while the thread is mounted', () => {
    render(
      <>
        <Dispatcher />
        <ChatThread />
      </>,
    );

    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', metaKey: true });

    expect(useFindInChatStore.getState().isOpen).toBe(true);
  });

  it('leaves ⌘F inert with no thread mounted — Find belongs to the chat surface', () => {
    render(<Dispatcher />);

    fireEvent.keyDown(window, { key: 'f', code: 'KeyF', metaKey: true });

    expect(useFindInChatStore.getState().isOpen).toBe(false);
  });
});
