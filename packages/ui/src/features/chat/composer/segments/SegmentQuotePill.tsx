/**
 * SegmentQuotePill — the quote pill on a committed segment or the pending
 * live segment (spec §2.2). Plain-prop driven, not a reuse of
 * `ComposerQuotePreview`: that compound is wired to the native single-quote
 * composer state (`ComposerPrimitive.Quote/QuoteText/QuoteDismiss`), which
 * the multi-quote segment model replaces (T27 deletes it once nothing else
 * writes `composer.quote`). Reuses its `composer-quote-preview` /
 * `composer-quote-dismiss` testids since it fills the same visual role.
 */
import { QuoteIcon, XIcon } from 'lucide-react';

export function SegmentQuotePill({
  segmentId,
  quote,
  onDismiss,
}: {
  segmentId: string;
  quote: string;
  onDismiss: () => void;
}) {
  return (
    <div
      data-testid="composer-quote-preview"
      data-segment-id={segmentId}
      className="mx-3 mt-2 flex items-start gap-2 rounded-lg border-l-2 border-primary bg-muted px-3 py-2"
    >
      <QuoteIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <p className="line-clamp-2 min-w-0 flex-1 text-label text-muted-foreground">{quote}</p>
      <button
        type="button"
        data-testid="composer-quote-dismiss"
        data-segment-id={segmentId}
        aria-label="Dismiss quote"
        onClick={onDismiss}
        className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
