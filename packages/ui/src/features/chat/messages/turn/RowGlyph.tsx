import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STATUS_ICONS, type RowIcon, type RowStatus } from './tool-icons';

export function Spinner({ className }: { className?: string }) {
  return (
    <Loader2
      aria-hidden
      className={cn('size-3.5 shrink-0 animate-spin text-live motion-reduce:animate-none', className)}
    />
  );
}

/** A finished step shows what it was; any other state shows itself. */
export function RowGlyph({ icon: Icon, status }: { icon: RowIcon; status: RowStatus }) {
  if (status === 'running') return <Spinner />;
  const Shown = status === 'success' ? Icon : STATUS_ICONS[status];
  return (
    <Shown
      aria-hidden
      className={cn(
        'size-3.5 shrink-0',
        status === 'failed' && 'text-fail',
        (status === 'awaiting-approval' || status === 'needs-you') && 'text-warning',
        status !== 'failed' && status !== 'awaiting-approval' && status !== 'needs-you' && 'text-muted-foreground',
      )}
    />
  );
}
