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
 * `disabled` reads the LIVE thread run-state from `useAuiState` (not the stale
 * REST snapshot) so the toolbar is correctly disabled mid-run. The daemon port
 * is threaded from `useChatExtras()` — no extra `getDaemonPort()` call here.
 *
 * Provider defaults (`displayEffort` 3rd arg / `effectiveFeature` provider arg)
 * are NOT fetched in app-tauri yet — callers pass `undefined` (follow-up ticket).
 */

import { useState, useEffect, useCallback } from 'react';
import { useAuiState } from '@assistant-ui/react';
import type {
  AdapterInfo,
  AdapterModel,
  Chat,
  EffortLevel,
  ExecutionMode,
  FeatureKey,
  SessionTuning,
} from '@qlan-ro/mainframe-types';
import { getAdapters } from '@/lib/api/adapters';
import { getChat, setChatTuning, setChatConfig, type ChatConfigPatch } from '@/lib/api/chats';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';

// ---------------------------------------------------------------------------
// useAdapters
// ---------------------------------------------------------------------------

/**
 * Fetches the full adapter registry once on mount and holds it in state.
 * Returns an empty array while loading or on error (logged via console.warn).
 */
export function useAdapters(): AdapterInfo[] {
  const extras = useChatExtras();
  const port = extras?.port;
  const [adapters, setAdapters] = useState<AdapterInfo[]>([]);

  useEffect(() => {
    if (port == null) return;
    let cancelled = false;

    async function load() {
      try {
        const data = await getAdapters(port!);
        if (!cancelled) setAdapters(data);
      } catch (err) {
        console.warn('[composer/useAdapters] failed to load adapters', err);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [port]);

  return adapters;
}

// ---------------------------------------------------------------------------
// useComposerTuning
// ---------------------------------------------------------------------------

export interface ComposerTuningHook {
  chat: Chat | null;
  adapter: AdapterInfo | null;
  model: AdapterModel | null;
  setEffort: (effort: EffortLevel) => void;
  setFeature: (key: FeatureKey, on: boolean) => void;
  setModel: (model: string) => void;
  setPlanMode: (on: boolean) => void;
  setPermissionMode: (mode: ExecutionMode) => void;
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
  const extras = useChatExtras();
  const chatId = extras?.state.chatId ?? null;
  const [chat, setChat] = useState<Chat | null>(null);

  // Fetch the chat when chatId changes.
  useEffect(() => {
    if (!chatId || !extras) return;
    const id: string = chatId;
    const port = extras.port;
    let cancelled = false;

    async function load() {
      try {
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
    // extras.port is stable within a chat epoch; only chatId triggers a re-fetch.
  }, [chatId, extras?.port]);

  // Adopt daemon-side config changes (model/plan/permission/effort/features) live.
  // The controller mirrors `chat.updated` into state.chatConfig, so the toolbar
  // stays correct when the daemon changes config on its own (e.g. the agent
  // exiting plan mode → planMode:false) — no manual reload needed. The REST fetch
  // above seeds the initial value before the first chat.updated arrives.
  const liveChat = extras?.state.chatConfig ?? null;
  useEffect(() => {
    if (liveChat) setChat(liveChat);
  }, [liveChat]);

  // Live run-state from the assistant-ui thread — stays accurate mid-run
  // (unlike the REST snapshot in `chat.isRunning` which is fetched once).
  const isRunning = useAuiState((s: { thread: { isRunning: boolean } }) => s.thread.isRunning);

  const adapter: AdapterInfo | null = chat != null ? (adapters.find((a) => a.id === chat.adapterId) ?? null) : null;

  // Resolve the AdapterModel: the chat's explicit model, else the adapter's
  // default (chat.model is null when the session inherits the adapter default).
  const model: AdapterModel | null = (() => {
    if (adapter == null) return null;
    const adapterModels = adapter.models;
    return (
      (chat?.model != null ? adapterModels.find((m) => m.id === chat.model) : undefined) ??
      adapterModels.find((m) => m.isDefault) ??
      adapterModels[0] ??
      null
    );
  })();

  /**
   * Shared optimistic-mutate helper: captures prev, applies optimistic update,
   * fires PATCH, reconciles on success, reverts on error.
   */
  const optimisticPatch = useCallback(
    <T extends Partial<Chat>>(optimistic: T, patch: () => Promise<Chat>, label: string) => {
      if (!chat || !extras) return;
      const prev = chat;
      setChat({ ...chat, ...optimistic });
      patch()
        .then((updated) => setChat(updated))
        .catch((err: unknown) => {
          console.warn(`[composer/useComposerTuning] ${label} failed — reverting`, { err });
          setChat(prev);
        });
    },
    [chat, extras],
  );

  const setEffort = useCallback(
    (effort: EffortLevel) => {
      if (!extras || !chatId) return;
      const tuning: SessionTuning = { effort };
      const { port } = extras;
      optimisticPatch({ effort }, () => setChatTuning(port, chatId, tuning), 'setEffort');
    },
    [chatId, extras, optimisticPatch],
  );

  const setFeature = useCallback(
    (key: FeatureKey, on: boolean) => {
      if (!extras || !chatId) return;
      // Write ONLY the touched field — ultracode→xhigh coercion is a daemon resolver invariant.
      const patch: SessionTuning = { [key]: on };
      const { port } = extras;
      optimisticPatch(patch as Partial<Chat>, () => setChatTuning(port, chatId, patch), `setFeature(${key})`);
    },
    [chatId, extras, optimisticPatch],
  );

  // adapter / model / permission / plan all go through PATCH /config (one optimistic helper).
  const patchConfig = useCallback(
    (patch: ChatConfigPatch) => {
      if (!extras || !chatId) return;
      const { port } = extras;
      optimisticPatch(patch as Partial<Chat>, () => setChatConfig(port, chatId, patch), 'patchConfig');
    },
    [chatId, extras, optimisticPatch],
  );

  const setModel = useCallback((m: string) => patchConfig({ model: m }), [patchConfig]);
  const setPlanMode = useCallback((on: boolean) => patchConfig({ planMode: on }), [patchConfig]);
  const setPermissionMode = useCallback((mode: ExecutionMode) => patchConfig({ permissionMode: mode }), [patchConfig]);

  return {
    chat,
    adapter,
    model,
    setEffort,
    setFeature,
    setModel,
    setPlanMode,
    setPermissionMode,
    disabled: isRunning,
  };
}
