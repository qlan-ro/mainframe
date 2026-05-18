import React, { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { PluginView } from '../plugins/PluginView';
import { usePluginLayoutStore } from '../../store/plugins';

type SetSlot = (node: ReactNode) => void;
const FullviewHeaderSlotContext = createContext<SetSlot | null>(null);

/**
 * Render `node` into the active FullviewModal header. No-op when not inside a
 * FullviewModal. Caller should memoize `node` (e.g. via `useMemo`) to avoid
 * spurious slot updates each render.
 */
export function useFullviewHeaderSlot(node: ReactNode): void {
  const setSlot = useContext(FullviewHeaderSlotContext);
  useEffect(() => {
    if (!setSlot) return;
    setSlot(node);
    return () => setSlot(null);
  }, [setSlot, node]);
}

export const FullviewModal: React.FC = () => {
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);
  const contributions = usePluginLayoutStore((s) => s.contributions);
  const activateFullview = usePluginLayoutStore((s) => s.activateFullview);
  const [headerSlot, setHeaderSlot] = useState<ReactNode>(null);

  const close = useCallback((): void => {
    if (activeFullviewId) {
      activateFullview(activeFullviewId);
    }
  }, [activeFullviewId, activateFullview]);

  useEffect(() => {
    if (!activeFullviewId) return;
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeFullviewId, close]);

  if (!activeFullviewId) return null;

  const contribution = contributions.find((c) => c.pluginId === activeFullviewId && c.zone === 'fullview');
  const label = contribution?.label ?? activeFullviewId;

  return (
    <div
      data-testid="fullview-modal-backdrop"
      role="presentation"
      onClick={close}
      className="fixed inset-0 z-50 flex items-center justify-center bg-mf-overlay/60"
    >
      <div
        data-testid="fullview-modal"
        onClick={(e) => e.stopPropagation()}
        className="flex h-5/6 w-5/6 flex-col rounded-lg border border-mf-border bg-mf-app-bg shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-mf-border px-4 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-mf-text-secondary">{label}</span>
          <div className="flex items-center gap-1">
            {headerSlot}
            <Button
              variant="ghost"
              size="sm"
              data-testid="fullview-button-close"
              onClick={close}
              aria-label="Close"
              className="text-mf-text-secondary hover:bg-mf-panel-bg hover:text-mf-text-primary"
            >
              <X size={14} />
            </Button>
          </div>
        </div>

        {contribution && (
          <div className="flex-1 overflow-hidden">
            <FullviewHeaderSlotContext.Provider value={setHeaderSlot}>
              <PluginView pluginId={activeFullviewId} />
            </FullviewHeaderSlotContext.Provider>
          </div>
        )}
      </div>
    </div>
  );
};
