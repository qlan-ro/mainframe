/**
 * Row rendering contract for `TriggerFieldPopover` — the two optional
 * per-item hooks (`itemTestId`, `itemGlyph`) and the prefix-derived fallbacks
 * every existing trigger still relies on.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TriggerFieldPopover } from '../TriggerFieldPopover';
import type { TriggerAdapter, TriggerConfig, TriggerItem } from '../types';
import type { TriggerEntry, TriggerField } from '../use-trigger-field';

const ITEMS: TriggerItem[] = [
  { id: 'chat-1', type: 'session', label: 'Fix the parser' },
  { id: 'src/a.ts', type: 'file', label: 'a.ts', description: 'src/a.ts' },
];

const emptyAdapter: TriggerAdapter = { categories: () => [], categoryItems: () => [] };

function makeTrigger(overrides: Partial<TriggerConfig> = {}): TriggerConfig {
  return {
    char: '@',
    adapter: emptyAdapter,
    formatter: { serialize: (item) => `@${item.id}` },
    itemTestIdPrefix: 'composer-file-item',
    ...overrides,
  };
}

function makeField(entries: readonly TriggerEntry[], trigger: TriggerConfig | null): TriggerField {
  return {
    open: true,
    listboxId: 'listbox',
    trigger,
    entries,
    highlightedIndex: 0,
    optionId: (entryId) => `listbox-option-${entryId}`,
    handleKeyDown: () => false,
    setCursorPosition: () => undefined,
    selectEntry: () => undefined,
    highlightIndex: () => undefined,
    ariaProps: {
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-haspopup': 'listbox',
      'aria-expanded': true,
    },
  };
}

describe('TriggerFieldPopover row test ids', () => {
  it('falls back to `<prefix>-<id>` when the trigger declares no itemTestId', () => {
    render(<TriggerFieldPopover field={makeField(ITEMS, makeTrigger())} />);

    expect(screen.getByTestId('composer-file-item-chat-1')).toBeTruthy();
    expect(screen.getByTestId('composer-file-item-src/a.ts')).toBeTruthy();
  });

  it('uses itemTestId when it returns a string and falls back when it returns undefined', () => {
    const itemTestId = (item: TriggerItem) =>
      item.type === 'session' ? `composer-mention-session-${item.id}` : undefined;
    render(<TriggerFieldPopover field={makeField(ITEMS, makeTrigger({ itemTestId }))} />);

    expect(screen.getByTestId('composer-mention-session-chat-1')).toBeTruthy();
    expect(screen.queryByTestId('composer-file-item-chat-1')).toBeNull();
    expect(screen.getByTestId('composer-file-item-src/a.ts')).toBeTruthy();
  });

  it('keeps the category test id prefix-derived even when itemTestId is declared', () => {
    const entries: TriggerEntry[] = [{ id: 'agents', label: 'Agents' }, ...ITEMS];
    render(<TriggerFieldPopover field={makeField(entries, makeTrigger({ itemTestId: () => 'custom' }))} />);

    expect(screen.getByTestId('composer-file-item-category-agents')).toBeTruthy();
  });

  it('falls back to the default prefix when the field has no active trigger', () => {
    render(<TriggerFieldPopover field={makeField(ITEMS, null)} />);

    expect(screen.getByTestId('trigger-item-chat-1')).toBeTruthy();
  });
});

describe('TriggerFieldPopover row glyphs', () => {
  const itemGlyph = (item: TriggerItem) =>
    item.type === 'session' ? <span data-testid="session-glyph">#</span> : null;

  it('renders the glyph node for the items it matches', () => {
    render(<TriggerFieldPopover field={makeField(ITEMS, makeTrigger({ itemGlyph }))} />);

    const sessionRow = screen.getByTestId('composer-file-item-chat-1');
    expect(sessionRow.querySelectorAll('[data-testid="session-glyph"]')).toHaveLength(1);
    expect(sessionRow.textContent).toContain('Fix the parser');
  });

  it('emits no glyph node for items the hook returns null for', () => {
    render(<TriggerFieldPopover field={makeField(ITEMS, makeTrigger({ itemGlyph }))} />);

    const fileRow = screen.getByTestId('composer-file-item-src/a.ts');
    expect(fileRow.querySelector('[data-testid="session-glyph"]')).toBeNull();
    expect(fileRow.textContent).toBe('a.tssrc/a.ts');
  });

  it('renders no glyph for any row when the trigger declares no itemGlyph', () => {
    render(<TriggerFieldPopover field={makeField(ITEMS, makeTrigger())} />);

    expect(screen.queryByTestId('session-glyph')).toBeNull();
    expect(screen.getByTestId('composer-file-item-chat-1').textContent).toBe('Fix the parser');
  });

  it('renders no glyph on category rows', () => {
    const entries: TriggerEntry[] = [{ id: 'agents', label: 'Agents' }];
    render(<TriggerFieldPopover field={makeField(entries, makeTrigger({ itemGlyph: () => <span>x</span> }))} />);

    expect(screen.getByTestId('composer-file-item-category-agents').textContent).toBe('Agents');
  });
});
