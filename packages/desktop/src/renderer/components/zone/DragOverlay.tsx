import { createContext, useCallback, useContext, useState } from 'react';
import type { ZoneId } from '@qlan-ro/mainframe-types';

interface DragState {
  isDragging: boolean;
  sourceToolWindow: string | null;
  hoveredZone: ZoneId | null;
}

interface DragContextValue extends DragState {
  startDrag: (toolWindowId: string) => void;
  endDrag: () => void;
  setHoveredZone: (zone: ZoneId | null) => void;
}

const DragContext = createContext<DragContextValue | null>(null);

export function useDragContext(): DragContextValue {
  const ctx = useContext(DragContext);
  if (!ctx) throw new Error('useDragContext must be used inside DragProvider');
  return ctx;
}

export function DragProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [state, setState] = useState<DragState>({
    isDragging: false,
    sourceToolWindow: null,
    hoveredZone: null,
  });

  const startDrag = useCallback((toolWindowId: string) => {
    setState({ isDragging: true, sourceToolWindow: toolWindowId, hoveredZone: null });
  }, []);

  const endDrag = useCallback(() => {
    setState({ isDragging: false, sourceToolWindow: null, hoveredZone: null });
  }, []);

  const setHoveredZone = useCallback((zone: ZoneId | null) => {
    setState((s) => ({ ...s, hoveredZone: zone }));
  }, []);

  return (
    <DragContext.Provider value={{ ...state, startDrag, endDrag, setHoveredZone }}>{children}</DragContext.Provider>
  );
}
