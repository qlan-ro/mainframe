import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { CenterTab } from '../../renderer/store/tabs.js';
import { useTabsStore } from '../../renderer/store/tabs.js';
import { updateEditorViewState, clearEditorViewState } from '../../renderer/components/editor/editor-state.js';

function makeChatTab(chatId: string, label = 'Chat'): CenterTab {
  return { type: 'chat', id: `chat:${chatId}`, chatId, label };
}

function resetStore(): void {
  useTabsStore.setState({
    tabs: [],
    activePrimaryTabId: null,
    fileView: null,
    fileViewCollapsed: false,
  });
}

describe('useTabsStore', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('starts with empty tabs array', () => {
      expect(useTabsStore.getState().tabs).toEqual([]);
    });

    it('starts with null activePrimaryTabId', () => {
      expect(useTabsStore.getState().activePrimaryTabId).toBeNull();
    });

    it('starts with null fileView', () => {
      expect(useTabsStore.getState().fileView).toBeNull();
    });

    it('starts with fileViewCollapsed false', () => {
      expect(useTabsStore.getState().fileViewCollapsed).toBe(false);
    });
  });

  describe('openTab', () => {
    it('adds a new tab and makes it active', () => {
      const tab = makeChatTab('c1');
      useTabsStore.getState().openTab(tab);
      expect(useTabsStore.getState().tabs).toHaveLength(1);
      expect(useTabsStore.getState().tabs[0]).toEqual(tab);
      expect(useTabsStore.getState().activePrimaryTabId).toBe(tab.id);
    });

    it('does not duplicate an existing tab, just activates it', () => {
      const tab = makeChatTab('c1');
      useTabsStore.getState().openTab(tab);
      useTabsStore.getState().openTab(makeChatTab('c2'));
      useTabsStore.getState().openTab(tab);
      expect(useTabsStore.getState().tabs).toHaveLength(2);
      expect(useTabsStore.getState().activePrimaryTabId).toBe(tab.id);
    });
  });

  describe('closeTab', () => {
    it('removes a tab by id', () => {
      useTabsStore.getState().openTab(makeChatTab('c1'));
      useTabsStore.getState().openTab(makeChatTab('c2'));
      useTabsStore.getState().closeTab('chat:c1');
      const ids = useTabsStore.getState().tabs.map((t: CenterTab) => t.id);
      expect(ids).toEqual(['chat:c2']);
    });

    it('selects the next tab when active tab is closed', () => {
      useTabsStore.getState().openTab(makeChatTab('c1'));
      useTabsStore.getState().openTab(makeChatTab('c2'));
      useTabsStore.getState().openTab(makeChatTab('c3'));
      // active is c3, switch back to c1 to close it
      useTabsStore.getState().setActiveTab('chat:c1');
      useTabsStore.getState().closeTab('chat:c1');
      // c1 was at index 0, so next active should be c2 (index 0 after removal)
      expect(useTabsStore.getState().activePrimaryTabId).toBe('chat:c2');
    });

    it('sets activePrimaryTabId to null when last tab is closed', () => {
      useTabsStore.getState().openTab(makeChatTab('c1'));
      useTabsStore.getState().closeTab('chat:c1');
      expect(useTabsStore.getState().activePrimaryTabId).toBeNull();
    });

    it('preserves activePrimaryTabId when a non-active tab is closed', () => {
      useTabsStore.getState().openTab(makeChatTab('c1'));
      useTabsStore.getState().openTab(makeChatTab('c2'));
      // c2 is active
      useTabsStore.getState().closeTab('chat:c1');
      expect(useTabsStore.getState().activePrimaryTabId).toBe('chat:c2');
    });

    it('does nothing for unknown tab id', () => {
      useTabsStore.getState().openTab(makeChatTab('c1'));
      useTabsStore.getState().closeTab('nonexistent');
      expect(useTabsStore.getState().tabs).toHaveLength(1);
    });
  });

  describe('setActiveTab', () => {
    it('changes the active tab', () => {
      useTabsStore.getState().openTab(makeChatTab('c1'));
      useTabsStore.getState().openTab(makeChatTab('c2'));
      useTabsStore.getState().setActiveTab('chat:c1');
      expect(useTabsStore.getState().activePrimaryTabId).toBe('chat:c1');
    });

    it('does nothing for unknown tab id', () => {
      useTabsStore.getState().openTab(makeChatTab('c1'));
      useTabsStore.getState().setActiveTab('nonexistent');
      expect(useTabsStore.getState().activePrimaryTabId).toBe('chat:c1');
    });
  });

  describe('openChatTab', () => {
    it('creates a chat tab with the correct id format', () => {
      useTabsStore.getState().openChatTab('abc', 'My Chat');
      const tab = useTabsStore.getState().tabs[0]!;
      expect(tab.id).toBe('chat:abc');
      expect(tab.chatId).toBe('abc');
      expect(tab.label).toBe('My Chat');
      expect(tab.type).toBe('chat');
    });

    it('uses default label when none provided', () => {
      useTabsStore.getState().openChatTab('abc');
      expect(useTabsStore.getState().tabs[0]!.label).toBe('New Chat');
    });
  });

  describe('updateTabLabel', () => {
    it('updates the label of a tab', () => {
      useTabsStore.getState().openTab(makeChatTab('c1', 'Old'));
      useTabsStore.getState().updateTabLabel('chat:c1', 'New');
      expect(useTabsStore.getState().tabs[0]!.label).toBe('New');
    });

    it('does not affect other tabs', () => {
      useTabsStore.getState().openTab(makeChatTab('c1', 'A'));
      useTabsStore.getState().openTab(makeChatTab('c2', 'B'));
      useTabsStore.getState().updateTabLabel('chat:c1', 'Updated');
      expect(useTabsStore.getState().tabs[1]!.label).toBe('B');
    });
  });

  describe('file view', () => {
    it('openEditorTab sets fileView with editor type', () => {
      useTabsStore.getState().openEditorTab('/tmp/file.ts');
      const fv = useTabsStore.getState().fileView;
      expect(fv).not.toBeNull();
      expect(fv!.type).toBe('editor');
      if (fv!.type === 'editor') {
        expect(fv!.filePath).toBe('/tmp/file.ts');
        expect(fv!.label).toBe('file.ts');
      }
      expect(useTabsStore.getState().fileViewCollapsed).toBe(false);
    });

    it('openDiffTab sets fileView with diff type', () => {
      useTabsStore.getState().openDiffTab('/tmp/file.ts', 'git');
      const fv = useTabsStore.getState().fileView;
      expect(fv!.type).toBe('diff');
      if (fv!.type === 'diff') {
        expect(fv!.filePath).toBe('/tmp/file.ts');
        expect(fv!.source).toBe('git');
        expect(fv!.label).toContain('diff');
      }
    });

    it('openInlineDiffTab sets fileView with inline diff', () => {
      useTabsStore.getState().openInlineDiffTab('/tmp/file.ts', 'original', 'modified', 10);
      const fv = useTabsStore.getState().fileView;
      expect(fv!.type).toBe('diff');
      if (fv!.type === 'diff') {
        expect(fv!.source).toBe('inline');
        expect(fv!.original).toBe('original');
        expect(fv!.modified).toBe('modified');
        expect(fv!.startLine).toBe(10);
      }
    });

    it('openSkillEditorTab sets fileView with skill-editor type', () => {
      useTabsStore.getState().openSkillEditorTab('skill-1', 'claude', 'My Skill');
      const fv = useTabsStore.getState().fileView;
      expect(fv!.type).toBe('skill-editor');
      if (fv!.type === 'skill-editor') {
        expect(fv!.skillId).toBe('skill-1');
        expect(fv!.adapterId).toBe('claude');
        expect(fv!.label).toBe('My Skill');
      }
    });

    it('closeFileView clears fileView and resets collapsed', () => {
      useTabsStore.getState().openEditorTab('/tmp/file.ts');
      useTabsStore.getState().closeFileView();
      expect(useTabsStore.getState().fileView).toBeNull();
      expect(useTabsStore.getState().fileViewCollapsed).toBe(false);
    });

    it('toggleFileViewCollapsed toggles the collapsed state', () => {
      expect(useTabsStore.getState().fileViewCollapsed).toBe(false);
      useTabsStore.getState().toggleFileViewCollapsed();
      expect(useTabsStore.getState().fileViewCollapsed).toBe(true);
      useTabsStore.getState().toggleFileViewCollapsed();
      expect(useTabsStore.getState().fileViewCollapsed).toBe(false);
    });
  });

  describe('tab ordering', () => {
    it('maintains insertion order', () => {
      useTabsStore.getState().openTab(makeChatTab('c1'));
      useTabsStore.getState().openTab(makeChatTab('c2'));
      useTabsStore.getState().openTab(makeChatTab('c3'));
      const ids = useTabsStore.getState().tabs.map((t: CenterTab) => t.id);
      expect(ids).toEqual(['chat:c1', 'chat:c2', 'chat:c3']);
    });
  });

  describe('navigation back/forward', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      clearEditorViewState();
      vi.useRealTimers();
    });

    it('navigateBack saves the debounced stable state, not the click target', () => {
      useTabsStore.getState().openEditorTab('src/a.ts', undefined, 1, 1);

      // User moves cursor to line 50 — state settles after debounce
      const stateAtLine50 = { cursor: '50:10', scrollTop: 400 };
      updateEditorViewState(stateAtLine50);
      vi.advanceTimersByTime(200); // debounce fires → stableState = stateAtLine50

      // CMD+click fires a burst of events (cursor move + scroll) within <150ms
      const clickCursor = { cursor: '43:32', scrollTop: 400 };
      const clickScroll = { cursor: '43:32', scrollTop: 410 };
      updateEditorViewState(clickCursor);
      updateEditorViewState(clickScroll);
      // go-to-definition resolves immediately — no time for debounce to fire

      useTabsStore.getState().openEditorTab('src/b.ts', undefined, 20, 1);
      useTabsStore.getState().navigateBack();

      const fv = useTabsStore.getState().fileView;
      expect(fv).not.toBeNull();
      expect(fv!.type).toBe('editor');
      if (fv!.type === 'editor') {
        expect(fv!.filePath).toBe('src/a.ts');
        expect(fv!.viewState).toEqual(stateAtLine50);
      }
    });

    it('navigateForward saves the debounced stable state', () => {
      useTabsStore.getState().openEditorTab('src/a.ts', undefined, 1, 1);

      const stateA = { cursor: '5:3', scrollTop: 100 };
      updateEditorViewState(stateA);
      vi.advanceTimersByTime(200);
      // CMD+click burst
      updateEditorViewState({ cursor: '8:1', scrollTop: 100 });
      useTabsStore.getState().openEditorTab('src/b.ts', undefined, 20, 1);

      // In file B — let state settle
      const stateB = { cursor: '25:7', scrollTop: 200 };
      updateEditorViewState(stateB);
      vi.advanceTimersByTime(200);
      // CMD+click burst in B
      updateEditorViewState({ cursor: '25:7', scrollTop: 205 });
      useTabsStore.getState().navigateBack();

      // In file A — let state settle
      const stateA2 = { cursor: '50:1', scrollTop: 500 };
      updateEditorViewState(stateA2);
      vi.advanceTimersByTime(200);
      // CMD+click burst
      updateEditorViewState({ cursor: '60:1', scrollTop: 600 });

      useTabsStore.getState().navigateForward();

      const fv = useTabsStore.getState().fileView;
      expect(fv).not.toBeNull();
      expect(fv!.type).toBe('editor');
      if (fv!.type === 'editor') {
        expect(fv!.filePath).toBe('src/b.ts');
        expect(fv!.viewState).toEqual(stateB);
      }
    });

    it('falls back to no viewState when no tracking exists', () => {
      useTabsStore.getState().openEditorTab('src/a.ts', undefined, 10, 5);
      useTabsStore.getState().openEditorTab('src/b.ts', undefined, 20, 1);

      useTabsStore.getState().navigateBack();

      const fv = useTabsStore.getState().fileView;
      expect(fv!.type).toBe('editor');
      if (fv!.type === 'editor') {
        expect(fv!.filePath).toBe('src/a.ts');
        expect(fv!.line).toBe(10);
        expect(fv!.column).toBe(5);
        expect(fv!.viewState).toBeUndefined();
      }
    });

    it('falls back to latest state when no stable state has settled yet', () => {
      useTabsStore.getState().openEditorTab('src/a.ts', undefined, 1, 1);

      // State updates but debounce hasn't fired yet
      const latest = { cursor: '10:1', scrollTop: 50 };
      updateEditorViewState(latest);
      // No vi.advanceTimersByTime — stableState is still null

      useTabsStore.getState().openEditorTab('src/b.ts', undefined, 20, 1);
      useTabsStore.getState().navigateBack();

      const fv = useTabsStore.getState().fileView;
      if (fv!.type === 'editor') {
        expect(fv!.viewState).toEqual(latest);
      }
    });
  });
});
