/**
 * Typed tokens become chips once finished — on a headless Lexical editor, one
 * keystroke per update the way typing arrives.
 */
import { describe, expect, it } from 'vitest';
import {
  $createLineBreakNode,
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  $isTextNode,
  createEditor,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import { $isDirectiveNode, DirectiveNode } from '@assistant-ui/react-lexical';
import { registerTypedChips } from '../typed-chips';
import { $readEditorText } from '../lexical-edits';

function setup(): LexicalEditor {
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

function type(editor: LexicalEditor, text: string) {
  for (const char of text) insert(editor, (selection) => selection.insertText(char));
}

/** The content as `[token]` for chips and plain text otherwise, plus the composer text. */
function read(editor: LexicalEditor) {
  return editor.getEditorState().read(() => {
    const children = $getRoot()
      .getChildren()
      .flatMap((paragraph) => ($isElementNode(paragraph) ? paragraph.getChildren() : []));
    const shape = children
      .map((node) => ($isDirectiveNode(node) ? `[${node.getTextContent()}]` : node.getTextContent()))
      .join('');
    return { shape, text: $readEditorText() };
  });
}

function insert(editor: LexicalEditor, edit: (selection: RangeSelection) => void) {
  editor.update(
    () => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) edit(selection);
    },
    { discrete: true },
  );
}

describe('typed tokens become chips', () => {
  it('chips an @path once a space follows it, with the text unchanged', () => {
    const editor = setup();
    type(editor, 'see @src/app.ts');
    expect(read(editor).shape).toBe('see @src/app.ts');

    type(editor, ' ');

    expect(read(editor)).toEqual({ shape: 'see [@src/app.ts] ', text: 'see @src/app.ts ' });
  });

  it('chips a quoted path with spaces as one token', () => {
    const editor = setup();
    type(editor, '@"docs/my notes.md" next');
    expect(read(editor).shape).toBe('[@"docs/my notes.md"] next');
  });

  it('chips a /command that opens the message, not one later in the line', () => {
    const editor = setup();
    type(editor, '/review now and /later ');
    expect(read(editor).shape).toBe('[/review] now and /later ');
  });

  it('chips a /command that opens a new line', () => {
    const editor = setup();
    type(editor, 'first');
    insert(editor, (selection) => selection.insertNodes([$createLineBreakNode()]));
    type(editor, '/review ');
    expect(read(editor)).toEqual({ shape: 'first\n[/review] ', text: 'first\n/review ' });
  });

  it('leaves a token alone while the caret is still in it', () => {
    const editor = setup();
    type(editor, 'a  b');
    insert(editor, (selection) => {
      const node = selection.anchor.getNode();
      if ($isTextNode(node)) selection.setTextNodeRange(node, 2, node, 2);
    });
    type(editor, '@sr');
    expect(read(editor).shape).toBe('a @sr b');
  });

  it('does not chip an email address or a bare @', () => {
    const editor = setup();
    type(editor, 'mail me@host.com and @ alone ');
    expect(read(editor).shape).toBe('mail me@host.com and @ alone ');
  });

  it('chips two finished tokens in one node', () => {
    const editor = setup();
    insert(editor, (selection) => selection.insertText('@a.ts and @b.ts done'));
    expect(read(editor).shape).toBe('[@a.ts] and [@b.ts] done');
  });
});
