/**
 * DaemonRow — leaf presenters for daemon list entries.
 *
 * Exports: DaemonStatus type, DAEMON_STATUS presentation map,
 *   ConnDot, DaemonGlyph, DaemonRow.
 *
 * Visual spec: 17-daemon.jsx. Token mapping: task-B5-brief.md.
 */
import { useState } from 'react';
import { Laptop, Server, Lock, Check, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { MenuRow, MenuDivider } from '@/components/ui/menu';

// ---------------------------------------------------------------------------
// Status type + presentation map
// ---------------------------------------------------------------------------

export type DaemonStatus = 'connected' | 'connecting' | 'unreachable' | 'needs-repair';

interface StatusMeta {
  label: string;
  word: string;
  spin?: boolean;
  lock?: boolean;
  dotClass: string;
  wordClass: string;
}

export const DAEMON_STATUS: Record<DaemonStatus, StatusMeta> = {
  connected: {
    label: 'Connected',
    word: 'Connected',
    dotClass: 'bg-mf-success',
    wordClass: 'text-mf-success',
  },
  connecting: {
    label: 'Connecting…',
    word: 'Connecting',
    spin: true,
    dotClass: 'border-mf-warning',
    wordClass: 'text-mf-warning',
  },
  unreachable: {
    label: 'Unreachable',
    word: 'Offline',
    dotClass: 'bg-destructive',
    wordClass: 'text-destructive',
  },
  'needs-repair': {
    label: 'Re-pair needed',
    word: 'Re-pair',
    lock: true,
    dotClass: 'text-mf-warning',
    wordClass: 'text-mf-warning',
  },
};

// ---------------------------------------------------------------------------
// ConnDot
// ---------------------------------------------------------------------------

export function ConnDot({ status }: { status: DaemonStatus }) {
  const m = DAEMON_STATUS[status];

  if (m.spin) {
    return (
      <span
        aria-label={m.label}
        className="inline-block size-[10px] shrink-0 rounded-full border-[1.5px] border-mf-warning border-t-transparent animate-spin"
      />
    );
  }

  if (m.lock) {
    return (
      <span aria-label={m.label} className="flex shrink-0 items-center justify-center">
        <Lock size={11} aria-hidden className="text-mf-warning" />
      </span>
    );
  }

  return <span aria-label={m.label} className={cn('inline-block size-2 shrink-0 rounded-full', m.dotClass)} />;
}

// ---------------------------------------------------------------------------
// DaemonGlyph
// ---------------------------------------------------------------------------

export function DaemonGlyph({ kind }: { kind: 'local' | 'remote' }) {
  const Icon = kind === 'local' ? Laptop : Server;
  return <Icon size={14} className="text-mf-text-3" aria-hidden />;
}

// ---------------------------------------------------------------------------
// DaemonRowManage — ⋯ menu for remote daemons
// ---------------------------------------------------------------------------

interface DaemonRowManageProps {
  id: string;
  status: DaemonStatus;
  onRename?: (d: DaemonMeta) => void;
  onRepair?: (d: DaemonMeta) => void;
  onRemove?: (d: DaemonMeta) => void;
  d: DaemonMeta;
}

function DaemonRowManage({ id, status, d, onRename, onRepair, onRemove }: DaemonRowManageProps) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          data-testid={`daemon-row-${id}-manage`}
          type="button"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-md text-mf-text-3 opacity-0 transition-all hover:bg-accent hover:text-foreground group-hover:opacity-100 data-[state=open]:opacity-100 data-[state=open]:bg-accent"
          aria-label="Manage daemon"
        >
          <MoreHorizontal size={13} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={4} className="w-44">
        {onRename != null && (
          <MenuRow
            data-testid={`daemon-row-${id}-rename`}
            icon={<Pencil size={13} className="shrink-0 text-mf-text-3" aria-hidden />}
            label="Rename…"
            onClick={() => {
              setOpen(false);
              onRename(d);
            }}
          />
        )}
        {onRepair != null && (
          <MenuRow
            data-testid={`daemon-row-${id}-repair`}
            icon={<Lock size={13} className="shrink-0 text-mf-text-3" aria-hidden />}
            label="Re-pair…"
            note={status === 'needs-repair' ? 'Token revoked or expired' : undefined}
            onClick={() => {
              setOpen(false);
              onRepair(d);
            }}
          />
        )}
        {(onRename != null || onRepair != null) && onRemove != null && <MenuDivider />}
        {onRemove != null && (
          <MenuRow
            data-testid={`daemon-row-${id}-remove`}
            icon={<Trash2 size={13} className="shrink-0" aria-hidden />}
            label="Remove"
            danger
            onClick={() => {
              setOpen(false);
              onRemove(d);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// DaemonRow
// ---------------------------------------------------------------------------

export interface DaemonRowProps {
  d: DaemonMeta;
  status: DaemonStatus;
  active: boolean;
  onSwitch: (d: DaemonMeta) => void;
  onRename?: (d: DaemonMeta) => void;
  onRepair?: (d: DaemonMeta) => void;
  onRemove?: (d: DaemonMeta) => void;
}

export function DaemonRow({ d, status, active, onSwitch, onRename, onRepair, onRemove }: DaemonRowProps) {
  const m = DAEMON_STATUS[status];
  const isRemote = d.kind === 'remote';

  return (
    <div
      data-testid={`daemon-row-${d.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onSwitch(d)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onSwitch(d);
      }}
      className={cn(
        'group flex cursor-pointer items-center gap-[8px] rounded-md px-[6px] py-[4px] transition-colors',
        'hover:bg-accent',
        active && 'bg-accent',
      )}
    >
      {/* Active checkmark slot — 13px wide */}
      <span className="flex w-[13px] shrink-0 items-center justify-center">
        {active && (
          <Check size={11} data-testid={`daemon-row-${d.id}-active`} className="text-primary" aria-label="Active" />
        )}
      </span>

      {/* Glyph chip — 30x30 */}
      <span
        className={cn(
          'flex size-[30px] shrink-0 items-center justify-center rounded-md',
          active ? 'bg-primary/10' : 'bg-mf-chip',
        )}
      >
        <DaemonGlyph kind={d.kind} />
      </span>

      {/* Label + metadata column */}
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-body text-foreground', active && 'font-semibold')}>{d.label}</span>
          {d.kind === 'local' && (
            <span className="shrink-0 rounded-sm bg-mf-chip px-[5px] py-px font-mono text-micro font-bold uppercase tracking-wide text-mf-text-3">
              Local
            </span>
          )}
        </span>
        {d.host && <span className="truncate font-mono text-[10.5px] text-mf-text-3">{d.host}</span>}
      </span>

      {/* Right: ConnDot + status word */}
      <span className="flex shrink-0 items-center gap-[5px]">
        <span data-testid={`daemon-row-${d.id}-dot`} className="flex items-center">
          <ConnDot status={status} />
        </span>
        <span className={cn('text-caption', m.wordClass)}>{m.word}</span>
      </span>

      {/* Manage menu — remote only */}
      {isRemote && (
        <DaemonRowManage id={d.id} status={status} d={d} onRename={onRename} onRepair={onRepair} onRemove={onRemove} />
      )}
    </div>
  );
}
