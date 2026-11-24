/**
 * What "Always allow" saves is what the gate lists, to the last rule: the
 * answer and the list are built from the same updates.
 */
import { describe, expect, it } from 'vitest';
import type { ControlUpdate, PermissionOption } from '@qlan-ro/mainframe-types';
import { buildOptionResponse } from '../build-control-response';
import { grantLines, grantedUpdates } from '../permission-grants';

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
