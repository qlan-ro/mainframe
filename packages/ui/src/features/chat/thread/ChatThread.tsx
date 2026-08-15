/**
 * ChatThread — warm-chrome thread shell wiring the native message dispatch.
 *
 * Role-based message components (UserMessage / AssistantMessage / SystemMessage)
 * render through MessagePrimitive.GroupedParts + the tool-card registry inside a
 * centered, max-width column. The composer sits in a `ViewportFooter` so its
 * height registers as scroll inset (the last message never hides behind it);
 * the recovery card takes that slot when the working directory is gone. An
 * unanswered gate shares that footer above the composer, in its own slot
 * capped at 45% of the SCROLLPORT (a container query against
 * `ThreadPrimitive.Viewport`'s `[container-type:size]` — not the root, which
 * also contains the in-flow `FindBar` and would over-count the pane by the
 * find bar's height whenever it's open) and scrolling internally, so it never
 * scrolls out of reach and a tall composer draft can never squeeze it away
 * (#336). Three invariants hold together at every scroll position: the gate
 * slot keeps a `min-h-24` floor, the composer's bottom edge never paints past
 * the scrollport, and some transcript stays visible above the footer. The
 * footer reserves a fixed strip for that last one (`calc(100cqh-2rem)`, not a
 * bare `100cqh`) and gives the gate slot first claim on any remaining
 * shrinkage (`shrink-[100]` in ChatGateMount, against the composer wrapper's
 * plain default) — the composer only compresses once the slot is already
 * pinned at its floor. The composer's own root scrolls internally
 * (`min-h-0 overflow-y-auto` in Composer.tsx) so shrinking it clips its
 * content instead of letting it paint past the pane.
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
import { useFindInChatStore } from '../find/find-in-chat-store';
import { useShortcutAction } from '@/features/shortcuts/action-store';
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
  useShortcutAction('chat.find', () => useFindInChatStore.getState().open());
  // The ITEM id, not mainThreadId: a split zone renders a thread that is not the
  // main one, and its rebound item is the identity whose change means "different
  // session in this viewport".
  const threadId = useAuiState((s) => s.threadListItem?.id ?? null);
  const { viewportRef, contentRef } = useThreadBottomPin(threadId);
  const messageCount = useAuiState((s: { thread: { messages: readonly unknown[] } }) => s.thread.messages.length);
  return (
    <ComposerEditProvider>
      <SkillsProvider>
        <ThreadPrimitive.Root
          data-testid="chat-thread"
          className="flex h-full flex-col overflow-hidden bg-background text-foreground"
        >
          {/* In-chat Find bar (Cmd/Ctrl+F) — in-flow above the viewport, NOT
              sticky/overlaid: it takes real space out of the root's flex
              column, which is exactly why the `cqh` query container below
              lives on the viewport rather than the root (#336). */}
          <FindBar />
          {/* Native autoscroll Viewport + a CSS warm-chrome thin scrollbar.
          (Radix ScrollArea via asChild doesn't bind to ThreadPrimitive.Viewport.)
          `[container-type:size]` gives the gate slot's and the footer's `cqh`
          caps a reference that IS the scrollport the sticky footer pins
          against — querying the root instead (the pre-#336-fix-up state)
          silently over-counts the pane by the find bar's height whenever it's
          open, since the root is the find bar's ancestor too. */}
          <ThreadPrimitive.Viewport
            ref={viewportRef}
            data-testid="chat-thread-viewport"
            data-mf-chat-thread
            // Escape from the composer parks focus here; a scroll container is
            // not focusable without it.
            tabIndex={-1}
            className="relative flex flex-1 flex-col overflow-y-auto [container-type:size]"
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
            </div>

            {/* Sticky footer — its height is measured into the scroll inset, so
                the pinned gate is inset for free. `max-h-[calc(100cqh-2rem)]`
                bounds the footer's OWN box against the viewport's
                `[container-type:size]` (the actual scrollport `sticky
                bottom-0` pins against — a sticky box taller than its
                scrollport doesn't pin, it pins to the TOP and overflows past
                the bottom), reserving a fixed 2rem strip so the transcript is
                never fully occluded even with the gate at its cap and a tall
                composer draft (#336). Below that cap, the inner wrapper is a
                flex column with `min-h-0` on both the gate slot and the
                banner+composer wrapper, so each can shrink below its natural
                content size instead of overflowing the footer; the slot's
                `shrink-[100]` (ChatGateMount) gives it first claim on any
                deficit, so the composer only compresses once the slot is
                already pinned at its floor. */}
            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 mt-auto flex max-h-[calc(100cqh-2rem)] shrink-0 flex-col bg-background">
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

              <div
                data-testid="chat-thread-footer"
                className="mx-auto flex w-full min-h-0 max-w-[min(48rem,100%-116px)] flex-col px-5 pb-4"
              >
                <ChatGateMount />
                {/* `min-h-0`, not `shrink-0`: the banner and the composer keep
                    their natural size while there's room, but under a squeeze
                    this wrapper — and the composer inside it (Composer.tsx) —
                    must be free to shrink below content size, or the deficit
                    the slot can't absorb alone paints the composer past the
                    pane (#336). */}
                <div className="flex min-h-0 flex-col">
                  <WorktreeSwitchBanner />
                  <ThreadFooterInput />
                </div>
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
