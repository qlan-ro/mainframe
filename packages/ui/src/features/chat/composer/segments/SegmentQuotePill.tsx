/**
 * SegmentQuotePill — the quote pill on a committed segment or the pending
 * live segment (spec §2.2). Plain-prop driven: the native quote compound
 * (`ComposerPrimitive.Quote/QuoteText/QuoteDismiss`) renders the single
 * `composer.quote` cell, and nothing writes that cell anymore — the
 * multi-quote segment model replaced it. Keeps the `composer-quote-preview` /
 * `composer-quote-dismiss` testids since it fills the same visual role.
 */
import { QuoteIcon, XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';

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
      className="mx-3 mt-2 flex items-start gap-2 rounded-lg bg-muted px-3 py-2"
    >
      <QuoteIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <p className="line-clamp-2 min-w-0 flex-1 text-xs text-muted-foreground">{quote}</p>
      <Button
        variant="ghost"
        size="icon-xs"
        data-testid="composer-quote-dismiss"
        data-segment-id={segmentId}
        aria-label="Dismiss quote"
        onClick={onDismiss}
        className="-my-0.5 -mr-1.5 text-muted-foreground"
      >
        <XIcon />
      </Button>
    </div>
  );
}
