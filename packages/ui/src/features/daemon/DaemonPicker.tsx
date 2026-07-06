/**
 * DaemonPicker — popover card content listing local + remote daemons.
 *
 * Renders: header, optional fallback banner (when active remote is down),
 * local DaemonRow, divider, remote section, empty state or remote rows,
 * divider, add-remote footer action.
 *
 * Visual spec: 17-daemon.jsx DaemonPicker. Token mapping: task-B6-brief.md.
 * Mount this inside a PopoverContent (B9); it does not double-wrap.
 */
import { Wifi, Lock, ChevronRight, Plus } from 'lucide-react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { MenuRow } from '@/components/ui/menu';
import { DaemonRow } from './DaemonRow';
import type { DaemonStatus } from './DaemonRow';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface DaemonPickerProps {
  daemons: DaemonMeta[];
  statusOf: (id: string) => DaemonStatus;
  activeId: string;
  onSwitch: (d: DaemonMeta) => void;
  onAdd: () => void;
  onRename?: (d: DaemonMeta) => void;
  onRepair?: (d: DaemonMeta) => void;
  onRemove?: (d: DaemonMeta) => void;
  close?: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isDown(status: DaemonStatus): boolean {
  return status === 'unreachable' || status === 'needs-repair';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface FallbackBannerProps {
  active: DaemonMeta;
  status: DaemonStatus;
  onUseLocal: () => void;
}

function FallbackBanner({ active, status, onUseLocal }: FallbackBannerProps) {
  const needsRepair = status === 'needs-repair';
  const Icon = needsRepair ? Lock : Wifi;
  const detail = needsRepair ? 'needs re-pairing' : 'is unreachable';

  return (
    <button
      type="button"
      data-testid="daemon-picker-fallback"
      onClick={onUseLocal}
      className={cn(
        'flex w-full cursor-pointer items-center gap-[9px] rounded-md px-[9px] py-[8px]',
        'bg-primary/8 border border-primary/22 text-left',
        'hover:bg-primary/12 transition-colors',
      )}
    >
      <Icon size={14} className="shrink-0 text-primary" aria-hidden />
      <span className="min-w-0 flex-1 text-caption text-muted-foreground">
        <strong className="font-semibold text-foreground">{active.label}</strong> {detail}.
      </span>
      <span className="flex shrink-0 items-center gap-0.5 text-caption font-semibold text-primary">
        Use This Mac
        <ChevronRight size={12} aria-hidden />
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// DaemonPicker
// ---------------------------------------------------------------------------

export function DaemonPicker({
  daemons,
  statusOf,
  activeId,
  onSwitch,
  onAdd,
  onRename,
  onRepair,
  onRemove,
  close,
}: DaemonPickerProps) {
  const local = daemons.find((d) => d.kind === 'local');
  const remotes = daemons.filter((d) => d.kind === 'remote');
  const active = daemons.find((d) => d.id === activeId);
  const activeStatus = active ? statusOf(active.id) : undefined;
  const activeDown = active != null && active.kind === 'remote' && activeStatus != null && isDown(activeStatus);

  function handleSwitch(d: DaemonMeta) {
    onSwitch(d);
    close?.();
  }

  function handleAdd() {
    onAdd();
    close?.();
  }

  return (
    <div data-testid="daemon-picker" className="flex w-[324px] flex-col py-[5px]">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-[10px] pb-[6px] pt-[2px]">
        <span className="text-micro font-bold uppercase tracking-wide text-mf-text-3">Daemon</span>
        <span className="text-micro text-mf-text-4">One connected at a time</span>
      </div>

      <div className="flex flex-col gap-[3px] px-[5px]">
        {/* ── Fallback banner ────────────────────────────────────────── */}
        {activeDown && active != null && activeStatus != null && local != null && (
          <div className="pb-[4px]">
            <FallbackBanner active={active} status={activeStatus} onUseLocal={() => handleSwitch(local)} />
          </div>
        )}

        {/* ── Local row ──────────────────────────────────────────────── */}
        {local != null && (
          <DaemonRow d={local} status={statusOf(local.id)} active={activeId === local.id} onSwitch={handleSwitch} />
        )}
      </div>

      {/* ── Divider ────────────────────────────────────────────────── */}
      <div className="my-[5px] h-px bg-border" />

      {/* ── Remote servers section ─────────────────────────────────── */}
      <div className="flex flex-col px-[5px]">
        <span className="px-[6px] pb-[4px] text-micro font-bold uppercase tracking-wide text-mf-text-3">
          Remote servers
        </span>

        {remotes.length === 0 ? (
          <p data-testid="daemon-picker-empty" className="px-[6px] py-[8px] text-center text-caption text-mf-text-3">
            No remote daemons yet. Pair one to offload agents to a server you control.
          </p>
        ) : (
          <div className="flex flex-col gap-[3px]">
            {remotes.map((d) => (
              <DaemonRow
                key={d.id}
                d={d}
                status={statusOf(d.id)}
                active={activeId === d.id}
                onSwitch={handleSwitch}
                onRename={onRename}
                onRepair={onRepair}
                onRemove={onRemove}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Divider ────────────────────────────────────────────────── */}
      <div className="my-[5px] h-px bg-border" />

      {/* ── Add footer ─────────────────────────────────────────────── */}
      <div className="px-[5px]">
        <MenuRow
          data-testid="daemon-picker-add"
          onClick={handleAdd}
          icon={<Plus size={13} className="shrink-0 text-primary" aria-hidden />}
          label="Add remote daemon…"
        />
      </div>
    </div>
  );
}
