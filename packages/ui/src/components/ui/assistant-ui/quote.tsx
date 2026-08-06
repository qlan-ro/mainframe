'use client';

/**
 * SelectionToolbar — the floating action toolbar shown on a text selection
 * inside a message (portal), hand-ported from the assistant-ui shadcn
 * registry (https://www.assistant-ui.com/docs/ui/quote) and restyled on v2.
 * Only `SelectionToolbarPrimitive.Root` is native; the actions are v2 Buttons
 * (`ChatSelectionToolbar.tsx` reads `window.getSelection()` itself and appends
 * through the multi-quote segment store, not the native single-quote composer
 * state — see that file's docstring for why `SelectionToolbarPrimitive.Quote`/
 * `ComposerPrimitive.Quote` aren't used).
 */

import type { ComponentProps } from 'react';
import { SelectionToolbarPrimitive } from '@assistant-ui/react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@v2/components/ui/button';
import { cn } from '@v2/lib/utils';

function SelectionToolbarRoot({ className, ...props }: ComponentProps<typeof SelectionToolbarPrimitive.Root>) {
  return (
    <SelectionToolbarPrimitive.Root
      data-slot="selection-toolbar"
      data-testid="chat-selection-toolbar"
      className={cn(
        'flex items-center gap-1 rounded-md bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10',
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
}: ComponentProps<typeof Button> & { icon: LucideIcon; label: string }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      data-slot="selection-toolbar-action"
      onMouseDown={(e) => e.preventDefault()}
      className={className}
      {...props}
    >
      <Icon data-icon="inline-start" />
      {label}
    </Button>
  );
}

export const SelectionToolbar = {
  Root: SelectionToolbarRoot,
  Action: SelectionToolbarAction,
};
