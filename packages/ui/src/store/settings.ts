import { create } from 'zustand';
import type { ProviderConfig, GeneralConfig, GeneralConfigPatch, NotificationConfig } from '@qlan-ro/mainframe-types';
import { GENERAL_DEFAULTS } from '@qlan-ro/mainframe-types';

export type SettingsTab = 'general' | 'providers' | 'keybindings' | 'notifications' | 'remote-access' | 'about';

interface SettingsState {
  activeTab: SettingsTab;
  selectedProvider: string | null;
  providers: Record<string, ProviderConfig>;
  general: GeneralConfig;
  loading: boolean;
  setActiveTab: (tab: SettingsTab) => void;
  setSelectedProvider: (id: string | null) => void;
  setProviderConfig: (adapterId: string, config: ProviderConfig) => void;
  loadProviders: (providers: Record<string, ProviderConfig>) => void;
  loadGeneral: (general: GeneralConfigPatch) => void;
  patchGeneral: (patch: GeneralConfigPatch) => void;
  setLoading: (loading: boolean) => void;
  setNotifications: (notifications: NotificationConfig) => void;
}

function mergeGeneral(current: GeneralConfig, patch: GeneralConfigPatch): GeneralConfig {
  return {
    ...current,
    ...patch,
    idleCompaction: { ...current.idleCompaction, ...patch.idleCompaction },
    notifications: {
      chat: { ...current.notifications.chat, ...patch.notifications?.chat },
      permission: { ...current.notifications.permission, ...patch.notifications?.permission },
      other: { ...current.notifications.other, ...patch.notifications?.other },
    },
  };
}

export const useSettingsStore = create<SettingsState>((set) => ({
  activeTab: 'general',
  selectedProvider: null,
  providers: {},
  general: structuredClone(GENERAL_DEFAULTS),
  loading: false,
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedProvider: (id) => set({ selectedProvider: id }),
  setProviderConfig: (adapterId, config) => set((s) => ({ providers: { ...s.providers, [adapterId]: config } })),
  loadProviders: (providers) => set({ providers }),
  loadGeneral: (general) => set({ general: mergeGeneral(GENERAL_DEFAULTS, general) }),
  patchGeneral: (patch) => set((s) => ({ general: mergeGeneral(s.general, patch) })),
  setLoading: (loading) => set({ loading }),
  setNotifications: (notifications) => set((s) => ({ general: { ...s.general, notifications } })),
}));
