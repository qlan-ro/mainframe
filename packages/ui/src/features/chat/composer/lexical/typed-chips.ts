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
 * Both run as one Lexical root transform, inside the same update as the edit,
 * so the change and the edit are one undo step and the composer text (each
 * chip's text is its token) does not change. The message is read and its
 * tokens found once per update, then every text node and chip is checked
 * against them in a single walk: a restore or paste that changes a node per
 * line stays linear, and a `/` chip is re-checked whenever text before it
 * changes. Tokens come from the draft's session labels, as on restore and
 * paste. Typed tokens wait while an input method is composing.
 */
import {
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  type LexicalEditor,
  RootNode,
  type TextNode,
} from 'lexical';
import { $createDirectiveNode, $isDirectiveNode, type DirectiveNode } from '@assistant-ui/react-lexical';
import { type ComposerChipFormatter, createComposerChipFormatter, type MessageToken } from './composer-chip-formatter';
import { $readEditorText } from './lexical-edits';

const WHITESPACE = /\s/;

/** Where the caret is, when it is collapsed in a text node. */
function $caret(): { key: string; offset: number } | null {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return null;
  return selection.anchor.type === 'text' ? { key: selection.anchor.key, offset: selection.anchor.offset } : null;
}

/**
 * The tokens a typed message has finished: whitespace follows, or another
 * finished token starts right where it ends (`/review@x.ts `, which a restore
 * chips as two).
 */
function finishedTokens(message: string, tokens: readonly MessageToken[]): MessageToken[] {
  const finished: MessageToken[] = [];
  let nextStart = -1;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]!;
    const spaced = token.end < message.length && WHITESPACE.test(message[token.end]!);
    if (spaced || token.end === nextStart) {
      finished.push(token);
      nextStart = token.start;
    } else {
      nextStart = -1;
    }
  }
  return finished.reverse();
}

/**
 * Chips every finished token in the text node, which starts at `from` in the
 * message, in one pass. `first` is the first token that may lie in it.
 */
function $chipNode(
  node: TextNode,
  from: number,
  tokens: readonly MessageToken[],
  first: number,
  caret: { key: string; offset: number } | null,
): void {
  const to = from + node.getTextContentSize();
  const here = caret?.key === node.getKey() ? caret.offset : null;
  const chosen: MessageToken[] = [];
  for (let i = first; i < tokens.length && tokens[i]!.start < to; i++) {
    const token = tokens[i]!;
    if (token.start < from || token.end > to) continue;
    const typing = here !== null && here >= token.start - from && here <= token.end - from;
    if (!typing) chosen.push(token);
  }
  if (chosen.length === 0) return;
  const parts = node.splitText(...chosen.flatMap((token) => [token.start - from, token.end - from]));
  let at = from;
  let next = 0;
  for (const part of parts) {
    const token = chosen[next];
    if (token && token.start === at) {
      const { id, type, label } = token.segment;
      part.replace($createDirectiveNode({ id, type, label }, label));
      next++;
    }
    at += part.getTextContentSize();
  }
}

/** A `/` chip that does not open the message becomes its text. */
function $demote(chip: DirectiveNode): void {
  chip.replace($createTextNode(chip.getTextContent()));
}

/** The one pass: chip the finished typed tokens, demote the `/` chips that no longer open the message. */
function $reconcile(composing: boolean, formatter: ComposerChipFormatter): void {
  const message = $readEditorText();
  const tokens = composing ? [] : finishedTokens(message, formatter.tokens(message));
  const opening = message.search(/\S/);
  const openingEnd = opening === -1 ? message.length : opening;
  const caret = $caret();
  let offset = 0;
  let first = 0;
  for (const paragraph of $getRoot().getChildren()) {
    const children = $isElementNode(paragraph) ? paragraph.getChildren() : [];
    for (const child of children) {
      while (first < tokens.length && tokens[first]!.end <= offset) first++;
      const size = child.getTextContentSize();
      if ($isDirectiveNode(child)) {
        if (offset > openingEnd && child.getTextContent().startsWith('/')) $demote(child);
      } else if ($isTextNode(child) && child.isSimpleText() && first < tokens.length) {
        $chipNode(child, offset, tokens, first, caret);
      }
      offset += size;
    }
    offset += 1;
  }
}

export function registerTypedChips(
  editor: LexicalEditor,
  formatter: ComposerChipFormatter = createComposerChipFormatter([]),
): () => void {
  return editor.registerNodeTransform(RootNode, () => {
    $reconcile(editor.isComposing(), formatter);
  });
}
