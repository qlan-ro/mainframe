/**
 * ← and → over a chip in one press.
 *
 * WebKit's native caret stops at a `contenteditable="false"` span and will not
 * cross it, and Lexical leaves isolated decorators to the native move. So the
 * chip fields step over a chip themselves. Word and line moves keep the native
 * behaviour.
 */
import {
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  type PointType,
} from 'lexical';
import { $isDirectiveNode, type DirectiveNode } from '@assistant-ui/react-lexical';

/** The chip directly beside a point in one direction, if any. */
function $chipBeside(point: PointType, backward: boolean): DirectiveNode | null {
  const node = point.getNode();
  if ($isTextNode(node)) {
    const atEdge = backward ? point.offset === 0 : point.offset === node.getTextContentSize();
    const sibling = atEdge ? (backward ? node.getPreviousSibling() : node.getNextSibling()) : null;
    return $isDirectiveNode(sibling) ? sibling : null;
  }
  if ($isElementNode(node)) {
    const child = node.getChildAtIndex(backward ? point.offset - 1 : point.offset);
    return $isDirectiveNode(child) ? child : null;
  }
  return null;
}

/** Inside a key command: steps over the chip beside the caret (⇧ extends the selection over it). */
export function $stepOverChip(event: KeyboardEvent, backward: boolean): boolean {
  if (event.altKey || event.metaKey || event.ctrlKey) return false;
  const selection = $getSelection();
  if ($isNodeSelection(selection)) {
    const [node] = selection.getNodes();
    if (!$isDirectiveNode(node)) return false;
    event.preventDefault();
    if (backward) node.selectPrevious();
    else node.selectNext(0, 0);
    return true;
  }
  if (!$isRangeSelection(selection)) return false;
  if (!event.shiftKey && !selection.isCollapsed()) return false;
  const chip = $chipBeside(selection.focus, backward);
  if (!chip) return false;
  event.preventDefault();
  const parentKey = chip.getParentOrThrow().getKey();
  const index = chip.getIndexWithinParent() + (backward ? 0 : 1);
  selection.focus.set(parentKey, index, 'element');
  if (!event.shiftKey) selection.anchor.set(parentKey, index, 'element');
  return true;
}
