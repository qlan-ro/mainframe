/**
 * The send path turns a draft into a command invocation here, so the boundary
 * between "invokes a command" and "is a message that mentions one" is the whole
 * behaviour under test.
 */
import { describe, expect, it } from 'vitest';
import type { CustomCommand } from '@qlan-ro/mainframe-types';
import { matchCommandInvocation, publishCommands } from '../command-registry';

const commands: CustomCommand[] = [
  { name: 'launch-config', description: 'Generate .mainframe/launch.json for this project', source: 'mainframe' },
  { name: 'compact', description: 'Compact the conversation', source: 'claude' },
];

describe('matchCommandInvocation', () => {
  it('matches a bare invocation and carries the source through', () => {
    expect(matchCommandInvocation('/launch-config', commands)).toEqual({
      name: 'launch-config',
      source: 'mainframe',
    });
  });

  it('keeps a non-mainframe source, so an adapter command routes to sendCommand', () => {
    expect(matchCommandInvocation('/compact', commands)).toEqual({ name: 'compact', source: 'claude' });
  });

  it('matches through the trailing space the picker inserts', () => {
    expect(matchCommandInvocation('/launch-config ', commands)).toEqual({
      name: 'launch-config',
      source: 'mainframe',
    });
  });

  it('does not match a draft with trailing prose — the words would be discarded', () => {
    expect(matchCommandInvocation('/launch-config for the api package', commands)).toBeNull();
  });

  it('does not match a command named mid-sentence', () => {
    expect(matchCommandInvocation('run /launch-config for me', commands)).toBeNull();
  });

  it('does not match an unknown command', () => {
    expect(matchCommandInvocation('/nope', commands)).toBeNull();
  });

  it('does not match a bare slash or ordinary text', () => {
    expect(matchCommandInvocation('/', commands)).toBeNull();
    expect(matchCommandInvocation('hello', commands)).toBeNull();
  });

  it('reads the published list when no list is passed — the controller has no context', () => {
    publishCommands([]);
    expect(matchCommandInvocation('/launch-config')).toBeNull();
    publishCommands(commands);
    expect(matchCommandInvocation('/launch-config')).toEqual({ name: 'launch-config', source: 'mainframe' });
    publishCommands([]);
  });
});
