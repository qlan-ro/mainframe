import { createPortal } from 'react-dom';
import { ThreadPrimitive } from '@assistant-ui/react';
import { ArrowDownIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * The scroll-to-bottom button, rendered through a portal into `host`.
 *
 * It is declared inside the Viewport tree (so `ThreadPrimitive.ScrollToBottom`
 * still reaches the viewport store) but lands in a sibling of the viewport, out
 * of reach of the viewport's edge-fade mask. `bottom` clears the measured
 * footer: the 8px gap the old `-top-10` placement left above it.
 */
export function TranscriptScrollToBottom({ host, footerHeight }: { host: HTMLElement | null; footerHeight: number }) {
  if (!host) return null;
  return createPortal(
    <ThreadPrimitive.ScrollToBottom asChild>
      <Button
        data-testid="chat-scroll-to-bottom"
        aria-label="Scroll to bottom"
        variant="outline"
        size="icon-sm"
        style={{ bottom: `calc(${footerHeight}px + 0.5rem)` }}
        className="pointer-events-auto absolute left-1/2 z-10 -translate-x-1/2 rounded-full text-muted-foreground shadow-md disabled:invisible"
      >
        <ArrowDownIcon />
      </Button>
    </ThreadPrimitive.ScrollToBottom>,
    host,
  );
}
