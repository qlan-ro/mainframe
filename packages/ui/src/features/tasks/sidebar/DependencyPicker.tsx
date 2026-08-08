/**
 * Picks the tasks this one depends on.
 *
 * The shipped picker hand-rolls a dropdown with its own search field,
 * click-outside listener and Escape handler. All three are what `Popover` +
 * `Command` already are, so the port keeps only the domain rules: never depend
 * on yourself, never twice on the same task.
 */
import { useMemo, useState } from 'react';
import { PlusIcon, XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Todo } from '@/lib/api/todos';

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface DependencyPickerProps {
  currentNumber?: number;
  allTodos: Todo[];
  value: number[];
  onChange: (value: number[]) => void;
}

export function DependencyPicker({ currentNumber, allTodos, value, onChange }: DependencyPickerProps) {
  const [open, setOpen] = useState(false);

  const available = useMemo(
    () => allTodos.filter((t) => t.number !== currentNumber && !value.includes(t.number)),
    [allTodos, currentNumber, value],
  );
  const selected = allTodos.filter((t) => value.includes(t.number));

  return (
    <div className="flex flex-col gap-1.5">
      <Label>Depends on</Label>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((todo) => (
            <Badge key={todo.number} data-testid={`tasks-dep-pill-${todo.number}`} variant="secondary" className="pr-1">
              #{todo.number} {truncate(todo.title, 24)}
              <button
                type="button"
                data-testid={`tasks-dep-remove-${todo.number}`}
                aria-label={`Remove dependency on #${todo.number}`}
                onClick={() => onChange(value.filter((n) => n !== todo.number))}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {available.length > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              data-testid="tasks-dep-input"
              variant="outline"
              size="sm"
              className="w-full justify-start font-normal text-muted-foreground"
            >
              <PlusIcon />
              Add dependency…
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-(--radix-popover-trigger-width) p-0">
            <Command>
              <CommandInput placeholder="Search tasks…" />
              <CommandList>
                <CommandEmpty>No matching tasks</CommandEmpty>
                {available.map((todo) => (
                  <CommandItem
                    key={todo.number}
                    data-testid={`tasks-dep-opt-${todo.number}`}
                    value={`#${todo.number} ${todo.title}`}
                    onSelect={() => {
                      onChange([...value, todo.number]);
                      setOpen(false);
                    }}
                  >
                    <span className="text-muted-foreground">#{todo.number}</span>
                    <span className="truncate">{todo.title}</span>
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        value.length === 0 && <span className="text-xs text-muted-foreground">No other tasks available</span>
      )}
    </div>
  );
}
