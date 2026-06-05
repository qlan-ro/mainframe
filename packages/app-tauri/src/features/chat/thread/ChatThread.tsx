/**
 * ChatThread — warm-chrome thread shell wiring the native message dispatch.
 *
 * Role-based message components (UserMessage / AssistantMessage / SystemMessage)
 * render through MessagePrimitive.GroupedParts + the tool-card registry inside a
 * centered, max-width column. The composer sits in a `ViewportFooter` so its
 * height registers as scroll inset (the last message never hides behind it).
 */
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { ArrowDownIcon } from 'lucide-react';
import { UserMessage } from '../messages/UserMessage';
import { AssistantMessage } from '../messages/AssistantMessage';
import { SystemMessage } from '../messages/SystemMessage';
import { Composer } from '../composer/Composer';
// Side-effect: populates the tool-card registry (kept out of registry.ts to break the import cycle).
import '../tools/register-cards';

function GeneratingIndicator() {
  const isRunning = useAuiState((s: { thread: { isRunning: boolean } }) => s.thread.isRunning);
  if (!isRunning) return null;
  return (
    <div
      data-testid="chat-thread-running"
      className="flex items-center gap-2 px-1 pb-1.5 text-caption text-muted-foreground"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-mf-warning" />
      Thinking…
    </div>
  );
}

export function ChatThread() {
  return (
    <ThreadPrimitive.Root
      data-testid="chat-thread"
      className="flex h-full flex-col overflow-hidden bg-background text-foreground"
    >
      {/* Native autoscroll Viewport + a CSS warm-chrome thin scrollbar.
          (Radix ScrollArea via asChild doesn't bind to ThreadPrimitive.Viewport.) */}
      <ThreadPrimitive.Viewport
        data-testid="chat-thread-viewport"
        className="mf-thin-scrollbar relative flex flex-1 flex-col overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-3xl flex-1 px-5 py-4">
          <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage, SystemMessage }} />
        </div>

        {/* Sticky footer — its height is measured into the scroll inset. */}
        <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto flex flex-col bg-background">
          <ThreadPrimitive.ScrollToBottom asChild>
            <button
              data-testid="chat-scroll-to-bottom"
              aria-label="Scroll to bottom"
              className="absolute -top-10 left-1/2 z-10 flex size-8 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-[var(--mf-shadow-pop)] transition-opacity hover:text-foreground disabled:invisible"
            >
              <ArrowDownIcon className="size-4" />
            </button>
          </ThreadPrimitive.ScrollToBottom>

          <div className="mx-auto w-full max-w-3xl px-5 pb-4">
            <GeneratingIndicator />
            <Composer />
          </div>
        </ThreadPrimitive.ViewportFooter>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
}
