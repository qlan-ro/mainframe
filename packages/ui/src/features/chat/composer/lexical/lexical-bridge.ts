/**
 * What the composer card shares between the Lexical field and the trigger
 * engine above it: the editor (for inserting picks) and the masked text the
 * engine detects tokens in.
 *
 * Masked text is the composer text with every chip blanked to spaces of the
 * same length. Offsets still line up with the caret react-lexical's
 * `CursorPlugin` reports (a chip counts as its text length), but a finished
 * chip can never be read back as an open `@` or `/` token, and an `@` typed
 * right after a chip still counts as word-initial.
 */
import { useSyncExternalStore } from 'react';
import type { LexicalEditor } from 'lexical';

export interface LexicalComposerBridge {
  readonly editor: LexicalEditor | null;
  /** Called by the field: the editor on mount, null on unmount (only if it is still the current one). */
  attach(editor: LexicalEditor | null, previous?: LexicalEditor): void;
  getMaskedText(): string;
  setMaskedText(text: string): void;
  subscribe(listener: () => void): () => void;
}

export function createLexicalComposerBridge(): LexicalComposerBridge {
  let masked = '';
  let current: LexicalEditor | null = null;
  const listeners = new Set<() => void>();
  return {
    get editor() {
      return current;
    },
    attach(editor, previous) {
      if (editor === null && previous !== undefined && current !== previous) return;
      current = editor;
    },
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
