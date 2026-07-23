'use client';

/**
 * Composer tuning hooks — data layer for EffortPicker + FeaturesPopover.
 *
 * Three independent concerns:
 *   useAdapters         — re-exported from @/store/adapters: the shared revision-guarded
 *                         catalog store, seeded/kept fresh at the app root (adapters-seed).
 *   useProviderDefaults — reads the requested adapter's ProviderConfig (a structural
 *                         TuningDefaults, D-D) live from the shared settings store —
 *                         the same store the Settings pane edits optimistically — so a
 *                         provider-default change reflects in the composer immediately.
 *                         Seeds the store via one fetch when it hasn't been loaded yet.
 *   useComposerTuning   — fetches the current chat, resolves the model, and
 *                         exposes setEffort/setFeature with optimistic updates.
 *
 * useComposerTuning holds plain React state (not aui external-store selectors) to avoid
 * the getSnapshot-loop trap. useAdapters/useProviderDefaults are zustand store selectors,
 * which is safe here — they select a stable reference, not a fresh snapshot per render.
 *
 * `disabled` reads the LIVE thread run-state from `useAuiState` (not the stale
 * REST snapshot) so the toolbar is correctly disabled mid-run. The daemon port
 * is threaded from `useChatExtras()` — no extra `getDaemonPort()` call here.
 */

import { useEffect, useCallback, useRef } from 'react';
import { useAuiState } from '@assistant-ui/react';
import type {
  AdapterInfo,
  AdapterModel,
  Chat,
  EffortLevel,
  ExecutionMode,
  FeatureKey,
  ProviderConfig,
  SessionTuning,
} from '@qlan-ro/mainframe-types';
import { getProviderSettings } from '@/lib/api/settings';
import { useSettingsStore } from '@/store/settings';
import { setChatTuning, setChatConfig, type ChatConfigPatch } from '@/lib/api/chats';
import { useDraftConfig, patchDraftConfig } from '@/features/sessions/runtime/draft-config';
import { reinitializeDraftAdapter } from '@/features/sessions/new-thread/initialize-draft';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { synthesizeDraftChat } from './synthesize-draft-chat';

// ---------------------------------------------------------------------------
// useAdapters — the shared store selector (seeded/kept fresh at the app root;
// see @/store/adapters + @/store/adapters-seed). Re-exported here so existing
// importers (SettingsSidebar, ProvidersPane, ChatSessionInline) keep working.
// ---------------------------------------------------------------------------

export { useAdapters } from '@/store/adapters';

// ---------------------------------------------------------------------------
// useProviderDefaults
// ---------------------------------------------------------------------------

/**
 * Returns this adapter's ProviderConfig (a structural TuningDefaults, D-D) live from
 * the shared settings store, or undefined while loading, on error, or when the adapter
 * has no saved config. The Settings pane writes the same store optimistically on every
 * edit, so provider-default changes reflect here without a reload. Seeds the store with
 * one fetch when nothing has loaded it yet (composer mounted, dialog never opened).
 */
export function useProviderDefaults(adapterId: string | null): ProviderConfig | undefined {
  const extras = useChatExtras();
  const port = extras?.port;
  const config = useSettingsStore((s) => (adapterId != null ? s.providers[adapterId] : undefined));

  useEffect(() => {
    if (port == null) return;
    if (Object.keys(useSettingsStore.getState().providers).length > 0) return;
    getProviderSettings(port)
      .then((data) => useSettingsStore.getState().loadProviders(data))
      .catch((err: unknown) => console.warn('[composer/useProviderDefaults] failed to load provider settings', err));
  }, [port]);

  return config;
}

// ---------------------------------------------------------------------------
// useComposerTuning
// ---------------------------------------------------------------------------

export interface ComposerTuningHook {
  chat: Chat | null;
  adapter: AdapterInfo | null;
  model: AdapterModel | null;
  providerDefaults: ProviderConfig | undefined;
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
  // The id every live-path PATCH must target. `chatConfig.id` is always the daemon's
  // own id — never the __LOCALID_* placeholder — so prefer it over `chatId` whenever
  // a real chat is known. This covers the controller's `chat.id.adopted` flip AND
  // guards the (should-be-impossible) gap where chatConfig has arrived but chatId
  // hasn't flipped yet: a live PATCH must never target a dead local id.
  const patchChatId = realChat?.id ?? chatId;

