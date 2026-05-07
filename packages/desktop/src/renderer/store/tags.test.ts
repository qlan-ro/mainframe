import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useTagsStore } from './tags';

vi.mock('../lib/api/tags-api', () => ({
  listTags: vi.fn().mockResolvedValue([{ name: 'feature', color: 'blue', createdAt: 'x' }]),
  setChatTags: vi.fn().mockResolvedValue(['feature']),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  updateTag: vi.fn(),
  getChatTags: vi.fn(),
}));

describe('tags store', () => {
  beforeEach(() => {
    useTagsStore.setState({
      registry: [],
      registryLoaded: false,
      selectedTags: new Set(),
      selectedSynthetic: new Set(),
      selectedProject: null,
    });
  });

  it('refreshRegistry hydrates the registry', async () => {
    await useTagsStore.getState().refreshRegistry();
    expect(useTagsStore.getState().registry.map((t) => t.name)).toEqual(['feature']);
    expect(useTagsStore.getState().registryLoaded).toBe(true);
  });

  it('toggleTag adds and removes from selectedTags', () => {
    useTagsStore.getState().toggleTag('feature');
    expect(useTagsStore.getState().selectedTags.has('feature')).toBe(true);
    useTagsStore.getState().toggleTag('feature');
    expect(useTagsStore.getState().selectedTags.has('feature')).toBe(false);
  });

  it('toggleSynthetic adds and removes from selectedSynthetic', () => {
    useTagsStore.getState().toggleSynthetic('has-pr');
    expect(useTagsStore.getState().selectedSynthetic.has('has-pr')).toBe(true);
    useTagsStore.getState().toggleSynthetic('has-pr');
    expect(useTagsStore.getState().selectedSynthetic.has('has-pr')).toBe(false);
  });

  it('setSelectedProject updates project filter', () => {
    useTagsStore.getState().setSelectedProject('p1');
    expect(useTagsStore.getState().selectedProject).toBe('p1');
    useTagsStore.getState().setSelectedProject(null);
    expect(useTagsStore.getState().selectedProject).toBeNull();
  });

  it('clearFilters resets selection but not registry', async () => {
    await useTagsStore.getState().refreshRegistry();
    useTagsStore.getState().toggleTag('feature');
    useTagsStore.getState().toggleSynthetic('has-pr');
    useTagsStore.getState().setSelectedProject('p1');
    useTagsStore.getState().clearFilters();
    const s = useTagsStore.getState();
    expect(s.selectedTags.size).toBe(0);
    expect(s.selectedSynthetic.size).toBe(0);
    expect(s.selectedProject).toBeNull();
    expect(s.registry.length).toBeGreaterThan(0);
  });

  it('applyToChat calls setChatTags and refreshes registry', async () => {
    const api = await import('../lib/api/tags-api');
    await useTagsStore.getState().applyToChat('c1', ['feature']);
    expect(api.setChatTags).toHaveBeenCalledWith('c1', ['feature']);
    expect(api.listTags).toHaveBeenCalled();
  });
});
