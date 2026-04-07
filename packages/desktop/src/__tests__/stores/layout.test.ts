import { describe, it, expect, beforeEach } from 'vitest';
import { useLayoutStore } from '../../renderer/store/layout.js';

const DEFAULT_STATE = {
  zones: {
    'left-top': { tabs: ['sessions'], activeTab: 'sessions' },
    'left-bottom': { tabs: ['skills', 'agents'], activeTab: 'skills' },
    'right-top': { tabs: ['files'], activeTab: 'files' },
    'right-bottom': { tabs: ['context', 'changes'], activeTab: 'context' },
    'bottom-left': { tabs: ['preview'], activeTab: 'preview' },
    'bottom-right': { tabs: ['terminal'], activeTab: 'terminal' },
  },
  collapsed: { left: false, right: false, bottom: true },
};

beforeEach(() => {
  localStorage.clear();
  useLayoutStore.setState(JSON.parse(JSON.stringify(DEFAULT_STATE)));
});

describe('useLayoutStore', () => {
  describe('moveToolWindow', () => {
    it('moves a tab from source zone to target zone', () => {
      useLayoutStore.getState().moveToolWindow('agents', 'right-top');
      const state = useLayoutStore.getState();
      expect(state.zones['left-bottom']?.tabs).toEqual(['skills']);
      expect(state.zones['right-top']?.tabs).toEqual(['files', 'agents']);
    });

    it('moves a tab to a specific index in the target zone', () => {
      useLayoutStore.getState().moveToolWindow('agents', 'right-top', 0);
      const state = useLayoutStore.getState();
      expect(state.zones['right-top']?.tabs).toEqual(['agents', 'files']);
    });

    it('sets activeTab on target zone if it was null', () => {
      useLayoutStore.setState({
        zones: {
          ...DEFAULT_STATE.zones,
          'right-top': { tabs: [], activeTab: null },
        },
        collapsed: DEFAULT_STATE.collapsed,
      });
      useLayoutStore.getState().moveToolWindow('agents', 'right-top');
      expect(useLayoutStore.getState().zones['right-top']?.activeTab).toBe('agents');
    });

    it('does not change activeTab on target zone if already set', () => {
      useLayoutStore.getState().moveToolWindow('agents', 'right-top');
      expect(useLayoutStore.getState().zones['right-top']?.activeTab).toBe('files');
    });

    it('updates activeTab on source when the active tab is moved', () => {
      useLayoutStore.getState().moveToolWindow('skills', 'right-top');
      expect(useLayoutStore.getState().zones['left-bottom']?.activeTab).toBe('agents');
    });

    it('sets source activeTab to null when last tab is moved', () => {
      useLayoutStore.getState().moveToolWindow('sessions', 'right-top');
      expect(useLayoutStore.getState().zones['left-top']?.activeTab).toBeNull();
    });

    it('does not change source activeTab when a non-active tab is moved', () => {
      useLayoutStore.getState().moveToolWindow('agents', 'right-top');
      expect(useLayoutStore.getState().zones['left-bottom']?.activeTab).toBe('skills');
    });
  });

  describe('reorderTab', () => {
    it('reorders tabs within a zone', () => {
      useLayoutStore.getState().reorderTab('left-bottom', 0, 1);
      expect(useLayoutStore.getState().zones['left-bottom']?.tabs).toEqual(['agents', 'skills']);
    });

    it('reorders from end to start', () => {
      useLayoutStore.getState().reorderTab('right-bottom', 1, 0);
      expect(useLayoutStore.getState().zones['right-bottom']?.tabs).toEqual(['changes', 'context']);
    });

    it('does not change activeTab during reorder', () => {
      useLayoutStore.getState().reorderTab('left-bottom', 0, 1);
      expect(useLayoutStore.getState().zones['left-bottom']?.activeTab).toBe('skills');
    });
  });

  describe('setActiveTab', () => {
    it('sets the active tab for a zone', () => {
      useLayoutStore.getState().setActiveTab('left-bottom', 'agents');
      expect(useLayoutStore.getState().zones['left-bottom']?.activeTab).toBe('agents');
    });

    it('does not affect other zones', () => {
      useLayoutStore.getState().setActiveTab('left-bottom', 'agents');
      expect(useLayoutStore.getState().zones['left-top']?.activeTab).toBe('sessions');
    });
  });

  describe('removeFromZone', () => {
    it('removes a tab from a zone', () => {
      useLayoutStore.getState().removeFromZone('agents');
      expect(useLayoutStore.getState().zones['left-bottom']?.tabs).toEqual(['skills']);
    });

    it('updates activeTab when the active tab is removed', () => {
      useLayoutStore.getState().removeFromZone('skills');
      expect(useLayoutStore.getState().zones['left-bottom']?.activeTab).toBe('agents');
    });

    it('sets activeTab to null when the last tab is removed', () => {
      useLayoutStore.getState().removeFromZone('sessions');
      expect(useLayoutStore.getState().zones['left-top']?.activeTab).toBeNull();
    });

    it('does not change activeTab when a non-active tab is removed', () => {
      useLayoutStore.getState().removeFromZone('agents');
      expect(useLayoutStore.getState().zones['left-bottom']?.activeTab).toBe('skills');
    });
  });

  describe('toggleSide', () => {
    it('toggles left collapsed state', () => {
      useLayoutStore.getState().toggleSide('left');
      expect(useLayoutStore.getState().collapsed.left).toBe(true);
      useLayoutStore.getState().toggleSide('left');
      expect(useLayoutStore.getState().collapsed.left).toBe(false);
    });

    it('toggles right collapsed state', () => {
      useLayoutStore.getState().toggleSide('right');
      expect(useLayoutStore.getState().collapsed.right).toBe(true);
    });

    it('toggles bottom collapsed state (starts true)', () => {
      useLayoutStore.getState().toggleSide('bottom');
      expect(useLayoutStore.getState().collapsed.bottom).toBe(false);
    });

    it('does not affect other sides when toggling one', () => {
      useLayoutStore.getState().toggleSide('left');
      expect(useLayoutStore.getState().collapsed.right).toBe(false);
      expect(useLayoutStore.getState().collapsed.bottom).toBe(true);
    });
  });

  describe('resetLayout', () => {
    it('restores default zones', () => {
      useLayoutStore.getState().moveToolWindow('agents', 'right-top');
      useLayoutStore.getState().resetLayout();
      const state = useLayoutStore.getState();
      expect(state.zones['left-bottom']?.tabs).toEqual(['skills', 'agents']);
      expect(state.zones['right-top']?.tabs).toEqual(['files']);
    });

    it('restores default collapsed state', () => {
      useLayoutStore.getState().toggleSide('left');
      useLayoutStore.getState().resetLayout();
      expect(useLayoutStore.getState().collapsed.left).toBe(false);
      expect(useLayoutStore.getState().collapsed.bottom).toBe(true);
    });
  });

  describe('findZoneForToolWindow', () => {
    it('finds the zone containing a tool window', () => {
      expect(useLayoutStore.getState().findZoneForToolWindow('agents')).toBe('left-bottom');
      expect(useLayoutStore.getState().findZoneForToolWindow('sessions')).toBe('left-top');
      expect(useLayoutStore.getState().findZoneForToolWindow('terminal')).toBe('bottom-right');
    });

    it('returns null for an unregistered tool window', () => {
      expect(useLayoutStore.getState().findZoneForToolWindow('unknown-tool')).toBeNull();
    });
  });

  describe('registerToolWindow', () => {
    it('adds a plugin tool window to the default zone', () => {
      useLayoutStore.getState().registerToolWindow('my-plugin', 'right-bottom');
      const state = useLayoutStore.getState();
      expect(state.zones['right-bottom']?.tabs).toContain('my-plugin');
    });

    it('is a no-op if the tool window is already placed in some zone', () => {
      useLayoutStore.getState().registerToolWindow('my-plugin', 'right-bottom');
      useLayoutStore.getState().registerToolWindow('my-plugin', 'left-top');
      const state = useLayoutStore.getState();
      expect(state.zones['right-bottom']?.tabs).toContain('my-plugin');
      expect(state.zones['left-top']?.tabs).not.toContain('my-plugin');
    });

    it('sets activeTab on the default zone if it was null', () => {
      useLayoutStore.setState({
        zones: { ...DEFAULT_STATE.zones, 'bottom-left': { tabs: [], activeTab: null } },
        collapsed: DEFAULT_STATE.collapsed,
      });
      useLayoutStore.getState().registerToolWindow('my-plugin', 'bottom-left');
      expect(useLayoutStore.getState().zones['bottom-left']?.activeTab).toBe('my-plugin');
    });
  });

  describe('unregisterToolWindow', () => {
    it('removes a tool window from its zone', () => {
      useLayoutStore.getState().registerToolWindow('my-plugin', 'right-bottom');
      useLayoutStore.getState().unregisterToolWindow('my-plugin');
      expect(useLayoutStore.getState().zones['right-bottom']?.tabs).not.toContain('my-plugin');
    });

    it('fixes activeTab when the active tool window is unregistered', () => {
      useLayoutStore.setState({
        zones: { ...DEFAULT_STATE.zones, 'bottom-right': { tabs: ['my-plugin', 'terminal'], activeTab: 'my-plugin' } },
        collapsed: DEFAULT_STATE.collapsed,
      });
      useLayoutStore.getState().unregisterToolWindow('my-plugin');
      expect(useLayoutStore.getState().zones['bottom-right']?.activeTab).toBe('terminal');
    });

    it('sets activeTab to null when the last tab is unregistered', () => {
      useLayoutStore.setState({
        zones: { ...DEFAULT_STATE.zones, 'left-top': { tabs: ['my-plugin'], activeTab: 'my-plugin' } },
        collapsed: DEFAULT_STATE.collapsed,
      });
      useLayoutStore.getState().unregisterToolWindow('my-plugin');
      expect(useLayoutStore.getState().zones['left-top']?.activeTab).toBeNull();
    });
  });
});
