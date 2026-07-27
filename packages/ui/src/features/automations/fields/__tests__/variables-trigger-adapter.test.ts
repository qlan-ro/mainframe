/**
 * variables-trigger-adapter — the `$` picker's adapter over an in-scope
 * token list. TDD: test written first, implemented after.
 */
import { describe, expect, it } from 'vitest';
import type { TokenDescriptor } from '@qlan-ro/mainframe-types';
import { literalDirectiveFormatter } from '@/features/chat/composer/triggers/directive-formatter';
import { buildVariablesTriggerAdapter } from '../variables-trigger-adapter';

const SCOPE: TokenDescriptor[] = [
  {
    ref: { stepId: 'trigger', output: 'result' },
    label: 'Result',
    type: 'text',
    sourceKind: 'trigger',
    source: 'Trigger',
  },
  {
    ref: { stepId: 'set-1', output: 'value' },
    label: 'release_notes',
    type: 'text',
    sourceKind: 'variable',
    source: 'Set release_notes',
  },
];

describe('buildVariablesTriggerAdapter', () => {
  it('is search-first: no categories', () => {
    const adapter = buildVariablesTriggerAdapter(SCOPE);
    expect(adapter.categories()).toEqual([]);
  });

  it('empty query lists every in-scope name, shaped {id, label: $name, description: source}', () => {
    const adapter = buildVariablesTriggerAdapter(SCOPE);
    const items = adapter.search!('');
    expect(items).toEqual([
      { id: 'trigger_result', type: 'variable', label: '$trigger_result', description: 'Trigger' },
      { id: 'release_notes', type: 'variable', label: '$release_notes', description: 'Set release_notes' },
    ]);
  });

  it('matches on a name PREFIX only — not on label/description substrings', () => {
    const adapter = buildVariablesTriggerAdapter(SCOPE);
    expect(adapter.search!('trig').map((i) => i.id)).toEqual(['trigger_result']);
    // "Trigger" is the *description* of release_notes-unrelated entries — a
    // substring-fuzzy match (the skills-adapter pattern) would wrongly pull
    // release_notes in via its own source label containing no such text, but
    // this guards the real risk: ordinary text like "costs $5" or "$HOME"
    // must not spuriously match a name that merely contains those letters
    // elsewhere (label/description), only a true name prefix.
    expect(adapter.search!('release').map((i) => i.id)).toEqual(['release_notes']);
  });

  it('an empty-result query (no name starts with it) lists nothing', () => {
    const adapter = buildVariablesTriggerAdapter(SCOPE);
    expect(adapter.search!('zzz')).toEqual([]);
  });

  it('reuses literalDirectiveFormatter("$") to serialize a picked item as literal $name (no trailing space)', () => {
    const formatter = literalDirectiveFormatter('$');
    expect(formatter.serialize({ id: 'release_notes', type: 'variable', label: '$release_notes' })).toBe(
      '$release_notes',
    );
  });
});
