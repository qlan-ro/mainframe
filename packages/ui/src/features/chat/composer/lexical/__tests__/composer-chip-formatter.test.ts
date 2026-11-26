import { describe, expect, it } from 'vitest';
import { createComposerChipFormatter } from '../composer-chip-formatter';

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
});
