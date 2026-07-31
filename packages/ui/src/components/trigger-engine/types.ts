/**
 * Structural types for the trigger engine.
 *
 * These were previously imported from `@assistant-ui/react` (`Unstable_*`).
 * The engine owns them now, so nothing in the trigger path depends on an
 * unstable library surface.
 */

import type { ReactNode } from 'react';

export interface TriggerItem {
  id: string;
  /** Domain kind — `skill` / `file` / `directory` / `agent` / `session`. Drives icons and close-on-insert. */
  type: string;
  label: string;
  description?: string;
}

export interface TriggerCategory {
  id: string;
  label: string;
}

/** Synchronous view over a data source. Async sources bridge through a cache. */
export interface TriggerAdapter {
  categories(): readonly TriggerCategory[];
  categoryItems(categoryId: string): readonly TriggerItem[];
  search?(query: string): readonly TriggerItem[];
}

/** Renders a picked item as the literal text inserted into the composer. */
export interface DirectiveFormatter {
  serialize(item: TriggerItem): string;
}

/** A trigger char detected before the cursor. */
export interface DetectedTrigger {
  /** Text between the trigger char and the cursor. */
  query: string;
  /** Index of the trigger char in the full text. */
  offset: number;
}

/** One trigger char wired to a data source, as declared by a consuming field. */
export interface TriggerConfig {
  char: string;
  adapter: TriggerAdapter;
  formatter: DirectiveFormatter;
  /** Test-id prefix for the popover rows: `<prefix>-<item.id>`. */
  itemTestIdPrefix: string;
  /** Overrides the `<itemTestIdPrefix>-<id>` row test id for items it returns a string for. */
  itemTestId?(item: TriggerItem): string | undefined;
  /** Optional leading glyph for a row. Items it returns null for render no glyph node at all. */
  itemGlyph?(item: TriggerItem): ReactNode;
  /** Defaults to true. `false` keeps the token open (directory drill-down). */
  closeOnInsert?(item: TriggerItem): boolean;
  onInserted?(item: TriggerItem): void;
}
