/**
 * ChatThread — warm-chrome thread shell wiring the native message dispatch.
 *
 * Role-based message components (UserMessage / AssistantMessage / SystemMessage)
 * render through MessagePrimitive.GroupedParts + the tool-card registry inside a
 * centered, max-width column. The composer sits in a `ViewportFooter` so its
 * height registers as scroll inset (the last message never hides behind it);
 * the recovery card takes that slot when the working directory is gone.
 */
import type { ReactNode } from 'react';
import { ThreadPrimitive, useAuiState } from '@assistant-ui/react';
import { AlertTriangleIcon, ArrowDownIcon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { boundedMessageComponents } from '../messages/bounded-messages';
import { Composer } from '../composer/Composer';
import { WorktreeSwitchBanner } from '../composer/WorktreeSwitchBanner';
import { ChatSelectionToolbar } from './ChatSelectionToolbar';
import { ComposerEditProvider } from '../composer/edit/composer-edit-context';
import { ChatGateMount } from '../gates/ChatGateMount';
import { CompactingPill } from '../messages/SystemMessage';
import { DegradedChatCard } from './DegradedChatCard';
import { useChatExtras } from '../runtime/use-chat-thread-runtime';
import { useRotatingPhrase } from './use-rotating-phrase';
import { formatElapsedSeconds } from '../format-duration';
import { useRunElapsed } from './use-run-elapsed';
import { useThreadBottomPin } from './use-thread-bottom-pin';
import { SkillsProvider } from '@/features/skills/use-chat-skills';
import { useDraftConfigStore } from '@/features/sessions/runtime/draft-config';
import { FindBar } from '../find/FindBar';
import { useFindHotkey } from '../find/use-find-hotkey';
// Side-effect: populates the tool-card registry (kept out of registry.ts to break the import cycle).
import '../tools/register-cards';

/** Surfaces a failed history load (loadState reduced to error) with a retry —
 *  otherwise a failed load renders as a silent empty chat. Same recipe as
 *  DegradedChatCard: a destructive Alert plus an outline action. */
function LoadErrorBanner() {
  const extras = useChatExtras();
  if (extras?.state.loadState.type !== 'error') return null;
  return (
    <div data-testid="chat-thread-load-error" className="mx-auto my-8 flex max-w-sm flex-col gap-3">
      <Alert variant="destructive">
        <AlertTriangleIcon />
        <AlertTitle>Couldn’t load this chat</AlertTitle>
        <AlertDescription>Its history is on the daemon — retrying re-reads it.</AlertDescription>
      </Alert>
      <div className="flex">
        <Button data-testid="chat-thread-load-retry" variant="outline" size="sm" onClick={() => void extras.retry()}>
          Retry
        </Button>
      </div>
    </div>
  );
}

// Rotated while a run is active; each is rendered with the shimmer sweep.
const RUNNING_PHRASES = ['Thinking…', 'Working…', 'Reasoning…', 'Crunching…', 'Composing…'] as const;
const PHRASE_INTERVAL_MS = 2600;

/**
 * Two treatments lifted from assistant-ui's `elements-thinking-indicator`
 * (https://r.assistant-ui.com/elements-thinking-indicator.json, fetched
 * 2026-08-07; sha256 of its `files[0].content`
 * 974a60f431517c6c53273af3f8eef3f31dd37c00ca620b14b9297a91838f03d3 — the
 * registry item carries no version, so re-pull and diff against that hash):
 * the leading pulse dot and the trailing elapsed readout. An IDEA
 * lift, not a fork — the component stays ours, so both are re-themed to house
 * tokens: the dot is `primary`, not upstream's `blue-500` (v2's settled
 * "working" signal — same call AssistantMessage's RunningIndicator took), and
 * the readout takes `muted-foreground` rather than upstream's `text-foreground/30`
 * ink tier, matching every other elapsed reading in the app.
 *
 * NOT taken: upstream's per-label entrance animation. It needs a second,
 * absolutely-positioned copy of the label to carry the shimmer (`animate-in`
 * and `shimmer` both write `animation`, so one element cannot do both), which
 * would duplicate the phrase in the accessibility tree and in this row's
 * textContent.
 */
function GeneratingIndicator() {
  const isRunning = useAuiState((s: { thread: { isRunning: boolean } }) => s.thread.isRunning);
  const phrase = useRotatingPhrase(isRunning, RUNNING_PHRASES, PHRASE_INTERVAL_MS);
  const elapsed = useRunElapsed(isRunning);
  if (!isRunning) return null;
  return (
    <div data-testid="chat-thread-running" className="flex items-center gap-2 px-1 pb-1.5">
      <span
        aria-hidden
        className="size-1.5 shrink-0 animate-pulse rounded-full bg-primary motion-reduce:animate-none"
      />
      {/* Stock `shimmer` (from shadcn/tailwind.css, which the v2 sheet imports)
          replaces the bridge's hand-rolled `mf-text-shimmer`. It derives base and
          highlight from currentColor, so `text-muted-foreground` gives the same
          muted-with-a-brighter-sweep reading, and it ships its own unlayered
          `prefers-reduced-motion` reset. Verified by compiling app.css with the
          Tailwind CLI, not by assuming the class resolves. */}
      <span data-testid="chat-thread-running-text" className="text-xs font-medium text-muted-foreground shimmer">
        {phrase}
      </span>
      {elapsed !== undefined && (
        <span
          data-testid="chat-thread-running-elapsed"
          className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground"
        >
          {formatElapsedSeconds(elapsed)}
        </span>
      )}
    </div>
  );
}

/** Transient chrome, not a persisted message — lives outside
 *  ThreadPrimitive.Messages; the "Context compacted" system message replaces
 *  it once compact-done lands in the transcript. */
function CompactingIndicator() {
  const extras = useChatExtras();
  if (!extras?.state.compacting) return null;
  return <CompactingPill />;
}

function ThreadFooterInput() {
  const directoryMissing = useChatExtras()?.state.chatConfig?.directoryMissing ?? false;
  // A projectless draft has nowhere to create the chat: the welcome screen's
  // picker resolves the project first, and the composer appears with it.
  // Read the ITEM id, not mainThreadId — under a split zone this thread is not
  // the main one, and the rebound threadListItem is the identity that matches.
  const itemId = useAuiState((s) => s.threadListItem?.id ?? null);
  const itemStatus = useAuiState((s) => s.threadListItem?.status);
  const hasDraftCfg = useDraftConfigStore((s) => (itemId ? s.drafts.has(itemId) : false));
  const projectlessDraft = itemId?.startsWith('__LOCALID_') === true && itemStatus === 'new' && !hasDraftCfg;
  return (
    <>
      <DegradedChatCard />
      {!directoryMissing && !projectlessDraft && <Composer />}
    </>
  );
}

export function ChatThread({ emptyState }: { emptyState?: ReactNode } = {}) {
  useFindHotkey();
  const { viewportRef, contentRef } = useThreadBottomPin();
  const messageCount = useAuiState((s: { thread: { messages: readonly unknown[] } }) => s.thread.messages.length);
  return (
    <ComposerEditProvider>
      <SkillsProvider>
        <ThreadPrimitive.Root
          data-testid="chat-thread"
          className="flex h-full flex-col overflow-hidden bg-background text-foreground"
        >
          {/* In-chat Find bar (Cmd/Ctrl+F) — sticky above the scrolling viewport. */}
          <FindBar />
          {/* Native autoscroll Viewport + a CSS warm-chrome thin scrollbar.
          (Radix ScrollArea via asChild doesn't bind to ThreadPrimitive.Viewport.) */}
          <ThreadPrimitive.Viewport
            ref={viewportRef}
            data-testid="chat-thread-viewport"
            data-mf-chat-thread
            className="relative flex flex-1 flex-col overflow-y-auto"
          >
            {/* Width cap: 48rem, minus the rail block (58px) MIRRORED on both
                sides — in a narrow zone the transcript clears the floating
                rail instead of running under it, with a symmetric left inset. */}
            <div ref={contentRef} className="mx-auto w-full max-w-[min(48rem,100%-116px)] flex-1 px-5 py-4">
              <LoadErrorBanner />
              {messageCount === 0 && emptyState != null ? emptyState : null}
              <ThreadPrimitive.Messages components={boundedMessageComponents} />
              {/* Inline "thinking/working" indicator — sits after the last message,
                  not pinned above the composer (#214). */}
              <GeneratingIndicator />
              <CompactingIndicator />
              <ChatGateMount />
            </div>

            {/* Sticky footer — its height is measured into the scroll inset. */}
            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto flex flex-col bg-background">
              <ThreadPrimitive.ScrollToBottom asChild>
                <Button
                  data-testid="chat-scroll-to-bottom"
                  aria-label="Scroll to bottom"
                  variant="outline"
                  size="icon-sm"
                  // shadow-md, not the variant's shadow-xs: this one floats over
                  // the transcript rather than sitting in a row.
                  className="absolute -top-10 left-1/2 z-10 -translate-x-1/2 rounded-full text-muted-foreground shadow-md disabled:invisible"
                >
                  <ArrowDownIcon />
                </Button>
              </ThreadPrimitive.ScrollToBottom>

              <div data-testid="chat-thread-footer" className="mx-auto w-full max-w-[min(48rem,100%-116px)] px-5 pb-4">
                <WorktreeSwitchBanner />
                <ThreadFooterInput />
              </div>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>

          {/* Floating Quote / New-session actions on text selection inside a message (portals to body). */}
          <ChatSelectionToolbar />
        </ThreadPrimitive.Root>
      </SkillsProvider>
    </ComposerEditProvider>
  );
}
