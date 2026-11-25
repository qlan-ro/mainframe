import { useAuiState } from '@assistant-ui/react';
import { useSideAwareThreadId } from '@/features/side-chat/side-chat-scope';
import { AlertTriangleIcon, Loader2Icon } from 'lucide-react';
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

export function ChatThreadLoadingSpinner() {
  const extras = useChatExtras();
  const threadId = useSideAwareThreadId();
  // assistant-ui's stand-in for the coming reply is no history.
  const messages = useAuiState((s) => messageCount(s.thread.messages));
  const isDraft = threadId?.startsWith('__LOCALID_') === true;
  if (extras?.state.loadState.type !== 'loading' || messages > 0 || isDraft) return null;
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
