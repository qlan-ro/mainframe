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
import { setChatTuning, setChatConfig, type ChatConfigPatch } from '@/lib/api/chats';
import { useDraftConfig, patchDraftConfig } from '@/features/sessions/runtime/draft-config';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { synthesizeDraftChat } from './synthesize-draft-chat';

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
  setAdapter: (adapterId: string) => void;
  setPlanMode: (on: boolean) => void;
  setPermissionMode: (mode: ExecutionMode) => void;
  disabled: boolean;
}

/**
 * Resolves the current chat + its model from the adapter registry, then exposes
 * config mutators. Returns null values until the config is loaded.
 *
 * Server-authoritative, NO optimistic UI (mirrors the desktop client): `chat` is
 * read live from the controller's `state.chatConfig` (seeded from REST on load,
 * then mirrored from every `chat.updated`). A mutator just sends the PATCH; the
 * daemon's resulting `chat.updated` broadcast updates `chatConfig` and the toolbar
 * reflects it. No local copy → no optimistic-vs-broadcast race, no flicker.
 */
export function useComposerTuning(adapters: AdapterInfo[]): ComposerTuningHook {
  const extras = useChatExtras();
  const chatId = extras?.state.chatId ?? null;
  const port = extras?.port ?? null;
  const realChat = extras?.state.chatConfig ?? null;

  // Draft mode: a brand-new __LOCALID_* thread has no daemon chat yet. Bind the
  // toolbar to a Chat synthesized from the in-memory draft and route every setter
  // to patchDraftConfig — the daemon chat is still created only on first send (D3).
  const isLocalDraft = chatId != null && chatId.startsWith('__LOCALID_') && realChat == null;
  const draft = useDraftConfig(isLocalDraft ? chatId : null);
  const draftMode = isLocalDraft && draft != null;
  const chat: Chat | null = realChat ?? (chatId != null && draft != null ? synthesizeDraftChat(chatId, draft) : null);

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

  const setEffort = useCallback(
    (effort: EffortLevel) => {
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { effort });
        return;
      }
      if (port == null || !chatId) return;
      const tuning: SessionTuning = { effort };
      setChatTuning(port, chatId, tuning).catch((err: unknown) =>
        console.warn('[composer/useComposerTuning] setEffort failed', { err }),
      );
    },
    [draftMode, chatId, port],
  );

  const setFeature = useCallback(
    (key: FeatureKey, on: boolean) => {
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { [key]: on });
        return;
      }
      if (port == null || !chatId) return;
      // Write ONLY the touched field — ultracode→xhigh coercion is a daemon resolver invariant.
      const patch: SessionTuning = { [key]: on };
      setChatTuning(port, chatId, patch).catch((err: unknown) =>
        console.warn(`[composer/useComposerTuning] setFeature(${key}) failed`, { err }),
      );
    },
    [draftMode, chatId, port],
  );

  // adapter / model / permission / plan all go through PATCH /config (or the draft).
  const patchConfig = useCallback(
    (patch: ChatConfigPatch, label: string) => {
      if (port == null || !chatId) return;
      setChatConfig(port, chatId, patch).catch((err: unknown) =>
        console.warn(`[composer/useComposerTuning] ${label} failed`, { err }),
      );
    },
    [chatId, port],
  );

  const setModel = useCallback(
    (m: string) => {
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { model: m });
        return;
      }
      patchConfig({ model: m }, 'setModel');
    },
    [draftMode, chatId, patchConfig],
  );
  const setAdapter = useCallback(
    (id: string) => {
      // Switching adapter clears the model so it falls back to the new adapter's default.
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { adapterId: id, model: undefined });
        return;
      }
      patchConfig({ adapterId: id }, 'setAdapter');
    },
    [draftMode, chatId, patchConfig],
  );
  const setPlanMode = useCallback(
    (on: boolean) => {
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { planMode: on });
        return;
      }
      patchConfig({ planMode: on }, 'setPlanMode');
    },
    [draftMode, chatId, patchConfig],
  );
  const setPermissionMode = useCallback(
    (mode: ExecutionMode) => {
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { permissionMode: mode });
        return;
      }
      patchConfig({ permissionMode: mode }, 'setPermissionMode');
    },
    [draftMode, chatId, patchConfig],
  );

  return {
    chat,
    adapter,
    model,
    setEffort,
    setFeature,
    setModel,
    setAdapter,
    setPlanMode,
    setPermissionMode,
    disabled: isRunning,
  };
}
