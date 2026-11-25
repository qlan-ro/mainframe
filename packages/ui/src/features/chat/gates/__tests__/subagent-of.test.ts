import { describe, it, expect } from 'vitest';
import type { ThreadMessage } from '@assistant-ui/react';
import { subagentOf } from '../subagent-of';

type Part = Record<string, unknown>;

const message = (content: Part[]) => ({ id: 'm', role: 'assistant', content }) as unknown as ThreadMessage;

const agentCall = (toolCallId: string, args: Record<string, unknown>, inner: Part[]): Part => ({
  type: 'tool-call',
  toolCallId,
  toolName: 'Agent',
  args,
  messages: [message(inner)],
});

const bash = (toolCallId: string): Part => ({ type: 'tool-call', toolCallId, toolName: 'Bash', args: {} });

describe('subagentOf', () => {
  it('names the Agent call whose own transcript holds the request', () => {
    const messages = [
      message([
        agentCall('agent-1', { subagent_type: 'code-reviewer', description: 'Review the diff' }, [bash('tu-9')]),
      ]),
    ];

    expect(subagentOf(messages, 'tu-9')).toEqual({
      toolCallId: 'agent-1',
      name: 'code-reviewer',
      title: 'Review the diff',
    });
  });

  it('finds a request nested two Agent calls deep under the top-level one', () => {
    const inner = agentCall('agent-inner', { description: 'Deeper' }, [bash('tu-deep')]);
    const messages = [message([agentCall('agent-top', { description: 'Outer' }, [inner])])];

    expect(subagentOf(messages, 'tu-deep')?.toolCallId).toBe('agent-top');
  });

  it('is null for the session’s own tool call', () => {
    const messages = [message([bash('tu-own'), agentCall('agent-1', {}, [bash('tu-other')])])];

    expect(subagentOf(messages, 'tu-own')).toBeNull();
  });

  it('is null for an empty tool id', () => {
    expect(subagentOf([message([agentCall('agent-1', {}, [bash('')])])], '')).toBeNull();
  });

  it('falls back to the description for the name, and to "Sub-agent" with neither', () => {
    const onlyTitle = [message([agentCall('a', { description: 'Fix tests' }, [bash('x')])])];
    const neither = [message([agentCall('b', {}, [bash('y')])])];

    expect(subagentOf(onlyTitle, 'x')).toMatchObject({ name: 'Fix tests', title: 'Fix tests' });
    expect(subagentOf(neither, 'y')).toMatchObject({ name: 'Sub-agent', title: 'Sub-agent' });
  });

  it('uses the sub-agent type as the title when there is no description', () => {
    const messages = [message([agentCall('a', { subagent_type: 'explorer' }, [bash('x')])])];

    expect(subagentOf(messages, 'x')).toMatchObject({ name: 'explorer', title: 'explorer' });
  });
});
