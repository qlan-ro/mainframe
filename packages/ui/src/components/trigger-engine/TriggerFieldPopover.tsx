'use client';

/**
 * Listbox for a `useTriggerField`. Renders nothing when the field is closed, so
 * an empty result set shows no chrome.
 */

import { cn } from '@/lib/utils';
import type { TriggerEntry, TriggerField } from './use-trigger-field';

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
    <button
      type="button"
      role="option"
      id={field.optionId(entry.id)}
      aria-selected={highlighted}
      data-highlighted={highlighted ? '' : undefined}
      data-testid={testId}
      className="flex w-full min-w-0 flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left text-sm
                 data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
      // Keep the caret (and the field's own cursor tracking) alive through the click.
      onMouseDown={(e) => e.preventDefault()}
      onMouseMove={() => field.highlightIndex(index)}
      onClick={() => field.selectEntry(entry)}
    >
      <span className="flex min-w-0 items-center gap-1.5">
        {glyph}
        <span className="font-medium text-foreground">{entry.label}</span>
      </span>
      {isItem && entry.description != null && (
        <span className="max-w-full truncate text-xs text-muted-foreground">{entry.description}</span>
      )}
    </button>
  );
}

export function TriggerFieldPopover({
  field,
  testId = 'trigger-field-popover',
  className,
  label = 'Suggestions',
}: {
  field: TriggerField;
  testId?: string;
  className?: string;
  label?: string;
}) {
  if (!field.open) return null;
  const testIdPrefix = field.trigger?.itemTestIdPrefix ?? 'trigger-item';

  return (
    <div
      data-testid={testId}
      className={cn(
        'z-50 max-h-64 w-80 overflow-auto rounded-xl border border-border bg-popover p-1 shadow-md',
        className,
      )}
    >
      <div role="listbox" id={field.listboxId} aria-label={label}>
        {field.entries.map((entry, index) => (
          <TriggerFieldRow key={entry.id} entry={entry} index={index} field={field} testIdPrefix={testIdPrefix} />
        ))}
      </div>
    </div>
  );
}
