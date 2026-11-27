/**
 * Keeps the chips true to the transcript's grammar as the text changes.
 *
 * A token the menu never inserted (`@src/app.ts`, `/review`, typed out) turns
 * into a chip when whitespace follows it (a space or a line break) and the
 * caret has left it: the same moment the textarea overlay would have coloured
 * it for good. Tokens are read over the whole message (`findMessageTokens`),
 * so a typed token chips exactly when the sent message would show it as one: a
 * `/command` only when it opens the message, an `@` only after whitespace.
 *
 * The other way round, a `/` chip that no longer opens the message becomes
 * text again. react-lexical's SyncPlugin parses a restored draft line by line,
 * so every line's leading `/word` arrives as a chip; so does a `/` menu pick
 * made mid-message. Neither is a command once sent.
 *
 * Both run as Lexical node transforms, inside the same update as the edit, so
 * the change and the edit are one undo step and the composer text (each chip's
 * text is its token) does not change. Typed tokens wait while an input method
 * is composing.
 */
import {
  $createTextNode,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
  TextNode,
} from 'lexical';
import { mergeRegister } from '@lexical/utils';
import { $createDirectiveNode, DirectiveNode } from '@assistant-ui/react-lexical';
import { findMessageTokens } from './composer-chip-formatter';
import { $nodeOffset, $readEditorText } from './lexical-edits';

const WHITESPACE = /\s/;

/** The caret's offset in this node, or null when it is elsewhere. */
function $caretIn(node: TextNode): number | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  return selection.anchor.key === node.getKey() ? selection.anchor.offset : null;
}

/** Chips the first finished token in the node. The remainder is a new dirty node, so the transform reruns on it. */
export function $chipFinishedToken(node: TextNode): void {
  if (!node.isSimpleText() || !node.isAttached()) return;
  const message = $readEditorText();
  const from = $nodeOffset(node);
  const to = from + node.getTextContentSize();
  const caret = $caretIn(node);
  for (const { start, end, segment } of findMessageTokens(message)) {
    if (start < from || end > to) continue;
    const closed = end < message.length && WHITESPACE.test(message[end]!);
    const typing = caret !== null && caret >= start - from && caret <= end - from;
    if (!closed || typing) continue;
    const parts = node.splitText(start - from, end - from);
    const target = start === from ? parts[0] : parts[1];
    target?.replace($createDirectiveNode({ id: segment.id, type: segment.type, label: segment.label }, segment.label));
    return;
  }
}

/** True when only whitespace comes before `node` in the message: where a `/command` may stand. */
function $opensMessage(node: LexicalNode): boolean {
  return $readEditorText().slice(0, $nodeOffset(node)).trim() === '';
}

/** A `/` chip that does not open the message becomes its text. */
export function $demoteStrayCommand(node: DirectiveNode): void {
  if (!node.isAttached()) return;
  const text = node.getTextContent();
  if (!text.startsWith('/') || $opensMessage(node)) return;
  node.replace($createTextNode(text));
}

export function registerTypedChips(editor: LexicalEditor): () => void {
  return mergeRegister(
    editor.registerNodeTransform(TextNode, (node) => {
      if (editor.isComposing()) return;
      $chipFinishedToken(node);
    }),
    editor.registerNodeTransform(DirectiveNode, $demoteStrayCommand),
  );
}
