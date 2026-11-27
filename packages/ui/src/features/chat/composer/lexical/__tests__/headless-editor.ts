/**
 * A headless Lexical editor with the chip node and the typed-chip transforms,
 * for the chip logic tests. Edits arrive one update at a time, the way typing
 * does.
 */
import {
  $getRoot,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isRangeSelection,
  $createParagraphNode,
  createEditor,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import { $isDirectiveNode, DirectiveNode } from '@assistant-ui/react-lexical';
import { registerTypedChips } from '../typed-chips';
import { $readEditorText } from '../lexical-edits';

export function setup(): LexicalEditor {
  const editor = createEditor({
    nodes: [DirectiveNode],
    onError: (error) => {
      throw error;
    },
  });
  editor.update(() => $getRoot().append($createParagraphNode()).selectEnd(), { discrete: true });
  registerTypedChips(editor);
  return editor;
}

/** One discrete update against the current selection. */
export function insert(editor: LexicalEditor, edit: (selection: RangeSelection) => void): void {
  editor.update(
    () => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) edit(selection);
    },
    { discrete: true },
  );
}

export function type(editor: LexicalEditor, text: string): void {
  for (const char of text) insert(editor, (selection) => selection.insertText(char));
}

/** ⇧↵ in the plain-text field. */
export function lineBreak(editor: LexicalEditor): void {
  insert(editor, (selection) => selection.insertLineBreak());
}

/** The content as `[token]` for chips and plain text otherwise (`\n` between lines), plus the composer text. */
export function read(editor: LexicalEditor): { shape: string; text: string } {
  return editor.getEditorState().read(() => {
    const shape = $getRoot()
      .getChildren()
      .map((paragraph) =>
        $isElementNode(paragraph)
          ? paragraph
              .getChildren()
              .map((node) =>
                $isDirectiveNode(node)
                  ? `[${node.getTextContent()}]`
                  : $isLineBreakNode(node)
                    ? '\n'
                    : node.getTextContent(),
              )
              .join('')
          : '',
      )
      .join('\n');
    return { shape, text: $readEditorText() };
  });
}
