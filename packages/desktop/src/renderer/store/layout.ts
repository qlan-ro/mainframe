import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ZoneId } from '@qlan-ro/mainframe-types';

interface ZoneState {
  tabs: string[];
  activeTab: string | null;
}

type CollapsibleSide = 'left' | 'right' | 'bottom';

interface LayoutState {
  zones: Record<ZoneId, ZoneState>;
  collapsed: Record<CollapsibleSide, boolean>;
  moveToolWindow: (id: string, targetZone: ZoneId, index?: number) => void;
  reorderTab: (zoneId: ZoneId, from: number, to: number) => void;
  setActiveTab: (zoneId: ZoneId, tab: string) => void;
  removeFromZone: (id: string) => void;
  toggleSide: (side: CollapsibleSide) => void;
  resetLayout: () => void;
  findZoneForToolWindow: (id: string) => ZoneId | null;
  registerToolWindow: (toolWindowId: string, defaultZone: ZoneId) => void;
  unregisterToolWindow: (toolWindowId: string) => void;
}

const DEFAULT_ZONES: Record<ZoneId, ZoneState> = {
  'left-top': { tabs: ['sessions'], activeTab: 'sessions' },
  'left-bottom': { tabs: ['skills', 'agents'], activeTab: 'skills' },
  'right-top': { tabs: ['files'], activeTab: 'files' },
  'right-bottom': { tabs: ['context', 'changes'], activeTab: 'context' },
  'bottom-left': { tabs: ['preview'], activeTab: 'preview' },
  'bottom-right': { tabs: ['terminal'], activeTab: 'terminal' },
};

const DEFAULT_COLLAPSED: Record<CollapsibleSide, boolean> = {
  left: false,
  right: false,
  bottom: true,
};

function cloneZones(zones: Record<ZoneId, ZoneState>): Record<ZoneId, ZoneState> {
  return JSON.parse(JSON.stringify(zones)) as Record<ZoneId, ZoneState>;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set, get) => ({
      zones: cloneZones(DEFAULT_ZONES),
      collapsed: { ...DEFAULT_COLLAPSED },

      moveToolWindow: (id, targetZone, index) => {
        set((state) => {
          const zones = cloneZones(state.zones);
          let sourceZone: ZoneId | null = null;

          for (const zoneId of Object.keys(zones) as ZoneId[]) {
            if (zones[zoneId]!.tabs.includes(id)) {
              sourceZone = zoneId;
              break;
            }
          }

          if (sourceZone) {
            const src = zones[sourceZone]!;
            const wasActive = src.activeTab === id;
            src.tabs = src.tabs.filter((t) => t !== id);
            if (wasActive) {
              src.activeTab = src.tabs[0] ?? null;
            }
          }

          const tgt = zones[targetZone]!;
          if (index !== undefined) {
            tgt.tabs.splice(index, 0, id);
          } else {
            tgt.tabs.push(id);
          }
          if (tgt.activeTab === null) {
            tgt.activeTab = id;
          }

          return { zones };
        });
      },

      reorderTab: (zoneId, from, to) => {
        set((state) => {
          const zones = cloneZones(state.zones);
          const zone = zones[zoneId]!;
          const [tab] = zone.tabs.splice(from, 1);
          if (tab !== undefined) {
            zone.tabs.splice(to, 0, tab);
          }
          return { zones };
        });
      },

      setActiveTab: (zoneId, tab) => {
        set((state) => {
          const zones = cloneZones(state.zones);
          zones[zoneId]!.activeTab = tab;
          return { zones };
        });
      },

      removeFromZone: (id) => {
        set((state) => {
          const zones = cloneZones(state.zones);

          for (const zoneId of Object.keys(zones) as ZoneId[]) {
            const zone = zones[zoneId]!;
            if (!zone.tabs.includes(id)) continue;

            const wasActive = zone.activeTab === id;
            zone.tabs = zone.tabs.filter((t) => t !== id);
            if (wasActive) {
              zone.activeTab = zone.tabs[0] ?? null;
            }
            break;
          }

          return { zones };
        });
      },

      toggleSide: (side) => {
        set((state) => ({
          collapsed: { ...state.collapsed, [side]: !state.collapsed[side] },
        }));
      },

      resetLayout: () => {
        set({
          zones: cloneZones(DEFAULT_ZONES),
          collapsed: { ...DEFAULT_COLLAPSED },
        });
      },

      findZoneForToolWindow: (id) => {
        const { zones } = get();
        for (const zoneId of Object.keys(zones) as ZoneId[]) {
          if (zones[zoneId]!.tabs.includes(id)) return zoneId;
        }
        return null;
      },

      registerToolWindow: (toolWindowId, defaultZone) => {
        const already = get().findZoneForToolWindow(toolWindowId);
        if (already !== null) return;
        set((state) => {
          const zones = cloneZones(state.zones);
          zones[defaultZone]!.tabs.push(toolWindowId);
          if (zones[defaultZone]!.activeTab === null) {
            zones[defaultZone]!.activeTab = toolWindowId;
          }
          return { zones };
        });
      },

      unregisterToolWindow: (toolWindowId) => {
        set((state) => {
          const zones = cloneZones(state.zones);
          for (const zoneId of Object.keys(zones) as ZoneId[]) {
            const zone = zones[zoneId]!;
            if (!zone.tabs.includes(toolWindowId)) continue;
            const wasActive = zone.activeTab === toolWindowId;
            zone.tabs = zone.tabs.filter((t) => t !== toolWindowId);
            if (wasActive) {
              zone.activeTab = zone.tabs[0] ?? null;
            }
            break;
          }
          return { zones };
        });
      },
    }),
    { name: 'mainframe-layout' },
  ),
);
