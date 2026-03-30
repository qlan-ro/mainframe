import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  allLabels: string[];
  className?: string;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

/**
 * Comma-separated label input with autocomplete dropdown.
 * Suggests existing labels for the segment after the last comma.
 */
export function LabelInput({
  value,
  onChange,
  allLabels,
  className,
  placeholder,
  onKeyDown,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  // Parse current segment (text after last comma)
  const parts = value.split(',');
  const currentSegment = (parts[parts.length - 1] ?? '').trimStart();
  const alreadyUsed = new Set(
    parts
      .slice(0, -1)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );

  // Filter suggestions: match current segment, exclude already-used labels
  const suggestions =
    currentSegment.length > 0
      ? allLabels.filter(
          (l) => l.toLowerCase().includes(currentSegment.toLowerCase()) && !alreadyUsed.has(l.toLowerCase()),
        )
      : [];

  const showDropdown = open && suggestions.length > 0;

  // Position dropdown below input
  const updatePos = useCallback(() => {
    if (!inputRef.current) return;
    const rect = inputRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 2, left: rect.left, width: rect.width });
  }, []);

  useEffect(() => {
    if (showDropdown) updatePos();
  }, [showDropdown, updatePos]);

  // Close on outside click
  useEffect(() => {
    if (!showDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (inputRef.current?.contains(e.target as Node) || panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDropdown]);

  // Reset highlight when suggestions change
  useEffect(() => {
    setHighlighted(0);
  }, [suggestions.length]);

  const selectSuggestion = useCallback(
    (label: string) => {
      const prefix = parts.slice(0, -1).join(', ');
      const next = prefix ? `${prefix}, ${label}, ` : `${label}, `;
      onChange(next);
      setOpen(false);
      inputRef.current?.focus();
    },
    [parts, onChange],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showDropdown) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setHighlighted((h) => (h + 1) % suggestions.length);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length);
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          if (suggestions[highlighted]) {
            e.preventDefault();
            selectSuggestion(suggestions[highlighted]);
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setOpen(false);
          return;
        }
      }
      onKeyDown?.(e);
    },
    [showDropdown, suggestions, highlighted, selectSuggestion, onKeyDown],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={className}
        autoComplete="off"
      />
      {showDropdown &&
        createPortal(
          <div
            ref={panelRef}
            style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
            className="z-50 max-h-36 overflow-y-auto bg-mf-panel-bg border border-mf-border rounded-mf-input shadow-lg py-1"
          >
            {suggestions.map((label, i) => (
              <button
                key={label}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectSuggestion(label)}
                className={cn(
                  'w-full text-left px-2.5 py-1 text-mf-small transition-colors',
                  i === highlighted
                    ? 'bg-mf-hover text-mf-text-primary'
                    : 'text-mf-text-secondary hover:bg-mf-hover hover:text-mf-text-primary',
                )}
              >
                {label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
