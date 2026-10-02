import { useAuiState } from '@assistant-ui/react';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { AlertTriangleIcon, Loader2Icon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useChatExtras } from '../runtime/chat-extras';
import { CompactingPill } from '../messages/SystemMessage';
import { useRotatingPhrase } from './use-rotating-phrase';
import { formatElapsedSeconds } from '../format-duration';
import { useRunElapsed } from './use-run-elapsed';
export function LoadErrorBanner() {
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

export function ChatThreadLoadingSpinner() {
  const extras = useChatExtras();
  const threadId = useSideAwareThreadId();
  const messageCount = useAuiState((s: { thread: { messages: readonly unknown[] } }) => s.thread.messages.length);
  const isDraft = threadId?.startsWith('__LOCALID_') === true;
  if (extras?.state.loadState.type !== 'loading' || messageCount > 0 || isDraft) return null;
  return (
    <div
      data-testid="chat-thread-loading"
      role="status"
      aria-label="Loading chat history"
      className="absolute inset-0 flex items-center justify-center"
    >
      <Loader2Icon className="size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
    </div>
  );
}
const RUNNING_PHRASES = ['Thinking…', 'Working…', 'Reasoning…', 'Crunching…', 'Composing…'] as const;
const PHRASE_INTERVAL_MS = 2600;

export function GeneratingIndicator() {
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

export function CompactingIndicator() {
  const extras = useChatExtras();
  if (!extras?.state.compacting) return null;
  return <CompactingPill />;
}
