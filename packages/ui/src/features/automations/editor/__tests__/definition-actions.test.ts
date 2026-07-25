/**
 * definition-actions — the editor's definition-level patch helpers. Renaming a
 * set-value step is the one edit whose effect reaches other steps, so it is
 * derived from the patch itself (old definition vs new) rather than dispatched
 * by hand from the pane. TDD: tests written first, implemented after.
 */
import { describe, expect, it } from 'vitest';
import type { AutomationDefinition, AutomationStep } from '../../contract';
import { applyVariableRenames } from '../definition-actions';

function definition(steps: AutomationStep[]): AutomationDefinition {
  return { triggers: [], steps };
}

function setValue(id: string, name: string): AutomationStep {
  return { id, kind: 'set_variable', name, value: ['Release day'] };
}

function notify(id: string, message: string): AutomationStep {
  return { id, kind: 'notify', message: [message] };
}

function messageOf(result: AutomationDefinition, id: string): string {
  const step = result.steps.find((s) => s.id === id);
  if (step?.kind !== 'notify') throw new Error(`no notify step ${id}`);
  return step.message.join('');
}

describe('applyVariableRenames', () => {
  it('rewrites downstream refs to the renamed value', () => {
    const previous = definition([setValue('v1', 'headline'), notify('n1', 'Ship $headline today')]);
    const next = definition([setValue('v1', 'title'), notify('n1', 'Ship $headline today')]);

    expect(messageOf(applyVariableRenames(previous, next), 'n1')).toBe('Ship $title today');
  });

  it('leaves a longer name that merely starts with the old one alone', () => {
    const previous = definition([setValue('v1', 'headline'), notify('n1', '$headline vs $headliner')]);
    const next = definition([setValue('v1', 'title'), notify('n1', '$headline vs $headliner')]);

    expect(messageOf(applyVariableRenames(previous, next), 'n1')).toBe('$title vs $headliner');
  });

  it('keeps the dotted path when the base name changes', () => {
    const previous = definition([setValue('v1', 'release'), notify('n1', 'See $release.notes')]);
    const next = definition([setValue('v1', 'shipment'), notify('n1', 'See $release.notes')]);

    expect(messageOf(applyVariableRenames(previous, next), 'n1')).toBe('See $shipment.notes');
  });

  it('returns the patch untouched when no name changed', () => {
    const previous = definition([setValue('v1', 'headline'), notify('n1', 'Ship $headline')]);
    const next = definition([setValue('v1', 'headline'), notify('n1', 'Ship $headline now')]);

    expect(applyVariableRenames(previous, next).steps).toEqual(next.steps);
  });

  it('rewrites nothing when a previously unnamed value is named for the first time', () => {
    const previous = definition([setValue('v1', ''), notify('n1', 'Ship $headline')]);
    const next = definition([setValue('v1', 'headline'), notify('n1', 'Ship $headline')]);

    expect(messageOf(applyVariableRenames(previous, next), 'n1')).toBe('Ship $headline');
  });

  it('rewrites nothing when a name is cleared — refs stay put until a real name replaces it', () => {
    const previous = definition([setValue('v1', 'headline'), notify('n1', 'Ship $headline')]);
    const next = definition([setValue('v1', ''), notify('n1', 'Ship $headline')]);

    expect(messageOf(applyVariableRenames(previous, next), 'n1')).toBe('Ship $headline');
  });

  it('rewrites refs held inside a block, from a rename made outside it', () => {
    const inner = notify('n1', 'Ship $headline');
    const block = (steps: AutomationStep[]): AutomationStep => ({
      id: 'r1',
      kind: 'repeat',
      items: { stepId: 'builtin', output: 'today' },
      steps,
    });
    const previous = definition([setValue('v1', 'headline'), block([inner])]);
    const next = definition([setValue('v1', 'title'), block([inner])]);

    const repeat = applyVariableRenames(previous, next).steps[1];
    if (repeat?.kind !== 'repeat') throw new Error('expected the repeat block');
    const nested = repeat.steps[0];
    if (nested?.kind !== 'notify') throw new Error('expected the nested notify');
    expect(nested.message.join('')).toBe('Ship $title');
  });

  it('rewrites from a rename made inside a block — nesting hides no set-value step', () => {
    const branch = (steps: AutomationStep[]): AutomationStep => ({
      id: 'if1',
      kind: 'if',
      match: 'all',
      conditions: [],
      then: steps,
      otherwise: [],
    });
    const previous = definition([branch([setValue('v1', 'headline')]), notify('n1', 'Ship $headline')]);
    const next = definition([branch([setValue('v1', 'title')]), notify('n1', 'Ship $headline')]);

    expect(messageOf(applyVariableRenames(previous, next), 'n1')).toBe('Ship $title');
  });

  it('ignores a renamed ask_me field key — only set-value names rewrite refs (the stale $ref is a save-time error)', () => {
    const askMe = (key: string): AutomationStep => ({
      id: 'q1',
      kind: 'ask_me',
      title: 'Check-in',
      fields: [{ key, label: 'Headline', type: 'text' }],
    });
    const previous = definition([askMe('field_1'), notify('n1', 'Ship $field_1')]);
    const next = definition([askMe('headline'), notify('n1', 'Ship $field_1')]);

    expect(messageOf(applyVariableRenames(previous, next), 'n1')).toBe('Ship $field_1');
  });

  it('ignores a set-value step that only exists in one of the two definitions', () => {
    const previous = definition([notify('n1', 'Ship $headline')]);
    const next = definition([setValue('v1', 'headline'), notify('n1', 'Ship $headline')]);

    expect(messageOf(applyVariableRenames(previous, next), 'n1')).toBe('Ship $headline');
  });
});
