/**
 * layout/surfaces/RunSurface.tsx — renders the Run surface's pane model (Phase 8).
 * 1 or 2 panes laid out along `run.dir`; each pane is a tab strip + active body.
 * Terminal/preview CONTENT is a separate deferred phase — pane bodies render a
 * placeholder. The whole surface is a drop target for a Files-tab drag
 * (`data-drop-surface="run"`).
 */
import { X } from 'lucide-react';
import { useLayoutStore } from '@/store/layout';
import type { RunPane } from '@/store/run-pane';
import { SurfacePicker } from '../SurfacePicker';

function RunTabPill({ paneId, tab, active }: { paneId: string; tab: RunPane['tabs'][number]; active: boolean }) {
  const activateRunTab = useLayoutStore((s) => s.activateRunTab);
  const closeRunTab = useLayoutStore((s) => s.closeRunTab);
  return (
    <div
      data-testid={`run-tab-${tab.id}`}
      onClick={() => activateRunTab(paneId, tab.id)}
      className={`flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-caption ${
        active ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50'
      }`}
    >
      <span className="max-w-[140px] truncate">{tab.title}</span>
      <button
        data-testid={`run-tab-close-${tab.id}`}
        onClick={(e) => {
          e.stopPropagation();
          closeRunTab(paneId, tab.id);
        }}
        className="grid h-3.5 w-3.5 place-items-center rounded-sm hover:bg-accent"
        aria-label={`Close ${tab.title}`}
      >
        <X size={10} />
      </button>
    </div>
  );
}

function RunPaneView({ pane }: { pane: RunPane }) {
  const activeTab = pane.tabs.find((t) => t.id === pane.active);
  return (
    <div data-testid={`run-pane-${pane.id}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-[34px] flex-shrink-0 items-center gap-0.5 overflow-x-auto bg-mf-tab-bar px-1 [border-bottom:0.5px_solid_var(--border)] [scrollbar-width:none]">
        {pane.tabs.map((t) => (
          <RunTabPill key={t.id} paneId={pane.id} tab={t} active={t.id === pane.active} />
        ))}
      </div>
      <div className="grid min-h-0 flex-1 place-items-center text-caption text-muted-foreground">
        {activeTab ? `${activeTab.kind}: ${activeTab.title}` : 'Empty pane'}
      </div>
    </div>
  );
}

export function RunSurface() {
  const run = useLayoutStore((s) => s.run);
  const hasContent = run && run.panes.some((p) => p.tabs.length > 0);

  return (
    <div data-testid="run-surface" className="flex h-full flex-col">
      {hasContent ? (
        <div className={`flex min-h-0 flex-1 ${run.dir === 'h' ? 'flex-col' : 'flex-row'}`}>
          {run.panes.map((pane, i) => (
            <div
              key={pane.id}
              className={`flex min-h-0 min-w-0 flex-1 ${
                i > 0
                  ? run.dir === 'h'
                    ? '[border-top:0.5px_solid_var(--border)]'
                    : '[border-left:0.5px_solid_var(--border)]'
                  : ''
              }`}
            >
              <RunPaneView pane={pane} />
            </div>
          ))}
        </div>
      ) : (
        <SurfacePicker surface="run" />
      )}
    </div>
  );
}
