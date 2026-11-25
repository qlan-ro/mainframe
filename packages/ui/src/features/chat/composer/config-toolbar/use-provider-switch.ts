'use client';

/**
 * useProviderSwitch — `POST /switch-provider` (C5). Picking another provider's
 * model switches the chat in place with no confirmation; the transcript marks
 * the handoff.
 */
import { useCallback } from 'react';
import type { Chat, SessionTuning } from '@qlan-ro/mainframe-types';
import { switchChatProvider } from '@/lib/api/chats';
import { mfToast } from '@/lib/toast';

export interface ProviderSwitchRequest {
  adapterId: string;
  model: string;
  tuning?: SessionTuning;
}

export function useProviderSwitch(
  chat: Chat | null,
  port: number | null,
): (req: ProviderSwitchRequest, onFailure?: () => void) => void {
  const chatId = chat?.id ?? null;
  return useCallback(
    (req, onFailure) => {
      if (chatId == null || port == null) {
        onFailure?.();
        return;
      }
      void switchChatProvider(port, chatId, req).catch((err: unknown) => {
        console.warn('[composer/useProviderSwitch] switch failed', { err });
        mfToast.error('Could not switch provider', { description: err instanceof Error ? err.message : String(err) });
        onFailure?.();
      });
    },
    [chatId, port],
  );
}
