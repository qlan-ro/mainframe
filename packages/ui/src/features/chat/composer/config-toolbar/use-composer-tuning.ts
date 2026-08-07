'use client';

/**
 * Composer tuning hooks — data layer for ComposerToolbar and the per-model
 * effort/options flyout in ModelMenuRow.
 *
 * Three independent concerns:
 *   useAdapters         — re-exported from @/store/adapters: the shared revision-guarded
 *                         catalog store, seeded/kept fresh at the app root (adapters-seed).
 *   useProviderDefaults — re-exported from ./use-provider-defaults: the adapter's
 *                         saved ProviderConfig, live from the shared settings store.
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
 *
 * setEffort/setFeature/setModel route their live path through the mid-session
 * warning gate (see ./use-tuning-warning), so no control can bypass it.
 */

import { useCallback, useRef } from 'react';
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
import { setChatTuning, setChatConfig, type ChatConfigPatch } from '@/lib/api/chats';
import { useDraftConfig, patchDraftConfig } from '@/features/sessions/runtime/draft-config';
import { reinitializeDraftAdapter } from '@/features/sessions/new-thread/initialize-draft';
import { useChatExtras } from '../../runtime/use-chat-thread-runtime';
import { synthesizeDraftChat } from './synthesize-draft-chat';
import { useProviderDefaults } from './use-provider-defaults';
import { useTuningWarning, type TuningWarningHook } from './use-tuning-warning';

// ---------------------------------------------------------------------------
// useAdapters — the shared store selector (seeded/kept fresh at the app root;
// see @/store/adapters + @/store/adapters-seed). Re-exported here so existing
// importers (SettingsSidebar, ProvidersPane, ChatModelChip) keep working.
// ---------------------------------------------------------------------------

export { useAdapters } from '@/store/adapters';

// Re-exported so the existing importers keep their path (see ./use-provider-defaults).
export { useProviderDefaults };

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
  /**
   * Switch to `model` AND apply one tuning field in the same gesture (a write
   * from a non-active model's flyout). ONE guarded change — its apply issues
   * the config PATCH and the tuning PATCH together, so the mid-session gate
   * can never drop half of it.
   */
  setModelTuning: (model: string, tuning: SessionTuning) => void;
  setAdapter: (adapterId: string) => void;
  setPlanMode: (on: boolean) => void;
  setPermissionMode: (mode: ExecutionMode) => void;
  disabled: boolean;
  /** True once the thread has any message — the trigger for the mid-session warning. */
  hasMessages: boolean;
  /** CLI-reported conversation size, null until the first usage report. */
  contextTokens: number | null;
  tuningWarning: TuningWarningHook;
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
  const hasMessages = useAuiState((s: { thread: { messages: readonly unknown[] } }) => s.thread.messages.length > 0);

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

  const contextTokens = extras?.state.contextUsage?.totalTokens ?? null;
  const tuningWarning = useTuningWarning({ chat, model, providerDefaults, hasMessages, contextTokens });
  const guard = tuningWarning.guard;

  const setEffort = useCallback(
    (effort: EffortLevel) => {
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { effort });
        return;
      }
      if (port == null || !patchChatId) return;
      guard({ kind: 'effort', to: effort }, () => {
        const tuning: SessionTuning = { effort };
        setChatTuning(port, patchChatId, tuning).catch((err: unknown) =>
          console.warn('[composer/useComposerTuning] setEffort failed', { err }),
        );
      });
    },
    [draftMode, chatId, patchChatId, port, guard],
  );

  const setFeature = useCallback(
    (key: FeatureKey, on: boolean) => {
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { [key]: on });
        return;
      }
      if (port == null || !patchChatId) return;
      guard({ kind: 'feature', key, to: on }, () => {
        // Write ONLY the touched field — ultracode→xhigh coercion is a daemon resolver invariant.
        const patch: SessionTuning = { [key]: on };
        setChatTuning(port, patchChatId, patch).catch((err: unknown) =>
          console.warn(`[composer/useComposerTuning] setFeature(${key}) failed`, { err }),
        );
      });
    },
    [draftMode, chatId, patchChatId, port, guard],
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
      guard({ kind: 'model', to: m }, () => patchConfig({ model: m }, 'setModel'));
    },
    [draftMode, chatId, patchConfig, guard],
  );
  const setModelTuning = useCallback(
    (m: string, tuning: SessionTuning) => {
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { model: m, ...tuning });
        return;
      }
      if (port == null || !patchChatId) return;
      // Guarded as a model change — switching is the dominant act; the tuning
      // rides in the same parked closure.
      guard({ kind: 'model', to: m }, () => {
        patchConfig({ model: m }, 'setModelTuning');
        setChatTuning(port, patchChatId, tuning).catch((err: unknown) =>
          console.warn('[composer/useComposerTuning] setModelTuning failed', { err }),
        );
      });
    },
    [draftMode, chatId, patchChatId, port, patchConfig, guard],
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
    setModelTuning,
    setAdapter,
    setPlanMode,
    setPermissionMode,
    disabled: isRunning,
    hasMessages,
    contextTokens,
    tuningWarning,
  };
}
