'use client';

/**
 * Composer tuning hooks — data layer for EffortPicker + FeaturesPopover.
 *
 * Two independent concerns:
 *   useAdapters  — fetches the adapter registry once on mount (model catalog).
 *   useComposerTuning — fetches the current chat, resolves the model, and
 *                       exposes setEffort/setFeature with optimistic updates.
 *
 * Neither hook uses Zustand. They hold plain React state to avoid the
 * getSnapshot-loop trap that affects external-store selectors.
 *
 * Provider defaults (`displayEffort` 3rd arg / `effectiveFeature` provider arg)
 * are NOT fetched in app-tauri yet — callers pass `undefined` (follow-up ticket).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import type { AdapterInfo, AdapterModel, Chat, EffortLevel, FeatureKey, SessionTuning } from '@qlan-ro/mainframe-types';
import { getAdapters } from '@/lib/api/adapters';
import { getChat, setChatTuning } from '@/lib/api/chats';
import { getDaemonPort } from '@/lib/tauri/bridge';
import { useChatId } from '../tools/chat-tool-context';

// ---------------------------------------------------------------------------
// useAdapters
// ---------------------------------------------------------------------------

/**
 * Fetches the full adapter registry once on mount and holds it in state.
 * Returns an empty array while loading or on error (logged via console.warn).
 */
export function useAdapters(): AdapterInfo[] {
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const port = await getDaemonPort();
        const data = await getAdapters(port);
        if (!cancelled) setAdapters(data);
      } catch (err) {
        console.warn('[composer/useAdapters] failed to load adapters', err);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return adapters;
}

// ---------------------------------------------------------------------------
// useComposerTuning
// ---------------------------------------------------------------------------

export interface ComposerTuningHook {
  chat: Chat | null;
  model: AdapterModel | null;
  setEffort: (effort: EffortLevel) => void;
  setFeature: (key: FeatureKey, on: boolean) => void;
  disabled: boolean;
}

/**
 * Resolves the current chat + its model from the adapter registry, then
 * exposes optimistic mutators.  Returns null values until both are loaded.
 *
 * Optimistic invariant: local state is updated immediately, then the PATCH
 * is sent; on success the returned Chat reconciles any server-side coercion;
 * on error the previous value is restored and a warning is logged.
 */
export function useComposerTuning(adapters: AdapterInfo[]): ComposerTuningHook {
  const chatId = useChatId();
  const [chat, setChat] = useState<Chat | null>(null);
  const portRef = useRef<number | null>(null);

  // Fetch the port once and cache it.
  useEffect(() => {
    if (portRef.current != null) return;
    getDaemonPort()
      .then((p) => {
        portRef.current = p;
      })
      .catch((err) => console.warn('[composer/useComposerTuning] getDaemonPort failed', err));
  }, []);

  // Fetch the chat when chatId changes.
  useEffect(() => {
    if (!chatId) return;
    // Capture as a non-optional string so the async closure's type is stable.
    const id: string = chatId;
    let cancelled = false;

    async function load() {
      try {
        const port = portRef.current ?? (await getDaemonPort());
        portRef.current = port;
        const data = await getChat(port, id);
        if (!cancelled) setChat(data);
      } catch (err) {
        console.warn('[composer/useComposerTuning] getChat failed', { chatId: id, err });
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [chatId]);

  // Resolve the AdapterModel: the chat's explicit model, else the adapter's
  // default (chat.model is null when the session inherits the adapter default).
  const model: AdapterModel | null = (() => {
    if (chat == null) return null;
    const adapterModels = adapters.find((a) => a.id === chat.adapterId)?.models ?? [];
    return (
      (chat.model != null ? adapterModels.find((m) => m.id === chat.model) : undefined) ??
      adapterModels.find((m) => m.isDefault) ??
      adapterModels[0] ??
      null
    );
  })();

  const setEffort = useCallback(
    (effort: EffortLevel) => {
      if (!chat || !chatId || portRef.current == null) return;
      const prev = chat;
      const next: Chat = { ...chat, effort };
      setChat(next);

      const patch: SessionTuning = { effort };
      setChatTuning(portRef.current, chatId, patch)
        .then((updated) => setChat(updated))
        .catch((err) => {
          console.warn('[composer/useComposerTuning] setEffort failed — reverting', { err });
          setChat(prev);
        });
    },
    [chat, chatId],
  );

  const setFeature = useCallback(
    (key: FeatureKey, on: boolean) => {
      if (!chat || !chatId || portRef.current == null) return;
      const prev = chat;
      // Write ONLY the touched field — ultracode→xhigh coercion is a daemon resolver invariant.
      const patch: SessionTuning = { [key]: on };
      const next: Chat = { ...chat, ...patch };
      setChat(next);

      setChatTuning(portRef.current, chatId, patch)
        .then((updated) => setChat(updated))
        .catch((err) => {
          console.warn('[composer/useComposerTuning] setFeature failed — reverting', { key, err });
          setChat(prev);
        });
    },
    [chat, chatId],
  );

  return {
    chat,
    model,
    setEffort,
    setFeature,
    disabled: chat?.isRunning === true,
  };
}
