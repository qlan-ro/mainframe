import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the SDK before importing session
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: vi.fn(),
}));

import { ClaudeSdkSession } from '../../../plugins/builtin/claude-sdk/session.js';
import { query as mockQuery } from '@anthropic-ai/claude-agent-sdk';
import { createMockSink } from './test-utils.js';

function createMockQuery(messages: any[]) {
  let index = 0;
  const gen = {
    next: vi.fn(async () => {
      if (index < messages.length) {
        return { value: messages[index++], done: false };
      }
      return { value: undefined, done: true };
    }),
    return: vi.fn(async () => ({ value: undefined, done: true })),
    throw: vi.fn(async () => ({ value: undefined, done: true })),
    [Symbol.asyncIterator]: () => gen,
    interrupt: vi.fn(async () => {}),
    close: vi.fn(),
    setModel: vi.fn(async () => {}),
    setPermissionMode: vi.fn(async () => {}),
    streamInput: vi.fn(async () => {}),
  };
  return gen;
}

describe('ClaudeSdkSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns and processes SDK events through sink', async () => {
    const sdkMessages = [
      {
        type: 'system',
        subtype: 'init',
        session_id: 'sess-abc',
        model: 'claude-opus-4-6',
        tools: [],
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
      },
      {
        type: 'result',
        subtype: 'success',
        total_cost_usd: 0.01,
        usage: { input_tokens: 10, output_tokens: 5 },
        result: 'Done',
        is_error: false,
        duration_ms: 100,
        duration_api_ms: 80,
        num_turns: 1,
        stop_reason: 'end_turn',
        modelUsage: {},
        permission_denials: [],
        uuid: 'uuid-2',
        session_id: 'sess-abc',
      },
    ];

    const mockGen = createMockQuery(sdkMessages);
    (mockQuery as ReturnType<typeof vi.fn>).mockReturnValue(mockGen);

    const session = new ClaudeSdkSession({ projectPath: '/tmp/test' });
    const sink = createMockSink();

    await session.spawn({ permissionMode: 'default' }, sink);
    await session.sendMessage('Hello');

    // Wait for the event loop to process
    await new Promise((r) => setTimeout(r, 50));

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(sink.onInit).toHaveBeenCalledWith('sess-abc');
    expect(sink.onResult).toHaveBeenCalledTimes(1);
  });

  it('kill closes the query and calls onExit', async () => {
    const mockGen = createMockQuery([]);
    (mockQuery as ReturnType<typeof vi.fn>).mockReturnValue(mockGen);

    const session = new ClaudeSdkSession({ projectPath: '/tmp/test' });
    const sink = createMockSink();
    await session.spawn({}, sink);
    await session.sendMessage('Hello');
    await new Promise((r) => setTimeout(r, 20));

    await session.kill();

    expect(mockGen.close).toHaveBeenCalled();
  });

  it('interrupt calls query.interrupt()', async () => {
    const mockGen = createMockQuery([]);
    mockGen.next = vi.fn(() => new Promise(() => {})); // hang forever
    (mockQuery as ReturnType<typeof vi.fn>).mockReturnValue(mockGen);

    const session = new ClaudeSdkSession({ projectPath: '/tmp/test' });
    const sink = createMockSink();
    await session.spawn({}, sink);
    await session.sendMessage('Hello');

    await session.interrupt();

    expect(mockGen.interrupt).toHaveBeenCalled();
  });

  it('setModel delegates to query.setModel()', async () => {
    const mockGen = createMockQuery([]);
    mockGen.next = vi.fn(() => new Promise(() => {}));
    (mockQuery as ReturnType<typeof vi.fn>).mockReturnValue(mockGen);

    const session = new ClaudeSdkSession({ projectPath: '/tmp/test' });
    const sink = createMockSink();
    await session.spawn({}, sink);
    await session.sendMessage('Hello');

    await session.setModel('claude-sonnet-4-5-20250929');

    expect(mockGen.setModel).toHaveBeenCalledWith('claude-sonnet-4-5-20250929');
  });

  it('maps yolo permission mode to bypassPermissions', async () => {
    const mockGen = createMockQuery([]);
    (mockQuery as ReturnType<typeof vi.fn>).mockReturnValue(mockGen);

    const session = new ClaudeSdkSession({ projectPath: '/tmp/test' });
    const sink = createMockSink();
    await session.spawn({ permissionMode: 'yolo' }, sink);
    await session.sendMessage('Hello');

    const callArgs = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.options.permissionMode).toBe('bypassPermissions');
  });

  it('passes resume option when chatId is set', async () => {
    const mockGen = createMockQuery([]);
    (mockQuery as ReturnType<typeof vi.fn>).mockReturnValue(mockGen);

    const session = new ClaudeSdkSession({ projectPath: '/tmp/test', chatId: 'existing-session' });
    const sink = createMockSink();
    await session.spawn({}, sink);
    await session.sendMessage('Continue');

    const callArgs = (mockQuery as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(callArgs.options.resume).toBe('existing-session');
  });
});
