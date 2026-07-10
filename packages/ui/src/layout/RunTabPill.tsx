/**
 * RunTabPill — one tab in the Run surface strip: a leading type glyph, the tab
 * title, and a hover close (×). A launch-config tab (console/preview — the only
 * tabs carrying `config`) whose process is live flips its glyph into a red Stop,
 * mirroring the toolbar's Stop (todo #206); clicking it stops the config via the
 * same daemon call the toolbar uses, without closing the tab.
 *
 * data-testid: run-tab-<id> / run-tab-stop-<id> / run-tab-close-<id>.
 */
import { Eye, FileText, Play, Square, Terminal, X } from 'lucide-react';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '@/store/layout';
import { isLaunchStatusLive } from '@/features/run/derive-launch-control';
import { Hint } from '@/components/ui/hint';
import type { RunPane, RunTab } from '@/store/run-pane';

function tabGlyph(tab: RunTab, isActive: boolean) {
  // Inactive → muted (text3); active → the tab type's own accent color.
  const color = !isActive
    ? 'text-mf-text-3'
    : tab.kind === 'terminal'
      ? 'text-mf-term-cyan'
      : tab.kind === 'preview' || tab.kind === 'console'
        ? 'text-mf-surface-run'
        : 'text-foreground';
  const cls = `flex-shrink-0 ${color}`;
  if (tab.kind === 'preview') return <Eye size={11} className={cls} />;
  if (tab.kind === 'console') return <Play size={11} fill="currentColor" className={cls} />;
  if (tab.kind === 'terminal') return <Terminal size={11} className={cls} />;
  return <FileText size={11} className={cls} />;
}

interface RunTabPillProps {
  pane: RunPane;
  tab: RunTab;
  configs: LaunchConfiguration[];
  scopeStatuses: Record<string, LaunchProcessStatus>;
  onStop: (config: LaunchConfiguration) => void;
}

export function RunTabPill({ pane, tab, configs, scopeStatuses, onStop }: RunTabPillProps) {
  const activateRunTab = useLayoutStore((s) => s.activateRunTab);
  const closeRunTab = useLayoutStore((s) => s.closeRunTab);
  const isActive = tab.id === pane.active;

  // The config object is resolved so `onStop` hits the same daemon stop call the
  // toolbar uses; only launch tabs carry a `config`, so terminals keep their glyph.
  const config = tab.config ? configs.find((c) => c.name === tab.config) : undefined;
  const live = config ? isLaunchStatusLive(scopeStatuses[config.name]) : false;

  return (
    <div
      data-testid={`run-tab-${tab.id}`}
      role="tab"
      aria-selected={isActive}
      onClick={() => activateRunTab(pane.id, tab.id)}
      className={[
        'group flex h-[26px] min-w-0 max-w-[160px] flex-shrink-0 cursor-pointer select-none items-center gap-[6px] pl-[9px] pr-[6px]',
        'rounded-[7px] tracking-tight transition-colors duration-[120ms]',
        isActive
          ? 'bg-mf-chip font-semibold text-foreground'
          : 'font-medium text-mf-text-3 hover:bg-accent hover:text-foreground',
      ].join(' ')}
    >
      {live && config ? (
        <Hint label={`Stop ${tab.title}`}>
          <button
            data-testid={`run-tab-stop-${tab.id}`}
            type="button"
            className="inline-flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-[3px] hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              onStop(config);
            }}
          >
            <Square size={9} className="text-destructive" fill="currentColor" />
          </button>
        </Hint>
      ) : (
        tabGlyph(tab, isActive)
      )}
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-caption leading-none">
        {tab.title}
      </span>
      <Hint label={`Close ${tab.title}`}>
        <button
          data-testid={`run-tab-close-${tab.id}`}
          type="button"
          className={`inline-flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-[3px] opacity-0 transition-opacity duration-[120ms] hover:bg-accent group-hover:opacity-100 ${isActive ? 'opacity-60' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            closeRunTab(pane.id, tab.id);
          }}
        >
          <X size={9} />
        </button>
      </Hint>
    </div>
  );
}
