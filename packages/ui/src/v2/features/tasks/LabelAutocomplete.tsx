/**
 * A tag input with a ghost completion: labels become removable badges, the
 * inline suggestion completes on Tab, comma splits a batch, and Backspace on an
 * empty field removes the last one.
 *
 * The ghost is drawn as an absolutely positioned overlay behind the caret — an
 * invisible copy of the typed text pushes it to the right offset, so it stays
 * aligned without measuring text.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { XIcon } from 'lucide-react';
import { Badge } from '@v2/components/ui/badge';

interface LabelAutocompleteProps {
  value: string[];
  onChange: (labels: string[]) => void;
  allLabels: string[];
}

export function LabelAutocomplete({ value, onChange, allLabels }: LabelAutocompleteProps) {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const ghost = useMemo(() => {
    const trimmed = inputValue.trim().toLowerCase();
    if (!trimmed) return null;
    return allLabels.find((l) => !value.includes(l) && l.toLowerCase().startsWith(trimmed)) ?? null;
  }, [inputValue, value, allLabels]);

  const addLabels = useCallback(
    (raw: string) => {
      const added = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !value.includes(s));
      if (added.length === 0) return;
      onChange([...value, ...new Set(added)]);
      setInputValue('');
    },
    [value, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Tab' && ghost) {
        e.preventDefault();
        addLabels(ghost);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (inputValue.trim()) addLabels(inputValue);
      } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
        onChange(value.slice(0, -1));
      }
    },
    [inputValue, value, ghost, addLabels, onChange],
  );

  return (
    <div
      className="flex min-h-9 cursor-text flex-wrap items-center gap-1 rounded-md border border-input bg-transparent px-2.5 py-1 shadow-xs focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30"
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((label) => (
        <Badge key={label} data-testid={`tasks-label-pill-${label}`} variant="secondary" className="pr-1">
          {label}
          <button
            type="button"
            data-testid={`tasks-label-remove-${label}`}
            aria-label={`Remove ${label}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((l) => l !== label));
            }}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      <span className="relative min-w-20 flex-1">
        <input
          ref={inputRef}
          data-testid="tasks-label-input"
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onBlur={() => {
            if (inputValue.trim()) addLabels(inputValue);
          }}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? 'Add labels…' : ''}
          className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {ghost && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 flex items-center overflow-hidden text-sm whitespace-nowrap select-none"
          >
            <span className="invisible">{inputValue}</span>
            <span className="text-muted-foreground">{ghost.slice(inputValue.length)}</span>
          </span>
        )}
      </span>
    </div>
  );
}
