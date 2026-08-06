'use client';

/**
 * PushNotificationCard — compact collapsible card for Claude's 'PushNotification'
 * tool call (todo #293).
 *
 * Family: attention. Collapsed by default.
 * Header: bell glyph + verb "Notify" + the message, truncated to
 *   one line + StatusDot.
 * Body: the message clamped at two lines, then the CLI's result string verbatim —
 *   Mainframe raises its own notification from the call and never rewrites the
 *   result the CLI writes back.
 *
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { BellIcon } from 'lucide-react';
import { StatusDot, CollapsibleCardShell, ErrorBody, resolveResultText } from '../shared';

// ---------------------------------------------------------------------------
// PushNotificationCard
// ---------------------------------------------------------------------------

export const PushNotificationCard: ToolCallMessagePartComponent = ({ args, result, isError }) => {
  const message = typeof args['message'] === 'string' ? args['message'] : '';
  const { text: resultText } = resolveResultText(result);
  const hasBody = Boolean(message) || Boolean(resultText);

  const target = message ? (
    <span className="min-w-0 truncate text-sm text-muted-foreground">{message}</span>
  ) : undefined;

  const body = hasBody ? (
    <div className="border-t border-border">
      {isError ? (
        <ErrorBody text={resultText} testId="push-notification-card-error-body" />
      ) : (
        <>
          {message && (
            <p
              data-testid="push-notification-card-message"
              className="line-clamp-2 px-3 pt-2 pb-1 text-sm leading-normal text-foreground"
            >
              {message}
            </p>
          )}
          {resultText && (
            <p
              data-testid="push-notification-card-result"
              className="px-3 pt-1.5 pb-2 font-mono text-xs leading-normal wrap-break-word whitespace-pre-wrap text-muted-foreground"
            >
              {resultText}
            </p>
          )}
        </>
      )}
    </div>
  ) : null;

  return (
    <CollapsibleCardShell
      testId="push-notification-card-root"
      triggerId="push-notification-card-trigger"
      result={result}
      isError={isError}
      defaultOpen={false}
      disableTrigger={!hasBody}
      icon={<BellIcon />}
      verb="Notify"
      target={target}
      trailing={<StatusDot result={result} isError={isError} />}
    >
      {body}
    </CollapsibleCardShell>
  );
};

PushNotificationCard.displayName = 'PushNotificationCard';
