import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { CenterTab } from '../../renderer/store/tabs.js';
import { useTabsStore } from '../../renderer/store/tabs.js';
import { setActiveEditorGetter } from '../../renderer/components/editor/editor-state.js';

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
    afterEach(() => {
      setActiveEditorGetter(null);
    });

    it('navigateBack uses live cursor position, not stale fileView line', () => {
      // Open file A at line 1
      useTabsStore.getState().openEditorTab('src/a.ts', undefined, 1, 1);

      // Simulate user moving cursor to line 50, col 10 in the editor
      setActiveEditorGetter(() => ({ line: 50, column: 10 }));

      // Navigate to file B at line 20 — this pushes file A onto the back stack
      useTabsStore.getState().openEditorTab('src/b.ts', undefined, 20, 1);

      // Navigate back — should restore file A at line 50 (live cursor), not line 1 (stale)
      useTabsStore.getState().navigateBack();

      const fv = useTabsStore.getState().fileView;
      expect(fv).not.toBeNull();
      expect(fv!.type).toBe('editor');
      if (fv!.type === 'editor') {
        expect(fv!.filePath).toBe('src/a.ts');
        expect(fv!.line).toBe(50);
        expect(fv!.column).toBe(10);
      }
    });

    it('navigateForward uses live cursor position from current editor', () => {
      // Open file A at line 1, then navigate to file B at line 20
      useTabsStore.getState().openEditorTab('src/a.ts', undefined, 1, 1);
      setActiveEditorGetter(() => ({ line: 5, column: 3 }));
      useTabsStore.getState().openEditorTab('src/b.ts', undefined, 20, 1);

      // Navigate back to file A
      setActiveEditorGetter(() => ({ line: 25, column: 7 }));
      useTabsStore.getState().navigateBack();

      // Now file A is open. Simulate cursor move to line 60
      setActiveEditorGetter(() => ({ line: 60, column: 1 }));

      // Navigate forward — should push file A at line 60 (live) onto back stack,
      // and restore file B at line 25 (captured when we navigated back)
      useTabsStore.getState().navigateForward();

      const fv = useTabsStore.getState().fileView;
      expect(fv).not.toBeNull();
      expect(fv!.type).toBe('editor');
      if (fv!.type === 'editor') {
        expect(fv!.filePath).toBe('src/b.ts');
        expect(fv!.line).toBe(25);
        expect(fv!.column).toBe(7);
      }
    });

    it('falls back to fileView line/column when no editor getter is registered', () => {
      // No editor getter registered — should use stale fileView values as fallback
      useTabsStore.getState().openEditorTab('src/a.ts', undefined, 10, 5);
      useTabsStore.getState().openEditorTab('src/b.ts', undefined, 20, 1);

      useTabsStore.getState().navigateBack();

      const fv = useTabsStore.getState().fileView;
      expect(fv!.type).toBe('editor');
      if (fv!.type === 'editor') {
        expect(fv!.filePath).toBe('src/a.ts');
        expect(fv!.line).toBe(10);
        expect(fv!.column).toBe(5);
      }
    });
  });
});
