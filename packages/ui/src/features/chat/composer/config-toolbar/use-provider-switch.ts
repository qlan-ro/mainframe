'use client';

/**
 * useProviderSwitch — the confirm gate in front of `POST /switch-provider`.
 *
 * `request` either switches straight away (the user opted out of the
 * confirmation) or fetches the chat's segments to pick the right copy — a
 * provider that already ran here is "returning" — and parks the request
 * until the dialog is answered. Like useTuningWarning, a parked request is
 * dropped when the composer moves to another chat, and confirm refuses a
 * mismatch. Server-authoritative: the daemon's `chat.updated` moves the
 * toolbar; nothing is applied optimistically.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AdapterInfo, Chat, SessionTuning } from '@qlan-ro/mainframe-types';
import { getChatSegments, switchChatProvider } from '@/lib/api/chats';
import { mfToast } from '@/lib/toast';
import { useUiPrefs } from '@/store/ui-prefs';
import { hasEarlierSession } from './provider-switch';

export interface ProviderSwitchRequest {
  adapterId: string;
  model: string;
  tuning?: SessionTuning;
}

export interface ParkedProviderSwitch {
  request: ProviderSwitchRequest;
  fromName: string;
  toName: string;
  returning: boolean;
  originChatId: string;
}

export interface ProviderSwitchHook {
  pending: ParkedProviderSwitch | null;
  suppressChecked: boolean;
  setSuppressChecked: (value: boolean) => void;
  request: (req: ProviderSwitchRequest) => void;
  confirm: () => void;
  cancel: () => void;
}

const nameOf = (adapters: readonly AdapterInfo[], id: string): string => adapters.find((a) => a.id === id)?.name ?? id;

function runSwitch(port: number, chatId: string, req: ProviderSwitchRequest): void {
  switchChatProvider(port, chatId, req).catch((err: unknown) => {
    console.warn('[composer/useProviderSwitch] switch failed', { err });
    mfToast.error('Could not switch provider', { description: err instanceof Error ? err.message : String(err) });
  });
}

export function useProviderSwitch(
  chat: Chat | null,
  port: number | null,
  adapters: readonly AdapterInfo[],
): ProviderSwitchHook {
  const suppressed = useUiPrefs((s) => s.dontConfirmProviderSwitch);
  const [pending, setPending] = useState<ParkedProviderSwitch | null>(null);
  const [suppressChecked, setSuppressChecked] = useState(false);
  const chatId = chat?.id ?? null;
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const cancel = useCallback(() => {
    setPending(null);
    setSuppressChecked(false);
  }, []);

  useEffect(() => {
    if (pending != null && pending.originChatId !== chatId) cancel();
  }, [pending, chatId, cancel]);

  const request = useCallback(
    (req: ProviderSwitchRequest) => {
      const live = chatRef.current;
      if (live == null || port == null) return;
      if (suppressed) {
        runSwitch(port, live.id, req);
        return;
      }
      const park = (returning: boolean) => {
        setSuppressChecked(false);
        setPending({
          request: req,
          fromName: nameOf(adapters, live.adapterId),
          toName: nameOf(adapters, req.adapterId),
          returning,
          originChatId: live.id,
        });
      };
      getChatSegments(port, live.id)
        .then((segments) => park(hasEarlierSession(segments, req.adapterId)))
        .catch((err: unknown) => {
          // The copy only differs in wording; the switch itself still works.
          console.warn('[composer/useProviderSwitch] segments read failed', { err });
          park(false);
        });
    },
    [adapters, port, suppressed],
  );

  const confirm = useCallback(() => {
    const parked = pending;
    cancel();
    if (parked == null || port == null || parked.originChatId !== chatRef.current?.id) return;
    // Committed here only, so ticking the box then cancelling writes nothing.
    if (suppressChecked) useUiPrefs.getState().dismissProviderSwitchConfirm();
    runSwitch(port, parked.originChatId, parked.request);
  }, [pending, port, suppressChecked, cancel]);

  return { pending, suppressChecked, setSuppressChecked, request, confirm, cancel };
}
