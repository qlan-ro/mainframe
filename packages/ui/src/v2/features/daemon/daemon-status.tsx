/**
 * Leaf presenters for daemon entries: the status type, its presentation map,
 * the connection dot and the local/remote glyph.
 *
 * The connection dot is green, not the accent: green is the convention users
 * already read as "connected", where the accent would say "selected". Quiet
 * reads `muted-foreground` and anything wrong reads `destructive`, the same
 * collapse `StatusDot` made.
 */
import { LaptopIcon, LockIcon, ServerIcon } from 'lucide-react';
import { cn } from '@v2/lib/utils';

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
    dotClass: 'bg-success',
    wordClass: 'text-muted-foreground',
  },
  connecting: {
    label: 'Connecting…',
    word: 'Connecting',
    spin: true,
    dotClass: 'border-muted-foreground',
    wordClass: 'text-muted-foreground',
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
    dotClass: 'text-destructive',
    wordClass: 'text-destructive',
  },
};

export function ConnDot({ status }: { status: DaemonStatus }) {
  const meta = DAEMON_STATUS[status];

  if (meta.spin) {
    return (
      <span
        aria-label={meta.label}
        className="inline-block size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-muted-foreground border-t-transparent"
      />
    );
  }

  if (meta.lock) {
    return <LockIcon aria-label={meta.label} className="size-3 shrink-0 text-destructive" />;
  }

  return <span aria-label={meta.label} className={cn('inline-block size-2 shrink-0 rounded-full', meta.dotClass)} />;
}

export function DaemonGlyph({ kind, className }: { kind: 'local' | 'remote'; className?: string }) {
  const Icon = kind === 'local' ? LaptopIcon : ServerIcon;
  return <Icon aria-hidden className={cn('size-4 shrink-0 text-muted-foreground', className)} />;
}
