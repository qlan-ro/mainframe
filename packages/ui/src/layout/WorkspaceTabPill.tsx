/**
 * WorkspaceTabPill — one tab in the workspace strip: a STATIC type glyph, the tab
 * title, an optional Stop, and a hover close (×). The leading glyph identifies
 * the tab TYPE and never changes with the process's running/stopped state:
 * console (logs-only launch) = square-terminal, preview webview = eye, url = globe,
 * terminal = terminal, file kinds = code/diff/file glyphs. A launch-config tab
 * (console/preview — the only tabs carrying `config`) whose process is live shows
 * a red Stop as a SEPARATE control between the title and the close, mirroring the
 * toolbar's Stop (todo #206); clicking it stops the config via the same daemon
 * call the toolbar uses, without closing the tab.
 *
 * A file tab in `preview` mode renders its title italic (VS Code's single
 * replace-me slot) and double-clicking the pill promotes it to permanent.
 *
 * data-testid: workspace-tab-<id> / workspace-tab-stop-<id> / workspace-tab-close-<id>.
 */
import { Code2, Eye, FileText, GitCompare, Globe, Square, SquareTerminal, Terminal, X } from 'lucide-react';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { useLayoutStore } from '@/store/layout';
import { isLaunchStatusLive } from '@/features/run/derive-launch-control';
import { Hint } from '@/components/ui/hint';
import { useSurfaceDragStore } from './use-surface-drag';
import type { RunPane, RunTab } from '@/store/run-pane';

function glyphColor(tab: RunTab, isActive: boolean): string {
  if (!isActive) return 'text-mf-text-3';
  if (tab.kind === 'terminal') return 'text-mf-term-cyan';
  if (tab.kind === 'preview' || tab.kind === 'console' || tab.kind === 'url') return 'text-mf-surface-run';
  if (tab.kind === 'diff') return 'text-mf-accent-amber';
  return 'text-foreground';
}

function tabGlyph(tab: RunTab, isActive: boolean) {
  const cls = `flex-shrink-0 ${glyphColor(tab, isActive)}`;
  if (tab.kind === 'preview') return <Eye size={12} className={cls} />;
  if (tab.kind === 'url') return <Globe size={12} className={cls} />;
  if (tab.kind === 'console') return <SquareTerminal size={12} className={cls} />;
  if (tab.kind === 'terminal') return <Terminal size={12} className={cls} />;
  if (tab.kind === 'diff') return <GitCompare size={12} className={cls} />;
  if (tab.kind === 'code' || tab.kind === 'skill') return <Code2 size={12} className={cls} />;
  return <FileText size={12} className={cls} />;
}

interface WorkspaceTabPillProps {
  pane: RunPane;
  tab: RunTab;
  configs: LaunchConfiguration[];
  scopeStatuses: Record<string, LaunchProcessStatus>;
  onStop: (config: LaunchConfiguration) => void;
}

export function WorkspaceTabPill({ pane, tab, configs, scopeStatuses, onStop }: WorkspaceTabPillProps) {
  const activateRunTab = useLayoutStore((s) => s.activateRunTab);
  const closeRunTab = useLayoutStore((s) => s.closeRunTab);
  const promoteFileTab = useLayoutStore((s) => s.promoteFileTab);
  const beginTabDrag = useSurfaceDragStore((s) => s.beginTabDrag);
  const isActive = tab.id === pane.active;

  // The config object is resolved so `onStop` hits the same daemon stop call the
  // toolbar uses; only launch tabs carry a `config`, so terminals keep their glyph.
  const config = tab.config ? configs.find((c) => c.name === tab.config) : undefined;
  const live = config ? isLaunchStatusLive(scopeStatuses[config.name]) : false;

  return (
    <div
      data-testid={`workspace-tab-${tab.id}`}
      role="tab"
      aria-selected={isActive}
      onClick={() => activateRunTab(pane.id, tab.id)}
      onDoubleClick={() => promoteFileTab(tab.id)}
      onPointerDown={(e) => {
        // The whole pill is the drag handle (no visible grip). A press that moves
        // less than the drag store's threshold still counts as a click.
        if (e.button !== 0) return;
        beginTabDrag(tab.id, { clientX: e.clientX, clientY: e.clientY });
      }}
      className={[
        'group flex h-[26px] min-w-0 max-w-[160px] flex-shrink-0 cursor-pointer select-none items-center gap-[6px] pl-[9px] pr-[6px]',
        'rounded-[7px] tracking-tight transition-colors duration-[120ms]',
        isActive
          ? 'bg-mf-chip font-semibold text-foreground'
          : 'font-medium text-muted-foreground hover:bg-accent hover:text-foreground',
      ].join(' ')}
    >
      {tabGlyph(tab, isActive)}
      <span
        className={[
          'min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-caption leading-none',
          tab.mode === 'preview' ? 'italic' : '',
        ].join(' ')}
      >
        {tab.title}
      </span>
      {live && config && (
        <Hint label={`Stop ${tab.title}`}>
          <button
            data-testid={`workspace-tab-stop-${tab.id}`}
            type="button"
            className="inline-flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-[3px] hover:bg-accent"
            onClick={(e) => {
              e.stopPropagation();
              onStop(config);
            }}
          >
            <Square size={12} className="text-destructive" fill="currentColor" />
          </button>
        </Hint>
      )}
      <Hint label={`Close ${tab.title}`}>
        <button
          data-testid={`workspace-tab-close-${tab.id}`}
          type="button"
          className={`inline-flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-[3px] opacity-0 transition-opacity duration-[120ms] hover:bg-accent group-hover:opacity-100 ${isActive ? 'opacity-60' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            closeRunTab(pane.id, tab.id);
          }}
        >
          <X size={12} />
        </button>
      </Hint>
    </div>
  );
}
