/**
 * LabelAutocomplete — tag input with ghost suggestion, comma-batch entry,
 * Tab-complete, and Backspace-remove. No external deps beyond React.
 *
 * Port of packages/desktop/…/todos/LabelAutocomplete.tsx.
 * Rebuilt on warm-chrome tokens (no mf-* phantoms).
 */
import React, { useState, useRef, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: string[];
  onChange: (labels: string[]) => void;
  allLabels: string[];
}

export function LabelAutocomplete({ value, onChange, allLabels }: Props): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const ghostSuggestion = useMemo(() => {
    const trimmed = inputValue.trim().toLowerCase();
    if (!trimmed) return null;
    return allLabels.find((l) => !value.includes(l) && l.toLowerCase().startsWith(trimmed)) ?? null;
  }, [inputValue, value, allLabels]);

  const addLabels = useCallback(
    (raw: string) => {
      const newLabels = raw
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s && !value.includes(s));
      if (newLabels.length === 0) return;
      const unique = [...new Set(newLabels)];
      onChange([...value, ...unique]);
      setInputValue('');
    },
    [value, onChange],
  );

  const removeLabel = useCallback((label: string) => onChange(value.filter((l) => l !== label)), [value, onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Tab' && ghostSuggestion) {
        e.preventDefault();
        addLabels(ghostSuggestion);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (inputValue.trim()) addLabels(inputValue);
      } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
        onChange(value.slice(0, -1));
      }
    },
    [inputValue, value, ghostSuggestion, addLabels, onChange],
  );

  return (
    <div className="relative">
      <div
        className={cn(
          'bg-background border border-border rounded-md px-2 py-1.5',
          'flex flex-wrap gap-1 cursor-text min-h-[32px]',
          'focus-within:ring-1 focus-within:ring-ring',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((label) => (
          <span
            key={label}
            data-testid={`tasks-label-pill-${label}`}
            className="flex items-center gap-0.5 bg-muted px-1.5 py-0.5 rounded text-caption text-muted-foreground"
          >
            {label}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeLabel(label);
              }}
              className="ml-0.5 hover:text-foreground transition-colors"
              aria-label={`Remove ${label}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <span className="relative flex-1 min-w-[80px]">
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
            className="w-full bg-transparent text-caption text-foreground focus:outline-none"
          />
          {ghostSuggestion && (
            <span
              className="absolute inset-0 pointer-events-none text-caption select-none whitespace-nowrap overflow-hidden flex items-center"
              aria-hidden="true"
            >
              <span className="invisible">{inputValue}</span>
              <span className="text-muted-foreground opacity-40">{ghostSuggestion.slice(inputValue.length)}</span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
