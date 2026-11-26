/**
 * useSubmitComposition re-pins the transcript on every submit: the user's own
 * send is the one run start that moves the view, even for a reader who
 * scrolled up (assistant-ui's run-start scroll is off). An empty draft sends
 * nothing and leaves the view alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { ReactNode } from 'react';
import { TranscriptScrollProvider } from '../../../thread/transcript-scroll-context';
import { useComposerSegments } from '../segment-store';

let liveText = '';
const calls: string[] = [];
const runtimeState = () => ({ text: liveText, attachments: [], runConfig: undefined });

vi.mock('@assistant-ui/react', () => ({
  useAui: () => ({
    thread: { append: () => calls.push('append') },
    composer: {
      __internal_getRuntime: () => ({ getState: runtimeState }),
      getState: runtimeState,
      reset: () => Promise.resolve(),
    },
  }),
  useAuiState: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({ threadListItem: { id: 'thread-1' }, composer: { text: liveText, attachments: [] } }),
}));

import { useSubmitComposition } from '../use-submit-composition';

const pinToBottom = vi.fn(() => calls.push('pin'));
const scroll = {
  viewportElement: { current: null },
  isFollowing: () => false,
  beginInteraction: () => () => {},
  pinToBottom,
};
const wrapper = ({ children }: { children: ReactNode }) => (
  <TranscriptScrollProvider value={scroll}>{children}</TranscriptScrollProvider>
);

beforeEach(() => {
  calls.length = 0;
  pinToBottom.mockClear();
  liveText = '';
  useComposerSegments.setState({ byThread: {} });
});

describe('useSubmitComposition — re-pin on send', () => {
  it.each([undefined, 'queue', 'steer'] as const)('re-pins after appending (mode %s)', (mode) => {
    liveText = 'hello';
    const { result } = renderHook(() => useSubmitComposition(), { wrapper });
    act(() => result.current(mode));
    expect(calls).toEqual(['append', 'pin']);
  });

  it('does not move the view when there is nothing to send', () => {
    const { result } = renderHook(() => useSubmitComposition(), { wrapper });
    act(() => result.current());
    expect(pinToBottom).not.toHaveBeenCalled();
  });
});
