import React, { useEffect } from 'react';
import { Zap, Bell, Activity, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Hint } from '@/components/ui/hint';
import { useWorkflowsModal, type WfSection } from './use-workflows-modal';
import { useWorkflowsStore, selectPendingCount } from './use-workflows-store';
import { WfLibrary } from './WfLibrary';
import { WfRunsList } from './WfRunsList';
import { WfRunDetail } from './WfRunDetail';
import { WfNeedsYou } from './WfNeedsYou';

const NAV: Array<{ id: WfSection; label: string; Icon: typeof Bell }> = [
  { id: 'needs', label: 'Needs you', Icon: Bell },
  { id: 'runs', label: 'Runs', Icon: Activity },
  { id: 'library', label: 'Library', Icon: Zap },
];

export function WorkflowsView({ port }: { port: number }): React.ReactElement {
  const { section, selectedRunId, setSection, close } = useWorkflowsModal();
  const pending = useWorkflowsStore(selectPendingCount);
  const runs = useWorkflowsStore((s) => s.runs);
  const selectRun = useWorkflowsStore((s) => s.selectRun);
  const clearRun = useWorkflowsStore((s) => s.clearRun);
  const active = runs.filter((r) => r.status === 'running' || r.status === 'waiting').length;

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
      {/* Title bar — prototype: gap 11px, padding 0 14px */}
      <div className="flex h-[50px] flex-shrink-0 items-center gap-[11px] border-b border-border bg-card px-[14px]">
        <Hint label="Close">
          <button
            type="button"
            data-testid="workflows-close"
            onClick={close}
            className="inline-flex h-[30px] w-[30px] items-center justify-center rounded-md text-mf-text-3 hover:bg-accent"
          >
            <X size={15} aria-hidden />
          </button>
        </Hint>
        <Zap size={16} className="text-primary" aria-hidden />
        <span className="text-heading font-bold tracking-tight text-foreground">Workflows</span>
        <span
          data-testid="workflows-title-count"
          className="inline-flex items-center rounded-md bg-muted px-[8px] py-[2px] font-mono text-micro text-mf-text-3"
        >
          {active} active · {pending} need you
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Left nav — prototype: padding 10px 8px, gap 2px between items */}
        <nav className="flex w-[190px] flex-shrink-0 flex-col gap-[2px] border-r border-border bg-mf-content2 py-[10px] px-[8px]">
          {NAV.map(({ id, label, Icon }) => {
            const on = !selectedRunId && section === id;
            return (
              <button
                key={id}
                data-testid={`workflows-nav-${id}`}
                type="button"
                onClick={() => setSection(id)}
                className={cn(
                  'flex h-[34px] items-center gap-[9px] rounded-md px-[10px] text-label',
                  on
                    ? 'bg-card font-semibold text-foreground shadow-sm'
                    : 'font-medium text-muted-foreground hover:bg-accent',
                )}
              >
                <Icon size={15} className={on ? 'text-primary' : 'text-mf-text-3'} aria-hidden />
                <span className="flex-1 text-left">{label}</span>
                {id === 'needs' && pending > 0 && (
                  <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-mf-warning px-[5px] text-micro font-bold text-white">
                    {pending}
                  </span>
                )}
              </button>
            );
          })}
          <div className="mt-auto border-t border-border px-[10px] py-[8px] text-micro leading-normal text-mf-text-3">
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
          ) : section === 'needs' ? (
            <WfNeedsYou port={port} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
