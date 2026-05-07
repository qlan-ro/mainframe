import React, { useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/button';
import { PluginView } from '../plugins/PluginView';
import { usePluginLayoutStore } from '../../store/plugins';

export const FullviewModal: React.FC = () => {
  const activeFullviewId = usePluginLayoutStore((s) => s.activeFullviewId);
  const contributions = usePluginLayoutStore((s) => s.contributions);
  const activateFullview = usePluginLayoutStore((s) => s.activateFullview);

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
      onClick={close}
      className="fixed inset-0 z-50 flex items-center justify-center bg-mf-overlay/60"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-5/6 w-5/6 flex-col rounded-lg border border-mf-border bg-mf-app-bg shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-mf-border px-4 py-2">
          <span className="text-xs font-medium uppercase tracking-wide text-mf-text-secondary">{label}</span>
          <Button variant="ghost" size="sm" onClick={close} aria-label="Close" className="hover:bg-mf-hover">
            <X size={14} />
          </Button>
        </div>

        {contribution && (
          <div className="flex-1 overflow-hidden">
            <PluginView pluginId={activeFullviewId} />
          </div>
        )}
      </div>
    </div>
  );
};
