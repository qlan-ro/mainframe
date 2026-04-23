import { describe, it, expect, vi } from 'vitest';
import { mapSdkMessage } from '../../../plugins/builtin/claude-sdk/event-mapper.js';
import { createMockSink } from './test-utils.js';

describe('mapSdkMessage', () => {
  it('maps system init to onInit', () => {
    const sink = createMockSink();
    mapSdkMessage(
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-1',
        model: 'claude-opus-4-6',
        tools: ['Bash', 'Read'],
        mcp_servers: [],
        permissionMode: 'default',
        cwd: '/tmp',
        claude_code_version: '2.1.83',
        apiKeySource: 'oauth',
        slash_commands: [],
        output_style: 'concise',
        skills: [],
        plugins: [],
        uuid: 'uuid-1',
      } as any,
      sink,
    );

    expect(sink.onInit).toHaveBeenCalledWith('sess-1');
  });

  it('maps assistant message to onMessage with content and usage', () => {
    const sink = createMockSink();
    mapSdkMessage(
      {
        type: 'assistant',
        uuid: 'uuid-2',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Hello world' },
            { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } },
          ],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 5,
          },
          model: 'claude-opus-4-6',
        },
      } as any,
      sink,
    );

    expect(sink.onMessage).toHaveBeenCalledTimes(1);
    const [content, metadata] = (sink.onMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toEqual([
      { type: 'text', text: 'Hello world' },
      { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } },
    ]);
    expect(metadata?.usage?.input_tokens).toBe(100);
  });

  it('maps compact_boundary to onCompact', () => {
    const sink = createMockSink();
    mapSdkMessage(
      {
        type: 'system',
        subtype: 'compact_boundary',
        uuid: 'uuid-3',
        session_id: 'sess-1',
      } as any,
      sink,
    );

    expect(sink.onCompact).toHaveBeenCalledTimes(1);
  });

  it('maps result success to onResult', () => {
    const sink = createMockSink();
    mapSdkMessage(
      {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.05,
        usage: { input_tokens: 200, output_tokens: 100 },
        result: 'Done',
        is_error: false,
        uuid: 'uuid-4',
        session_id: 'sess-1',
        duration_ms: 1000,
        duration_api_ms: 800,
        num_turns: 1,
        stop_reason: 'end_turn',
        modelUsage: {},
        permission_denials: [],
      } as any,
      sink,
    );

    expect(sink.onResult).toHaveBeenCalledTimes(1);
    const data = (sink.onResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(data.total_cost_usd).toBe(0.05);
    expect(data.subtype).toBe('success');
  });

  it('maps result error to onResult with is_error', () => {
    const sink = createMockSink();
    mapSdkMessage(
      {
        type: 'result',
        subtype: 'error_during_execution',
        total_cost_usd: 0.02,
        usage: { input_tokens: 50, output_tokens: 20 },
        is_error: true,
        uuid: 'uuid-5',
        session_id: 'sess-1',
        duration_ms: 500,
        duration_api_ms: 400,
        num_turns: 1,
        stop_reason: null,
        modelUsage: {},
        permission_denials: [],
        errors: ['Something failed'],
      } as any,
      sink,
    );

    const data = (sink.onResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(data.is_error).toBe(true);
    expect(data.subtype).toBe('error_during_execution');
  });

  it('extracts thinking blocks from assistant message', () => {
    const sink = createMockSink();
    mapSdkMessage(
      {
        type: 'assistant',
        uuid: 'uuid-6',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: 'Let me think...' },
            { type: 'text', text: 'Here is the answer' },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
          model: 'claude-opus-4-6',
        },
      } as any,
      sink,
    );

    const [content] = (sink.onMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(content).toEqual([
      { type: 'thinking', thinking: 'Let me think...' },
      { type: 'text', text: 'Here is the answer' },
    ]);
  });

  it('maps user message with tool_result to onToolResult', () => {
    const sink = createMockSink();
    mapSdkMessage(
      {
        type: 'user',
        uuid: 'uuid-7',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-1',
              content: 'file contents here',
              is_error: false,
            },
          ],
        },
      } as any,
      sink,
    );

    expect(sink.onToolResult).toHaveBeenCalledTimes(1);
    const toolResults = (sink.onToolResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(toolResults[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: 'tu-1',
      content: 'file contents here',
      isError: false,
    });
  });

  it('detects plan file paths in tool_result content', () => {
    const sink = createMockSink();
    mapSdkMessage(
      {
        type: 'user',
        uuid: 'uuid-8',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-2',
              content: '{"filePath": "/tmp/plan.md", "plan": true}',
              is_error: false,
            },
          ],
        },
      } as any,
      sink,
    );

    expect(sink.onPlanFile).toHaveBeenCalledWith('/tmp/plan.md');
  });

  it('detects skill from SkillTool tool_use in assistant messages', async () => {
    const { homedir } = await import('node:os');
    const pathMod = await import('node:path');
    const sink = createMockSink();
    mapSdkMessage(
      {
        type: 'assistant',
        uuid: 'uuid-10',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          model: 'claude',
          content: [
            {
              type: 'tool_use',
              id: 'toolu_s1',
              name: 'Skill',
              input: { skill: 'brainstorming' },
            },
          ],
        },
      } as any,
      sink,
    );

    expect(sink.onSkillFile).toHaveBeenCalledWith({
      path: pathMod.join(homedir(), '.claude', 'skills', 'brainstorming', 'SKILL.md'),
      displayName: 'brainstorming',
    });
  });

  it('does NOT fire onSkillFile for plain prose mentioning "Base directory for this skill"', () => {
    const sink = createMockSink();
    mapSdkMessage(
      {
        type: 'user',
        uuid: 'uuid-11',
        session_id: 'sess-1',
        parent_tool_use_id: null,
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu-4',
              content: 'Base directory for this skill: /fake/path',
              is_error: false,
            },
          ],
        },
      } as any,
      sink,
    );

    expect(sink.onSkillFile).not.toHaveBeenCalled();
  });
});
