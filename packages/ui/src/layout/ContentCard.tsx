import { useEffect, useRef, type ComponentProps } from 'react';
import { Loader2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { focusVisibleComposer } from '@/features/chat/composer/focus-composer';
import { useBootRestoring } from '@/features/sessions/runtime/boot-restore';
import { useDelayedVisible } from '@/lib/use-delayed-visible';

/** A restore that outlasts this shows a spinner on the cover, so a quick one never flashes it. */
export const BOOT_SPINNER_DELAY_MS = 400;

/**
 * An opaque sheet over the card while the last chat is restored. The surfaces
 * under it stay mounted, laid out and focusable (`visibility:hidden` would make
 * WebKit drop the composer's autofocus); they are just not seen until the chat
 * is ready (`boot-restore`). It marks itself `data-preview-overlay`, so a native
 * preview webview, which composites above all DOM, steps aside for it too.
 */
function BootCover() {
  const spinner = useDelayedVisible(true, { delay: BOOT_SPINNER_DELAY_MS, minVisible: 0 });
  return (
    <div
      data-testid="content-card-boot-cover"
      data-preview-overlay
      aria-hidden
      className="absolute inset-0 z-50 flex items-center justify-center bg-background"
    >
      {spinner && (
        <Loader2Icon
          data-testid="content-card-boot-spinner"
          className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none"
        />
      )}
    </div>
  );
}

/**
 * The one content card. While the app restores the last chat it is covered, so
 * the frame holds still until the restored chat is ready. When the cover lifts
 * the keyboard goes to the conversation's composer, unless something already has it.
 */
export function ContentCard({ className, children, ...props }: ComponentProps<'div'>) {
  const restoring = useBootRestoring();
  const wasRestoring = useRef(restoring);
  useEffect(() => {
    if (wasRestoring.current && !restoring && document.activeElement === document.body) focusVisibleComposer();
    wasRestoring.current = restoring;
  }, [restoring]);

  return (
    <div
      data-testid="content-card"
      data-boot-restoring={restoring ? '' : undefined}
      aria-busy={restoring || undefined}
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-[10px] border-t border-l bg-background',
        className,
      )}
      {...props}
    >
      {children}
      {restoring && <BootCover />}
    </div>
  );
}
