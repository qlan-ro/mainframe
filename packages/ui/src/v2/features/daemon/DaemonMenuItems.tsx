/**
 * The switcher dropdown's body: the fallback banner, the local row, and the
 * remote section with its per-daemon manage submenu.
 *
 * The shipped picker is a hand-built 324px card over `components/ui/menu`; this
 * is the stock team-switcher shape, so a remote's manage actions live in a
 * `DropdownMenuSub` rather than a nested popover. "Add remote daemon…" and
 * "Re-pair…" open the legacy pairing dialog until that flow is ported.
 */
import {
  CheckIcon,
  ChevronRightIcon,
  LockIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  WifiOffIcon,
} from 'lucide-react';
import type { DaemonMeta } from '@qlan-ro/mainframe-types';
import { Badge } from '@v2/components/ui/badge';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@v2/components/ui/dropdown-menu';
import { cn } from '@v2/lib/utils';
import { ConnDot, DAEMON_STATUS, DaemonGlyph, type DaemonStatus } from './daemon-status';

export interface DaemonMenuItemsProps {
  daemons: DaemonMeta[];
  statusOf: (id: string) => DaemonStatus;
  activeId: string;
  onSwitch: (d: DaemonMeta) => void;
  onRename: (d: DaemonMeta) => void;
  onRepair: (d: DaemonMeta) => void;
  onRemove: (d: DaemonMeta) => void;
  onAddRemote: () => void;
}

function isDown(status: DaemonStatus): boolean {
  return status === 'unreachable' || status === 'needs-repair';
}

function DaemonItemContent({ d, status, active }: { d: DaemonMeta; status: DaemonStatus; active: boolean }) {
  const meta = DAEMON_STATUS[status];

  return (
    <>
      <DaemonGlyph kind={d.kind} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate', active && 'font-semibold')}>{d.label}</span>
          {d.kind === 'local' && (
            <Badge variant="outline" className="shrink-0 px-1 py-0 text-xs">
              Local
            </Badge>
          )}
        </span>
        {d.host && <span className="truncate font-mono text-xs text-muted-foreground">{d.host}</span>}
      </span>
      <span data-testid={`daemon-row-${d.id}-dot`} className="flex shrink-0 items-center">
        <ConnDot status={status} />
      </span>
      <span className={cn('shrink-0 text-xs', meta.wordClass)}>{meta.word}</span>
      {active && <CheckIcon data-testid={`daemon-row-${d.id}-active`} aria-label="Active" className="shrink-0" />}
    </>
  );
}

function RemoteItem({
  d,
  status,
  active,
  onSwitch,
  onRename,
  onRepair,
  onRemove,
}: { d: DaemonMeta; status: DaemonStatus; active: boolean } & Pick<
  DaemonMenuItemsProps,
  'onSwitch' | 'onRename' | 'onRepair' | 'onRemove'
>) {
  return (
    <div className="flex items-center gap-1">
      <DropdownMenuItem data-testid={`daemon-row-${d.id}`} onSelect={() => onSwitch(d)} className="min-w-0 flex-1">
        <DaemonItemContent d={d} status={status} active={active} />
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger
          data-testid={`daemon-row-${d.id}-manage`}
          aria-label={`Manage ${d.label}`}
          className="shrink-0 [&>svg:last-child]:hidden"
        >
          <MoreHorizontalIcon />
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem data-testid={`daemon-row-${d.id}-rename`} onSelect={() => onRename(d)}>
            <PencilIcon />
            Rename…
          </DropdownMenuItem>
          <DropdownMenuItem data-testid={`daemon-row-${d.id}-repair`} onSelect={() => onRepair(d)}>
            <LockIcon />
            Re-pair…
            {status === 'needs-repair' && (
              <span className="ml-auto text-xs text-muted-foreground">Token revoked or expired</span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            data-testid={`daemon-row-${d.id}-remove`}
            onSelect={() => onRemove(d)}
          >
            <Trash2Icon />
            Remove
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </div>
  );
}

export function DaemonMenuItems({
  daemons,
  statusOf,
  activeId,
  onSwitch,
  onRename,
  onRepair,
  onRemove,
  onAddRemote,
}: DaemonMenuItemsProps) {
  const local = daemons.find((d) => d.kind === 'local');
  const remotes = daemons.filter((d) => d.kind === 'remote');
  const active = daemons.find((d) => d.id === activeId);
  const activeDown = active != null && active.kind === 'remote' && isDown(statusOf(active.id));

  return (
    <div data-testid="daemon-picker">
      {activeDown && local != null && (
        <DropdownMenuItem data-testid="daemon-picker-fallback" onSelect={() => onSwitch(local)}>
          <WifiOffIcon className="text-destructive" />
          <span className="min-w-0 flex-1 truncate">
            <strong className="font-semibold">{active.label}</strong> is unreachable.
          </span>
          <span className="flex shrink-0 items-center font-semibold text-primary">
            Use {local.label}
            <ChevronRightIcon />
          </span>
        </DropdownMenuItem>
      )}

      <DropdownMenuLabel className="text-muted-foreground">Daemon</DropdownMenuLabel>
      {local != null && (
        <DropdownMenuItem data-testid={`daemon-row-${local.id}`} onSelect={() => onSwitch(local)}>
          <DaemonItemContent d={local} status={statusOf(local.id)} active={activeId === local.id} />
        </DropdownMenuItem>
      )}

      <DropdownMenuSeparator />

      <DropdownMenuLabel className="text-muted-foreground">Remote servers</DropdownMenuLabel>
      {remotes.length === 0 ? (
        <p data-testid="daemon-picker-empty" className="px-2 pb-1.5 text-xs text-muted-foreground">
          No remote daemons yet. Pair one to offload agents to a server you control.
        </p>
      ) : (
        remotes.map((d) => (
          <RemoteItem
            key={d.id}
            d={d}
            status={statusOf(d.id)}
            active={activeId === d.id}
            onSwitch={onSwitch}
            onRename={onRename}
            onRepair={onRepair}
            onRemove={onRemove}
          />
        ))
      )}

      <DropdownMenuItem data-testid="daemon-picker-add" onSelect={onAddRemote}>
        <PlusIcon />
        Add remote daemon…
      </DropdownMenuItem>
    </div>
  );
}
