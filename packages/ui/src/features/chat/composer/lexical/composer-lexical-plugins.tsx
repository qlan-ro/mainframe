'use client';

/**
 * The Lexical composer's own plugins, rendered as children of
 * `LexicalComposerInput`. Each one ports a behaviour the textarea composer
 * gets from `ComposerPrimitive.Input` or from `Composer.tsx`'s key handler.
 *
 * Priorities matter. react-lexical's KeyboardPlugin runs at HIGH and hands
 * Enter, Esc, ↑, ↓, ⇥ and Backspace to the composer-input plugin registry
 * first, which is where the trigger engine listens. These run at NORMAL, so the
 * `/` and `@` menu always gets the key before they do.
 */
import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $addUpdateTag,
  $getSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_LEFT_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  PASTE_COMMAND,
  PASTE_TAG,
} from 'lexical';
import { mergeRegister } from '@lexical/utils';
import { useAui, type Unstable_DirectiveFormatter } from '@assistant-ui/react';
import type { TriggerFieldAriaProps } from '@/components/trigger-engine/use-trigger-field';
import { focusOwningTranscript } from '../focus-composer';
import type { LexicalComposerBridge } from './lexical-bridge';
import { $pastedNodes, $readMaskedText, $stepOverChip } from './lexical-edits';

const isComposing = (event: KeyboardEvent) => event.isComposing || event.keyCode === 229;

/** react-lexical's tag on runtime → editor syncs (`SyncPlugin`, not exported). */
const AUI_SYNC_TAG = 'aui-sync';

/**
 * ↵ sends (or queues/steers mid-run, ⌥↵ the other), ⇧↵ is a new line, Esc
 * parks focus on the transcript, ⇧⇥ cycles the permission mode.
 *
 * `LexicalComposerInput` runs with `submitMode="none"`: its own Enter calls
 * `composer.send()` directly, which would skip `useSubmitComposition` (quotes,
 * session references, captures). So the send goes through the same `onEnter`
 * the card already uses.
 */
export function ComposerKeysPlugin({ onEnter, onShiftTab }: { onEnter(altKey: boolean): void; onShiftTab(): void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(
    () =>
      mergeRegister(
        editor.registerCommand(
          KEY_ENTER_COMMAND,
          (event) => {
            if (!event || event.shiftKey || isComposing(event)) return false;
            event.preventDefault();
            onEnter(event.altKey);
            return true;
          },
          COMMAND_PRIORITY_NORMAL,
        ),
        editor.registerCommand(
          KEY_ESCAPE_COMMAND,
          (event) => {
            // No preventDefault: the panels dismiss on a document-level Escape
            // gated on `!defaultPrevented` (see Composer.tsx).
            const root = editor.getRootElement();
            if (!event || event.defaultPrevented || !root) return false;
            return focusOwningTranscript(root);
          },
          COMMAND_PRIORITY_NORMAL,
        ),
        // WebKit's native caret stops at a contenteditable=false chip and will
        // not cross it, and Lexical leaves isolated decorators to the native
        // move. So ← and → step over a chip here, in one press.
        editor.registerCommand(KEY_ARROW_LEFT_COMMAND, (event) => $stepOverChip(event, true), COMMAND_PRIORITY_NORMAL),
        editor.registerCommand(
          KEY_ARROW_RIGHT_COMMAND,
          (event) => $stepOverChip(event, false),
          COMMAND_PRIORITY_NORMAL,
        ),
        editor.registerCommand(
          KEY_TAB_COMMAND,
          (event) => {
            if (!event.shiftKey) return false;
            event.preventDefault();
            onShiftTab();
            return true;
          },
          COMMAND_PRIORITY_NORMAL,
        ),
      ),
    [editor, onEnter, onShiftTab],
  );
  return null;
}

/**
 * Pasted files become attachments (the textarea's `addAttachmentOnPaste`).
 * Pasted text holding `/` or `@` tokens comes back as chips: plain-text paste
 * reads only `text/plain`, where a copied chip is its directive text.
 */
export function ComposerPastePlugin({ formatter }: { formatter: Unstable_DirectiveFormatter }) {
  const [editor] = useLexicalComposerContext();
  const aui = useAui();
  useEffect(
    () =>
      editor.registerCommand(
        PASTE_COMMAND,
        (event) => {
          if (!(event instanceof ClipboardEvent) || !event.clipboardData) return false;
          const files = Array.from(event.clipboardData.files);
          if (files.length > 0 && aui.thread.getState().capabilities.attachments) {
            event.preventDefault();
            for (const file of files) aui.composer.addAttachment(file).catch(() => {});
            return true;
          }
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
    [editor, aui, formatter],
  );
  return null;
}

/**
 * Publishes the editor and the masked text to the trigger engine, and puts the
 * composer's hooks on the contenteditable itself: the test id and the
 * `data-mf-composer-input` marker ⌘L and the focus helpers look for, plus the
 * engine's combobox ARIA. `LexicalComposerInput` spreads extra props onto its
 * wrapper div, not the editable element, so they are set here.
 */
export function ComposerBridgePlugin({ bridge, aria }: { bridge: LexicalComposerBridge; aria: TriggerFieldAriaProps }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    bridge.attach(editor);
    const unregister = mergeRegister(
      editor.registerUpdateListener(({ editorState, tags }) => {
        const masked = editorState.read($readMaskedText);
        bridge.setMaskedText(masked);
        // The runtime emptied the field (a send, a quote taking the text):
        // without this, ⌘Z would bring the sent text back.
        if (masked === '' && tags.has(AUI_SYNC_TAG)) editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
      }),
      editor.registerRootListener((root) => {
        if (!root) return;
        root.dataset.testid = 'chat-composer-input';
        root.dataset.mfComposerInput = '';
        root.dataset.noring = '';
      }),
    );
    return () => {
      unregister();
      bridge.attach(null, editor);
    };
  }, [editor, bridge]);

  useEffect(() => {
    const root = editor.getRootElement();
    if (!root) return;
    const entries = Object.entries(aria);
    for (const [name, value] of entries) root.setAttribute(name, String(value));
    return () => {
      for (const [name] of entries) root.removeAttribute(name);
    };
  }, [editor, aria]);
  return null;
}
