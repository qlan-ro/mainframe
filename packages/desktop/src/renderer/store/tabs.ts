import { create } from 'zustand';
import { getEditorViewStateForNav, getCursorPositionForNav } from '../components/editor/editor-state';
import { useLayoutStore } from './layout';
import { useChatsStore } from './chats';

export type ChatTab = { type: 'chat'; id: string; chatId: string; label: string };

export type FileView =
  | {
      type: 'editor';
      filePath: string;
      label: string;
      content?: string;
      line?: number;
      column?: number;
      /** Opaque Monaco ICodeEditorViewState for restoring scroll + folds. */
      viewState?: unknown;
      /** Cursor position tracked separately — applied after viewState restore. */
      cursorLine?: number;
      cursorColumn?: number;
    }
  | {
      type: 'diff';
      filePath: string;
      label: string;
      source: 'git' | 'inline';
      chatId?: string;
      oldPath?: string;
      original?: string;
      modified?: string;
      startLine?: number;
      base?: string;
    }
  | { type: 'skill-editor'; skillId: string; adapterId: string; label: string };

export type CenterTab = ChatTab;

const DEFAULT_SIDEBAR_PX = 300;

interface TabsState {
  tabs: CenterTab[];
  activePrimaryTabId: string | null;
  fileView: FileView | null;
  fileViewCollapsed: boolean;
  sidebarWidth: number;
  /** Number of diff changes in the active diff editor (set by MonacoDiffEditor). */
  diffChangeCount: number;

  openTab: (tab: CenterTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  openChatTab: (chatId: string, label?: string) => void;
  updateTabLabel: (id: string, label: string) => void;
  openEditorTab: (filePath: string, content?: string, line?: number, column?: number) => void;
  openDiffTab: (filePath: string, source: 'git', chatId?: string, oldPath?: string, base?: string) => void;
  openInlineDiffTab: (filePath: string, original: string, modified: string, startLine?: number) => void;
  openSkillEditorTab: (skillId: string, adapterId: string, label: string) => void;
  setSidebarWidth: (w: number) => void;
  closeFileView: () => void;
  toggleFileViewCollapsed: () => void;
  navigateBack: () => void;
  navigateForward: () => void;
  expandedPaths: string[];
  revealPath: string | null;
  toggleTreePath: (path: string) => void;
  revealFileInTree: (filePath: string) => void;
  clearRevealPath: () => void;
  setDiffChangeCount: (count: number) => void;
}

interface NavEntry {
  filePath: string;
  line?: number;
  column?: number;
  viewState?: unknown;
  cursorLine?: number;
  cursorColumn?: number;
}
const navBackStack: NavEntry[] = [];
const navForwardStack: NavEntry[] = [];

/** Build a NavEntry for the current editor, capturing view state + cursor. */
function currentEditorNavEntry(fv: FileView & { type: 'editor' }): NavEntry {
  const viewState = getEditorViewStateForNav();
  const cursor = getCursorPositionForNav();
  return {
    filePath: fv.filePath,
    line: fv.line,
    column: fv.column,
    viewState: viewState ?? undefined,
    cursorLine: cursor?.line,
    cursorColumn: cursor?.column,
  };
}

function expandRightPanel(): void {
  const layout = useLayoutStore.getState();
  if (layout.collapsed.right) {
    layout.toggleSide('right');
  }
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activePrimaryTabId: null,
  fileView: null,
  fileViewCollapsed: false,
  sidebarWidth: DEFAULT_SIDEBAR_PX,
  diffChangeCount: 0,
  expandedPaths: ['.'],
  revealPath: null,

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
    get().openTab({ type: 'chat', id, chatId, label: label || 'Untitled session' });
  },

  updateTabLabel: (id, label) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, label } : t)),
    })),

  openEditorTab: (filePath, content, line, column) => {
    const label = filePath.split('/').pop() || filePath;
    if (line != null) {
      const current = get().fileView;
      if (current?.type === 'editor') {
        navBackStack.push(currentEditorNavEntry(current));
        navForwardStack.length = 0;
      }
    }
    expandRightPanel();
    set({ fileView: { type: 'editor', filePath, label, content, line, column }, fileViewCollapsed: false });
  },

  openDiffTab: (filePath, source, chatId, oldPath, base) => {
    const label = `${filePath.split('/').pop() || filePath} (diff)`;
    expandRightPanel();
    set({ fileView: { type: 'diff', filePath, label, source, chatId, oldPath, base }, fileViewCollapsed: false });
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

  navigateBack: () => {
    const entry = navBackStack.pop();
    if (!entry) return;
    const current = get().fileView;
    if (current?.type === 'editor') {
      navForwardStack.push(currentEditorNavEntry(current));
    }
    const label = entry.filePath.split('/').pop() || entry.filePath;
    set({
      fileView: {
        type: 'editor',
        filePath: entry.filePath,
        label,
        line: entry.line,
        column: entry.column,
        viewState: entry.viewState,
        cursorLine: entry.cursorLine,
        cursorColumn: entry.cursorColumn,
      },
      fileViewCollapsed: false,
    });
  },

  navigateForward: () => {
    const entry = navForwardStack.pop();
    if (!entry) return;
    const current = get().fileView;
    if (current?.type === 'editor') {
      navBackStack.push(currentEditorNavEntry(current));
    }
    const label = entry.filePath.split('/').pop() || entry.filePath;
    set({
      fileView: {
        type: 'editor',
        filePath: entry.filePath,
        label,
        line: entry.line,
        column: entry.column,
        viewState: entry.viewState,
        cursorLine: entry.cursorLine,
        cursorColumn: entry.cursorColumn,
      },
      fileViewCollapsed: false,
    });
  },

  toggleTreePath: (path) =>
    set((state) => {
      const has = state.expandedPaths.includes(path);
      return {
        expandedPaths: has ? state.expandedPaths.filter((p) => p !== path) : [...state.expandedPaths, path],
      };
    }),

  revealFileInTree: (filePath) => {
    const parts = filePath.split('/');
    const ancestors: string[] = ['.'];
    for (let i = 0; i < parts.length - 1; i++) {
      ancestors.push(parts.slice(0, i + 1).join('/'));
    }
    set((state) => ({
      expandedPaths: [...new Set([...state.expandedPaths, ...ancestors])],
      revealPath: filePath,
    }));
    setTimeout(() => {
      if (get().revealPath === filePath) set({ revealPath: null });
    }, 3000);
  },

  clearRevealPath: () => set({ revealPath: null }),
  setDiffChangeCount: (count) => set({ diffChangeCount: count }),
}));

/** Close file view when the active project changes (e.g. switching chats across projects). */
function deriveProjectId(state: {
  activeChatId: string | null;
  chats: { id: string; projectId: string }[];
}): string | null {
  if (!state.activeChatId) return null;
  return state.chats.find((c) => c.id === state.activeChatId)?.projectId ?? null;
}

let lastProjectId: string | null = null;
useChatsStore.subscribe((state, prev) => {
  if (state.activeChatId === prev.activeChatId && state.chats === prev.chats) return;
  const projectId = deriveProjectId(state);
  if (projectId !== lastProjectId) {
    if (lastProjectId !== null) {
      useTabsStore.getState().closeFileView();
      navBackStack.length = 0;
      navForwardStack.length = 0;
    }
    lastProjectId = projectId;
  }
});
