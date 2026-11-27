import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The scroll-to-bottom button, rendered through a portal into `host`, a sibling
 * of the viewport out of reach of its edge-fade mask. `bottom` clears the
 * measured footer.
 *
 * It reads the bottom pin, not assistant-ui's `ThreadPrimitive.ScrollToBottom`:
 * the pin is the one definition of "at the bottom" (`bottom-pin.ts`), so the
 * button shows exactly when the transcript is not following, and a click
 * re-pins rather than planting assistant-ui's own scroll intent.
 */
export function TranscriptScrollToBottom({
  host,
  footerHeight,
  isPinned,
  subscribePinned,
  onPin,
}: {
  host: HTMLElement | null;
  footerHeight: number;
  isPinned: () => boolean;
  subscribePinned: (listener: () => void) => () => void;
  onPin: () => void;
}) {
  const pinned = useSyncExternalStore(subscribePinned, isPinned, isPinned);
  if (!host) return null;
  return createPortal(
    <Button
      type="button"
      data-testid="chat-scroll-to-bottom"
      aria-label="Scroll to bottom"
      variant="outline"
      size="icon-sm"
      disabled={pinned}
      onClick={onPin}
      style={{ bottom: `calc(${footerHeight}px + 0.5rem)` }}
      className="pointer-events-auto absolute left-1/2 z-10 -translate-x-1/2 rounded-full text-muted-foreground shadow-md disabled:invisible"
    >
      <ArrowDownIcon />
    </Button>,
    host,
  );
}
