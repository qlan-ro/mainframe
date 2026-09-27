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
 *
 * `compact`/`kind`/`testIdKey` (todo #344): the side-chat panel renders a
 * slim, boxless variant of the SAME component rather than a second design.
 * `kind: 'provider-transcript'` is a distinct, non-dismissible fact ("this
 * provider keeps its own transcript"), shown instead of the not-preserved line
 * whenever the chat's adapter does not report the no-persistence capability —
 * read from `AdapterInfo.capabilities.noPersistence`, never from an adapter
 * id. The two are mutually exclusive by construction: a capability-off chat
 * never stamps `contextLostAt` (only a no-persistence spawn does). `testIdKey`
 * overrides the id the data-testid keys on (the panel passes the PARENT chat
 * id, per the approved design direction) without changing the dismissal key,
 * which stays the chat's own id (`chat.id` — the side chat's own, inside the
 * panel) matching #346's dismissal rule.
 */
import { History, Info, X } from 'lucide-react';
import { useState } from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useAdaptersStore } from '@/store/adapters';
import { useChatExtras } from '../runtime/chat-extras';
import { dismissContextNotice, isContextNoticeDismissed } from './context-notice-dismissals';

export type ContextNoticeKind = 'not-preserved' | 'provider-transcript';

export interface ContextNotPreservedNoticeProps {
  /** Slim single line, no boxed card, no dismiss chrome position change. */
  compact?: boolean;
  kind?: ContextNoticeKind;
  /** Overrides the data-testid's id suffix — defaults to the chat's own id. */
  testIdKey?: string;
}

function ProviderTranscriptBody({ testId, compact }: { testId: string; compact: boolean }) {
  const copy = 'This provider keeps its own transcript for this chat.';
  if (compact) {
    return (
      <div data-testid={testId} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground">
        <Info className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{copy}</span>
      </div>
    );
  }
  return (
    <Alert data-testid={testId} className="mb-4">
      <Info />
      <AlertTitle>This provider keeps its own transcript</AlertTitle>
      <AlertDescription>
        <p className="min-w-0">{copy}</p>
      </AlertDescription>
    </Alert>
  );
}

function NotPreservedBody({
  testId,
  dismissTestId,
  compact,
  onDismiss,
}: {
  testId: string;
  dismissTestId: string;
  compact: boolean;
  onDismiss: () => void;
}) {
  if (compact) {
    return (
      <div data-testid={testId} className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-muted-foreground">
        <History className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">Earlier context was not preserved</span>
        <Button
          data-testid={dismissTestId}
          aria-label="Dismiss"
          variant="ghost"
          size="icon-sm"
          className="size-5 shrink-0"
          onClick={onDismiss}
        >
          <X className="size-3" />
        </Button>
      </div>
    );
  }
  return (
    <Alert data-testid={testId} className="relative mb-4">
      <History />
      <AlertTitle className="pr-8">Earlier context was not preserved</AlertTitle>
      <AlertDescription className="pr-8">
        <p className="min-w-0">
          This chat’s session restarted without the provider keeping its history. Sending a message starts a fresh
          session here.
        </p>
      </AlertDescription>
      <Button
        data-testid={dismissTestId}
        aria-label="Dismiss"
        variant="ghost"
        size="icon-sm"
        className="absolute top-2 right-2 size-6"
        onClick={onDismiss}
      >
        <X className="size-3.5" />
      </Button>
    </Alert>
  );
}

export function ContextNotPreservedNotice({
  compact = false,
  kind = 'not-preserved',
  testIdKey,
}: ContextNotPreservedNoticeProps = {}) {
  const chat = useChatExtras()?.state.chatConfig ?? null;
  // Read unconditionally (hook order) even for the 'not-preserved' kind, which
  // never consumes it — the capability is only relevant to 'provider-transcript'.
  const adapterInfo = useAdaptersStore((s) => (chat ? s.byId[chat.adapterId] : undefined));
  // Bumped on dismiss to force a re-render after writing to localStorage —
  // isContextNoticeDismissed is a plain synchronous read, not React state.
  const [dismissTick, setDismissTick] = useState(0);

  if (chat == null) return null;
  const idKey = testIdKey ?? chat.id;

  if (kind === 'provider-transcript') {
    const noPersistenceCapable = adapterInfo?.capabilities?.noPersistence ?? false;
    if (noPersistenceCapable) return null;
    return <ProviderTranscriptBody testId={`chat-provider-keeps-transcript-${idKey}`} compact={compact} />;
  }

  const contextLostAt = chat.contextLostAt ?? null;
  if (contextLostAt == null) return null;
  if (dismissTick >= 0 && isContextNoticeDismissed(chat.id, contextLostAt)) return null;

  return (
    <NotPreservedBody
      testId={`chat-context-not-preserved-${idKey}`}
      dismissTestId={`chat-context-not-preserved-dismiss-${idKey}`}
      compact={compact}
      onDismiss={() => {
        dismissContextNotice(chat.id, contextLostAt);
        setDismissTick((tick) => tick + 1);
      }}
    />
  );
}
