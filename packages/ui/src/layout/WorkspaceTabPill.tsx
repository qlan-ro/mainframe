/**
 * WorkspaceTabPill — one tab in the workspace strip: a type glyph, the title, an
 * optional Stop, and a hover close (×).
 *
 * The leading glyph identifies the tab TYPE by SHAPE and never changes with the
 * process's running/stopped state (eye = preview webview, globe = url,
 * square-terminal = console/logs process, terminal = shell, code = a file,
 * git-compare = a diff). Its INK carries the tab's active state instead — one
 * rule for every kind, rather than a per-kind hue.
 *
 * A launch-config tab (console/preview — the only tabs carrying `config`) whose
 * process is live shows a red Stop as a SEPARATE control between the title and
 * the close, mirroring the toolbar's Stop (todo #206): it stops the config via
 * the same daemon call, without closing the tab.
 *
 * A file tab in `preview` mode renders its title italic (the single replace-me
 * slot); double-clicking the pill promotes it to permanent.
 *
 * data-testid: workspace-tab-<id> / workspace-tab-stop-<id> / workspace-tab-close-<id>.
 */
import { Code2, Eye, FileText, GitCompare, Globe, Square, SquareTerminal, Terminal, X } from 'lucide-react';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import { useLayoutStore } from '@/store/layout';
import { isLaunchStatusLive } from '@/features/run/derive-launch-control';
import type { RunPane, RunTab } from '@/store/run-pane';

const GLYPHS: Record<RunTab['kind'], typeof Eye> = {
  preview: Eye,
  url: Globe,
  console: SquareTerminal,
  terminal: Terminal,
  code: Code2,
  skill: Code2,
  diff: GitCompare,
  viewer: FileText,
};

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
  const isActive = tab.id === pane.active;

  // The config object is resolved so `onStop` hits the same daemon stop call the
  // toolbar uses; only launch tabs carry a `config`, so terminals keep their glyph.
  const config = tab.config ? configs.find((c) => c.name === tab.config) : undefined;
  const live = config ? isLaunchStatusLive(scopeStatuses[config.name]) : false;
  const Glyph = GLYPHS[tab.kind];

  return (
    <div
      data-testid={`workspace-tab-${tab.id}`}
      role="tab"
      aria-selected={isActive}
      onClick={() => activateRunTab(pane.id, tab.id)}
      onDoubleClick={() => promoteFileTab(tab.id)}
      className={cn(
        'group flex h-6 max-w-40 min-w-0 shrink-0 cursor-pointer items-center gap-1.5 rounded-md pr-1 pl-2 text-xs select-none',
        isActive
          ? 'bg-muted font-semibold text-foreground'
          : 'font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground',
      )}
    >
      <Glyph className={cn('size-3 shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
      <span className={cn('min-w-0 flex-1 truncate', tab.mode === 'preview' && 'italic')}>{tab.title}</span>
      {live && config && (
        <Hint label={`Stop ${tab.title}`}>
          <Button
            data-testid={`workspace-tab-stop-${tab.id}`}
            variant="ghost"
            size="icon-2xs"
            onClick={(e) => {
              e.stopPropagation();
              onStop(config);
            }}
          >
            <Square className="text-destructive" fill="currentColor" />
          </Button>
        </Hint>
      )}
      <Hint label={`Close ${tab.title}`}>
        <Button
          data-testid={`workspace-tab-close-${tab.id}`}
          variant="ghost"
          size="icon-2xs"
          className={cn('opacity-0 group-hover:opacity-100', isActive && 'opacity-60')}
          onClick={(e) => {
            e.stopPropagation();
            closeRunTab(pane.id, tab.id);
          }}
        >
          <X />
        </Button>
      </Hint>
    </div>
  );
}
