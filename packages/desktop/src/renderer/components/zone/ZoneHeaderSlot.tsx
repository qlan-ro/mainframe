import { createContext, useCallback, useContext, useMemo, useState, useEffect } from 'react';

/**
 * Allows panel components to register internal tabs and/or action buttons
 * with the ZoneHeader.
 *
 * Zone wraps children in <ZoneHeaderSlotProvider>.
 * Panels call useZoneHeaderTabs() and/or useZoneHeaderActions() to register.
 * ZoneHeader reads registered state and renders it.
 */

export interface InternalTab {
  id: string;
  label: string;
  /** If provided, tab shows a close button */
  onClose?: () => void;
}

export interface ZoneHeaderSlotState {
  tabs: InternalTab[];
  activeTabId: string | null;
  onTabChange: ((tabId: string) => void) | null;
  actions: React.ReactNode;
}

interface ZoneHeaderSlotContextValue {
  slotState: ZoneHeaderSlotState;
  setSlotState: (updater: (prev: ZoneHeaderSlotState) => ZoneHeaderSlotState) => void;
}

const defaultSlotState: ZoneHeaderSlotState = {
  tabs: [],
  activeTabId: null,
  onTabChange: null,
  actions: null,
};

const ZoneHeaderSlotContext = createContext<ZoneHeaderSlotContextValue>({
  slotState: defaultSlotState,
  setSlotState: () => {},
});

export function ZoneHeaderSlotProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [slotState, setSlotStateRaw] = useState<ZoneHeaderSlotState>(defaultSlotState);

  const setSlotState = useCallback((updater: (prev: ZoneHeaderSlotState) => ZoneHeaderSlotState): void => {
    setSlotStateRaw(updater);
  }, []);

  const value = useMemo(() => ({ slotState, setSlotState }), [slotState, setSlotState]);

  return <ZoneHeaderSlotContext.Provider value={value}>{children}</ZoneHeaderSlotContext.Provider>;
}

/**
 * Register internal tabs with the ZoneHeader.
 * ZoneHeader renders standardized tab UI and calls onTabChange on click.
 */
export function useZoneHeaderTabs(
  tabs: InternalTab[],
  activeTabId: string | null,
  onTabChange: (tabId: string) => void,
): void {
  const { setSlotState } = useContext(ZoneHeaderSlotContext);

  useEffect(() => {
    setSlotState((prev) => ({ ...prev, tabs, activeTabId, onTabChange }));
    return () => {
      setSlotState((prev) => ({ ...prev, tabs: [], activeTabId: null, onTabChange: null }));
    };
  }, [setSlotState, JSON.stringify(tabs.map((t) => t.id)), activeTabId, onTabChange]);
}

/**
 * Register action buttons with the ZoneHeader.
 * Actions render between tabs/title and the minimize button.
 * Panels that want their own action area (e.g. Preview) simply don't call this.
 */
export function useZoneHeaderActions(actions: React.ReactNode): void {
  const { setSlotState } = useContext(ZoneHeaderSlotContext);

  useEffect(() => {
    setSlotState((prev) => ({ ...prev, actions }));
    return () => {
      setSlotState((prev) => ({ ...prev, actions: null }));
    };
  }, [setSlotState, actions]);
}

/**
 * Hook for ZoneHeader to read all registered slot state.
 */
export function useZoneHeaderSlotState(): ZoneHeaderSlotState {
  const { slotState } = useContext(ZoneHeaderSlotContext);
  return slotState;
}
