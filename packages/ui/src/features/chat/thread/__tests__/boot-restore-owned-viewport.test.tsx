// @vitest-environment jsdom
/**
 * #1006's boot cover lifts once the main transcript has sat at its tail for three polls. It reads
 * `data-surface="chat"`, `data-mf-chat-thread` and `data-mf-chat-id` and the viewport's scroll position,
 * so the plain list's viewport has to carry the markers and reach the tail by itself.
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantRuntimeProvider, ThreadPrimitive, useExternalStoreRuntime } from '@assistant-ui/react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { useUiPrefs } from '@/store/ui-prefs';
import { chatControllerRegistry } from '@/features/sessions/runtime/chat-controller-registry';
import {
  beginBootRestore,
  decideBootRestore,
  isBootRestoring,
  resetBootRestore,
} from '@/features/sessions/runtime/boot-restore';

vi.mock('../../messages/turn/TurnTranscript', () => ({ TurnTranscript: () => null }));
vi.mock('../EarlierMessages', () => ({ EarlierMessages: () => null }));
vi.mock('../ContextNotPreservedNotice', () => ({ ContextNotPreservedNotice: () => null }));
vi.mock('../ChatThreadIndicators', () => ({ ChatThreadLoadingSpinner: () => null, LoadErrorBanner: () => null }));
vi.mock('../TranscriptWidthHandle', () => ({
  TRANSCRIPT_WIDTH_VAR: '--mf-transcript-width',
  TranscriptWidthHandle: () => null,
}));
vi.mock('../DegradedChatCard', () => ({ DegradedChatCard: () => null }));
vi.mock('../../composer/Composer', () => ({ Composer: () => null }));
vi.mock('../../composer/WorktreeSwitchBanner', () => ({ WorktreeSwitchBanner: () => null }));
vi.mock('../../composer/strips/BottomStrip', () => ({ BottomStrip: () => null }));
vi.mock('../../composer/strips/DraftStrip', () => ({ DraftStrip: () => null }));
vi.mock('../../orchestration/AgentOutboxChip', () => ({ AgentOutboxChip: () => null }));
vi.mock('../../gates/ChatGateMount', () => ({ ChatGateMount: () => null }));
vi.mock('../../runtime/chat-extras', () => ({ useChatExtras: () => ({ state: { chatId: 'chat-1' } }) }));
vi.mock('@/features/side-chat/side-chat-scope', () => ({ useSideAwareThreadId: () => 'thread-1' }));

import { ChatThreadViewport } from '../ChatThreadViewport';

const layout = { height: 2000, top: 0 };
const DRIVEN = {
  clientHeight: { get: () => 800, configurable: true },
  scrollHeight: { get: () => layout.height, configurable: true },
  scrollTop: {
    get: () => layout.top,
    set: (value: number) => {
      layout.top = Math.max(0, Math.min(layout.height - 800, value));
    },
    configurable: true,
  },
};
const originals: PropertyDescriptorMap = {};
const MESSAGES: ThreadMessageLike[] = [{ id: 'm1', role: 'user', content: 'hello' }];

function Harness() {
  const runtime = useExternalStoreRuntime<ThreadMessageLike>({
    messages: MESSAGES,
    convertMessage: (message) => message,
    isRunning: false,
    onNew: async () => {},
  });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root>
        <div data-surface="chat">
          <ChatThreadViewport variant="main" />
        </div>
      </ThreadPrimitive.Root>
    </AssistantRuntimeProvider>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  useUiPrefs.setState({ plainTranscript: true });
  layout.height = 2000;
  layout.top = 0;
  for (const name of Object.keys(DRIVEN))
    originals[name] = Object.getOwnPropertyDescriptor(Element.prototype, name) ?? {
      value: undefined,
      configurable: true,
    };
  Object.defineProperties(Element.prototype, DRIVEN);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  resetBootRestore();
  const controller = { getState: () => ({ loadState: { type: 'ready' } }), subscribeState: () => () => undefined };
  vi.spyOn(chatControllerRegistry, 'get').mockImplementation((() => controller) as never);
});
afterEach(() => {
  resetBootRestore();
  Object.defineProperties(Element.prototype, originals);
  useUiPrefs.setState({ plainTranscript: false });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('boot restore over the plain list', () => {
  it('lifts the cover once the owned viewport sits at the tail', () => {
    beginBootRestore();
    render(<Harness />);
    decideBootRestore('chat-1');
    expect(isBootRestoring()).toBe(true);
    act(() => void vi.advanceTimersByTime(16 * 4));
    expect(layout.top).toBe(1200);
    expect(isBootRestoring()).toBe(false);
  });

  it('keeps holding while the viewport is away from the tail', () => {
    beginBootRestore();
    render(<Harness />);
    layout.top = 300;
    decideBootRestore('chat-1');
    act(() => void vi.advanceTimersByTime(16 * 10));
    expect(isBootRestoring()).toBe(true);
  });
});
