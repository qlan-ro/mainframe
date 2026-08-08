'use client';

/**
 * VariablePickerButton — the `⟨⟩` affordance mounted in `TriggerTextField`'s
 * slot. Lists the exact same in-scope names as the field's `$` trigger
 * adapter (`buildVariablesTriggerAdapter`) — same namespace, same
 * `sanitizeVariableName` collision rules — so typing `$` and clicking this
 * button always agree on what a name resolves to.
 *
 * Insertion reads the caret directly off `textareaRef` rather than through
 * `useTriggerField`'s `selectEntry` — that method only fires against an
 * already-*detected* token (the user mid-typing a trigger char), which this
 * button-driven flow never has.
 */
import { useState, type RefObject } from 'react';
import { formatVariableRef, type TokenDescriptor } from '@qlan-ro/mainframe-types';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { buildVariablesTriggerAdapter } from './variables-trigger-adapter';

export interface VariablePickerButtonProps {
  scope: TokenDescriptor[];
  testId: string;
  value: string;
  onChange(next: string): void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export function VariablePickerButton({ scope, testId, value, onChange, textareaRef }: VariablePickerButtonProps) {
  const [open, setOpen] = useState(false);
  const items = buildVariablesTriggerAdapter(scope).categoryItems('');
  const pickerTestId = `${testId}-var-picker`;

  function pick(name: string) {
    const el = textareaRef.current;
    const caret = el?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    // Mid-word (`todo/` + name) a bare `$` is literal text; `formatVariableRef`
    // picks the braced spelling there, so the insertion always resolves.
    const literal = formatVariableRef(name, [], before);
    onChange(before + literal + value.slice(caret));
    setOpen(false);
    const nextCaret = caret + literal.length;
    el?.focus();
    el?.setSelectionRange(nextCaret, nextCaret);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid={pickerTestId}
          aria-label="Insert variable"
          className="flex size-[20px] items-center justify-center rounded-md text-xs font-semibold text-primary hover:bg-accent"
        >
          <span aria-hidden className="font-mono">
            ⟨⟩
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        data-testid={`${pickerTestId}-menu`}
        align="end"
        className="w-56 p-1"
        // Radix returns focus to the trigger button on close by default;
        // `pick()` already moved it to the textarea at the insertion point.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <Command>
          <CommandList>
            <CommandEmpty className="px-2 py-4 text-xs text-muted-foreground">No variables in scope yet.</CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  data-testid={`${pickerTestId}-option-${item.id}`}
                  onSelect={() => pick(item.id)}
                >
                  <span className="truncate text-sm text-foreground">{item.label}</span>
                  {item.description && (
                    <span className="ml-auto truncate text-xs text-muted-foreground">{item.description}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
