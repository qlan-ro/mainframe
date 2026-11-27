import { describe, expect, it } from 'vitest';
import { createComposerChipFormatter, findMessageTokens } from '../composer-chip-formatter';

describe('createComposerChipFormatter', () => {
  it('parses the composer tokens into chips whose label is the wire text', () => {
    const formatter = createComposerChipFormatter([]);
    expect(formatter.parse('/review look at @src/app.ts and @"my dir/a b.ts"')).toEqual([
      { kind: 'mention', type: 'command', label: '/review', id: 'review' },
      { kind: 'text', text: ' look at ' },
      { kind: 'mention', type: 'mention', label: '@src/app.ts', id: 'src/app.ts' },
      { kind: 'text', text: ' and ' },
      { kind: 'mention', type: 'mention', label: '@"my dir/a b.ts"', id: 'my dir/a b.ts' },
    ]);
  });

  it('keeps a recorded session label with spaces as one chip', () => {
    const formatter = createComposerChipFormatter(['Fix login bug']);
    expect(formatter.parse('see @Fix login bug now')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'mention', type: 'session', label: '@Fix login bug', id: 'Fix login bug' },
      { kind: 'text', text: ' now' },
    ]);
  });

  it('serializes a chip back to exactly its label', () => {
    const formatter = createComposerChipFormatter([]);
    expect(formatter.serialize({ id: 'src/app.ts', type: 'file', label: '@src/app.ts' })).toBe('@src/app.ts');
  });

  it('returns text untouched when it holds no token', () => {
    expect(createComposerChipFormatter([]).parse('plain words')).toEqual([{ kind: 'text', text: 'plain words' }]);
  });

  it('never opens a command after a session label, mid-line', () => {
    expect(createComposerChipFormatter(['Fix login bug']).parse('@Fix login bug /review')).toEqual([
      { kind: 'mention', type: 'session', label: '@Fix login bug', id: 'Fix login bug' },
      { kind: 'text', text: ' /review' },
    ]);
  });

  it('reads its input as a whole message: a /command on a later line is text', () => {
    expect(createComposerChipFormatter([]).parse('hi\n/review')).toEqual([{ kind: 'text', text: 'hi\n/review' }]);
  });

  it('allows whitespace before the opening /command, as the transcript does', () => {
    expect(createComposerChipFormatter([]).parse('  /review')).toEqual([
      { kind: 'text', text: '  ' },
      { kind: 'mention', type: 'command', label: '/review', id: 'review' },
    ]);
  });
});

describe('findMessageTokens', () => {
  it('gives each token its offsets in the message', () => {
    expect(findMessageTokens('/review @a.ts\nsee @b.ts').map(({ start, end }) => [start, end])).toEqual([
      [0, 7],
      [8, 13],
      [18, 23],
    ]);
  });

  it('needs whitespace or the start of the text before an @', () => {
    expect(findMessageTokens('mail@x.com and @y.ts').map((token) => token.segment.label)).toEqual(['@y.ts']);
  });

  it('finds a session label first, so its spaces stay inside one token', () => {
    expect(findMessageTokens('see @Fix login bug', ['Fix login bug'])).toEqual([
      {
        start: 4,
        end: 18,
        segment: { kind: 'mention', type: 'session', label: '@Fix login bug', id: 'Fix login bug' },
      },
    ]);
  });
});
