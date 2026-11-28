import { useEffect, useRef, useState, type CSSProperties, type ComponentProps } from 'react';
import { Loader2Icon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { focusVisibleComposer } from '@/features/chat/composer/focus-composer';
import { bootHoldElapsedMs, useBootRestoring } from '@/features/sessions/runtime/boot-restore';

/** A restore that outlasts this shows a spinner on the cover, so a quick one never flashes it. */
export const BOOT_SPINNER_DELAY_MS = 400;

/**
 * The spinner is on the cover from its first frame, transparent, and a CSS animation delay
 * (`[data-boot-spinner]` in `app.css`) brings it in once the hold has lasted `BOOT_SPINNER_DELAY_MS`.
 * A timer would start in an effect after the shell's first commit and fire only when the main thread
 * is free; at boot the thread is busy mounting the shell and then the restored transcript, and such a
 * timer often fired after the cover had lifted. The delay counts from the hold's start, not this mount.
 */
function spinnerDelayStyle(): CSSProperties {
  const delay = Math.max(0, Math.round(BOOT_SPINNER_DELAY_MS - bootHoldElapsedMs()));
  return { '--mf-boot-spinner-delay': `${delay}ms` } as CSSProperties;
}

/**
 * An opaque sheet over the card while the last chat is restored. The surfaces
 * under it stay mounted, laid out and focusable (`visibility:hidden` would make
 * WebKit drop the composer's autofocus); they are just not seen until the chat
 * is ready (`boot-restore`). It marks itself `data-preview-overlay`, so a native
 * preview webview, which composites above all DOM, steps aside for it too.
 */
function BootCover() {
  const [spinnerStyle] = useState(spinnerDelayStyle);
  return (
    <div
      data-testid="content-card-boot-cover"
      data-preview-overlay
      aria-hidden
      className="absolute inset-0 z-50 flex items-center justify-center bg-background"
    >
      <span data-testid="content-card-boot-spinner" data-boot-spinner style={spinnerStyle}>
        <Loader2Icon className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" />
      </span>
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
