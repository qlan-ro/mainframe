/**
 * Editor edits the chip fields make on their own behalf: insert a picked
 * trigger item as a chip, open the `@` menu from the `+` button, build nodes
 * from text (a paste, a controlled value) and read the text back.
 */
import {
  $createLineBreakNode,
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  type LexicalNode,
  type PointType,
} from 'lexical';
import { $createDirectiveNode, $isDirectiveNode } from '@assistant-ui/react-lexical';
import type { Unstable_DirectiveSegment } from '@assistant-ui/react';
import { detectTrigger } from '@/components/trigger-engine/detect';
import type { TriggerInsertRequest } from '@/components/trigger-engine/use-trigger-field';
import { mentionDraft } from '../triggers/open-mention-trigger';
import { type ComposerChipFormatter, segmentRange } from './composer-chip-formatter';

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
    const current = $readEditorText();
    const addition = mentionDraft(current).slice(current.length);
    $getRoot().selectEnd();
    const selection = $getSelection();
    if ($isRangeSelection(selection)) selection.insertText(addition);
  });
  editor.focus();
}

/** Inside a read or update: the text, one `\n` per paragraph, as react-lexical's SyncPlugin writes it. */
export function $readEditorText(): string {
  return $getRoot()
    .getChildren()
    .map((paragraph) => paragraph.getTextContent())
    .join('\n');
}

/** Inside a read: the text with each chip blanked to spaces (see `lexical-bridge.ts`). */
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

/** Inside a read or update: the composer-text offset of a selection point, or of a node's start. */
function $offsetOf(key: string, type: 'text' | 'element', offsetInPoint: number): number {
  let offset = 0;
  for (const paragraph of $getRoot().getChildren()) {
    if (!$isElementNode(paragraph)) continue;
    const children = paragraph.getChildren();
    if (type === 'element' && paragraph.getKey() === key) {
      return children.slice(0, offsetInPoint).reduce((sum, child) => sum + child.getTextContent().length, offset);
    }
    for (const child of children) {
      if (child.getKey() === key) return offset + (type === 'text' ? offsetInPoint : 0);
      offset += child.getTextContent().length;
    }
    offset += 1;
  }
  return offset;
}

const $pointOffset = (point: PointType) => $offsetOf(point.key, point.type, point.offset);

/** Inside a read or update: where `node` starts in the composer text. */
export const $nodeOffset = (node: LexicalNode) => $offsetOf(node.getKey(), 'text', 0);

/** Segments as nodes; a `\n` inside a text segment becomes a line break. */
function $segmentNodes(segments: readonly Unstable_DirectiveSegment[]): LexicalNode[] {
  const nodes: LexicalNode[] = [];
  for (const segment of segments) {
    if (segment.kind !== 'text') {
      const item = { id: segment.id, type: segment.type, label: segment.label };
      nodes.push($createDirectiveNode(item, segment.label));
      continue;
    }
    segment.text.split('\n').forEach((line, index) => {
      if (index > 0) nodes.push($createLineBreakNode());
      if (line !== '') nodes.push($createTextNode(line));
    });
  }
  return nodes;
}

const normalize = (text: string) => text.replace(/\r\n?/g, '\n');

/**
 * Inside an update: pasted plain text as nodes, or null when it holds no chip.
 * The paste is read in place, between the text before and after the selection,
 * so a token chips exactly when the message would show it as one: `/review`
 * pasted after `please ` stays text, and so does `@x.com` pasted onto `mail`.
 */
export function $pastedNodes(text: string, formatter: ComposerChipFormatter): LexicalNode[] | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return null;
  const [start, end] = selection.isBackward()
    ? [selection.focus, selection.anchor]
    : [selection.anchor, selection.focus];
  const message = $readEditorText();
  const before = message.slice(0, $pointOffset(start));
  const pasted = normalize(text);
  const whole = before + pasted + message.slice($pointOffset(end));
  const segments = segmentRange(whole, formatter.tokens(whole), before.length, before.length + pasted.length);
  return segments.some((segment) => segment.kind === 'mention') ? $segmentNodes(segments) : null;
}

/** Inside an update: replaces the whole content with `text`, one paragraph per line, tokens as chips. */
export function $setEditorText(text: string, formatter: ComposerChipFormatter): void {
  const message = normalize(text);
  const tokens = formatter.tokens(message);
  const root = $getRoot();
  root.clear();
  let lineStart = 0;
  for (const line of message.split('\n')) {
    const paragraph = $createParagraphNode();
    paragraph.append(...$segmentNodes(segmentRange(message, tokens, lineStart, lineStart + line.length)));
    root.append(paragraph);
    lineStart += line.length + 1;
  }
  root.selectEnd();
}
