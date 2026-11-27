'use client';

/**
 * Plugins both chip fields share: the live composer field and the standalone
 * editor used for quote segments and queued-message edits.
 */
import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $addUpdateTag,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  PASTE_COMMAND,
  PASTE_TAG,
} from 'lexical';
import { mergeRegister } from '@lexical/utils';
import type { Unstable_DirectiveFormatter } from '@assistant-ui/react';
import { $stepOverChip } from './chip-caret';
import { $pastedNodes } from './lexical-edits';
import { registerTypedChips } from './typed-chips';

/** ← and → over a chip in one press (see `chip-caret.ts`). */
export function ChipCaretPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(KEY_ARROW_LEFT_COMMAND, (event) => $stepOverChip(event, true), COMMAND_PRIORITY_NORMAL),
        editor.registerCommand(
          KEY_ARROW_RIGHT_COMMAND,
          (event) => $stepOverChip(event, false),
          COMMAND_PRIORITY_NORMAL,
        ),
      ),
    [editor],
  );
  return null;
}

/**
 * Pasted text holding `/` or `@` tokens comes back as chips: plain-text paste
 * reads only `text/plain`, where a copied chip is its token text.
 */
export function ChipPastePlugin({ formatter }: { formatter: Unstable_DirectiveFormatter }) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
          // A command runs inside an update already: edit directly. A nested
          // editor.update() here would be queued, return false, and let
          // plain-text paste the same text a second time.
          const text = event.clipboardData.getData('text/plain');
          const selection = $getSelection();
          if (text === '' || !$isRangeSelection(selection)) return false;
          const nodes = $pastedNodes(text, formatter);
          if (!nodes) return false;
          event.preventDefault();
          $addUpdateTag(PASTE_TAG);
          selection.insertNodes(nodes);
          return true;
        },
        COMMAND_PRIORITY_HIGH,
      ),
    [editor, formatter],
  );
  return null;
}

/** Typed tokens become chips once finished (see `typed-chips.ts`). */
export function TypedChipsPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => registerTypedChips(editor), [editor]);
  return null;
}
