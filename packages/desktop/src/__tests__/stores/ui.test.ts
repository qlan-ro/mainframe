import { describe, it, expect, beforeEach } from 'vitest';
import { useUIStore } from '../../renderer/store/ui.js';

function resetStore(): void {
  useUIStore.setState({
    panelSizes: { left: 240, right: 280, bottom: 200 },
    panelCollapsed: { left: false, right: false, bottom: true },
    leftPanelTab: 'chats',
    rightPanelTab: 'diff',
  });
}

describe('useUIStore', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  describe('initial state', () => {
    it('has default panel sizes', () => {
      const sizes = useUIStore.getState().panelSizes;
      expect(sizes.left).toBe(240);
      expect(sizes.right).toBe(280);
      expect(sizes.bottom).toBe(200);
    });

    it('has default panel collapsed states', () => {
      const collapsed = useUIStore.getState().panelCollapsed;
      expect(collapsed.left).toBe(false);
      expect(collapsed.right).toBe(false);
      expect(collapsed.bottom).toBe(true);
    });

    it('has default panel tabs', () => {
      const state = useUIStore.getState();
      expect(state.leftPanelTab).toBe('chats');
      expect(state.rightPanelTab).toBe('diff');
    });
  });

  describe('setPanelSize', () => {
    it('updates the size of a specific panel', () => {
      useUIStore.getState().setPanelSize('left', 300);
      expect(useUIStore.getState().panelSizes.left).toBe(300);
    });

    it('does not affect other panel sizes', () => {
      useUIStore.getState().setPanelSize('left', 300);
      expect(useUIStore.getState().panelSizes.right).toBe(280);
      expect(useUIStore.getState().panelSizes.bottom).toBe(200);
    });

    it('updates right panel size', () => {
      useUIStore.getState().setPanelSize('right', 400);
      expect(useUIStore.getState().panelSizes.right).toBe(400);
    });

    it('updates bottom panel size', () => {
      useUIStore.getState().setPanelSize('bottom', 350);
      expect(useUIStore.getState().panelSizes.bottom).toBe(350);
    });
  });

  describe('togglePanel', () => {
    it('toggles the left panel collapsed state', () => {
      expect(useUIStore.getState().panelCollapsed.left).toBe(false);
      useUIStore.getState().togglePanel('left');
      expect(useUIStore.getState().panelCollapsed.left).toBe(true);
      useUIStore.getState().togglePanel('left');
      expect(useUIStore.getState().panelCollapsed.left).toBe(false);
    });

    it('toggles the right panel collapsed state', () => {
      expect(useUIStore.getState().panelCollapsed.right).toBe(false);
      useUIStore.getState().togglePanel('right');
      expect(useUIStore.getState().panelCollapsed.right).toBe(true);
    });

    it('toggles the bottom panel collapsed state', () => {
      expect(useUIStore.getState().panelCollapsed.bottom).toBe(true);
      useUIStore.getState().togglePanel('bottom');
      expect(useUIStore.getState().panelCollapsed.bottom).toBe(false);
    });

    it('does not affect other panels when toggling one', () => {
      useUIStore.getState().togglePanel('left');
      expect(useUIStore.getState().panelCollapsed.right).toBe(false);
      expect(useUIStore.getState().panelCollapsed.bottom).toBe(true);
    });
  });

  describe('setLeftPanelTab', () => {
    it('changes the left panel tab', () => {
      useUIStore.getState().setLeftPanelTab('files');
      expect(useUIStore.getState().leftPanelTab).toBe('files');
    });

    it('supports all left panel tabs', () => {
      const tabs = ['files', 'chats', 'context'] as const;
      for (const tab of tabs) {
        useUIStore.getState().setLeftPanelTab(tab);
        expect(useUIStore.getState().leftPanelTab).toBe(tab);
      }
    });
  });

  describe('setRightPanelTab', () => {
    it('changes the right panel tab', () => {
      useUIStore.getState().setRightPanelTab('preview');
      expect(useUIStore.getState().rightPanelTab).toBe('preview');
    });

    it('supports all right panel tabs', () => {
      const tabs = ['diff', 'preview', 'info'] as const;
      for (const tab of tabs) {
        useUIStore.getState().setRightPanelTab(tab);
        expect(useUIStore.getState().rightPanelTab).toBe(tab);
      }
    });
  });
});
