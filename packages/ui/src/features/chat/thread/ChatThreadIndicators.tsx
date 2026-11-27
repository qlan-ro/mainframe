import { useAuiState } from '@assistant-ui/react';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { AlertTriangleIcon } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { useDelayedVisible } from '@/lib/use-delayed-visible';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useChatExtras } from '../runtime/chat-extras';
import { messageCount } from '../view-model/placeholder';

export function LoadErrorBanner() {
  const extras = useChatExtras();
  if (extras?.state.loadState.type !== 'error') return null;
  return (
    <div data-testid="chat-thread-load-error" className="mx-auto my-8 flex max-w-sm flex-col gap-3">
      <Alert variant="fail">
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

/** Shown only when a load outlasts this, so a cached or fast open never flashes it. */
export const LOADING_DELAY_MS = 200;
/** Once shown it stays this long, so a load ending just after the delay does not flicker. */
export const LOADING_MIN_VISIBLE_MS = 300;

export function ChatThreadLoadingSpinner() {
  const extras = useChatExtras();
  const threadId = useSideAwareThreadId();
  // assistant-ui's stand-in for the coming reply is no history.
  const messages = useAuiState((s) => messageCount(s.thread.messages));
  const isDraft = threadId?.startsWith('__LOCALID_') === true;
  const loadState = extras?.state.loadState.type;
  const loading = loadState === 'loading' && messages === 0 && !isDraft;
  const visible = useDelayedVisible(loading, {
    delay: LOADING_DELAY_MS,
    minVisible: LOADING_MIN_VISIBLE_MS,
    resetKey: threadId,
  });
  // An error replaces the spinner at once; so do the first messages.
  if (!visible || loadState === 'error' || messages > 0) return null;
  return (
    <div
      data-testid="chat-thread-loading"
      role="status"
      aria-label="Loading chat history"
      className="absolute inset-0 flex items-center justify-center"
    >
      <Spinner aria-hidden role="presentation" className="size-6 text-muted-foreground" />
    </div>
  );
}
