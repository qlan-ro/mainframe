/**
 * ChatThread — warm-chrome thread shell wiring the native message dispatch.
 *
 * Role-based message components (UserMessage / AssistantMessage / SystemMessage)
 * render through MessagePrimitive.GroupedParts + the tool-card registry inside a
 * centered, max-width column. The full composer port (config toolbar, attachments,
 * queue) is a later leaf — the composer here stays intentionally thin.
 */
import { ThreadPrimitive, ComposerPrimitive, useAuiState } from '@assistant-ui/react';
import { ArrowDownIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { UserMessage } from '../messages/UserMessage';
import { AssistantMessage } from '../messages/AssistantMessage';
import { SystemMessage } from '../messages/SystemMessage';
// Side-effect: populates the tool-card registry (kept out of registry.ts to break the import cycle).
import '../tools/register-cards';

// ---- Generating indicator -----------------------------------------------------

function GeneratingIndicator() {
  const isRunning = useAuiState((s: { thread: { isRunning: boolean } }) => s.thread.isRunning);
  if (!isRunning) return null;
  return (
    <div
      data-testid="chat-thread-running"
      className="flex items-center gap-2 px-1 py-1 text-caption text-muted-foreground"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-mf-warning" />
      Thinking…
    </div>
  );
}

// ---- Composer (thin — full port is a later leaf) ------------------------------

function Composer() {
  return (
    <div className="border-t border-border bg-background px-4 py-3">
      <div className="mx-auto flex w-full max-w-3xl gap-2">
        <ComposerPrimitive.Input
          data-testid="chat-composer-input"
          placeholder="Message the assistant…"
          rows={1}
          className="flex-1 resize-none rounded-lg border border-border bg-card px-3 py-2 text-body text-foreground outline-none placeholder:text-mf-text-4 focus-visible:ring-1 focus-visible:ring-ring"
        />
        <ComposerPrimitive.Send
          data-testid="chat-composer-send"
          className="rounded-lg bg-primary px-4 py-2 text-body font-medium text-primary-foreground transition-colors hover:opacity-90 disabled:opacity-50"
        >
          Send
        </ComposerPrimitive.Send>
      </div>
    </div>
  );
}

// ---- Thread -------------------------------------------------------------------

export function ChatThread() {
  return (
    <ThreadPrimitive.Root
      data-testid="chat-thread"
      className="flex h-full flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Native autoscroll Viewport with a CSS-styled warm-chrome thin scrollbar.
          (Radix ScrollArea via asChild doesn't wire its overflow/ref through
          ThreadPrimitive.Viewport — it leaves overflow:visible, unbounded — so we
          style the native scroller instead; same visual, scroll engine intact.) */}
      <ThreadPrimitive.Viewport
        data-testid="chat-thread-viewport"
        className="mf-thin-scrollbar relative flex-1 overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl px-5 py-4">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, SystemMessage }} />
        </div>

        <ThreadPrimitive.ScrollToBottom asChild>
          <button
            data-testid="chat-scroll-to-bottom"
            aria-label="Scroll to bottom"
            className={cn(
              'absolute bottom-4 left-1/2 z-10 -translate-x-1/2',
              'flex size-8 items-center justify-center rounded-full',
              'border border-border bg-card text-muted-foreground shadow-[var(--mf-shadow-pop)]',
              'transition-opacity hover:text-foreground disabled:invisible',
            )}
          >
            <ArrowDownIcon className="size-4" />
          </button>
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>

      <div className="mx-auto w-full max-w-3xl px-5">
        <GeneratingIndicator />
      </div>
      <Composer />
    </ThreadPrimitive.Root>
  );
}
