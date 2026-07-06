/**
 * AssistantErrorBlock — the styled render for an assistant `error` turn.
 *
 * The projection (convert-message) sets `metadata.custom.mainframe.errorText` on
 * an `error` message and keeps the error string as a plain text part (a11y +
 * ≥1-content-part invariant). AssistantMessage reads `meta.errorText` and renders
 * THIS instead of the plain text, so errors read as errors — a destructive-tinted
 * block with an alert glyph — rather than ordinary assistant prose.
 *
 * Tokens: `--mf-destructive-tint` (faint error fill) + `text-destructive` +
 * `border-destructive` (Tailwind v4 `/opacity` is color-mix here, so the hairline
 * border tint is valid). data-testid: chat-error-block.
 */
import { AlertTriangleIcon } from 'lucide-react';

export function AssistantErrorBlock({ text }: { text: string }) {
  return (
    <div
      role="alert"
      data-testid="chat-error-block"
      className="flex items-start gap-2.5 rounded-[11px] border border-destructive/25 bg-[var(--mf-destructive-tint)] px-3.5 py-2.5"
    >
      <AlertTriangleIcon size={15} className="mt-px shrink-0 text-destructive" />
      <span className="min-w-0 whitespace-pre-wrap break-words text-body text-destructive">{text}</span>
    </div>
  );
}
