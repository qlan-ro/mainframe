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
 * `+` opens a popover (New terminal + launch configs), not a bare terminal.
 *
 * data-testid:
 *   run-tab-<id> / run-tab-close-<id>     — each tab + its close button
 *   run-tab-stop-<id>                     — Stop a live launch-config tab
 *   run-surface-drag                      — surface drag grip (primary pane)
 *   run-tab-strip-add-<paneId>            — the + trigger
 *   run-pane-new-terminal-<paneId>        — "New terminal" menu row
 *   run-pane-launch-<config>-<paneId>     — a launch-config menu row
 *   run-tab-strip-split-right / -split-down — split actions (primary)
 *   run-surface-close                     — close the Run surface (primary)
 *   run-pane-close-<paneId>               — un-split (secondary pane)
 */
import { useState } from 'react';
import { Eye, GripVertical, LayoutPanelLeft, LayoutPanelTop, Play, Plus, Terminal, X } from 'lucide-react';
import type { LaunchConfiguration } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MenuDivider, MenuEmpty, MenuLabel, MenuRow } from '@/components/ui/menu';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { useSurfaceDragStore } from './use-surface-drag';
import { RunTabPill } from './RunTabPill';
import { Hint } from '@/components/ui/hint';
import type { RunPane } from '@/store/run-pane';

const ACTION_BTN =
  'inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

interface RunAddMenuProps {
  paneId: string;
  configs: LaunchConfiguration[];
  onLaunch: (config: LaunchConfiguration) => void;
}

function RunAddMenu({ paneId, configs, onLaunch }: RunAddMenuProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Hint label="New terminal / Open preview">
        <PopoverTrigger asChild>
          <button
            data-testid={`run-tab-strip-add-${paneId}`}
            type="button"
            className={`${ACTION_BTN} ml-0.5 data-[state=open]:bg-mf-chip`}
          >
            <Plus size={11} className="text-mf-text-3" />
          </button>
        </PopoverTrigger>
      </Hint>
      <PopoverContent data-testid={`run-add-menu-${paneId}`} className="w-[214px] rounded-[8px] p-[4px]" align="start">
        <MenuLabel>New terminal</MenuLabel>
        <MenuRow
          data-testid={`run-pane-new-terminal-${paneId}`}
          icon={<Terminal className="size-[13px] text-mf-term-cyan" />}
          label="New terminal"
          hint="zsh"
          onClick={() => {
            setOpen(false);
            emitSurfaceIntent({ type: 'new-terminal', paneId });
          }}
        />
        <MenuDivider />
        <MenuLabel>Launch configuration</MenuLabel>
        {configs.length === 0 ? (
          <MenuEmpty>No launch configs found.</MenuEmpty>
        ) : (
          configs.map((cfg) => (
            <MenuRow
              key={cfg.name}
              data-testid={`run-pane-launch-${cfg.name}-${paneId}`}
              icon={
                cfg.preview ? (
                  <Eye className="size-[13px] text-mf-surface-run" />
                ) : (
                  <Terminal className="size-[13px] text-mf-term-cyan" />
                )
              }
              label={cfg.name}
              hint={cfg.preview ? 'preview' : 'process'}
              onClick={() => {
                setOpen(false);
                onLaunch(cfg);
              }}
            />
          ))
        )}
      </PopoverContent>
    </Popover>
  );
}

export function RunTabStrip({ pane, primary }: { pane: RunPane; primary: boolean }) {
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
        <Play size={11} className="text-mf-surface-run" fill="currentColor" />
      </div>

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

      <RunAddMenu paneId={pane.id} configs={configs} onLaunch={handleLaunch} />

      <div className="flex-1" />

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
