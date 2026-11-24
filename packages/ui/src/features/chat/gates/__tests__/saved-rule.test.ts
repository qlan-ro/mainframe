import { describe, it, expect } from 'vitest';
import type { ControlUpdate } from '@qlan-ro/mainframe-types';
import { savedRule } from '../saved-rule';

const add = (rules: { toolName: string; ruleContent?: string }[]): ControlUpdate => ({
  type: 'addRules',
  rules,
  behavior: 'allow',
  destination: 'localSettings',
});

describe('savedRule', () => {
  it('is the rule content for a command rule', () => {
    expect(savedRule([add([{ toolName: 'Bash', ruleContent: 'cargo test *' }])])).toBe('cargo test *');
  });

  it('trims the rule content', () => {
    expect(savedRule([add([{ toolName: 'Bash', ruleContent: '  git status  ' }])])).toBe('git status');
  });

  it('is the tool name when the rule covers the whole tool', () => {
    expect(savedRule([add([{ toolName: 'WebFetch' }])])).toBe('WebFetch');
  });

  it('falls back to the tool name when the content is blank', () => {
    expect(savedRule([add([{ toolName: 'Edit', ruleContent: '   ' }])])).toBe('Edit');
  });

  it('reads a replaceRules suggestion too', () => {
    expect(
      savedRule([
        {
          type: 'replaceRules',
          rules: [{ toolName: 'Bash', ruleContent: 'ls' }],
          behavior: 'allow',
          destination: 'session',
        },
      ]),
    ).toBe('ls');
  });

  it('skips suggestions that are not rules and takes the first rule found', () => {
    expect(
      savedRule([
        { type: 'setMode', mode: 'acceptEdits', destination: 'session' } as unknown as ControlUpdate,
        add([
          { toolName: 'Bash', ruleContent: 'npm run build' },
          { toolName: 'Bash', ruleContent: 'ignored' },
        ]),
      ]),
    ).toBe('npm run build');
  });

  it('is null with no suggestions', () => {
    expect(savedRule(undefined)).toBeNull();
    expect(savedRule([])).toBeNull();
  });

  it('is null for a rule update with no rules', () => {
    expect(savedRule([add([])])).toBeNull();
  });
});
