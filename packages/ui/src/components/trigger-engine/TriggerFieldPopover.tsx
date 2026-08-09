'use client';

/**
 * Listbox for a `useTriggerField`, rendered as a portalled popover anchored to
 * the field it serves. It is out of the field's own layout on purpose: in the
 * composer the field sits inside the thread's sticky viewport footer, whose
 * measured height is the thread's scroll inset, so an in-flow list there grows
 * the composer and pushes thread content up on every open, close, and change
 * in result count.
 *
 * cmdk supplies the panel, list, and row recipe only. The trigger engine keeps
 * detection, filtering, the highlight, selection, the option ids, and the
 * keyboard — the query lives in the caller's textarea, which cmdk cannot see.
 */

import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Command, CommandItem, CommandList } from '@/components/ui/command';
import { cn } from '@/lib/utils';
import type { TriggerEntry, TriggerField } from './use-trigger-field';

/**
 * The element `CommandList asChild` renders into. It has to be a forwardRef
 * component rather than a bare `<div>`: cmdk's asChild path reads `type.render`
 * off the child, which throws on a host-element type.
 */
const ListboxSlot = forwardRef<HTMLDivElement, ComponentProps<'div'>>((props, ref) => <div ref={ref} {...props} />);
ListboxSlot.displayName = 'ListboxSlot';

function TriggerFieldRow({
  entry,
  index,
  field,
  testIdPrefix,
}: {
  entry: TriggerEntry;
  index: number;
  field: TriggerField;
  testIdPrefix: string;
}) {
  const isItem = 'type' in entry;
  const highlighted = index === field.highlightedIndex;
  const testId = isItem
    ? (field.trigger?.itemTestId?.(entry) ?? `${testIdPrefix}-${entry.id}`)
    : `${testIdPrefix}-category-${entry.id}`;
  const glyph = isItem ? field.trigger?.itemGlyph?.(entry) : null;
  return (
    // The index is the row's cmdk value, so cmdk's `data-selected` and the
    // engine's own `data-highlighted` can never name different rows. The row's
    // own layout goes on CommandItem, where `cn` can resolve it against the
    // recipe — Radix's Slot merge only concatenates the child's className.
    <CommandItem asChild value={String(index)} className="flex-col items-start gap-0.5">
      <button
        type="button"
        id={field.optionId(entry.id)}
        data-highlighted={highlighted ? '' : undefined}
        data-testid={testId}
        className="w-full min-w-0 text-left"
        // Keep the caret (and the field's own cursor tracking) alive through the click.
        onMouseDown={(e) => e.preventDefault()}
        onMouseMove={() => field.highlightIndex(index)}
        onClick={() => field.selectEntry(entry)}
      >
        <span className="flex w-full min-w-0 items-center gap-1.5">
          {glyph}
          <span className="min-w-0 truncate text-sm font-medium text-foreground">{entry.label}</span>
        </span>
        {isItem && entry.description != null && (
          <span className="max-w-full truncate text-xs text-muted-foreground">{entry.description}</span>
        )}
      </button>
    </CommandItem>
  );
}

export function TriggerFieldPopover({
  field,
  children,
  testId = 'trigger-field-popover',
  className,
  label = 'Suggestions',
  side = 'top',
}: {
  field: TriggerField;
  /** The element the list anchors to — the composer form, or the automations field container. */
  children: ReactNode;
  testId?: string;
  className?: string;
  label?: string;
  side?: 'top' | 'bottom';
}) {
  const testIdPrefix = field.trigger?.itemTestIdPrefix ?? 'trigger-item';
  const highlighted = field.entries[field.highlightedIndex];

  return (
    <Popover
      open={field.open}
      onOpenChange={(next) => {
        if (!next) field.close();
      }}
    >
      <PopoverAnchor asChild>{children}</PopoverAnchor>
      <PopoverContent
        data-testid={testId}
        side={side}
        align="start"
        sideOffset={6}
        collisionPadding={8}
        // `Command` owns the inner padding; the content is only the panel.
        className={cn('w-(--radix-popover-trigger-width) gap-0 p-0', className)}
        // The caret never leaves the field the list serves.
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        // Clicking inside the field to move the caret mid-token must not dismiss the list.
        onInteractOutside={(e) => {
          if ((e.target as Element | null)?.closest('[data-slot="popover-anchor"]')) e.preventDefault();
        }}
      >
        <Command shouldFilter={false} disablePointerSelection loop={false} value={String(field.highlightedIndex)}>
          {/* asChild keeps the field's own listbox id and active-descendant on the
              element carrying role="listbox", so the input's aria-controls resolves
              across the portal — cmdk would otherwise substitute its own. The
              max-height is CommandList's own `max-h-72` (18rem) and the viewport
              clamp in one expression, because both have to hold at once. */}
          <CommandList asChild className="max-h-[min(18rem,var(--radix-popover-content-available-height))]">
            <ListboxSlot
              id={field.listboxId}
              aria-label={label}
              aria-activedescendant={highlighted ? field.optionId(highlighted.id) : undefined}
            >
              {field.entries.map((entry, index) => (
                <TriggerFieldRow key={entry.id} entry={entry} index={index} field={field} testIdPrefix={testIdPrefix} />
              ))}
            </ListboxSlot>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
