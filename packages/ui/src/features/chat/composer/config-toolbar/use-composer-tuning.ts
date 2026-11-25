'use client';

import { mfToast } from '@/lib/toast';
import { useProviderSwitch, type ProviderSwitchRequest } from './use-provider-switch';
import { useSessionModel } from './use-session-model';

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
import { useSettingsStore } from '@/store/settings';
import { supportsCliModel } from '@/lib/cli-model';
import { useChatExtras } from '../../runtime/chat-extras';
import { synthesizeDraftChat } from './synthesize-draft-chat';
import { useProviderDefaults } from './use-provider-defaults';
import { useTuningWarning, type TuningWarningHook } from './use-tuning-warning';

// ---------------------------------------------------------------------------
// useAdapters — the shared store selector (seeded/kept fresh at the app root;
// see @/store/adapters + @/store/adapters-seed). Re-exported here so existing
// importers (SettingsSidebar, ProvidersPane) keep working.
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
  runningModel: AdapterModel | null;
  providerDefaults: ProviderConfig | undefined;
  setEffort: (effort: EffortLevel) => void;
  setFeature: (key: FeatureKey, on: boolean) => void;
  setModel: (model: string, onSettled?: () => void) => boolean | void;
  switchProvider: (request: ProviderSwitchRequest, onSettled?: () => void) => void;
  setAdapter: (adapterId: string) => void;
  setPermissionMode: (mode: ExecutionMode) => void;
  /** True while bound to a `__LOCALID_*` draft with no daemon chat yet. */
  draftMode: boolean;
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
 * Live controls read the server's chat configuration.
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
  const reconcileModelResponse = extras?.reconcileModelResponse;
  const switchProvider = useProviderSwitch(realChat, port, reconcileModelResponse);
  const chat: Chat | null = realChat ?? (chatId != null && draft != null ? synthesizeDraftChat(chatId, draft) : null);

  // Live run-state from the assistant-ui thread — stays accurate mid-run
  // (unlike the REST snapshot in `chat.isRunning` which is fetched once).
  const isRunning = useAuiState((s: { thread: { isRunning: boolean } }) => s.thread.isRunning);
  const hasMessages = useAuiState((s: { thread: { messages: readonly unknown[] } }) => s.thread.messages.length > 0);

  const catalog: AdapterInfo | null = chat != null ? (adapters.find((a) => a.id === chat.adapterId) ?? null) : null;

  const providerDefaults = useProviderDefaults(catalog?.id ?? null);
  const { adapter, model, runningModel } = useSessionModel(
    port,
    catalog,
    chat,
    extras?.state,
    providerDefaults,
    draftMode ? draft : undefined,
  );

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
        void setChatTuning(port, patchChatId, tuning).catch((err: unknown) =>
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
        void setChatTuning(port, patchChatId, patch).catch((err: unknown) =>
          console.warn(`[composer/useComposerTuning] setFeature(${key}) failed`, { err }),
        );
      });
    },
    [draftMode, chatId, patchChatId, port, guard],
  );

  // adapter / model / permission all go through PATCH /config (or the draft).
  const patchConfig = useCallback(
    (patch: ChatConfigPatch, label: string, onSettled?: () => void) => {
      if (port == null || !patchChatId) {
        onSettled?.();
        return;
      }
      const request = () => setChatConfig(port, patchChatId, patch);
      void (label === 'setModel' && reconcileModelResponse ? reconcileModelResponse(patchChatId, request) : request())
        .catch((err: unknown) => {
          console.warn(`[composer/useComposerTuning] ${label} failed`, { err });
          if (patch.model !== undefined) {
            mfToast.error('Could not switch model', { description: err instanceof Error ? err.message : String(err) });
          }
        })
        .finally(onSettled);
    },
    [patchChatId, port, reconcileModelResponse],
  );

  const setModel = useCallback(
    (model: string, onSettled?: () => void) => {
      if (draftMode && chatId) {
        patchDraftConfig(chatId, { model });
        return;
      }
      return guard({ kind: 'model', to: model }, () => {
        patchConfig({ model }, 'setModel', onSettled);
      });
    },
    [draftMode, chatId, patchConfig, guard],
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
      const target = adapters.find((candidate) => candidate.id === id);
      const configuredModel = useSettingsStore.getState().providers[id]?.defaultModel;
      const defaultModel = supportsCliModel(id)
        ? 'default'
        : (target?.models.find((candidate) => candidate.isDefault)?.id ?? 'default');
      const model = configuredModel && configuredModel !== 'default' ? configuredModel : defaultModel;
      patchConfig({ adapterId: id, model }, 'setAdapter');
    },
    [adapters, draft, draftMode, chatId, patchConfig, port],
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
    runningModel,
    providerDefaults,
    setEffort,
    setFeature,
    setModel,
    switchProvider,
    setAdapter,
    setPermissionMode,
    draftMode,
    disabled: isRunning,
    hasMessages,
    contextTokens,
    tuningWarning,
  };
}
