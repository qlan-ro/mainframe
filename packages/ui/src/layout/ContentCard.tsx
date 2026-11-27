import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { useBootRestoring } from '@/features/sessions/runtime/boot-restore';

/**
 * The one content card. While the app restores the last chat the card is drawn
 * empty: its surfaces stay mounted and laid out, but are not painted, so the
 * frame holds still until the restored chat is ready (`boot-restore`).
 */
export function ContentCard({ className, ...props }: ComponentProps<'div'>) {
  const restoring = useBootRestoring();
  return (
    <div
      data-testid="content-card"
      data-boot-restoring={restoring ? '' : undefined}
      className={cn(
        'flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-[10px] border-t border-l bg-background',
        restoring && '[&>*]:invisible',
        className,
      )}
      {...props}
    />
  );
}
