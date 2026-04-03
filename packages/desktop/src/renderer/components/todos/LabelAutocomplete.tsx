import React, { useState, useRef, useCallback, useMemo } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

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

  const removeLabel = useCallback(
    (label: string) => {
      onChange(value.filter((l) => l !== label));
    },
    [value, onChange],
  );

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
          'bg-mf-app-bg border border-mf-border rounded-mf-input px-2 py-1.5',
          'flex flex-wrap gap-1 cursor-text min-h-[32px]',
          'focus-within:border-mf-accent',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((label) => (
          <span
            key={label}
            className="flex items-center gap-0.5 text-mf-status bg-mf-hover px-1.5 py-0.5 rounded text-mf-text-secondary"
          >
            {label}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                removeLabel(label);
              }}
              className="ml-0.5 hover:text-mf-text-primary transition-colors"
              aria-label={`Remove ${label}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <span className="relative flex-1 min-w-[80px]">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onBlur={() => {
              if (inputValue.trim()) addLabels(inputValue);
            }}
            onKeyDown={handleKeyDown}
            placeholder={value.length === 0 ? 'Add labels...' : ''}
            className="w-full bg-transparent text-mf-small text-mf-text-primary focus:outline-none"
          />
          {ghostSuggestion && (
            <span
              className="absolute inset-0 pointer-events-none text-mf-small select-none whitespace-nowrap overflow-hidden flex items-center"
              aria-hidden="true"
            >
              <span className="invisible">{inputValue}</span>
              <span className="text-mf-text-secondary opacity-40">{ghostSuggestion.slice(inputValue.length)}</span>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
