/**
 * RunTabStrip — the Run surface's header row, mirroring the prototype
 * `SurfaceTabStrip` (04-engine.jsx) and the sibling `FilesTabStrip`:
 *
 *   [grip] [▶ surface icon] [tab pills…] [+] ……… [split▸][split▾][close]
 *
 * Each tab carries a type glyph (eye = preview webview, play = console process,
 * terminal = shell, file = a Files guest). The `+` opens a popover (New terminal
 * + the launch configs) rather than spawning a terminal directly.
 *
 * data-testid:
 *   run-tab-<id> / run-tab-close-<id>     — each tab + its close button
 *   run-surface-drag                      — surface drag grip (primary pane)
 *   run-tab-strip-add-<paneId>            — the + trigger
 *   run-pane-new-terminal-<paneId>        — "New terminal" menu row
 *   run-pane-launch-<config>-<paneId>     — a launch-config menu row
 *   run-tab-strip-split-right / -split-down — split actions (primary)
 *   run-surface-close                     — close the Run surface (primary)
 *   run-pane-close-<paneId>               — un-split (secondary pane)
 */
import { useState } from 'react';
import {
  Eye,
  FileText,
  GripVertical,
  LayoutPanelLeft,
  LayoutPanelTop,
  Play,
  Plus,
  Terminal,
  X,
} from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MenuDivider, MenuEmpty, MenuLabel, MenuRow } from '@/components/ui/menu';
import { isSurfaceFloor, layoutCanSplit, useLayoutStore } from '@/store/layout';
import { emitSurfaceIntent } from '@/store/surface-intents';
import { useActiveIdentity } from '@/features/sessions/use-active-identity';
import { useDaemonPort } from '@/features/sessions/runtime/daemon-port-context';
import { useLaunchActions } from '@/features/run/use-launch-actions';
import { useSurfaceDragStore } from './use-surface-drag';
import type { RunPane, RunTab } from '@/store/run-pane';

const ACTION_BTN =
  'inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[6px] border-none bg-transparent cursor-pointer transition-[background] duration-[120ms] hover:bg-accent';

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

function RunTabPill({ pane, tab }: { pane: RunPane; tab: RunTab }) {
  const activateRunTab = useLayoutStore((s) => s.activateRunTab);
  const closeRunTab = useLayoutStore((s) => s.closeRunTab);
  const isActive = tab.id === pane.active;
  return (
    <div
      data-testid={`run-tab-${tab.id}`}
      role="tab"
      aria-selected={isActive}
      onClick={() => activateRunTab(pane.id, tab.id)}
      className={[
        'group flex h-[26px] min-w-0 max-w-[160px] flex-shrink-0 cursor-pointer select-none items-center gap-[6px] pl-[9px] pr-[6px]',
        'rounded-[7px] tracking-tight transition-colors duration-[120ms]',
        isActive ? 'bg-mf-chip font-semibold text-foreground' : 'font-medium text-mf-text-3 hover:bg-accent hover:text-foreground',
      ].join(' ')}
    >
      {tabGlyph(tab, isActive)}
      <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-caption leading-none">
        {tab.title}
      </span>
      <button
        data-testid={`run-tab-close-${tab.id}`}
        type="button"
        title={`Close ${tab.title}`}
        className={`inline-flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded-[3px] opacity-0 transition-opacity duration-[120ms] hover:bg-accent group-hover:opacity-100 ${isActive ? 'opacity-60' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          closeRunTab(pane.id, tab.id);
        }}
      >
        <X size={9} />
      </button>
    </div>
  );
}

function RunAddMenu({ paneId }: { paneId: string }) {
  const [open, setOpen] = useState(false);
  const { projectId, chatId } = useActiveIdentity();
  const port = useDaemonPort();
  const { configs, handleLaunch } = useLaunchActions(port, projectId ?? undefined, chatId ?? undefined);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid={`run-tab-strip-add-${paneId}`}
          type="button"
          title="New terminal / Open preview"
          className={`${ACTION_BTN} ml-0.5 data-[state=open]:bg-mf-chip`}
        >
          <Plus size={11} className="text-mf-text-3" />
        </button>
      </PopoverTrigger>
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
                handleLaunch(cfg);
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

  return (
    <div className="flex h-[34px] flex-shrink-0 items-center [border-bottom:0.5px_solid_var(--border)]">
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
          <RunTabPill key={t.id} pane={pane} tab={t} />
        ))}
      </div>

      <RunAddMenu paneId={pane.id} />

      <div className="flex-1" />

      <div className="flex flex-shrink-0 items-center gap-px pl-[2px] pr-[6px]">
        {primary && splitAvailable && (
          <>
            <button data-testid="run-tab-strip-split-right" type="button" title="Split right" onClick={() => splitSurface('v')} className={ACTION_BTN}>
              <LayoutPanelLeft size={13} className="text-mf-text-3" />
            </button>
            <button data-testid="run-tab-strip-split-down" type="button" title="Split down" onClick={() => splitSurface('h')} className={ACTION_BTN}>
              <LayoutPanelTop size={13} className="text-mf-text-3" />
            </button>
          </>
        )}
        {primary ? (
          <button data-testid="run-surface-close" type="button" title="Close Run" disabled={runIsFloor} onClick={() => toggleSurface('run')} className={`${ACTION_BTN} ${runIsFloor ? 'cursor-not-allowed opacity-40' : ''}`}>
            <X size={12} className="text-mf-text-3" />
          </button>
        ) : (
          <button data-testid={`run-pane-close-${pane.id}`} type="button" title="Close pane (un-split)" onClick={() => closePane(pane.id)} className={ACTION_BTN}>
            <LayoutPanelLeft size={12} className="text-mf-text-3" />
          </button>
        )}
      </div>
    </div>
  );
}
