import { describe, expect, it } from 'vitest';
import { findSlashInstructions, parseInstructionLine } from '../instructions.js';

describe('findSlashInstructions', () => {
  it('matches a token at the start of the text', () => {
    expect(findSlashInstructions('/domain-modeling')).toEqual([
      { start: 0, end: 16, token: '/domain-modeling', name: 'domain-modeling' },
    ]);
  });

  it('matches a token preceded by whitespace', () => {
    expect(findSlashInstructions('try /domain-modeling now')).toEqual([
      { start: 4, end: 20, token: '/domain-modeling', name: 'domain-modeling' },
    ]);
  });

  it('matches a namespaced token', () => {
    expect(findSlashInstructions('/codex:review')).toEqual([
      { start: 0, end: 13, token: '/codex:review', name: 'codex:review' },
    ]);
  });

  it('captures a sentence-final token without the trailing period', () => {
    expect(findSlashInstructions('run /domain-modeling.')).toEqual([
      { start: 4, end: 20, token: '/domain-modeling', name: 'domain-modeling' },
    ]);
  });

  it('returns offsets that slice back to the token', () => {
    const text = 'first /alpha then /beta:gamma end';
    const matches = findSlashInstructions(text);
    expect(matches.map((m) => text.slice(m.start, m.end))).toEqual(['/alpha', '/beta:gamma']);
  });

  it('matches every token in the text', () => {
    expect(findSlashInstructions('/alpha and /beta').map((m) => m.token)).toEqual(['/alpha', '/beta']);
  });

  it('ignores a token followed by a slash', () => {
    expect(findSlashInstructions('/usr/bin/env')).toEqual([]);
  });

  it('ignores a token followed by a period and a word character', () => {
    expect(findSlashInstructions('/README.md')).toEqual([]);
  });

  it('ignores a slash that is not at a token boundary', () => {
    expect(findSlashInstructions('a/b')).toEqual([]);
  });

  it('ignores a double slash', () => {
    expect(findSlashInstructions('//')).toEqual([]);
  });

  it('ignores a slash with an empty name', () => {
    expect(findSlashInstructions('/ modeling')).toEqual([]);
  });

  it('ignores a token carrying a second colon segment', () => {
    expect(findSlashInstructions('/codex:review:deep')).toEqual([]);
  });

  it('stops the name at the first character outside the allowed charset', () => {
    expect(findSlashInstructions('/domain modeling')).toEqual([{ start: 0, end: 7, token: '/domain', name: 'domain' }]);
    expect(findSlashInstructions('/foo$bar')).toEqual([{ start: 0, end: 4, token: '/foo', name: 'foo' }]);
  });

  it('returns nothing for text with no slash', () => {
    expect(findSlashInstructions('plain prose')).toEqual([]);
  });
});

describe('parseInstructionLine', () => {
  it('captures the whole line including arguments', () => {
    expect(parseInstructionLine('/todo-pipeline run')).toEqual({
      insertText: '/todo-pipeline run',
      name: 'todo-pipeline',
    });
  });

  it('captures a bare instruction', () => {
    expect(parseInstructionLine('/domain-modeling')).toEqual({
      insertText: '/domain-modeling',
      name: 'domain-modeling',
    });
  });

  it('captures a namespaced instruction', () => {
    expect(parseInstructionLine('/codex:review --base main')).toEqual({
      insertText: '/codex:review --base main',
      name: 'codex:review',
    });
  });

  it('trims surrounding whitespace out of insertText', () => {
    expect(parseInstructionLine('  /todo-pipeline run  ')).toEqual({
      insertText: '/todo-pipeline run',
      name: 'todo-pipeline',
    });
  });

  it('rejects multi-line content', () => {
    expect(parseInstructionLine('/domain-modeling\nsecond line')).toBeNull();
  });

  it('rejects content with a prefix before the instruction', () => {
    expect(parseInstructionLine('run /domain-modeling')).toBeNull();
  });

  it('rejects a name carrying a disallowed character', () => {
    expect(parseInstructionLine('/foo$bar')).toBeNull();
    expect(parseInstructionLine('/usr/bin/env')).toBeNull();
    expect(parseInstructionLine('/README.md')).toBeNull();
  });

  it('rejects a token carrying a second colon segment', () => {
    expect(parseInstructionLine('/codex:review:deep')).toBeNull();
  });

  it('rejects content that is not an instruction', () => {
    expect(parseInstructionLine('pnpm install')).toBeNull();
    expect(parseInstructionLine('')).toBeNull();
    expect(parseInstructionLine('/')).toBeNull();
  });
});
