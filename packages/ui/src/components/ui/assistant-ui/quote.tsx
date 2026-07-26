'use client';

/**
 * SelectionToolbar — the floating action toolbar shown on a text selection
 * inside a message (portal), hand-ported from the assistant-ui shadcn
 * registry (https://www.assistant-ui.com/docs/ui/quote) and restyled with
 * our mf-* tokens. Only `SelectionToolbarPrimitive.Root` is native; the
 * actions are plain buttons (`ChatSelectionToolbar.tsx` reads
 * `window.getSelection()` itself and appends through the multi-quote segment
 * store, not the native single-quote composer state — see that file's
 * docstring for why `SelectionToolbarPrimitive.Quote`/`ComposerPrimitive.Quote`
 * aren't used).
 */

import type { ComponentProps } from 'react';
import { SelectionToolbarPrimitive } from '@assistant-ui/react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

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

// A generic toolbar action (e.g. Quote, "New session") — plain button, no
// SelectionToolbarPrimitive wiring, so callers own the click behavior and read
// `window.getSelection()` themselves (the info SelectionToolbarPrimitive.Root
// captures internally isn't exposed outside the package).
function SelectionToolbarAction({
  className,
  icon: Icon,
  label,
  ...props
}: ComponentProps<'button'> & { icon: LucideIcon; label: string }) {
  return (
    <button
      type="button"
      data-slot="selection-toolbar-action"
      onMouseDown={(e) => e.preventDefault()}
      className={cn(
        'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-label text-popover-foreground transition-colors hover:bg-accent',
        className,
      )}
      {...props}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  );
}

export const SelectionToolbar = {
  Root: SelectionToolbarRoot,
  Action: SelectionToolbarAction,
};