  // Draft mode: a brand-new __LOCALID_* thread has no daemon chat yet. Bind the
  // toolbar to a Chat synthesized from the in-memory draft and route every setter
  // to patchDraftConfig — the daemon chat is still created only on first send (D3).
  const isLocalDraft = chatId != null && chatId.startsWith('__LOCALID_') && realChat == null;
  const draft = useDraftConfig(isLocalDraft ? chatId : null);
  const draftMode = isLocalDraft && draft != null;
  const adapterInitializations = useRef(new Set<string>());
  const chat: Chat | null = realChat ?? (chatId != null && draft != null ? synthesizeDraftChat(chatId, draft) : null);

  // Live run-state from the assistant-ui thread — stays accurate mid-run
  // (unlike the REST snapshot in `chat.isRunning` which is fetched once).
  const isRunning = useAuiState((s: { thread: { isRunning: boolean } }) => s.thread.isRunning);

  const adapter: AdapterInfo | null = chat != null ? (adapters.find((a) => a.id === chat.adapterId) ?? null) : null;

  const providerDefaults = useProviderDefaults(adapter?.id ?? null);

  // Resolve the AdapterModel: the chat's explicit model, else the user's
  // configured provider default, else the catalog default (chat.model is null
  // when the session inherits the adapter default).
  const model: AdapterModel | null = (() => {
    if (adapter == null) return null;
    const adapterModels = adapter.models;
    return (
      (chat?.model != null ? adapterModels.find((m) => m.id === chat.model) : undefined) ??
      (providerDefaults?.defaultModel != null
        ? adapterModels.find((m) => m.id === providerDefaults.defaultModel)
        : undefined) ??
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
      if (port == null || !patchChatId) return;
      const tuning: SessionTuning = { effort };
      setChatTuning(port, patchChatId, tuning).catch((err: unknown) =>
        console.warn('[composer/useComposerTuning] setEffort failed', { err }),
      );
    },
    [draftMode, chatId, patchChatId, port],
  );

  const setFeature = useCallback(
    (key: FeatureKey, on: boolean) => {
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { [key]: on });
        return;
      }
      if (port == null || !patchChatId) return;
      // Write ONLY the touched field — ultracode→xhigh coercion is a daemon resolver invariant.
      const patch: SessionTuning = { [key]: on };
      setChatTuning(port, patchChatId, patch).catch((err: unknown) =>
        console.warn(`[composer/useComposerTuning] setFeature(${key}) failed`, { err }),
      );
    },
    [draftMode, chatId, patchChatId, port],
  );

  // adapter / model / permission / plan all go through PATCH /config (or the draft).
  const patchConfig = useCallback(
    (patch: ChatConfigPatch, label: string) => {
      if (port == null || !patchChatId) return;
      setChatConfig(port, patchChatId, patch).catch((err: unknown) =>
        console.warn(`[composer/useComposerTuning] ${label} failed`, { err }),
      );
    },
    [patchChatId, port],
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
      if (draftMode && chatId && draft && port != null) {
        if (adapterInitializations.current.has(id)) return;
        adapterInitializations.current.add(id);
        void reinitializeDraftAdapter({
          localId: chatId,
          projectId: draft.projectId,
          port,
          defaultAdapterId: null,
          adapters,
          adapterId: id,
        })
          .catch((err: unknown) =>
            console.warn('[composer/useComposerTuning] setAdapter draft initialization failed', { err }),
          )
          .finally(() => adapterInitializations.current.delete(id));
        return;
      }
      patchConfig({ adapterId: id }, 'setAdapter');
    },
    [adapters, draft, draftMode, chatId, patchConfig, port],
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
    providerDefaults,
    setEffort,
    setFeature,
    setModel,
    setAdapter,
    setPlanMode,
    setPermissionMode,
    disabled: isRunning,
  };
}
