/**
 * RunTabStrip — the Run surface's header row, mirroring the prototype
 * `SurfaceTabStrip` (04-engine.jsx) and the sibling `FilesTabStrip`:
 *
 *   [grip] [▶ surface icon] [tab pills…] [+] ……… [split▸][split▾][close]
 *
 * Each tab carries a STATIC type glyph (eye = preview webview, square-terminal =
 * console/logs process, terminal = shell, file = a Files guest) that never
 * changes with run state; a launch-config tab whose process is live adds a
 * separate red Stop between the title and its close (toolbar parity, #206). The
 * `+` opens a DropdownMenu (New terminal + launch configs), not a bare terminal.
 *
 * data-testid:
 *   run-tab-<id> / run-tab-close-<id>     — each tab + its close button
 *   run-tab-stop-<id>                     — Stop a live launch-config tab
 *   run-surface-drag                      — surface drag grip (primary pane)
 *   run-tab-strip-add-<paneId>            — the + trigger
 *   run-pane-new-terminal-<paneId>        — "New terminal" menu row
 *   run-pane-open-url-<paneId>            — "URL…" menu row (opens the inline entry)
 *   run-pane-launch-<config>-<paneId>     — a launch-config menu row
 *   run-tab-strip-split-right / -split-down — split actions (primary)
 *   run-surface-close                     — close the Run surface (primary)
 *   run-pane-close-<paneId>               — un-split (secondary pane)
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Eye, Globe, GripVertical, LayoutPanelLeft, LayoutPanelTop, Play, Plus, Terminal, X } from 'lucide-react';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@v2/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { useSurfaceDragStore } from './use-surface-drag';
import { RunTabPill } from './RunTabPill';
import { RunUrlEntry } from './RunUrlEntry';
import { Hint } from '@/components/ui/hint';
import type { RunPane } from '@/store/run-pane';

const ACTION_BTN =
  'inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

interface RunAddMenuProps {
  paneId: string;
  configs: LaunchConfiguration[];
  onLaunch: (config: LaunchConfiguration) => void;
  onOpenUrl: () => void;
}

/** A row's trailing kind hint ("zsh" / "preview" / "process") — not a keyboard
 *  shortcut, so it stays a plain mono span rather than DropdownMenuShortcut. */
function RowHint({ children }: { children: ReactNode }) {
  return <span className="shrink-0 font-mono text-xs text-muted-foreground">{children}</span>;
}

