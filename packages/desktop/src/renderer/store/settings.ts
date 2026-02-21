import { create } from 'zustand';
import type { ProviderConfig, GeneralConfig } from '@mainframe/types';
import { GENERAL_DEFAULTS } from '@mainframe/types';

export type SettingsTab = 'providers' | 'general' | 'keybindings' | 'about';

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
}

export const useSettingsStore = create<SettingsState>((set) => ({
  isOpen: false,
  activeTab: 'general',
  selectedProvider: null,
  providers: {},
  general: { ...GENERAL_DEFAULTS },
  loading: false,

  open: (defaultProvider?: string, tab?: SettingsTab) =>
    set({
      isOpen: true,
      activeTab: tab ?? (defaultProvider ? 'providers' : 'general'),
      selectedProvider: defaultProvider ?? null,
    }),
  close: () => set({ isOpen: false }),
  setActiveTab: (tab) => set({ activeTab: tab }),
  setSelectedProvider: (id) => set({ selectedProvider: id }),
  setProviderConfig: (adapterId, config) =>
    set((state) => ({
      providers: { ...state.providers, [adapterId]: config },
    })),
  loadProviders: (providers) => set({ providers }),
  loadGeneral: (general) => set({ general }),
  setLoading: (loading) => set({ loading }),
}));
