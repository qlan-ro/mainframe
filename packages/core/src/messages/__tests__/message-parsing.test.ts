import { describe, it, expect } from 'vitest';
import { stripMainframeCommandTags } from '../message-parsing.js';

describe('stripMainframeCommandTags', () => {
  it('strips response wrapper tags', () => {
    const input = '<mainframe-command-response id="cmd_abc">Hello world</mainframe-command-response>';
    expect(stripMainframeCommandTags(input)).toBe('Hello world');
  });

  it('returns text unchanged when no tags present', () => {
    expect(stripMainframeCommandTags('Normal text')).toBe('Normal text');
  });

  it('strips command wrapper from user messages', () => {
    const input = '<mainframe-command name="init" id="cmd_abc">Do init work</mainframe-command>';
    expect(stripMainframeCommandTags(input)).toBe('');
  });
});
