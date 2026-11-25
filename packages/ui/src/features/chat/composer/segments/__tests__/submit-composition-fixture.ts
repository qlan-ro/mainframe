import { vi, beforeEach } from 'vitest';
import { useComposerSegments } from '../segment-store';

export const THREAD_ID = 'thread-1';

export const live = {
  text: '',
  attachments: [] as unknown[],
  runConfig: { custom: { effort: 'high' } } as unknown,
  canSend: false,
};

export const appendSpy = vi.fn();
export const resetSpy = vi.fn();
export const callOrder: string[] = [];

const runtimeGetState = vi.fn(() => ({
  text: live.text,
  attachments: live.attachments,
  runConfig: live.runConfig,
  canSend: live.canSend,
}));

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    thread: {
      append: (...args: unknown[]) => {
        callOrder.push('append');
        appendSpy(...args);
      },
    },
    composer: {
      __internal_getRuntime: () => ({ getState: runtimeGetState }),
      getState: runtimeGetState,
      setText: (text: string) => {
        live.text = text;
      },
      reset: () => {
        callOrder.push('reset');
        resetSpy();
        // Mirrors the real ComposerRuntime: reset() clears the composer's
        // entire state, including runConfig, for any FUTURE read.
        live.runConfig = null;
        live.attachments = [];
        live.text = '';
        return Promise.resolve();
      },
    },
  }),
  useAuiState: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      threadListItem: { id: THREAD_ID },
      composer: { text: live.text, attachments: live.attachments },
    }),
}));

import { useSessionReferences } from '../../sessions/session-reference-store';
import { useDraftContent } from '../../draft-content/draft-content-store';

beforeEach(() => {
  vi.clearAllMocks();
  callOrder.length = 0;
  live.text = '';
  live.attachments = [];
  live.runConfig = { custom: { effort: 'high' } };
  live.canSend = false;
  useComposerSegments.setState({ byThread: {} });
  useSessionReferences.setState({ byThread: {} });
  useDraftContent.setState({ byThread: {} });
});