function RunAddMenu({ paneId, configs, onLaunch, onOpenUrl }: RunAddMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* `open` drives the pressed chrome, not `data-[state=open]`: Hint's
          TooltipTrigger asChild overwrites the child's data-state with the
          tooltip's own. */}
      <Hint label="New terminal, URL, or preview">
        <DropdownMenuTrigger asChild>
          <button
            data-testid={`run-tab-strip-add-${paneId}`}
            type="button"
            className={cn(ACTION_BTN, 'ml-0.5', open && 'bg-mf-chip')}
          >
            <Plus size={12} className="text-mf-text-3" />
          </button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent data-testid={`run-add-menu-${paneId}`} className="w-[214px]" align="start">
        <DropdownMenuLabel>New tab</DropdownMenuLabel>
        <DropdownMenuItem
          data-testid={`run-pane-new-terminal-${paneId}`}
          onSelect={() => emitSurfaceIntent({ type: 'new-terminal', paneId })}
        >
          <Terminal className="size-3.5 text-mf-term-cyan" />
          <span className="min-w-0 flex-1 truncate">New terminal</span>
          <RowHint>zsh</RowHint>
        </DropdownMenuItem>
        <DropdownMenuItem data-testid={`run-pane-open-url-${paneId}`} onSelect={onOpenUrl}>
          <Globe className="size-3.5 text-mf-surface-run" />
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
              data-testid={`run-pane-launch-${cfg.name}-${paneId}`}
              onSelect={() => onLaunch(cfg)}
            >
              {cfg.preview ? (
                <Eye className="size-3.5 text-mf-surface-run" />
              ) : (
                <Terminal className="size-3.5 text-mf-term-cyan" />
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

export function RunTabStrip({ pane, primary }: { pane: RunPane; primary: boolean }) {
  const [urlEntryOpen, setUrlEntryOpen] = useState(false);
  const splitAvailable = useLayoutStore((s) => layoutCanSplit(s.layout));
  const splitSurface = useLayoutStore((s) => s.splitSurface);
  const toggleSurface = useLayoutStore((s) => s.toggleSurface);
  const runIsFloor = useLayoutStore((s) => isSurfaceFloor(s.layout, 'run'));
  const closePane = useLayoutStore((s) => s.closePane);
  const beginSurfaceDrag = useSurfaceDragStore((s) => s.beginSurfaceDrag);

  // The active session's launch scope drives both the add-menu (start) and each
  // tab's Stop. RunSurface renders only tabs matching this scope, so the active
  // identity is the right scope for start/stop (launch stop MUST pass chatId).
  const { projectId, chatId } = useActiveIdentity();
  const port = useDaemonPort();
  const { configs, scopeStatuses, handleLaunch, handleStop } = useLaunchActions(
    port,
    projectId ?? undefined,
    chatId ?? undefined,
  );

  return (
    <div className="flex h-[36px] flex-shrink-0 items-center [border-bottom:0.5px_solid_var(--border)]">
      {primary && (
        <div
          data-testid="run-surface-drag"
          className="grid h-full w-[20px] flex-shrink-0 cursor-grab place-items-center pl-[4px]"
          onPointerDown={(e) => beginSurfaceDrag('run', { clientX: e.clientX, clientY: e.clientY })}
        >
          <GripVertical size={13} className="text-mf-text-4" />
        </div>
      )}

      <div className={`flex-shrink-0 ${primary ? 'px-[4px]' : 'pl-[10px] pr-[4px]'}`}>
        <Play size={12} className="text-mf-surface-run" fill="currentColor" />
      </div>

      {/* The entry replaces the pill row rather than floating over the tab body:
          the native child webview composites above the DOM and would swallow it. */}
      {urlEntryOpen ? (
        <div className="flex min-w-0 flex-1 items-center pr-[6px]">
          <RunUrlEntry paneId={pane.id} onDone={() => setUrlEntryOpen(false)} />
        </div>
      ) : (
        <>
          <div className="flex h-full min-w-0 flex-initial items-center gap-[2px] overflow-x-auto pr-[2px] [scrollbar-width:none]">
            {pane.tabs.map((t) => (
              <RunTabPill
                key={t.id}
                pane={pane}
                tab={t}
                configs={configs}
                scopeStatuses={scopeStatuses}
                onStop={handleStop}
              />
            ))}
          </div>

          <RunAddMenu
            paneId={pane.id}
            configs={configs}
            onLaunch={handleLaunch}
            onOpenUrl={() => setUrlEntryOpen(true)}
          />
        </>
      )}

      {!urlEntryOpen && <div className="flex-1" />}

      <div className="flex flex-shrink-0 items-center gap-px pl-[2px] pr-[6px]">
        {primary && splitAvailable && (
          <>
            <Hint label="Split right">
              <button
                data-testid="run-tab-strip-split-right"
                type="button"
                onClick={() => splitSurface('v')}
                className={ACTION_BTN}
              >
                <LayoutPanelLeft size={13} className="text-mf-text-3" />
              </button>
            </Hint>
            <Hint label="Split down">
              <button
                data-testid="run-tab-strip-split-down"
                type="button"
                onClick={() => splitSurface('h')}
                className={ACTION_BTN}
              >
                <LayoutPanelTop size={13} className="text-mf-text-3" />
              </button>
            </Hint>
          </>
        )}
        {primary ? (
          <Hint label="Close Run">
            <button
              data-testid="run-surface-close"
              type="button"
              disabled={runIsFloor}
              onClick={() => toggleSurface('run')}
              className={`${ACTION_BTN} ${runIsFloor ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              <X size={12} className="text-mf-text-3" />
            </button>
          </Hint>
        ) : (
          <Hint label="Close pane (un-split)">
            <button
              data-testid={`run-pane-close-${pane.id}`}
              type="button"
              onClick={() => closePane(pane.id)}
              className={ACTION_BTN}
            >
              <LayoutPanelLeft size={12} className="text-mf-text-3" />
            </button>
          </Hint>
        )}
      </div>
    </div>
  );
}
