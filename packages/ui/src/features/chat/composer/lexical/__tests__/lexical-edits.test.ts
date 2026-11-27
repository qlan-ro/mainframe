/**
 * Text entering a chip field from outside, on a headless editor: a restored
 * value (`$setEditorText`) and a paste (`$pastedNodes`). Both read tokens over
 * the whole message, so a chip appears exactly where the sent message would
 * show a token.
 */
import { describe, expect, it } from 'vitest';
import { $getRoot, $getSelection, $isRangeSelection, $isTextNode } from 'lexical';
import { createComposerChipFormatter } from '../composer-chip-formatter';
import { $pastedNodes, $setEditorText } from '../lexical-edits';
import { read, setup, type } from './headless-editor';

const formatter = createComposerChipFormatter(['Fix login bug']);

function restored(text: string) {
  const editor = setup();
  editor.update(() => $setEditorText(text, formatter), { discrete: true });
  return read(editor);
}

/** Types `before`, puts the caret `back` characters from the end, pastes `text`. Returns the shape, or null for a plain paste. */
function paste(before: string, text: string, back = 0) {
  const editor = setup();
  type(editor, before);
  let pasted = false;
  editor.update(
    () => {
      const node = $getRoot().getLastDescendant();
      if (back > 0 && $isTextNode(node)) {
        const at = node.getTextContentSize() - back;
        node.select(at, at);
      }
      const nodes = $pastedNodes(text, formatter);
      const selection = $getSelection();
      if (nodes && $isRangeSelection(selection)) {
        selection.insertNodes(nodes);
        pasted = true;
      }
    },
    { discrete: true },
  );
  return pasted ? read(editor).shape : null;
}

describe('a restored value', () => {
  it('chips the opening /command and the mentions', () => {
    expect(restored('/review @a.ts\nand @Fix login bug')).toEqual({
      shape: '[/review] [@a.ts]\nand [@Fix login bug]',
      text: '/review @a.ts\nand @Fix login bug',
    });
  });

  it('leaves a /command on a later line as text', () => {
    expect(restored('hi\n/review')).toEqual({ shape: 'hi\n/review', text: 'hi\n/review' });
  });

  it('turns CRLF line ends into lines', () => {
    expect(restored('a\r\n@b.ts').text).toBe('a\n@b.ts');
  });
});

describe('a paste', () => {
  it('chips the tokens of a paste into an empty field', () => {
    expect(paste('', '/review look at @src/app.ts')).toBe('[/review] look at [@src/app.ts]');
  });

  it('is plain text when it holds no token', () => {
    expect(paste('see ', 'plain words')).toBeNull();
  });

  it('does not chip a /command pasted after other text', () => {
    expect(paste('please ', '/review')).toBeNull();
  });

  it('does not chip an @ pasted right after a word', () => {
    expect(paste('mail', '@x.com')).toBeNull();
  });

  it('chips an @ pasted after a space', () => {
    expect(paste('mail ', '@x.com')).toBe('mail [@x.com]');
  });

  it('does not chip a token the text after the caret continues', () => {
    expect(paste('/a.ts', '@src', 5)).toBeNull();
  });

  it('keeps a pasted /command on a later line as text, with the line break', () => {
    expect(paste('see ', '@a.ts\n/review')).toBe('see [@a.ts]\n/review');
  });
});
