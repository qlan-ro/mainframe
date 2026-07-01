import React, { useEffect } from 'react';
import { Zap, Bell, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useWorkflowsModal, type WfSection } from './use-workflows-modal';
import { useWorkflowsStore, selectPendingCount } from './use-workflows-store';
import { WfLibrary } from './WfLibrary';
import { WfRunsList } from './WfRunsList';
import { WfRunDetail } from './WfRunDetail';

const NAV: Array<{ id: WfSection; label: string; Icon: typeof Bell }> = [
  { id: 'needs', label: 'Needs you', Icon: Bell },
  { id: 'runs', label: 'Runs', Icon: Activity },
  { id: 'library', label: 'Library', Icon: Zap },
];

export function WorkflowsView({ port }: { port: number }): React.ReactElement {
  const { section, selectedRunId, setSection } = useWorkflowsModal();
  const pending = useWorkflowsStore(selectPendingCount);
  const selectRun = useWorkflowsStore((s) => s.selectRun);
  const clearRun = useWorkflowsStore((s) => s.clearRun);

  // Fetch run detail whenever the selectedRunId changes.
  useEffect(() => {
    if (selectedRunId != null) {
      void selectRun(port, selectedRunId);
    } else {
      clearRun();
    }
  }, [selectedRunId, port, selectRun, clearRun]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-mf-window font-sans" data-testid="workflows-view">
      {/* Title bar */}
      <div className="flex h-[50px] flex-shrink-0 items-center gap-3 border-b border-border bg-card px-3.5">
        <Zap size={16} className="text-primary" aria-hidden />
        <span className="text-heading font-bold tracking-tight text-foreground">Workflows</span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left nav */}
        <nav className="flex w-[190px] flex-shrink-0 flex-col gap-0.5 border-r border-border bg-mf-content2 p-2">
          {NAV.map(({ id, label, Icon }) => {
            const on = !selectedRunId && section === id;
            return (
              <button
                key={id}
                data-testid={`workflows-nav-${id}`}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  'flex h-[34px] items-center gap-2.5 rounded-md px-2.5 text-label',
                  on
                    ? 'bg-card font-semibold text-foreground shadow-sm'
                    : 'font-medium text-muted-foreground hover:bg-accent',
                )}
              >
                <Icon size={15} className={on ? 'text-primary' : 'text-mf-text-3'} aria-hidden />
                <span className="flex-1 text-left">{label}</span>
                {id === 'needs' && pending > 0 && (
                  <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-mf-warning px-1.5 text-micro font-bold text-white">
                    {pending}
                  </span>
                )}
              </button>
            );
          })}
          <div className="mt-auto border-t border-border px-2.5 py-2 text-micro leading-normal text-mf-text-3">
            Runs continue in the background — even with the app closed.
          </div>
        </nav>

        {/* Body — run detail takes precedence over section views. */}
        <div className="min-w-0 flex-1 overflow-hidden">
          {selectedRunId ? (
            <WfRunDetail port={port} />
          ) : section === 'library' ? (
            <WfLibrary port={port} />
          ) : section === 'runs' ? (
            <WfRunsList port={port} />
          ) : (
            <div className="p-6 text-body text-muted-foreground" data-testid="workflows-body-placeholder">
              Section: {section}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
