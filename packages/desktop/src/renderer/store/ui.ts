import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type PanelId = 'left' | 'right' | 'bottom';

interface UIState {
  panelSizes: Record<PanelId, number>;
  panelCollapsed: Record<PanelId, boolean>;
  panelVisible: boolean;
  leftPanelTab: 'files' | 'chats' | 'context';
  rightPanelTab: 'diff' | 'preview' | 'info';
  bottomPanelMode: 'preview' | 'terminal';

  setPanelSize: (id: PanelId, size: number) => void;
  togglePanel: (id: PanelId) => void;
  setPanelVisible: (visible: boolean) => void;
  setLeftPanelTab: (tab: UIState['leftPanelTab']) => void;
  setRightPanelTab: (tab: UIState['rightPanelTab']) => void;
  setBottomPanelMode: (mode: UIState['bottomPanelMode']) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      panelSizes: { left: 260, right: 260, bottom: 200 },
      panelCollapsed: { left: false, right: false, bottom: true },
      panelVisible: false,
      leftPanelTab: 'chats',
      rightPanelTab: 'diff',
      bottomPanelMode: 'preview',

      setPanelSize: (id, size) =>
        set((state) => ({
          panelSizes: { ...state.panelSizes, [id]: size },
        })),
      togglePanel: (id) =>
        set((state) => ({
          panelCollapsed: { ...state.panelCollapsed, [id]: !state.panelCollapsed[id] },
        })),
      setPanelVisible: (visible) =>
        set(() => ({
          panelVisible: visible,
        })),
      setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
      setBottomPanelMode: (mode) => set({ bottomPanelMode: mode }),
    }),
    { name: 'mainframe-ui' },
  ),
);
