/**
 * layout/surfaces/RunSurface.tsx — renders the Run surface's pane model (Phase 8).
 * 1 or 2 panes laid out along `run.dir`; each pane is a tab strip + active body.
 * Terminal/preview CONTENT is a separate deferred phase — pane bodies render a
 * placeholder. The whole surface is a drop target for a Files-tab drag
 * (`data-drop-surface="run"`).
 */
import { Plus, X } from 'lucide-react';
import { TerminalInstance } from '@/features/terminal/TerminalInstance';
import { PreviewInstance } from '@/features/preview/PreviewInstance';
import { useLayoutStore } from '@/store/layout';
import type { RunPane } from '@/store/run-pane';
import { emitSurfaceIntent } from '@/store/surface-intents';
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

interface RunPaneViewProps {
  pane: RunPane;
  showClosePane: boolean;
}

function RunPaneView({ pane, showClosePane }: RunPaneViewProps) {
  const activeTab = pane.tabs.find((t) => t.id === pane.active);
  const closePane = useLayoutStore((s) => s.closePane);
  return (
    <div data-testid={`run-pane-${pane.id}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex h-[34px] flex-shrink-0 items-center gap-0.5 overflow-x-auto bg-mf-tab-bar px-1 [border-bottom:0.5px_solid_var(--border)] [scrollbar-width:none]">
        {pane.tabs.map((t) => (
          <RunTabPill key={t.id} paneId={pane.id} tab={t} active={t.id === pane.active} />
        ))}
        <button
          data-testid={`run-pane-new-terminal-${pane.id}`}
          onClick={() => emitSurfaceIntent({ type: 'new-terminal', paneId: pane.id })}
          className={`grid h-5 w-5 flex-shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground${!showClosePane ? ' ml-auto' : ''}`}
          aria-label="New terminal"
        >
          <Plus size={11} />
        </button>
        {showClosePane && (
          <button
            data-testid={`run-pane-close-${pane.id}`}
            onClick={() => closePane(pane.id)}
            className="ml-auto grid h-5 w-5 flex-shrink-0 place-items-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close pane"
          >
            <X size={10} />
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {pane.tabs.map((t) => {
          if (t.kind === 'terminal') {
            return <TerminalInstance key={t.id} terminalId={t.id} visible={t.id === pane.active} />;
          }
          if (t.kind === 'preview') {
            return <PreviewInstance key={t.id} tabId={t.id} config={t.config} visible={t.id === pane.active} />;
          }
          return null;
        })}
        {activeTab && activeTab.kind !== 'terminal' && activeTab.kind !== 'preview' && (
          <div className="grid h-full place-items-center text-caption text-muted-foreground">
            {`${activeTab.kind}: ${activeTab.title}`}
          </div>
        )}
      </div>
    </div>
  );
}

export function RunSurface() {
  const run = useLayoutStore((s) => s.run);
  const hasContent = run && run.panes.some((p) => p.tabs.length > 0);
  const multiPane = run ? run.panes.length >= 2 : false;

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
              <RunPaneView pane={pane} showClosePane={multiPane} />
            </div>
          ))}
        </div>
      ) : (
        <SurfacePicker surface="run" />
      )}
    </div>
  );
}
