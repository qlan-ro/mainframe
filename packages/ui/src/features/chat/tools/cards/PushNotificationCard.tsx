'use client';

/**
 * PushNotificationCard — compact collapsible card for Claude's 'PushNotification'
 * tool call (todo #293).
 *
 * Family: attention. Collapsed by default.
 * Header: family tile (bell icon) + verb "Notify" + the message, truncated to
 *   one line + StatusDot.
 * Body: the message clamped at two lines, then the CLI's result string verbatim —
 *   Mainframe raises its own notification from the call and never rewrites the
 *   result the CLI writes back.
 *
 * Family color: the semantic --mf-warning pair (the EditFileCard precedent), not
 * a new --mf-tool-* family.
 */
import type { ToolCallMessagePartComponent } from '@assistant-ui/react';
import { BellIcon } from 'lucide-react';
import { StatusDot, CollapsibleCardShell, FamilyTile, ErrorBody, resolveResultText } from '../shared';

const FAMILY_COLOR = 'var(--mf-warning)';
const FAMILY_BG = 'var(--mf-warning-tint)';

// ---------------------------------------------------------------------------
// PushNotificationCard
// ---------------------------------------------------------------------------

export const PushNotificationCard: ToolCallMessagePartComponent = ({ args, result, isError }) => {
  const message = typeof args['message'] === 'string' ? args['message'] : '';
  const { text: resultText } = resolveResultText(result);
  const hasBody = Boolean(message) || Boolean(resultText);

  const tile = (
    <FamilyTile color={FAMILY_COLOR} bg={FAMILY_BG}>
      <BellIcon size={13} style={{ color: FAMILY_COLOR }} />
    </FamilyTile>
  );

  const target = message ? (
    <span className="text-label text-muted-foreground min-w-0 truncate">{message}</span>
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
              className="px-3 pt-2 pb-1 text-body text-foreground leading-normal line-clamp-2"
            >
              {message}
            </p>
          )}
          {resultText && (
            <p
              data-testid="push-notification-card-result"
              className="px-3 pb-2 pt-1.5 font-mono text-label text-muted-foreground leading-normal break-words whitespace-pre-wrap"
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
      tile={tile}
      verb="Notify"
      target={target}
      trailing={<StatusDot result={result} isError={isError} />}
    >
      {body}
    </CollapsibleCardShell>
  );
};

PushNotificationCard.displayName = 'PushNotificationCard';
