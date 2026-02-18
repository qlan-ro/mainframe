import { create, type StoreApi } from 'zustand';
import { useProjectsStore } from './projects';
import { useUIStore } from './ui';

export type ChatTab = { type: 'chat'; id: string; chatId: string; label: string };

export type FileView =
  | { type: 'editor'; filePath: string; label: string }
  | {
      type: 'diff';
      filePath: string;
      label: string;
      source: 'git' | 'session' | 'inline';
      chatId?: string;
      oldPath?: string;
      original?: string;
      modified?: string;
      startLine?: number;
    }
  | { type: 'skill-editor'; skillId: string; adapterId: string; label: string };

// Keep CenterTab as union so existing imports still resolve
export type CenterTab = ChatTab;

interface ProjectTabSnapshot {
  tabs: CenterTab[];
  activePrimaryTabId: string | null;
  fileView: FileView | null;
  fileViewCollapsed: boolean;
  sidebarWidth: number;
}

const DEFAULT_SIDEBAR_PX = 300;

interface TabsState {
  tabs: CenterTab[];
  activePrimaryTabId: string | null;
  fileView: FileView | null;
  fileViewCollapsed: boolean;
  sidebarWidth: number;

  openTab: (tab: CenterTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  openChatTab: (chatId: string, label?: string) => void;
  updateTabLabel: (id: string, label: string) => void;
  openEditorTab: (filePath: string) => void;
  openDiffTab: (filePath: string, source: 'git' | 'session', chatId?: string, oldPath?: string) => void;
  openInlineDiffTab: (filePath: string, original: string, modified: string, startLine?: number) => void;
  openSkillEditorTab: (skillId: string, adapterId: string, label: string) => void;
  setSidebarWidth: (w: number) => void;
  closeFileView: () => void;
  toggleFileViewCollapsed: () => void;
  switchProject: (prevProjectId: string | null, nextProjectId: string) => void;
}

const STORAGE_KEY = 'mf:projectTabs';

interface LegacySnapshot {
  tabs?: Array<{ type: string; id: string; [k: string]: unknown }>;
  activePrimaryTabId?: string | null;
  activeSecondaryTabId?: string | null;
  fileView?: FileView | null;
  fileViewCollapsed?: boolean;
}

function migrateSnapshot(raw: LegacySnapshot): ProjectTabSnapshot {
  const tabs = (raw.tabs ?? []).filter((t) => t.type === 'chat') as CenterTab[];
  return {
    tabs,
    activePrimaryTabId: raw.activePrimaryTabId ?? null,
    fileView: raw.fileView ?? null,
    fileViewCollapsed: raw.fileViewCollapsed ?? false,
    sidebarWidth: (raw as Partial<ProjectTabSnapshot>).sidebarWidth ?? DEFAULT_SIDEBAR_PX,
  };
}

function loadProjectTabs(): Map<string, ProjectTabSnapshot> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const entries: Array<[string, LegacySnapshot]> = JSON.parse(raw);
      return new Map(entries.map(([k, v]) => [k, migrateSnapshot(v)]));
    }
  } catch {
    /* ignore corrupt data */
  }
  return new Map();
}

function saveProjectTabs(map: Map<string, ProjectTabSnapshot>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...map]));
}

const projectTabs = loadProjectTabs();

function expandRightPanel(): void {
  const ui = useUIStore.getState();
  if (ui.panelCollapsed.right) {
    ui.togglePanel('right');
  }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activePrimaryTabId: null,
  fileView: null,
  fileViewCollapsed: false,
  sidebarWidth: DEFAULT_SIDEBAR_PX,

  openTab: (tab) =>
    set((state) => {
      const existing = state.tabs.find((t) => t.id === tab.id);
      if (existing) return { activePrimaryTabId: tab.id };
      return { tabs: [...state.tabs, tab], activePrimaryTabId: tab.id };
    }),

  closeTab: (id) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;
      const newTabs = state.tabs.filter((t) => t.id !== id);
      if (state.activePrimaryTabId === id) {
        const idx = state.tabs.findIndex((t) => t.id === id);
        const newActive = newTabs[Math.min(idx, newTabs.length - 1)]?.id ?? null;
        return { tabs: newTabs, activePrimaryTabId: newActive };
      }
      return { tabs: newTabs };
    }),

  setActiveTab: (id) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;
      return { activePrimaryTabId: id };
    }),

  openChatTab: (chatId, label) => {
    const id = `chat:${chatId}`;
    get().openTab({ type: 'chat', id, chatId, label: label || 'New Chat' });
  },

  updateTabLabel: (id, label) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, label } : t)),
    })),

  openEditorTab: (filePath) => {
    const label = filePath.split('/').pop() || filePath;
    expandRightPanel();
    set({ fileView: { type: 'editor', filePath, label }, fileViewCollapsed: false });
  },

  openDiffTab: (filePath, source, chatId, oldPath) => {
    const label = `${filePath.split('/').pop() || filePath} (diff)`;
    expandRightPanel();
    set({ fileView: { type: 'diff', filePath, label, source, chatId, oldPath }, fileViewCollapsed: false });
  },

  openInlineDiffTab: (filePath, original, modified, startLine) => {
    const label = `${filePath.split('/').pop() || filePath} (diff)`;
    expandRightPanel();
    set({
      fileView: { type: 'diff', filePath, label, source: 'inline', original, modified, startLine },
      fileViewCollapsed: false,
    });
  },

  openSkillEditorTab: (skillId, adapterId, label) => {
    expandRightPanel();
    set({ fileView: { type: 'skill-editor', skillId, adapterId, label }, fileViewCollapsed: false });
  },

  setSidebarWidth: (w) => set({ sidebarWidth: w }),

  closeFileView: () => set({ fileView: null, fileViewCollapsed: false }),

  toggleFileViewCollapsed: () =>
    set((state) => ({
      fileViewCollapsed: !state.fileViewCollapsed,
    })),

  switchProject: (prevProjectId, nextProjectId) => {
    const state = get();
    if (prevProjectId) {
      // Don't persist inline diffs (they contain large strings)
      const persistedFileView =
        state.fileView?.type === 'diff' && state.fileView.source === 'inline' ? null : state.fileView;
      projectTabs.set(prevProjectId, {
        tabs: state.tabs,
        activePrimaryTabId: state.activePrimaryTabId,
        fileView: persistedFileView,
        fileViewCollapsed: state.fileViewCollapsed,
        sidebarWidth: state.sidebarWidth,
      });
    }
    const restored = projectTabs.get(nextProjectId);
    set(
      restored ?? {
        tabs: [],
        activePrimaryTabId: null,
        fileView: null,
        fileViewCollapsed: false,
        sidebarWidth: DEFAULT_SIDEBAR_PX,
      },
    );
    saveProjectTabs(projectTabs);
  },
}));

// Auto-save current project's tabs on every tab state change
(useTabsStore as StoreApi<TabsState>).subscribe((state) => {
  const projectId = useProjectsStore.getState().activeProjectId;
  if (!projectId) return;
  const persistedFileView =
    state.fileView?.type === 'diff' && state.fileView.source === 'inline' ? null : state.fileView;
  projectTabs.set(projectId, {
    tabs: state.tabs,
    activePrimaryTabId: state.activePrimaryTabId,
    fileView: persistedFileView,
    fileViewCollapsed: state.fileViewCollapsed,
    sidebarWidth: state.sidebarWidth,
  });
  saveProjectTabs(projectTabs);
});
