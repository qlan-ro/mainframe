import { create } from 'zustand';
import type { AdapterInfo, AdapterModel } from '@qlan-ro/mainframe-types';

interface AdaptersState {
  adapters: AdapterInfo[];
  loading: boolean;
  setAdapters: (adapters: AdapterInfo[]) => void;
  setLoading: (loading: boolean) => void;
  updateAdapterModels: (adapterId: string, models: AdapterModel[]) => void;
}

export const useAdaptersStore = create<AdaptersState>((set) => ({
  adapters: [],
  loading: false,
  setAdapters: (adapters) => set({ adapters }),
  setLoading: (loading) => set({ loading }),
  updateAdapterModels: (adapterId, models) =>
    set((state) => ({
      adapters: state.adapters.map((a) => (a.id === adapterId ? { ...a, models } : a)),
    })),
}));
