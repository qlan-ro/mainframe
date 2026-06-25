'use client';

/**
 * Quote / select-to-quote — hand-ported from the assistant-ui shadcn registry
 * (https://www.assistant-ui.com/docs/ui/quote), restyled with our mf-* tokens.
 * Pure native primitives — NOT added via `shadcn add` (that churns the lockfile
 * with the mobile submodule on this branch). Three pieces:
 *   - SelectionToolbar     — floating "Quote" button on text selection (portal)
 *   - ComposerQuotePreview — dismissable quote pill above the composer input
 *   - QuoteBlock           — quoted text inside a user message (optional mount)
 *
 * The daemon glue (prepending the quote to the sent message) lives in the
 * controller's parseSendInput, not here — the AI-SDK `injectQuoteContext` path
 * is inert under our external-store runtime.
 */

import { memo, type ComponentProps, type FC } from 'react';
import type { QuoteMessagePartComponent } from '@assistant-ui/react';
import { ComposerPrimitive, SelectionToolbarPrimitive } from '@assistant-ui/react';
import { QuoteIcon, XIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

// --- QuoteBlock (quoted text shown inside a user message) ---------------------

function QuoteBlockRoot({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="quote-block" className={cn('mb-2 flex items-start gap-1.5', className)} {...props} />;
}
function QuoteBlockIcon({ className, ...props }: ComponentProps<typeof QuoteIcon>) {
  return (
    <QuoteIcon
      data-slot="quote-block-icon"
      className={cn('mt-0.5 size-3 shrink-0 text-muted-foreground', className)}
      {...props}
    />
  );
}
function QuoteBlockText({ className, ...props }: ComponentProps<'p'>) {
  return (
    <p
      data-slot="quote-block-text"
      className={cn('line-clamp-2 min-w-0 text-caption italic text-muted-foreground', className)}
      {...props}
    />
  );
}
const QuoteBlockImpl: QuoteMessagePartComponent = ({ text }) => (
  <QuoteBlockRoot>
    <QuoteBlockIcon />
    <QuoteBlockText>{text}</QuoteBlockText>
  </QuoteBlockRoot>
);
const QuoteBlock = memo(QuoteBlockImpl) as unknown as QuoteMessagePartComponent & {
  Root: typeof QuoteBlockRoot;
  Icon: typeof QuoteBlockIcon;
  Text: typeof QuoteBlockText;
};
QuoteBlock.displayName = 'QuoteBlock';
QuoteBlock.Root = QuoteBlockRoot;
QuoteBlock.Icon = QuoteBlockIcon;
QuoteBlock.Text = QuoteBlockText;

// --- SelectionToolbar (floating "Quote" button on text selection) ------------

function SelectionToolbarRoot({ className, ...props }: ComponentProps<typeof SelectionToolbarPrimitive.Root>) {
  return (
    <SelectionToolbarPrimitive.Root
      data-slot="selection-toolbar"
      data-testid="chat-selection-toolbar"
      className={cn(
        'flex items-center gap-1 rounded-lg border border-border bg-popover px-1 py-1 shadow-md',
        className,
      )}
      {...props}
    />
  );
}
function SelectionToolbarQuote({
  className,
  children,
  ...props
}: ComponentProps<typeof SelectionToolbarPrimitive.Quote>) {
  return (
    <SelectionToolbarPrimitive.Quote
      data-slot="selection-toolbar-quote"
      data-testid="chat-selection-quote"
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-label text-popover-foreground transition-colors hover:bg-accent',
        className,
      )}
      {...props}
    >
      {children ?? (
        <>
          <QuoteIcon className="size-3.5" />
          Quote
        </>
      )}
    </SelectionToolbarPrimitive.Quote>
  );
}
const SelectionToolbarImpl: FC<ComponentProps<typeof SelectionToolbarRoot>> = ({ className, ...props }) => (
  <SelectionToolbarRoot className={className} {...props}>
    <SelectionToolbarQuote />
  </SelectionToolbarRoot>
);
const SelectionToolbar = memo(SelectionToolbarImpl) as unknown as typeof SelectionToolbarImpl & {
  Root: typeof SelectionToolbarRoot;
  Quote: typeof SelectionToolbarQuote;
};
SelectionToolbar.displayName = 'SelectionToolbar';
SelectionToolbar.Root = SelectionToolbarRoot;
SelectionToolbar.Quote = SelectionToolbarQuote;

// --- ComposerQuotePreview (dismissable quote pill above the input) ------------

function ComposerQuotePreviewRoot({ className, ...props }: ComponentProps<typeof ComposerPrimitive.Quote>) {
  return (
    <ComposerPrimitive.Quote
      data-slot="composer-quote"
      data-testid="composer-quote-preview"
      className={cn('mx-3 mt-2 flex items-start gap-2 rounded-lg bg-muted px-3 py-2', className)}
      {...props}
    />
  );
}
function ComposerQuotePreviewIcon({ className, ...props }: ComponentProps<typeof QuoteIcon>) {
  return (
    <QuoteIcon
      data-slot="composer-quote-icon"
      className={cn('mt-0.5 size-3.5 shrink-0 text-muted-foreground', className)}
      {...props}
    />
  );
}
function ComposerQuotePreviewText({ className, ...props }: ComponentProps<typeof ComposerPrimitive.QuoteText>) {
  return (
    <ComposerPrimitive.QuoteText
      data-slot="composer-quote-text"
      className={cn('line-clamp-2 min-w-0 flex-1 text-label text-muted-foreground', className)}
      {...props}
    />
  );
}
function ComposerQuotePreviewDismiss({
  className,
  children,
  ...props
}: ComponentProps<typeof ComposerPrimitive.QuoteDismiss>) {
  const defaultClassName =
    'shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground';
  return (
    <ComposerPrimitive.QuoteDismiss
      data-slot="composer-quote-dismiss"
      asChild
      className={children ? className : undefined}
      {...props}
    >
      {children ?? (
        <button
          type="button"
          data-testid="composer-quote-dismiss"
          aria-label="Dismiss quote"
          className={cn(defaultClassName, className)}
        >
          <XIcon className="size-3.5" />
        </button>
      )}
    </ComposerPrimitive.QuoteDismiss>
  );
}
const ComposerQuotePreviewImpl: FC<ComponentProps<typeof ComposerQuotePreviewRoot>> = ({ className, ...props }) => (
  <ComposerQuotePreviewRoot className={className} {...props}>
    <ComposerQuotePreviewIcon />
    <ComposerQuotePreviewText />
    <ComposerQuotePreviewDismiss />
  </ComposerQuotePreviewRoot>
);
const ComposerQuotePreview = memo(ComposerQuotePreviewImpl) as unknown as typeof ComposerQuotePreviewImpl & {
  Root: typeof ComposerQuotePreviewRoot;
  Icon: typeof ComposerQuotePreviewIcon;
  Text: typeof ComposerQuotePreviewText;
  Dismiss: typeof ComposerQuotePreviewDismiss;
};
ComposerQuotePreview.displayName = 'ComposerQuotePreview';
ComposerQuotePreview.Root = ComposerQuotePreviewRoot;
ComposerQuotePreview.Icon = ComposerQuotePreviewIcon;
ComposerQuotePreview.Text = ComposerQuotePreviewText;
ComposerQuotePreview.Dismiss = ComposerQuotePreviewDismiss;

export { QuoteBlock, SelectionToolbar, ComposerQuotePreview };
