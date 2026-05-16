/**
 * Verifies useAppInit hydrates the tag registry at startup (bug #179).
 *
 * Before the fix: useTagsStore.getState().refreshRegistry is never called
 * during loadData, so chips render grey.
 * After the fix: refreshRegistry is included in the parallel Promise.allSettled
 * batch and the registry is populated before the UI renders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── stub all heavy deps that useAppInit imports ──────────────────────────────

const mockUnsubscribe = vi.fn();
const mockUnsubConnection = vi.fn();

vi.mock('../../lib/client', () => ({
  daemonClient: {
    connect: vi.fn(),
    disconnect: vi.fn(),
    onEvent: vi.fn(() => mockUnsubscribe),
    subscribeConnection: vi.fn(() => mockUnsubConnection),
    subscribe: vi.fn(),
    connected: false,
  },
}));

vi.mock('../../lib/ws-event-router', () => ({ routeEvent: vi.fn() }));
vi.mock('../../lib/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../../lib/launch', () => ({ fetchLaunchStatuses: vi.fn() }));
vi.mock('../../lib/launch-scope.js', () => ({ buildLaunchScope: vi.fn() }));

vi.mock('../../lib/api', () => ({
  getProjects: vi.fn().mockResolvedValue([]),
  getAdapters: vi.fn().mockResolvedValue([]),
  getProviderSettings: vi.fn().mockResolvedValue({}),
  getPlugins: vi.fn().mockResolvedValue([]),
  getAllChats: vi.fn().mockResolvedValue([]),
}));

// Mock tags-api so listTags resolves with a known tag.
vi.mock('../../lib/api/tags-api', () => ({
  listTags: vi.fn().mockResolvedValue([{ name: 'bug', color: 'red', createdAt: 'x' }]),
  setChatTags: vi.fn(),
  createTag: vi.fn(),
  deleteTag: vi.fn(),
  updateTag: vi.fn(),
  getChatTags: vi.fn(),
}));

const mockSetProjects = vi.fn();
const mockSetLoading = vi.fn();
const mockSetError = vi.fn();

vi.mock('../../store/projects', () => ({
  useProjectsStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) => {
      const state = { setProjects: mockSetProjects, setLoading: mockSetLoading, setError: mockSetError, projects: [] };
      return selector ? selector(state) : state;
    }),
    {
      getState: vi.fn(() => ({
        setProjects: mockSetProjects,
        setLoading: mockSetLoading,
        setError: mockSetError,
        projects: [],
      })),
    },
  ),
}));

vi.mock('../../store/chats', () => ({
  useChatsStore: Object.assign(
    vi.fn(() => ({})),
    { getState: vi.fn(() => ({ setChats: vi.fn(), setActiveChat: vi.fn() })) },
  ),
}));

vi.mock('../../store/tabs', () => ({
  useTabsStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({ openChatTab: vi.fn() })),
    },
  ),
}));

vi.mock('../../store/skills', () => ({
  useSkillsStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({ fetchSkills: vi.fn(), fetchAgents: vi.fn(), fetchCommands: vi.fn() })),
    },
  ),
}));

const mockLoadProviders = vi.fn();
vi.mock('../../store/settings', () => ({
  useSettingsStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) => {
      const state = { loadProviders: mockLoadProviders };
      return selector ? selector(state) : state;
    }),
    { getState: vi.fn(() => ({ loadProviders: mockLoadProviders })) },
  ),
}));

const mockSetAdapters = vi.fn();
vi.mock('../../store/adapters', () => ({
  useAdaptersStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) => {
      const state = { setAdapters: mockSetAdapters };
      return selector ? selector(state) : state;
    }),
    { getState: vi.fn(() => ({ setAdapters: mockSetAdapters })) },
  ),
}));

vi.mock('../../store', () => ({
  usePluginLayoutStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({ registerContribution: vi.fn(), registerAction: vi.fn() })),
    },
  ),
}));

vi.mock('../../store/sandbox', () => ({
  useSandboxStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({ setProcessStatus: vi.fn() })),
    },
  ),
}));

// ── real tags store — assert it gets hydrated ────────────────────────────────
import { useTagsStore } from '../../store/tags';
import { useAppInit } from '../useAppInit.js';

describe('useAppInit — tag registry hydration (#179)', () => {
  beforeEach(() => {
    useTagsStore.setState({ registry: [], registryLoaded: false });
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('hydrates the tag registry during init so session chips render with colour', async () => {
    // Before init the registry is empty.
    expect(useTagsStore.getState().registry).toHaveLength(0);
    expect(useTagsStore.getState().registryLoaded).toBe(false);

    await act(async () => {
      renderHook(() => useAppInit());
      // Yield the microtask queue so Promise.allSettled resolves.
      await new Promise((r) => setTimeout(r, 0));
    });

    // After init the registry must be populated and registryLoaded true.
    expect(useTagsStore.getState().registry).toHaveLength(1);
    expect(useTagsStore.getState().registry[0]?.name).toBe('bug');
    expect(useTagsStore.getState().registryLoaded).toBe(true);
  });
});
