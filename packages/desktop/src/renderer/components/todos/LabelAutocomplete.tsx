import React, { useState, useRef, useCallback, useEffect } from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface Props {
  value: string[];
  onChange: (labels: string[]) => void;
  allLabels: string[];
}

export function LabelAutocomplete({ value, onChange, allLabels }: Props): React.ReactElement {
  const [inputValue, setInputValue] = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = allLabels.filter((l) => !value.includes(l) && l.toLowerCase().includes(inputValue.toLowerCase()));

  const addLabel = useCallback(
    (label: string) => {
      const trimmed = label.trim();
      if (!trimmed || value.includes(trimmed)) return;
      onChange([...value, trimmed]);
      setInputValue('');
      setShowDropdown(false);
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
      if (e.key === 'Enter') {
        e.preventDefault();
        if (inputValue.trim()) addLabel(inputValue);
      } else if (e.key === 'Backspace' && !inputValue && value.length > 0) {
        onChange(value.slice(0, -1));
      } else if (e.key === 'Escape') {
        setShowDropdown(false);
      }
    },
    [inputValue, value, addLabel, onChange],
  );

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={containerRef} className="relative">
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
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={handleKeyDown}
          placeholder={value.length === 0 ? 'Add labels...' : ''}
          className="flex-1 min-w-[80px] bg-transparent text-mf-small text-mf-text-primary focus:outline-none"
        />
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg max-h-40 overflow-y-auto">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                addLabel(suggestion);
              }}
              className="w-full text-left px-2 py-1 text-mf-small text-mf-text-primary hover:bg-mf-hover transition-colors"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
