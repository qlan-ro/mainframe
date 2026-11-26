/**
 * Editor edits the Lexical composer makes on its own behalf: insert a picked
 * trigger item as a chip, open the `@` menu from the `+` button, rebuild
 * pasted text with chips, and read the masked text the trigger engine sees.
 */
import {
  $createLineBreakNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isNodeSelection,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
} from 'lexical';
import { $createDirectiveNode, $isDirectiveNode, type DirectiveNode } from '@assistant-ui/react-lexical';
import type { Unstable_DirectiveFormatter } from '@assistant-ui/react';
import { detectTrigger } from '@/components/trigger-engine/detect';
import type { TriggerInsertRequest } from '@/components/trigger-engine/use-trigger-field';
import { mentionDraft } from '../triggers/open-mention-trigger';

/** Inside a read or update: the text node and token the caret closes, if the caret is in one. */
function $tokenBeforeCaret(char: string) {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  const node = selection.anchor.getNode();
  if (!$isTextNode(node)) return null;
  const caret = selection.anchor.offset;
  const token = detectTrigger(node.getTextContent(), char, caret);
  return token ? { node, caret, start: token.offset } : null;
}

/**
 * Replaces the token before the caret with the pick. A closing pick becomes a
 * chip followed by one space; a drill-down pick (`@dir/`) stays plain text so
 * the token is still open and the menu lists the directory. Its own undo step.
 *
 * The answer comes from a read, not from inside the update: a keyboard pick
 * runs inside Lexical's Enter command, where `editor.update` is queued until
 * the command returns.
 */
export function insertTriggerPick(editor: LexicalEditor, request: TriggerInsertRequest): boolean {
  if (!editor.getEditorState().read(() => $tokenBeforeCaret(request.char) !== null)) return false;
  editor.update(() => {
    const found = $tokenBeforeCaret(request.char);
    if (!found) return;
    const parts = found.node.splitText(found.start, found.caret);
    const target = found.start === 0 ? parts[0] : parts[1];
    if (!target) return;
    if (!request.appendSpace) {
      const text = $createTextNode(request.directive);
      target.replace(text);
      text.selectEnd();
      return;
    }
    const { item, directive } = request;
    const chip = $createDirectiveNode({ id: item.id, type: item.type, label: directive }, directive);
    target.replace(chip);
    const next = chip.getNextSibling();
    if ($isTextNode(next) && next.getTextContent().startsWith(' ')) {
      next.select(1, 1);
    } else {
      const space = $createTextNode(' ');
      chip.insertAfter(space);
      space.selectEnd();
    }
  });
  return true;
}

/** The `+` menu's Mention: an `@` the detector can see, at the end, with the caret after it. */
export function openMentionInEditor(editor: LexicalEditor): void {
  editor.update(() => {
    const root = $getRoot();
    const current = readComposerText();
    const addition = mentionDraft(current).slice(current.length);
    root.selectEnd();
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.insertText(addition);
  });
  editor.focus();
}

/** Inside a read or update: the composer text, one `\n` per paragraph, as SyncPlugin writes it. */
function readComposerText(): string {
  return $getRoot()
    .getChildren()
    .map((paragraph) => paragraph.getTextContent())
    .join('\n');
}

/** Inside a read: the composer text with each chip blanked to spaces (see `lexical-bridge.ts`). */
export function $readMaskedText(): string {
  const lines: string[] = [];
  for (const paragraph of $getRoot().getChildren()) {
    if (!$isElementNode(paragraph)) continue;
    let line = '';
    for (const child of paragraph.getChildren()) {
      const text = child.getTextContent();
      line += $isDirectiveNode(child) ? ' '.repeat(text.length) : text;
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/** Pasted plain text as nodes, with every token the formatter recognises as a chip. Null when it holds none. */
export function $pastedNodes(text: string, formatter: Unstable_DirectiveFormatter): LexicalNode[] | null {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const parsed = lines.map((line) => formatter.parse(line));
  if (!parsed.some((segments) => segments.some((s) => s.kind === 'mention'))) return null;
  const nodes: LexicalNode[] = [];
  parsed.forEach((segments, index) => {
    if (index > 0) nodes.push($createLineBreakNode());
    for (const segment of segments) {
      if (segment.kind === 'text') {
        if (segment.text !== '') nodes.push($createTextNode(segment.text));
      } else {
        const item = { id: segment.id, type: segment.type, label: segment.label };
        nodes.push($createDirectiveNode(item, formatter.serialize(item)));
      }
    }
  });
  return nodes;
}

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

/**
 * Inside a key command: ← or → past a chip in one press (⇧ extends the
 * selection over it). Word and line moves keep the native behaviour.
 */
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
