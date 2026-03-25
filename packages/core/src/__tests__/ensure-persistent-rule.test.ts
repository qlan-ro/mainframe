import { describe, it, expect } from 'vitest';
import type { ControlUpdate } from '@qlan-ro/mainframe-types';
import { promoteToLocalSettings } from '../plugins/builtin/claude/session.js';

describe('promoteToLocalSettings', () => {
  it('promotes session-scoped setMode to localSettings', () => {
    const updates: ControlUpdate[] = [{ type: 'setMode', mode: 'acceptEdits', destination: 'session' }];

    const result = promoteToLocalSettings(updates);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: 'setMode',
      mode: 'acceptEdits',
      destination: 'localSettings',
    });
  });

  it('promotes session-scoped addDirectories to localSettings', () => {
    const updates: ControlUpdate[] = [
      { type: 'addDirectories', directories: ['/some/path'], destination: 'session' },
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
    ];

    const result = promoteToLocalSettings(updates);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'addDirectories',
      directories: ['/some/path'],
      destination: 'localSettings',
    });
    expect(result[1]).toEqual({
      type: 'setMode',
      mode: 'acceptEdits',
      destination: 'localSettings',
    });
  });

  it('leaves non-session destinations unchanged', () => {
    const updates: ControlUpdate[] = [
      { type: 'setMode', mode: 'acceptEdits', destination: 'localSettings' },
      {
        type: 'addRules',
        rules: [{ toolName: 'Edit' }],
        behavior: 'allow',
        destination: 'userSettings',
      },
    ];

    const result = promoteToLocalSettings(updates);

    expect(result).toEqual(updates);
  });

  it('returns empty array unchanged', () => {
    expect(promoteToLocalSettings([])).toEqual([]);
  });

  it('handles mixed session and non-session destinations', () => {
    const updates: ControlUpdate[] = [
      { type: 'setMode', mode: 'acceptEdits', destination: 'session' },
      {
        type: 'addRules',
        rules: [{ toolName: 'Bash' }],
        behavior: 'allow',
        destination: 'localSettings',
      },
    ];

    const result = promoteToLocalSettings(updates);

    expect(result[0]).toEqual({
      type: 'setMode',
      mode: 'acceptEdits',
      destination: 'localSettings',
    });
    expect(result[1]).toEqual(updates[1]); // already localSettings, unchanged
  });
});
