/**
 * ChatThread — transcript edge fades (#409).
 *
 * The viewport fades at its top and bottom edges (scroll-driven, so jsdom can
 * only assert the wiring): the mask classes, the bottom inset tracking the
 * measured footer, and the scroll-to-bottom button living outside the masked
 * viewport yet still driven by the bottom pin.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode, HTMLAttributes } from 'react';

type LoadState = { type: 'idle' | 'loading' | 'ready' } | { type: 'error'; error: string };

const testState = vi.hoisted(() => ({
  extrasState: { compacting: false, loadState: { type: 'ready' } as LoadState, runState: { type: 'idle' } },
  threadListItemId: 'chat-9' as string | null,
  messages: [] as unknown[],
}));

vi.mock('../VirtualMessages', () => ({ VirtualMessages: () => <div data-testid="tp-messages" /> }));
vi.mock('@assistant-ui/react', () => {
  type DivProps = HTMLAttributes<HTMLDivElement> & { children?: ReactNode };
  return {
    ThreadPrimitive: {
      Root: ({ children, ...props }: DivProps) => <div {...props}>{children}</div>,
      Viewport: ({ children, ...props }: DivProps) => <div {...props}>{children}</div>,
      Messages: () => <div data-testid="tp-messages" />,
    },
    useAui: () => ({}),
    useAuiState: (
      sel: (s: {
        thread: { isRunning: boolean; messages: unknown[] };
        threadListItem: { id: string | null } | undefined;
      }) => unknown,
    ) =>
      sel({
        thread: { isRunning: false, messages: testState.messages },
        threadListItem: testState.threadListItemId == null ? undefined : { id: testState.threadListItemId },
      }),
  };
});

vi.mock('../../messages/turn/TurnTranscript', () => ({ TurnTranscript: () => <div data-testid="messages-stub" /> }));
vi.mock('../../composer/Composer', () => ({ Composer: () => <div data-testid="chat-composer" /> }));
vi.mock('../../composer/WorktreeSwitchBanner', () => ({ WorktreeSwitchBanner: () => null }));
vi.mock('../../composer/strips/BottomStrip', () => ({ BottomStrip: () => null }));
vi.mock('../../orchestration/AgentOutboxChip', () => ({ AgentOutboxChip: () => null }));
vi.mock('../ChatSelectionToolbar', () => ({ ChatSelectionToolbar: () => null }));
vi.mock('../../composer/edit/composer-edit-context', () => ({
  ComposerEditProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => <div data-testid="gate-mount-stub" /> }));
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
vi.mock('../use-rotating-phrase', () => ({ useRotatingPhrase: () => 'Thinking…' }));
vi.mock('@/features/skills/use-chat-skills', () => ({
  SkillsProvider: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('../../find/FindBar', () => ({ FindBar: () => null }));
vi.mock('../../tools/register-cards', () => ({}));
vi.mock('@/features/sessions/runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));
vi.mock('../../runtime/chat-extras', () => ({
  useChatExtras: () => ({ state: testState.extrasState, retry: () => Promise.resolve() }),
}));

import { ChatThread } from '../ChatThread';

let observers: Array<() => void> = [];
let footerHeight = 120;

beforeEach(() => {
  testState.extrasState = { compacting: false, loadState: { type: 'ready' }, runState: { type: 'idle' } };
  testState.threadListItemId = 'chat-9';
  testState.messages = [];
  observers = [];
  footerHeight = 120;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private cb: () => void) {
        observers.push(() => this.cb());
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const isFooterBand = this.firstElementChild?.getAttribute('data-testid') === 'chat-thread-footer';
    const h = isFooterBand ? footerHeight : 0;
    return { height: h, width: 0, top: 0, left: 0, right: 0, bottom: h, x: 0, y: 0, toJSON: () => ({}) };
  });
});

describe('ChatThread — transcript edge fades', () => {
  it('masks the viewport with the sticky scroll-fade classes', () => {
    render(<ChatThread />);
    const viewport = screen.getByTestId('chat-thread-viewport');
    expect(viewport).toHaveClass('scroll-fade-y', 'scroll-fade-sticky');
  });

  it('keeps the bottom inset equal to the footer height as the composer grows', () => {
    render(<ChatThread />);
    const viewport = screen.getByTestId('chat-thread-viewport');
    expect(viewport.style.getPropertyValue('--scroll-fade-inset-b')).toBe('120px');
    footerHeight = 200;
    act(() => observers.forEach((notify) => notify()));
    expect(viewport.style.getPropertyValue('--scroll-fade-inset-b')).toBe('200px');
  });

  it('renders the scroll-to-bottom button outside the masked viewport, hidden while following', () => {
    render(<ChatThread />);
    const button = screen.getByTestId('chat-scroll-to-bottom');
    expect(screen.getByTestId('chat-thread-viewport').contains(button)).toBe(false);
    expect(button.style.bottom).toBe('calc(120px + 0.5rem)');
    expect(button).toBeDisabled();
  });
});
