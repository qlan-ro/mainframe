/**
 * WorkspaceTabPill — one workspace tab: a type glyph, the title, an optional
 * Stop, and a close (×). The shared title-bar tab shape (`tab-shape`), with the
 * glyph where a session tab has its status dot (W2).
 *
 * The leading glyph identifies the tab TYPE by SHAPE and never changes with the
 * process's running/stopped state (eye = preview webview, globe = url,
 * square-terminal = console/logs process, terminal = shell, code = a file,
 * git-compare = a diff). Its INK carries the tab's active state instead — one
 * rule for every kind, rather than a per-kind hue.
 *
 * The selected tab never truncates (`WorkspaceTabs` keeps it in view); the others
 * shrink to 60px (glyph plus a few letters) and show their × over the end of the
 * title on hover or keyboard focus, so it takes no space.
 *
 * A launch-config tab (console/preview — the only tabs carrying `config`) whose
 * process is live shows a red Stop as a SEPARATE control between the title and
 * the close, mirroring the toolbar's Stop (todo #206): it stops the config via
 * the same daemon call, without closing the tab.
 *
 * A file tab in `preview` mode renders its title italic (the single replace-me
 * slot); double-clicking the pill promotes it to permanent.
 *
 * data-testid: workspace-tab-<id> / workspace-tab-title-<id> / workspace-tab-stop-<id> / workspace-tab-close-<id>.
 */
import { Code2, Eye, FileText, GitCompare, Globe, Square, SquareTerminal, Terminal, X } from 'lucide-react';
import type { LaunchConfiguration, LaunchProcessStatus } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import { FadeLabel } from '@/components/ui/fade-label';
import { Hint } from '@/components/ui/hint';
import { cn } from '@/lib/utils';
import {
  TAB_CLOSE_ATTR,
  TAB_CLOSE_BUTTON,
  TAB_CLOSE_OVERLAY,
  tabHoverStyle,
  tabShape,
} from '@/features/session-tabs/tab-shape';
import { useLayoutStore } from '@/store/layout';
import { isLaunchStatusLive } from '@/features/run/derive-launch-control';
import { requestTerminalFocus } from '@/features/terminal/terminal-focus';
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
      tabIndex={isActive ? 0 : -1}
      onClick={() => {
        activateRunTab(pane.id, tab.id);
        if (tab.kind === 'terminal') requestTerminalFocus(tab.id);
      }}
      onDoubleClick={() => promoteFileTab(tab.id)}
      className={tabShape(
        isActive,
        // Keeps a tab scrolled into view clear of the fades at the ends of the row.
        cn(
          'scroll-mx-5 gap-1.5 pl-2.5',
          isActive ? 'shrink-0 pr-1' : 'max-w-44 shrink pr-2.5',
          !isActive && (live ? 'min-w-21 pr-1' : 'min-w-15'),
        ),
      )}
      style={tabHoverStyle('--sidebar')}
    >
      <Glyph className={cn('size-3 shrink-0', isActive ? 'text-foreground' : 'text-muted-foreground')} />
      {isActive ? (
        <span
          data-testid={`workspace-tab-title-${tab.id}`}
          className={cn('whitespace-nowrap', tab.mode === 'preview' && 'italic')}
        >
          {tab.title}
        </span>
      ) : (
        <FadeLabel
          data-testid={`workspace-tab-title-${tab.id}`}
          className={cn('flex-1', tab.mode === 'preview' && 'italic')}
          tooltipDelay={600}
        >
          {tab.title}
        </FadeLabel>
      )}
      {live && config && (
        <Hint label={`Stop ${tab.title}`}>
          <Button
            data-testid={`workspace-tab-stop-${tab.id}`}
            aria-label={`Stop ${tab.title}`}
            variant="ghost"
            size="icon-xs"
            className="rounded-sm hover:bg-foreground/8"
            onClick={(e) => {
              e.stopPropagation();
              onStop(config);
            }}
          >
            <Square className="text-destructive" fill="currentColor" />
          </Button>
        </Hint>
      )}
      <span
        className={cn(
          !isActive && TAB_CLOSE_OVERLAY,
          !isActive && 'bg-(--tab-hover) opacity-0 before:to-(--tab-hover)',
          !isActive && 'group-focus-within/tab:opacity-100 group-hover/tab:opacity-100',
          // Left of the Stop, which stays reachable.
          !isActive && live && 'right-8.5',
        )}
      >
        <Hint label={`Close ${tab.title}`}>
          <Button
            data-testid={`workspace-tab-close-${tab.id}`}
            {...TAB_CLOSE_ATTR}
            aria-label={`Close ${tab.title}`}
            tabIndex={-1}
            variant="ghost"
            size="icon-xs"
            className={TAB_CLOSE_BUTTON}
            onClick={(e) => {
              e.stopPropagation();
              closeRunTab(pane.id, tab.id);
            }}
          >
            <X />
          </Button>
        </Hint>
      </span>
    </div>
  );
}
