import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type PanelId = 'left' | 'right' | 'bottom';

interface UIState {
  panelSizes: Record<PanelId, number>;
  panelCollapsed: Record<PanelId, boolean>;
  leftPanelTab: 'files' | 'chats' | 'context';
  rightPanelTab: 'diff' | 'preview' | 'info';
  bottomPanelTab: 'terminal' | 'history' | 'logs';

  setPanelSize: (id: PanelId, size: number) => void;
  togglePanel: (id: PanelId) => void;
  setLeftPanelTab: (tab: UIState['leftPanelTab']) => void;
  setRightPanelTab: (tab: UIState['rightPanelTab']) => void;
  setBottomPanelTab: (tab: UIState['bottomPanelTab']) => void;
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      panelSizes: { left: 240, right: 280, bottom: 200 },
      panelCollapsed: { left: false, right: false, bottom: true },
      leftPanelTab: 'chats',
      rightPanelTab: 'diff',
      bottomPanelTab: 'terminal',

      setPanelSize: (id, size) =>
        set((state) => ({
          panelSizes: { ...state.panelSizes, [id]: size },
        })),
      togglePanel: (id) =>
        set((state) => ({
          panelCollapsed: { ...state.panelCollapsed, [id]: !state.panelCollapsed[id] },
        })),
      setLeftPanelTab: (tab) => set({ leftPanelTab: tab }),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
      setBottomPanelTab: (tab) => set({ bottomPanelTab: tab }),
    }),
    { name: 'mainframe-ui' },
  ),
);
