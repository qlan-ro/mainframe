import { create } from 'zustand';
import type { ProviderConfig, GeneralConfig, NotificationConfig } from '@qlan-ro/mainframe-types';
import { GENERAL_DEFAULTS } from '@qlan-ro/mainframe-types';

export type SettingsTab = 'general' | 'providers' | 'notifications' | 'remote-access' | 'about';

interface SettingsState {
  isOpen: boolean;
  activeTab: SettingsTab;
  selectedProvider: string | null;
  providers: Record<string, ProviderConfig>;
  general: GeneralConfig;
  loading: boolean;
  open: (defaultProvider?: string, tab?: SettingsTab) => void;
  close: () => void;
  setActiveTab: (tab: SettingsTab) => void;
  setSelectedProvider: (id: string | null) => void;
  setProviderConfig: (adapterId: string, config: ProviderConfig) => void;
  loadProviders: (providers: Record<string, ProviderConfig>) => void;
  loadGeneral: (general: GeneralConfig) => void;
  setLoading: (loading: boolean) => void;
  setNotifications: (notifications: NotificationConfig) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOpen: false,
  activeTab: 'general',
  selectedProvider: null,
  providers: {},
  // Deep-clone: a shallow `{ ...GENERAL_DEFAULTS }` shares the module-level
  // `notifications` object (`GENERAL_DEFAULTS.notifications === NOTIFICATION_DEFAULTS`),
  // so toggling a notification would mutate the shared default across every store.
  general: structuredClone(GENERAL_DEFAULTS),
  loading: false,
  open: (defaultProvider, tab) =>
    set({
      isOpen: true,
      activeTab: tab ?? (defaultProvider ? 'providers' : 'general'),
      selectedProvider: defaultProvider ?? null,
    }),
  close: () => set({ isOpen: false }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedProvider: (id) => set({ selectedProvider: id }),
  setProviderConfig: (adapterId, config) => set((s) => ({ providers: { ...s.providers, [adapterId]: config } })),
  loadProviders: (providers) => set({ providers }),
  loadGeneral: (general) => set({ general }),
  setLoading: (loading) => set({ loading }),
  setNotifications: (notifications) => set((s) => ({ general: { ...s.general, notifications } })),
}));
