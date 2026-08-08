/**
 * WorkspaceAddMenu — the strip's `+`: one native DropdownMenu covering everything
 * the merged surface can open (a file, a terminal, a URL, a launch config).
 *
 * data-testid:
 *   workspace-tab-strip-add-<paneId>        — the trigger
 *   workspace-add-menu-<paneId>             — the content
 *   workspace-pane-open-file-<paneId>       — Open file…
 *   workspace-pane-new-terminal-<paneId>    — New terminal
 *   workspace-pane-open-url-<paneId>        — URL… (swaps in the inline entry)
 *   workspace-pane-launch-<config>-<paneId> — a launch configuration
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, FileCode, Globe, Plus, Terminal } from 'lucide-react';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Hint } from '@/components/ui/hint';
import { emitSurfaceIntent } from '@/store/surface-intents';

/** A row's trailing kind hint ("zsh" / "preview" / "process") — not a keyboard
 *  shortcut, so it stays a plain mono span rather than DropdownMenuShortcut. */
function RowHint({ children }: { children: ReactNode }) {
  return <span className="shrink-0 font-mono text-xs text-muted-foreground">{children}</span>;
}

interface WorkspaceAddMenuProps {
  paneId: string;
  configs: LaunchConfiguration[];
  onLaunch: (config: LaunchConfiguration) => void;
  onOpenUrl: () => void;
}

export function WorkspaceAddMenu({ paneId, configs, onLaunch, onOpenUrl }: WorkspaceAddMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* `open` drives the pressed chrome, not `data-[state=open]`: Hint's
          TooltipTrigger asChild overwrites the child's data-state with the
          tooltip's own. */}
      <Hint label="Open a file, terminal, URL, or preview">
        <DropdownMenuTrigger asChild>
          <Button
            data-testid={`workspace-tab-strip-add-${paneId}`}
            variant="ghost"
            size="icon-xs"
            className={open ? 'ml-0.5 bg-muted' : 'ml-0.5'}
          >
            <Plus className="text-muted-foreground" />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent data-testid={`workspace-add-menu-${paneId}`} className="w-56" align="start">
        <DropdownMenuLabel>New tab</DropdownMenuLabel>
        <DropdownMenuItem
          data-testid={`workspace-pane-open-file-${paneId}`}
          onSelect={() => emitSurfaceIntent({ type: 'open-file-picker' })}
        >
          <FileCode className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">Open file…</span>
          <RowHint>⌘P</RowHint>
        </DropdownMenuItem>
        <DropdownMenuItem
          data-testid={`workspace-pane-new-terminal-${paneId}`}
          onSelect={() => emitSurfaceIntent({ type: 'new-terminal', paneId })}
        >
          <Terminal className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">New terminal</span>
          <RowHint>zsh</RowHint>
        </DropdownMenuItem>
        <DropdownMenuItem data-testid={`workspace-pane-open-url-${paneId}`} onSelect={onOpenUrl}>
          <Globe className="size-3.5 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate">URL…</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Launch configuration</DropdownMenuLabel>
        {configs.length === 0 ? (
          <div className="px-2 py-4 text-center text-xs text-muted-foreground">No launch configs found.</div>
        ) : (
          configs.map((cfg) => (
            <DropdownMenuItem
              key={cfg.name}
              data-testid={`workspace-pane-launch-${cfg.name}-${paneId}`}
              onSelect={() => onLaunch(cfg)}
            >
              {cfg.preview ? (
                <Eye className="size-3.5 text-muted-foreground" />
              ) : (
                <Terminal className="size-3.5 text-muted-foreground" />
              )}
              <span className="min-w-0 flex-1 truncate">{cfg.name}</span>
              <RowHint>{cfg.preview ? 'preview' : 'process'}</RowHint>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
