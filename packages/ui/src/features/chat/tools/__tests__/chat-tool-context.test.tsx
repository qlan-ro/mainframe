/** useChatId — which chat a tool card belongs to. */
import type { ReactNode } from 'react';
import { renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('../../runtime/chat-extras', () => ({ useChatExtras: () => ({ state: { chatId: 'column' } }) }));
vi.mock('@/features/side-chat/side-chat-scope', () => ({ useSideAwareThreadId: () => null }));

import { TranscriptScopeProvider } from '../../messages/turn/transcript-scope';
import { useChatId } from '../chat-tool-context';

it('is the transcript’s own chat, where a sub-agent tab shows another than the conversation', () => {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TranscriptScopeProvider
      value={{ rootThreadId: 'parent', chatId: 'parent', ancestors: [], pendingToolIds: new Set() }}
    >
      {children}
    </TranscriptScopeProvider>
  );
  expect(renderHook(() => useChatId(), { wrapper }).result.current).toBe('parent');
});

it('is the thread’s chat outside a transcript', () => {
  expect(renderHook(() => useChatId()).result.current).toBe('column');
});
