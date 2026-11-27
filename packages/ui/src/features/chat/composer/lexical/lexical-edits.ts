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
} from 'lexical';
import { $createDirectiveNode, $isDirectiveNode } from '@assistant-ui/react-lexical';
import type { Unstable_DirectiveFormatter, Unstable_DirectiveSegment } from '@assistant-ui/react';
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

function $segmentNodes(segments: readonly Unstable_DirectiveSegment[], formatter: Unstable_DirectiveFormatter) {
  const nodes: LexicalNode[] = [];
  for (const segment of segments) {
    if (segment.kind === 'text') {
      if (segment.text !== '') nodes.push($createTextNode(segment.text));
    } else {
      const item = { id: segment.id, type: segment.type, label: segment.label };
      nodes.push($createDirectiveNode(item, formatter.serialize(item)));
    }
  }
  return nodes;
}

const lines = (text: string) => text.replace(/\r\n?/g, '\n').split('\n');

/** Pasted plain text as nodes, with every token the formatter recognises as a chip. Null when it holds none. */
export function $pastedNodes(text: string, formatter: Unstable_DirectiveFormatter): LexicalNode[] | null {
  const parsed = lines(text).map((line) => formatter.parse(line));
  if (!parsed.some((segments) => segments.some((s) => s.kind === 'mention'))) return null;
  const nodes: LexicalNode[] = [];
  parsed.forEach((segments, index) => {
    if (index > 0) nodes.push($createLineBreakNode());
    nodes.push(...$segmentNodes(segments, formatter));
  });
  return nodes;
}

/** Inside an update: replaces the whole content with `text`, one paragraph per line, tokens as chips. */
export function $setEditorText(text: string, formatter: Unstable_DirectiveFormatter): void {
  const root = $getRoot();
  root.clear();
  for (const line of lines(text)) {
    const paragraph = $createParagraphNode();
    paragraph.append(...$segmentNodes(formatter.parse(line), formatter));
    root.append(paragraph);
  }
  root.selectEnd();
}
