import { afterEach, describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { ThreadMessage } from '@assistant-ui/react';
import { PanelColumnContext } from '@/features/session-panel/panel-control-store';
import { useUiPrefs } from '@/store/ui-prefs';
import type { AcpChatController } from '../../../controller/acp-chat-controller';
import type { ChatThreadState } from '../../../controller/chat-thread-state';
import { assistant, bash, scope, text, user } from '../../../view-model/turn/__tests__/fixtures';
import type { TurnScope } from '../../../view-model/turn/types';
import { releaseTranscriptViewModels, transcriptViewModels, useTranscriptTurns } from '../use-transcript-turns';

/** Just what the cache reads of a controller: its window, and a way to hear it change. */
function fakeController(floorItemId: string) {
  let state = {
    historyWindow: { hasMore: true, loading: false, floorItemId },
    windowMessages: null,
  } as unknown as ChatThreadState;
  const listeners = new Set<() => void>();
  const controller = {
    getState: () => state,
    subscribeState: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const set = (next: Partial<ChatThreadState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  return { controller: controller as unknown as AcpChatController, set, listeners };
}

const column = ({ children }: { children: ReactNode }) => (
  <PanelColumnContext.Provider value="main">{children}</PanelColumnContext.Provider>
);
const ROOT = scope({ rootThreadId: 'chat-1' });
const tail = (): ThreadMessage[] => [user('u5', 'latest'), assistant('a5', [text('Latest reply')])];

function mount(controller: AcpChatController, messages: readonly ThreadMessage[]) {
  return renderHook(({ list }) => useTranscriptTurns(list, ROOT, () => controller), {
    initialProps: { list: messages },
    wrapper: column,
  });
}

afterEach(() => {
  useUiPrefs.setState({ finishedWork: 'fold' });
});

describe('the chat column keeps its turns across a switch', () => {
  it('reuses the model when the chat comes back unchanged', () => {
    const { controller } = fakeController('u5');
    const messages = tail();
    const first = mount(controller, messages);
    const model = first.result.current;
    first.unmount();
    const again = mount(controller, [...messages]);
    expect(again.result.current).toBe(model);
    again.unmount();
    releaseTranscriptViewModels(controller);
  });

  it.each([
    ['an older page landed', { historyWindow: { hasMore: true, loading: false, floorItemId: 'u4' } }],
    ['the window was trimmed', { historyWindow: { hasMore: true, loading: false, floorItemId: 'u6' } }],
    ['a jump window opened', { windowMessages: [] }],
  ] as const)('drops the kept model of a chat off screen when %s', (_, change) => {
    const { controller, set, listeners } = fakeController('u5');
    const first = mount(controller, tail());
    first.unmount();
    expect(transcriptViewModels.size).toBe(1);
    act(() => set(change as Partial<ChatThreadState>));
    expect(transcriptViewModels.size).toBe(0);
    expect(listeners.size).toBe(0);
    // Back on screen, the rows are built from the window the chat has now.
    const older = [user('u4', 'older'), assistant('a4', [text('Older reply')]), ...tail()];
    const again = mount(controller, older);
    expect([...again.result.current.slices.keys()]).toEqual(['a4', 'a5']);
    again.unmount();
    releaseTranscriptViewModels(controller);
  });

  it('keeps the model through a switch that leaves the window as it was', () => {
    const { controller, set } = fakeController('u5');
    const messages = tail();
    const first = mount(controller, messages);
    const model = first.result.current;
    first.unmount();
    // A resume on the way back hands over the same window in a new history object.
    act(() => set({ historyWindow: { hasMore: true, loading: false, floorItemId: 'u5' } }));
    const again = mount(controller, messages);
    expect(again.result.current).toBe(model);
    again.unmount();
    releaseTranscriptViewModels(controller);
  });

  it('rebuilds after a display setting changes', () => {
    const { controller } = fakeController('u5');
    const messages = tail();
    const first = mount(controller, messages);
    const model = first.result.current;
    first.unmount();
    act(() => useUiPrefs.setState({ finishedWork: 'open' }));
    expect(transcriptViewModels.size).toBe(0);
    const again = mount(controller, messages);
    expect(again.result.current).not.toBe(model);
    again.unmount();
    releaseTranscriptViewModels(controller);
  });

  it('keeps nothing for a view outside the chat column', () => {
    const { controller } = fakeController('u5');
    const { unmount } = renderHook(() => useTranscriptTurns(tail(), ROOT, () => controller));
    expect(transcriptViewModels.size).toBe(0);
    unmount();
  });
});

describe('the same window under another scope', () => {
  const messages = [user('u1', 'run it'), assistant('a1', [bash('ls'), text('Listed')])];
  function mountScoped(controller: AcpChatController, initial: TurnScope) {
    return renderHook(({ scoped }) => useTranscriptTurns(messages, scoped, () => controller), {
      initialProps: { scoped: initial },
      wrapper: column,
    });
  }

  it.each([
    ['a pending permission', { pendingToolIds: new Set(['ls-call']) }],
    ['the run it began after', { runAfter: 'u1' }],
    ['whether its work can still be going', { live: false }],
    ['whether the chat runs', { isRunning: true }],
  ] as const)('rebuilds for %s', (_, change) => {
    const { controller } = fakeController('u1');
    const view = mountScoped(controller, ROOT);
    const model = view.result.current;
    view.rerender({ scoped: { ...ROOT, ...change } });
    expect(view.result.current).not.toBe(model);
    view.unmount();
    releaseTranscriptViewModels(controller);
  });

  it('reuses the model for the same pending set in another order', () => {
    const { controller } = fakeController('u1');
    const view = mountScoped(controller, { ...ROOT, pendingToolIds: new Set(['b', 'a']) });
    const model = view.result.current;
    view.rerender({ scoped: { ...ROOT, pendingToolIds: new Set(['a', 'b']) } });
    expect(view.result.current).toBe(model);
    view.unmount();
    releaseTranscriptViewModels(controller);
  });
});
