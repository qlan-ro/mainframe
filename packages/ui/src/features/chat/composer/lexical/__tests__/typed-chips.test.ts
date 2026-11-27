/**
 * Typed tokens become chips once finished, and a `/` chip that does not open
 * the message turns back into text — on a headless Lexical editor, one
 * keystroke per update the way typing arrives.
 */
import { describe, expect, it } from 'vitest';
import { $createParagraphNode, $createTextNode, $getRoot, $isTextNode, $isElementNode } from 'lexical';
import { $createDirectiveNode } from '@assistant-ui/react-lexical';
import { createComposerChipFormatter } from '../composer-chip-formatter';
import { insert, lineBreak, read, setup, type } from './headless-editor';

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

  it('leaves a /command on a later line as text: only the message start opens one', () => {
    const editor = setup();
    type(editor, 'hi');
    lineBreak(editor);
    type(editor, '/review now');
    expect(read(editor)).toEqual({ shape: 'hi\n/review now', text: 'hi\n/review now' });
  });

  it('chips a /command after leading whitespace, as the transcript does', () => {
    const editor = setup();
    type(editor, '  /review now');
    expect(read(editor).shape).toBe('  [/review] now');
  });

  it('chips a token that a line break closes', () => {
    const editor = setup();
    type(editor, 'see @src/a.ts');
    lineBreak(editor);
    type(editor, 'next ');
    expect(read(editor)).toEqual({ shape: 'see [@src/a.ts]\nnext ', text: 'see @src/a.ts\nnext ' });
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

  it('chips 150 finished tokens inserted into one node in a single update', () => {
    const editor = setup();
    insert(editor, (selection) => selection.insertText('@f.ts '.repeat(150)));
    const { shape, text } = read(editor);
    expect(shape).toBe('[@f.ts] '.repeat(150));
    expect(text).toBe('@f.ts '.repeat(150));
  });

  it('uses the draft session labels, as restore and paste do', () => {
    const editor = setup(createComposerChipFormatter(['Fix login bug']));
    insert(editor, (selection) => selection.insertText('see @Fix login bug now'));
    expect(read(editor).shape).toBe('see [@Fix login bug] now');
  });

  it('chips both parts of /review@x.ts, as a restore does', () => {
    const editor = setup();
    type(editor, '/review@x.ts ');
    expect(read(editor).shape).toBe('[/review][@x.ts] ');
  });

  it('chips two finished tokens in one node', () => {
    const editor = setup();
    insert(editor, (selection) => selection.insertText('@a.ts and @b.ts done'));
    expect(read(editor).shape).toBe('[@a.ts] and [@b.ts] done');
  });
});

/** Lines built the way react-lexical's SyncPlugin restores a draft: one paragraph per line, each line parsed alone. */
function restore(editor: ReturnType<typeof setup>, lines: (string | { chip: string })[][]) {
  editor.update(
    () => {
      const root = $getRoot().clear();
      for (const line of lines) {
        const paragraph = $createParagraphNode();
        for (const part of line) {
          paragraph.append(
            typeof part === 'string'
              ? $createTextNode(part)
              : $createDirectiveNode(
                  { id: part.chip.slice(1), type: part.chip.startsWith('/') ? 'command' : 'mention', label: part.chip },
                  part.chip,
                ),
          );
        }
        root.append(paragraph);
      }
      root.selectEnd();
    },
    { discrete: true },
  );
}

describe('chips restored line by line', () => {
  it('turns a restored line-2 command back into text', () => {
    const editor = setup();
    restore(editor, [['hi'], [{ chip: '/review' }, ' now']]);
    expect(read(editor)).toEqual({ shape: 'hi\n/review now', text: 'hi\n/review now' });
  });

  it('keeps the command that opens the message', () => {
    const editor = setup();
    restore(editor, [[{ chip: '/review' }, ' now'], ['more']]);
    expect(read(editor).shape).toBe('[/review] now\nmore');
  });

  it('turns a command chip into text once text is typed before it', () => {
    const editor = setup();
    restore(editor, [[{ chip: '/review' }, ' now']]);
    editor.update(() => $getRoot().getFirstDescendant()?.selectPrevious(), { discrete: true });
    type(editor, 'x');
    expect(read(editor)).toEqual({ shape: 'x/review now', text: 'x/review now' });
  });

  it('does not chip an @ typed right after a mention chip: a mention needs whitespace before it', () => {
    const editor = setup();
    restore(editor, [['see ', { chip: '@a.ts' }]]);
    type(editor, '@b.ts now');
    expect(read(editor).shape).toBe('see [@a.ts]@b.ts now');
  });
});

describe('chips follow text typed on an earlier line', () => {
  it('turns a restored /command back into text once text is typed on line 1', () => {
    const editor = setup();
    restore(editor, [[], [{ chip: '/review' }, ' now']]);
    editor.update(() => $getRoot().getFirstChild()?.selectStart(), { discrete: true });
    expect(read(editor).shape).toBe('\n[/review] now');
    type(editor, 'hi');
    expect(read(editor)).toEqual({ shape: 'hi\n/review now', text: 'hi\n/review now' });
  });

  it('chips a /command again when the text before it is removed', () => {
    const editor = setup();
    restore(editor, [['x'], [{ chip: '/review' }, ' now']]);
    expect(read(editor).shape).toBe('x\n/review now');
    editor.update(
      () => {
        const first = $getRoot().getFirstChild();
        if ($isElementNode(first)) first.clear();
      },
      { discrete: true },
    );
    expect(read(editor).shape).toBe('\n[/review] now');
  });
});

describe('restoring and pasting long text stays linear', () => {
  const LINES = 3000;
  const BOUND_MS = 500;

  function timed(run: () => void): number {
    const started = performance.now();
    run();
    return performance.now() - started;
  }

  it('restores 3,000 lines of text tokens quickly', () => {
    const editor = setup();
    const lines = Array.from({ length: LINES }, (_, i) => [`line ${i} see @src/f${i}.ts now`]);
    const ms = timed(() => restore(editor, lines));
    expect(read(editor).shape.split('\n')).toHaveLength(LINES);
    expect(ms).toBeLessThan(BOUND_MS);
  });

  it('restores 3,000 lines that each open with a /command chip quickly', () => {
    const editor = setup();
    const lines = Array.from({ length: LINES }, (_, i) => [{ chip: '/review' }, ` now ${i}`]);
    const ms = timed(() => restore(editor, lines));
    expect(ms).toBeLessThan(BOUND_MS);
  });

  it('pastes 3,000 plain lines quickly', () => {
    const editor = setup();
    const text = Array.from({ length: LINES }, (_, i) => `plain line ${i}`).join('\n');
    const ms = timed(() => insert(editor, (selection) => selection.insertRawText(text)));
    expect(read(editor).shape.split('\n')).toHaveLength(LINES);
    expect(ms).toBeLessThan(BOUND_MS);
  });
});
