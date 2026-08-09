'use client';

/**
 * Trigger-driven autocomplete for a plain text field: detection, navigation,
 * keyboard, insertion, and the combobox ARIA — independent of any editor.
 *
 * The composer feeds it through assistant-ui's composer-input plugin registry;
 * plain textareas feed it from their own change/select/keydown handlers.
 */

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { detectTrigger } from './detect';
import { computeNavigation } from './navigation';
import { insertDirective } from './selection';
import type { DetectedTrigger, TriggerCategory, TriggerConfig, TriggerItem } from './types';

export type TriggerEntry = TriggerCategory | TriggerItem;

/** The subset of a keyboard event the field consumes. */
export interface TriggerKeyEvent {
  readonly key: string;
  readonly shiftKey: boolean;
  preventDefault(): void;
}

export interface TriggerFieldAriaProps {
  role: 'combobox';
  'aria-autocomplete': 'list';
  'aria-haspopup': 'listbox';
  'aria-expanded': boolean;
  'aria-controls'?: string;
  'aria-activedescendant'?: string;
}

export interface TriggerField {
  /** True when there is something to show — the popover renders only then. */
  open: boolean;
  listboxId: string;
  /** The trigger whose token is currently active, for item test-ids. */
  trigger: TriggerConfig | null;
  entries: readonly TriggerEntry[];
  highlightedIndex: number;
  ariaProps: TriggerFieldAriaProps;
  optionId(entryId: string): string;
  /** Returns true when the key was consumed and the caller must not act on it. */
  handleKeyDown(e: TriggerKeyEvent): boolean;
  /** Dismisses the list and stops matching the current token. */
  close(): void;
  setCursorPosition(position: number): void;
  selectEntry(entry: TriggerEntry): void;
  highlightIndex(index: number): void;
}

export interface UseTriggerFieldOptions {
  value: string;
  onChange(next: string): void;
  triggers: readonly TriggerConfig[];
  /** When given, the caret is restored after an insertion (mouse picks fire no change event). */
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
}

interface ActiveTrigger {
  config: TriggerConfig;
  detected: DetectedTrigger;
}

const isItem = (entry: TriggerEntry): entry is TriggerItem => 'type' in entry;

/** First trigger char whose token ends at the cursor. Tokens can't overlap, so first match wins. */
function detectActive(triggers: readonly TriggerConfig[], value: string, cursor: number): ActiveTrigger | null {
  for (const config of triggers) {
    const detected = detectTrigger(value, config.char, cursor);
    if (detected) return { config, detected };
  }
  return null;
}

const wrap = (next: number, length: number) => (length === 0 ? 0 : (next + length) % length);

export function useTriggerField({ value, onChange, triggers, textareaRef }: UseTriggerFieldOptions): TriggerField {
  const listboxId = useId();
  const [cursor, setCursor] = useState(0);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const active = detectActive(triggers, value, cursor);
  const query = active?.detected.query ?? '';
  // Memoized so the entries identity is stable across unrelated renders (the
  // highlight reset below keys on it); async sources invalidate by handing us a
  // new adapter reference.
  const adapter = active?.config.adapter;
  const nav = useMemo(() => computeNavigation(adapter, query, activeCategoryId), [adapter, query, activeCategoryId]);
  const entries = nav.navigableList;
  const open = entries.length > 0;

  useEffect(() => setHighlightedIndex(0), [entries]);

  const snapshot = useRef({ value, active, entries, highlightedIndex, activeCategoryId, query, onChange });
  snapshot.current = { value, active, entries, highlightedIndex, activeCategoryId, query, onChange };

  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const position = pendingCaret.current;
    if (position == null) return;
    pendingCaret.current = null;
    const el = textareaRef?.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(position, position);
  });

  const close = useCallback(() => {
    setActiveCategoryId(null);
    // Rewinding the tracked cursor behind the trigger char is what stops
    // detection — the same mechanism the library's own close() used.
    const { active: current } = snapshot.current;
    if (current) setCursor(current.detected.offset);
  }, []);

  const selectEntry = useCallback((entry: TriggerEntry) => {
    const { active: current, value: text, onChange: emit } = snapshot.current;
    if (!current) return;
    if (!isItem(entry)) {
      setActiveCategoryId(entry.id);
      return;
    }
    const { config, detected } = current;
    const appendSpace = config.closeOnInsert?.(entry) ?? true;
    const next = insertDirective(text, config.char, detected, config.formatter.serialize(entry), { appendSpace });
    setActiveCategoryId(null);
    setCursor(next.cursor);
    pendingCaret.current = next.cursor;
    emit(next.text);
    config.onInserted?.(entry);
  }, []);

  const handleKeyDown = useCallback(
    (e: TriggerKeyEvent): boolean => {
      const current = snapshot.current;
      if (!current.active) return false;
      const length = current.entries.length;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex((i) => wrap(i + 1, length));
          return true;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex((i) => wrap(i - 1, length));
          return true;
        case 'Enter':
        case 'Tab': {
          if (e.shiftKey) return false;
          e.preventDefault();
          const entry = current.entries[current.highlightedIndex];
          if (entry) selectEntry(entry);
          return true;
        }
        case 'Escape':
          e.preventDefault();
          close();
          return true;
        case 'Backspace':
          if (!current.activeCategoryId || current.query !== '') return false;
          e.preventDefault();
          setActiveCategoryId(null);
          return true;
        default:
          return false;
      }
    },
    [close, selectEntry],
  );

  const highlightIndex = useCallback((index: number) => {
    if (index < 0 || index >= snapshot.current.entries.length) return;
    setHighlightedIndex(index);
  }, []);

  const optionId = useCallback((entryId: string) => `${listboxId}-option-${entryId}`, [listboxId]);

  const highlighted = entries[highlightedIndex];
  return {
    open,
    listboxId,
    trigger: active?.config ?? null,
    entries,
    highlightedIndex,
    optionId,
    handleKeyDown,
    close,
    setCursorPosition: setCursor,
    selectEntry,
    highlightIndex,
    ariaProps: {
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-haspopup': 'listbox',
      'aria-expanded': open,
      ...(open && { 'aria-controls': listboxId }),
      ...(open && highlighted && { 'aria-activedescendant': optionId(highlighted.id) }),
    },
  };
}
