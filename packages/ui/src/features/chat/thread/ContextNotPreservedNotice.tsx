/**
 * ContextNotPreservedNotice — dismissible notice shown when a temporary chat's
 * vendor CLI session was lost (a no-persistence spawn's context does not
 * survive a daemon restart, a config respawn, a degraded-recovery rebind, or
 * an unexpected CLI exit) and its earlier turns cannot be resumed (todo #346).
 *
 * A default-variant `Alert`, not `DegradedChatCard`'s destructive one: nothing
 * failed and there is no recovery action to offer — the next message simply
 * starts a fresh vendor session in the same chat. Per the user's live design
 * review (2026-09-24), it is dismissible rather than a standing fact, keyed by
 * `contextLostAt` (context-notice-dismissals.ts) so a LATER loss for the same
 * chat reopens it even if an earlier one was dismissed.
 */
import { History, X } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useChatExtras } from '../runtime/chat-extras';
import { dismissContextNotice, isContextNoticeDismissed } from './context-notice-dismissals';

export function ContextNotPreservedNotice() {
  const chat = useChatExtras()?.state.chatConfig ?? null;
  // Bumped on dismiss to force a re-render of this component after writing to
  // localStorage — isContextNoticeDismissed itself is a plain synchronous read,
  // not React state, so nothing else would re-derive visibility.
  const [dismissTick, setDismissTick] = useState(0);

  const contextLostAt = chat?.contextLostAt ?? null;
  if (chat == null || contextLostAt == null) return null;
  if (dismissTick >= 0 && isContextNoticeDismissed(chat.id, contextLostAt)) return null;

  return (
    <Alert data-testid={`chat-context-not-preserved-${chat.id}`} className="relative mb-4">
      <History />
      <AlertTitle className="pr-8">Earlier context was not preserved</AlertTitle>
      <AlertDescription className="pr-8">
        <p className="min-w-0">
          This chat’s session restarted without the provider keeping its history. Sending a message starts a fresh
          session here.
        </p>
      </AlertDescription>
      <Button
        data-testid={`chat-context-not-preserved-dismiss-${chat.id}`}
        aria-label="Dismiss"
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2 size-6"
        onClick={() => {
          dismissContextNotice(chat.id, contextLostAt);
          setDismissTick((tick) => tick + 1);
        }}
      >
        <X className="size-3.5" />
      </Button>
    </Alert>
  );
}
