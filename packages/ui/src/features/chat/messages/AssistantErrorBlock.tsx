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
import { Alert, AlertDescription } from '@v2/components/ui/alert';

export function AssistantErrorBlock({ text }: { text: string }) {
  return (
    // No AlertTitle: the error string IS the message, and the primitive's title
    // is `line-clamp-1` — a multi-line CLI error would be silently cut to one.
    <Alert variant="destructive" data-testid="chat-error-block" className="border-destructive/25">
      <AlertTriangleIcon />
      <AlertDescription className="min-w-0 whitespace-pre-wrap wrap-break-word text-destructive">
        {text}
      </AlertDescription>
    </Alert>
  );
}
