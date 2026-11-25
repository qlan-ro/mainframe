/**
 * SegmentQuotePill — the quote block on a committed segment or the pending
 * live segment (spec §2.2, C14): a 2 px rule, the quote on one line with the
 * whole of it in the tooltip, and where it is from. Plain-prop driven: the
 * native quote compound (`ComposerPrimitive.Quote/QuoteText/QuoteDismiss`)
 * renders the single `composer.quote` cell, and nothing writes that cell
 * anymore — the multi-quote segment model replaced it.
 */
import { XIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ComposerHint } from '../composer-card-context';

export function SegmentQuotePill({
  segmentId,
  quote,
  source,
  onDismiss,
}: {
  segmentId: string;
  quote: string;
  source?: string;
  onDismiss: () => void;
}) {
  return (
    <div
      data-testid="composer-quote-preview"
      data-segment-id={segmentId}
      className="relative flex items-start gap-2 py-0.5 pr-0.5 pl-3 before:absolute before:inset-y-[3px] before:left-0 before:w-0.5 before:rounded-full before:bg-hairline-strong"
    >
      <span className="flex min-w-0 flex-1 flex-col text-muted-foreground">
        <ComposerHint
          label={<span className="block max-h-[40vh] overflow-y-auto wrap-anywhere whitespace-pre-wrap">{quote}</span>}
        >
          {/* One line: a quote's own line breaks collapse, and come back in the tooltip. */}
          <span data-testid="composer-quote-text" className="block truncate text-control/[19px]">
            {quote}
          </span>
        </ComposerHint>
        {source && <span className="mt-px truncate text-caption/[19px]">{source}</span>}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        data-testid="composer-quote-dismiss"
        data-segment-id={segmentId}
        aria-label="Remove this quote"
        onClick={onDismiss}
        className="-mt-px size-5.5 shrink-0 rounded-sm text-muted-foreground hover:bg-sidebar-accent"
      >
        <XIcon />
      </Button>
    </div>
  );
}
