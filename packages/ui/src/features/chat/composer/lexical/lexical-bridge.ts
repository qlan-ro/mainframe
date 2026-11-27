/**
 * What the composer card shares between the chip field and the trigger engine
 * above it: the field's actions (insert a pick as a chip, open the `@` menu)
 * and the masked text the engine detects tokens in.
 *
 * Masked text is the composer text with every chip blanked to spaces of the
 * same length. Offsets still line up with the caret react-lexical's
 * `CursorPlugin` reports (a chip counts as its text length), but a finished
 * chip can never be read back as an open `@` or `/` token, and an `@` typed
 * right after a chip still counts as word-initial.
 *
 * Nothing here imports Lexical, so the card can hold a bridge while the field
 * itself is still loading (`lazy-fields.ts`).
 */
import { useSyncExternalStore } from 'react';
import type { TriggerInsertRequest } from '@/components/trigger-engine/use-trigger-field';

/** What the mounted field does on the card's behalf. */
export interface ChipFieldActions {
  /** Replaces the token before the caret with the pick. False when there is no token. */
  insertPick(request: TriggerInsertRequest): boolean;
  /** The `+` menu's Mention: an `@` at the end, caret after it, menu open. */
  openMention(): void;
}

export interface LexicalComposerBridge {
  /** Called by the field on mount. The returned function detaches it, if it is still the current one. */
  attach(actions: ChipFieldActions): () => void;
  insertPick(request: TriggerInsertRequest): boolean;
  openMention(): void;
  getMaskedText(): string;
  setMaskedText(text: string): void;
  subscribe(listener: () => void): () => void;
}

export function createLexicalComposerBridge(): LexicalComposerBridge {
  let masked = '';
  let current: ChipFieldActions | null = null;
  const listeners = new Set<() => void>();
  return {
    attach(actions) {
      current = actions;
      return () => {
        if (current === actions) current = null;
      };
    },
    insertPick: (request) => current?.insertPick(request) ?? false,
    openMention: () => current?.openMention(),
    getMaskedText: () => masked,
    setMaskedText(text) {
      if (text === masked) return;
      masked = text;
      for (const listener of listeners) listener();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

const NO_SUBSCRIBE = () => () => {};
const EMPTY = () => null;

/** The masked text, or null when no bridge is in play (the textarea composer). */
export function useMaskedText(bridge: LexicalComposerBridge | null): string | null {
  return useSyncExternalStore(bridge?.subscribe ?? NO_SUBSCRIBE, bridge?.getMaskedText ?? EMPTY);
}
