/**
 * Behavior tests for mainframeUserFormatter.parse().
 *
 * Each test provides a concrete fixed input string and asserts the exact
 * segment array — no logic from the formatter is re-derived here.
 */
import { describe, it, expect } from 'vitest';
import { mainframeUserFormatter } from '../user-directives';

// ---------------------------------------------------------------------------
// Plain text — no directives
// ---------------------------------------------------------------------------

describe('mainframeUserFormatter.parse — plain text', () => {
  it('returns a single text segment when there are no @ or / tokens', () => {
    expect(mainframeUserFormatter.parse('just plain text here')).toEqual([
      { kind: 'text', text: 'just plain text here' },
    ]);
  });

  it('returns a single text segment for an empty string', () => {
    expect(mainframeUserFormatter.parse('')).toEqual([{ kind: 'text', text: '' }]);
  });
});

// ---------------------------------------------------------------------------
// @mention tokens
// ---------------------------------------------------------------------------

describe('mainframeUserFormatter.parse — @mention', () => {
  it('splits "see @Layout.tsx here" into text + mention + text', () => {
    expect(mainframeUserFormatter.parse('see @Layout.tsx here')).toEqual([
      { kind: 'text', text: 'see ' },
      { kind: 'mention', type: 'mention', label: '@Layout.tsx', id: 'Layout.tsx' },
      { kind: 'text', text: ' here' },
    ]);
  });

  it('extracts id as the path without the leading @', () => {
    const segments = mainframeUserFormatter.parse('check @src/components/Button.tsx');
    const mention = segments.find((s) => s.kind === 'mention');
    expect(mention).toEqual({
      kind: 'mention',
      type: 'mention',
      label: '@src/components/Button.tsx',
      id: 'src/components/Button.tsx',
    });
  });

  it('handles an @mention at the start of the string', () => {
    expect(mainframeUserFormatter.parse('@package.json is the config')).toEqual([
      { kind: 'mention', type: 'mention', label: '@package.json', id: 'package.json' },
      { kind: 'text', text: ' is the config' },
    ]);
  });

  it('handles multiple @mentions in one message', () => {
    const segments = mainframeUserFormatter.parse('compare @a.ts and @b.ts');
    const mentions = segments.filter((s) => s.kind === 'mention');
    expect(mentions).toHaveLength(2);
    expect(mentions[0]).toEqual({ kind: 'mention', type: 'mention', label: '@a.ts', id: 'a.ts' });
    expect(mentions[1]).toEqual({ kind: 'mention', type: 'mention', label: '@b.ts', id: 'b.ts' });
  });
});

// ---------------------------------------------------------------------------
// /command tokens
// ---------------------------------------------------------------------------

describe('mainframeUserFormatter.parse — /command', () => {
  it('extracts a leading /command as a command segment with id (no slash)', () => {
    const segments = mainframeUserFormatter.parse('/debug run this');
    const cmd = segments.find((s) => s.kind === 'mention' && (s as { type?: string }).type === 'command');
    expect(cmd).toEqual({ kind: 'mention', type: 'command', label: '/debug', id: 'debug' });
  });

  it('emits trailing text after a /command', () => {
    const segments = mainframeUserFormatter.parse('/fix the issue');
    const text = segments.find((s) => s.kind === 'text');
    expect(text).toEqual({ kind: 'text', text: ' the issue' });
  });

  it('does not treat a mid-sentence /word as a command segment', () => {
    // /word not at start → treated as plain text by the COMMAND_RE (^-anchored)
    const segments = mainframeUserFormatter.parse('use /word here');
    expect(segments).toEqual([{ kind: 'text', text: 'use /word here' }]);
  });

  it('captures a namespaced /plugin:skill command (full token, not just /plugin)', () => {
    const segments = mainframeUserFormatter.parse('/plugin:skill do x');
    const cmd = segments.find((s) => s.kind === 'mention' && (s as { type?: string }).type === 'command');
    expect(cmd).toEqual({ kind: 'mention', type: 'command', label: '/plugin:skill', id: 'plugin:skill' });
    const text = segments.find((s) => s.kind === 'text');
    expect(text).toEqual({ kind: 'text', text: ' do x' });
  });

  it('captures a path/dotted /command token', () => {
    const segments = mainframeUserFormatter.parse('/foo/bar.baz rest');
    const cmd = segments.find((s) => s.kind === 'mention' && (s as { type?: string }).type === 'command');
    expect(cmd).toEqual({ kind: 'mention', type: 'command', label: '/foo/bar.baz', id: 'foo/bar.baz' });
  });
});
