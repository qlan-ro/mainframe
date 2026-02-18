import { create } from 'zustand';
import type { AdapterInfo } from '@mainframe/types';

interface AdaptersState {
  adapters: AdapterInfo[];
  loading: boolean;
  setAdapters: (adapters: AdapterInfo[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useAdaptersStore = create<AdaptersState>((set) => ({
  adapters: [],
  loading: false,
  setAdapters: (adapters) => set({ adapters }),
  setLoading: (loading) => set({ loading }),
}));
