import { create } from 'zustand';
import type { Tag, SyntheticTag } from '@qlan-ro/mainframe-types';
import { listTags, setChatTags as apiSetChatTags } from '../lib/api/tags-api';
import { createLogger } from '../lib/logger';

const log = createLogger('store:tags');

interface TagsState {
  registry: Tag[];
  registryLoaded: boolean;

  selectedProject: string | null; // null = "All"
  selectedTags: Set<string>;
  selectedSynthetic: Set<SyntheticTag>;

  refreshRegistry: () => Promise<void>;
  toggleTag: (name: string) => void;
  toggleSynthetic: (name: SyntheticTag) => void;
  setSelectedProject: (id: string | null) => void;
  clearFilters: () => void;

  applyToChat: (chatId: string, tags: string[]) => Promise<void>;
}

export const useTagsStore = create<TagsState>((set, get) => ({
  registry: [],
  registryLoaded: false,
  selectedProject: null,
  selectedTags: new Set(),
  selectedSynthetic: new Set(),

  async refreshRegistry() {
    try {
      const registry = await listTags();
      set({ registry, registryLoaded: true });
    } catch (err) {
      log.warn('refreshRegistry failed', { err: String(err) });
    }
  },

  toggleTag(name: string) {
    const next = new Set(get().selectedTags);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    set({ selectedTags: next });
  },

  toggleSynthetic(name: SyntheticTag) {
    const next = new Set(get().selectedSynthetic);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    set({ selectedSynthetic: next });
  },

  setSelectedProject(id: string | null) {
    set({ selectedProject: id });
  },

  clearFilters() {
    set({
      selectedTags: new Set(),
      selectedSynthetic: new Set(),
      selectedProject: null,
    });
  },

  async applyToChat(chatId: string, tags: string[]) {
    try {
      await apiSetChatTags(chatId, tags);
      await get().refreshRegistry();
    } catch (err) {
      log.warn('applyToChat failed', { err: String(err) });
      throw err;
    }
  },
}));
