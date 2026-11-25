/**
 * What "Always allow" saves is what the gate lists, to the last rule: the
 * answer and the list are built from the same updates.
 */
import { describe, expect, it } from 'vitest';
import type { ControlUpdate, PermissionOption } from '@qlan-ro/mainframe-types';
import { buildOptionResponse } from '../build-control-response';
import { grantLines, grantedUpdates, readSuggestions } from '../permission-grants';

const CARGO: ControlUpdate = {
  type: 'addRules',
  rules: [{ toolName: 'Bash', ruleContent: 'cargo test *' }],
  behavior: 'allow',
  destination: 'localSettings',
};
const BYPASS = { type: 'setMode', mode: 'bypassPermissions', destination: 'session' } as unknown as ControlUpdate;
const ALWAYS: PermissionOption = { optionId: 'allow-always', name: 'Always allow', kind: 'allow_always' };
const ONCE: PermissionOption = { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' };

const answer = (suggestions: ControlUpdate[], option = ALWAYS) =>
  buildOptionResponse(
    {
      requestId: 'r1',
      askedAt: 1,
      options: [option],
      request: { requestId: 'r1', toolName: 'Bash', toolUseId: 'tu1', input: {}, suggestions },
    },
    option,
  );

describe('the answer', () => {
  it('never carries a mode that approves everything, though the CLI suggested it', () => {
    expect(answer([CARGO, BYPASS]).updatedPermissions).toEqual([CARGO]);
  });

  it.each(['bypassPermissions', 'yolo', 'auto', 'dontAsk', 'someFutureMode'])('drops a switch to %s', (mode) => {
    const update = { type: 'setMode', mode, destination: 'session' } as unknown as ControlUpdate;
    expect(answer([update]).updatedPermissions).toEqual([]);
  });

  it('carries every other update, and lists each of them', () => {
    const updates: ControlUpdate[] = [
      CARGO,
      { type: 'addDirectories', directories: ['/srv/data'], destination: 'session' },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    ];
    expect(answer(updates).updatedPermissions).toEqual(updates);
    expect(grantLines(grantedUpdates(updates))).toHaveLength(3);
  });

  it('"Allow once" saves nothing', () => {
    expect(answer([CARGO], ONCE).updatedPermissions).toBeUndefined();
  });
});

describe('a suggestion this build cannot read', () => {
  const MALFORMED: [string, unknown][] = [
    ['an unknown type', { type: 'addEverything', destination: 'session' }],
    ['no type', { rules: [] }],
    ['a null', null],
    ['a string', 'allow all'],
    ['rules that are not a list', { ...CARGO, rules: 'Bash' }],
    ['a rule without a tool', { ...CARGO, rules: [{ ruleContent: 'ls' }] }],
    ['one bad rule among good ones', { ...CARGO, rules: [{ toolName: 'Bash' }, null] }],
    ['rule text that is not text', { ...CARGO, rules: [{ toolName: 'Bash', ruleContent: 7 }] }],
    ['an unknown behaviour', { ...CARGO, behavior: 'allowForever' }],
    ['an unknown destination', { ...CARGO, destination: 'enterprise' }],
    ['a destination off the prototype', { ...CARGO, destination: 'constructor' }],
    ['no rules at all', { ...CARGO, rules: [] }],
    ['directories that are not text', { type: 'addDirectories', directories: [{}], destination: 'session' }],
    ['a mode that is not text', { type: 'setMode', mode: 1, destination: 'session' }],
  ];

  it.each(MALFORMED)('is neither listed nor sent, and is reported: %s', (_what, value) => {
    const suggestions = [value, CARGO] as ControlUpdate[];

    expect(answer(suggestions).updatedPermissions).toEqual([CARGO]);
    const { updates, omitted } = readSuggestions(suggestions);
    expect(grantLines(updates)).toHaveLength(1);
    expect(omitted).toHaveLength(1);
  });

  it('survives suggestions that are not a list', () => {
    expect(readSuggestions({ type: 'setMode' })).toEqual({
      updates: [],
      omitted: ['a change that could not be read (“setMode”)'],
    });
    expect(readSuggestions(undefined)).toEqual({ updates: [], omitted: [] });
    expect(readSuggestions(null)).toEqual({ updates: [], omitted: [] });
  });

  it('listing an unknown update shows nothing rather than failing', () => {
    expect(grantLines([{ type: 'someday' } as unknown as ControlUpdate])).toEqual([]);
  });

  it('a field it does not know is not sent along', () => {
    const odd = { ...CARGO, everywhere: true, rules: [{ toolName: 'Bash', ruleContent: 'ls', scope: '*' }] };
    expect(answer([odd as ControlUpdate]).updatedPermissions).toEqual([
      { ...CARGO, rules: [{ toolName: 'Bash', ruleContent: 'ls' }] },
    ]);
  });
});

describe('what was left out', () => {
  const omitted = (value: unknown) => readSuggestions([value]).omitted[0];
  const mode = (name: string) => ({ type: 'setMode', mode: name, destination: 'session' });

  it.each([
    ['yolo', 'switching permissions to Unattended'],
    ['bypassPermissions', 'switching permissions to Unattended'],
    ['auto', 'switching permissions to Auto'],
    ['dontAsk', 'switching permissions to “dontAsk”'],
  ])('names the mode %s', (name, line) => {
    expect(omitted(mode(name))).toBe(line);
  });

  it('names a kind of change it does not know, with nothing hidden in the name', () => {
    expect(omitted({ type: 'x\u202Ey' })).toBe('a kind of change this version does not know (“x⟨U+202E⟩y”)');
  });

  it('cuts a very long name short', () => {
    expect(omitted({ type: 'a'.repeat(500) })).toBe(
      `a kind of change this version does not know (“${'a'.repeat(60)}…”)`,
    );
  });
});

describe('the list', () => {
  const text = (updates: ControlUpdate[]) =>
    grantLines(updates).map(({ verb, subject, where }) => `${verb} ${subject} ${where}`);

  it('names each rule in full, with what it does and where it is kept', () => {
    expect(
      text([
        {
          type: 'addRules',
          rules: [{ toolName: 'Bash', ruleContent: 'cargo test *' }, { toolName: 'WebFetch' }],
          behavior: 'allow',
          destination: 'projectSettings',
        },
      ]),
    ).toEqual([
      'Allow Bash(cargo test *) in this project’s shared settings',
      'Allow WebFetch in this project’s shared settings',
    ]);
  });

  it('says when a rule denies or asks instead', () => {
    const rules = [{ toolName: 'Bash', ruleContent: 'rm *' }];
    expect(text([{ type: 'addRules', rules, behavior: 'deny', destination: 'userSettings' }])).toEqual([
      'Deny Bash(rm *) in your settings, for every project',
    ]);
    expect(text([{ type: 'addRules', rules, behavior: 'ask', destination: 'session' }])).toEqual([
      'Ask before Bash(rm *) for this session',
    ]);
  });

  it('spells out a mode change, kept to the session whatever destination it names', () => {
    expect(text([{ type: 'setMode', mode: 'acceptEdits', destination: 'userSettings' }])).toEqual([
      'Switch permissions to Auto-Edits for this session',
    ]);
  });

  it('shows hidden characters in a rule, so it reads as what it is', () => {
    const rules = [{ toolName: 'Bash', ruleContent: 'ls\n\u202E' }];
    expect(text([{ type: 'addRules', rules, behavior: 'allow', destination: 'session' }])).toEqual([
      'Allow Bash(ls⟨U+000A⟩⟨U+202E⟩) for this session',
    ]);
  });

  it('counts each replacing rule, and says when a replacement clears them', () => {
    const rules = [{ toolName: 'Read' }, { toolName: 'Edit' }];
    expect(
      text([
        { type: 'replaceRules', rules, behavior: 'deny', destination: 'session' },
        { type: 'replaceRules', rules: [], behavior: 'deny', destination: 'session' },
      ]),
    ).toEqual([
      'Replace every “deny” rule with Read for this session',
      'and with Edit for this session',
      'Remove every “deny” rule for this session',
    ]);
  });

  it('covers removed and replaced rules and directories', () => {
    const rules = [{ toolName: 'Bash', ruleContent: 'ls *' }];
    expect(
      text([
        { type: 'removeRules', rules, behavior: 'deny', destination: 'localSettings' },
        { type: 'replaceRules', rules, behavior: 'allow', destination: 'localSettings' },
        { type: 'addDirectories', directories: ['/a', '/b'], destination: 'session' },
        { type: 'removeDirectories', directories: ['/c'], destination: 'session' },
      ]),
    ).toEqual([
      'Remove the “deny” rule Bash(ls *) in this project’s local settings',
      'Replace every “allow” rule with Bash(ls *) in this project’s local settings',
      'Work in /a for this session',
      'Work in /b for this session',
      'Stop working in /c for this session',
    ]);
  });
});
