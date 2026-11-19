/**
 * AssistantErrorBlock — the styled render for an assistant `error` turn.
 *
 * The projection (convert-message) sets `metadata.custom.mainframe.errorText` on
 * an `error` message and keeps the error string as a plain text part (a11y +
 * ≥1-content-part invariant). AssistantMessage reads `meta.errorText` and renders
 * THIS instead of the plain text, so errors read as errors rather than ordinary
 * assistant prose.
 */
import { AlertTriangleIcon } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/**
 * Headline and the provider's original text meet at the first blank line (the
 * format `turn_error.rs` writes). No blank line, or nothing after it, is one block.
 */
function splitErrorText(text: string): { headline: string; detail: string | null } {
  const at = text.indexOf('\n\n');
  if (at < 0) return { headline: text, detail: null };
  const detail = text.slice(at + 2).replace(/^\n+/, '');
  return detail.trim() ? { headline: text.slice(0, at), detail } : { headline: text, detail: null };
}

export function AssistantErrorBlock({ text }: { text: string }) {
  const { headline, detail } = splitErrorText(text);
  return (
    // No AlertTitle: the error string IS the message, and the primitive's title
    // is `line-clamp-1` — a multi-line CLI error would be silently cut to one.
    <Alert variant="destructive" data-testid="chat-error-block" className="border-destructive/25">
      <AlertTriangleIcon />
      <AlertDescription className="min-w-0 whitespace-pre-wrap wrap-break-word text-destructive">
        {headline}
        {detail !== null && (
          <span className="mt-1 block whitespace-pre-wrap wrap-break-word font-mono text-xs text-muted-foreground select-text">
            {detail}
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
