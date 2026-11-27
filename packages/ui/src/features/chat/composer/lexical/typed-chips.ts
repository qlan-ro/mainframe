/**
 * Tokens typed by hand become chips once they are finished.
 *
 * A token the menu never inserted (`@src/app.ts`, `/review`, typed out) turns
 * into a chip when whitespace follows it and the caret has left it: the same
 * moment the textarea overlay would have coloured it for good. The grammar is
 * the transcript's (`user-directives.ts`), so a typed token chips exactly when
 * the sent message would show it as a token; a `/command` only opens a line.
 *
 * It runs as a Lexical text-node transform, inside the same update as the
 * keystroke, so the chip and the space are one undo step and the composer text
 * (each chip's text is its token) does not change. Nothing happens while an
 * input method is composing.
 */
import { $getSelection, $isLineBreakNode, $isRangeSelection, type LexicalEditor, TextNode } from 'lexical';
import { $createDirectiveNode } from '@assistant-ui/react-lexical';
import { mainframeUserFormatter, mainframeUserInlineFormatter } from '@/features/chat/messages/user-directives';

const WHITESPACE = /\s/;

/** A command can only open a line: the node is the paragraph's first, or follows a line break. */
function $opensLine(node: TextNode): boolean {
  const previous = node.getPreviousSibling();
  return previous === null || $isLineBreakNode(previous);
}

/** The caret's offset in this node, or null when it is elsewhere. */
function $caretIn(node: TextNode): number | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  return selection.anchor.key === node.getKey() ? selection.anchor.offset : null;
}

/** Chips the first finished token in the node. The remainder is a new dirty node, so the transform reruns on it. */
export function $chipFinishedToken(node: TextNode): void {
  if (!node.isSimpleText() || !node.isAttached()) return;
  const text = node.getTextContent();
  const formatter = $opensLine(node) ? mainframeUserFormatter : mainframeUserInlineFormatter;
  const caret = $caretIn(node);
  let offset = 0;
  for (const segment of formatter.parse(text)) {
    if (segment.kind === 'text') {
      offset += segment.text.length;
      continue;
    }
    const start = offset;
    const end = start + segment.label.length;
    offset = end;
    const closed = end < text.length && WHITESPACE.test(text[end]!);
    const typing = caret !== null && caret >= start && caret <= end;
    if (!closed || typing) continue;
    const parts = node.splitText(start, end);
    const target = start === 0 ? parts[0] : parts[1];
    target?.replace($createDirectiveNode({ id: segment.id, type: segment.type, label: segment.label }, segment.label));
    return;
  }
}

export function registerTypedChips(editor: LexicalEditor): () => void {
  return editor.registerNodeTransform(TextNode, (node) => {
    if (editor.isComposing()) return;
    $chipFinishedToken(node);
  });
}
