import type { PromptRemedy } from '@qlan-ro/mainframe-types';
import { useChatExtras } from '../runtime/chat-extras';

interface SendFailureNoticeProps {
  readonly error: string;
  readonly clientId?: string;
  readonly remedy?: PromptRemedy;
  /** The failed send's attachments went back into the composer. */
  readonly attachmentsRestored?: boolean;
}

/**
 * The failed optimistic send's footer: the reason, Retry, and the remedy the
 * daemon offered for the refusal (Unarchive, for a Codex thread archived in
 * Codex). Both actions re-send the text only, so they are hidden once the
 * attachments are back in the composer rather than silently dropping them.
 */
export function SendFailureNotice({ error, clientId, remedy, attachmentsRestored }: SendFailureNoticeProps) {
  const chatExtras = useChatExtras();
  const canResend = clientId != null && chatExtras != null && attachmentsRestored !== true;
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <span data-testid="chat-user-message-send-failed" className="text-xs text-destructive">
          Failed to send
        </span>
        {canResend && remedy === 'unarchive_native_session' && (
          <button
            type="button"
            data-testid="chat-user-message-unarchive"
            title="Unarchive this chat's thread in the provider, then send again"
            onClick={() => void chatExtras.retryMessage(clientId, remedy)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Unarchive
          </button>
        )}
        {canResend && (
          <button
            type="button"
            data-testid="chat-user-message-retry"
            onClick={() => void chatExtras.retryMessage(clientId)}
            className="text-xs font-medium text-primary hover:underline"
          >
            Retry
          </button>
        )}
      </div>
      <p
        data-testid="chat-user-message-send-error"
        className="max-w-[470px] wrap-break-word text-right text-xs text-muted-foreground"
      >
        {error}
      </p>
    </div>
  );
}
