import { describe, it, expect, vi } from 'vitest';
import { PermissionBridge } from '../../../plugins/builtin/claude-sdk/permission-bridge.js';
import type { ControlResponse } from '@qlan-ro/mainframe-types';
import { createMockSink } from './test-utils.js';

describe('PermissionBridge', () => {
  it('canUseTool calls sink.onPermission and resolves on allow', async () => {
    const sink = createMockSink();
    const bridge = new PermissionBridge(sink);

    const resultPromise = bridge.canUseTool(
      'Bash',
      { command: 'ls' },
      {
        signal: AbortSignal.timeout(5000),
        toolUseID: 'tool-123',
      },
    );

    expect(sink.onPermission).toHaveBeenCalledTimes(1);
    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.toolName).toBe('Bash');
    expect(request.toolUseId).toBe('tool-123');
    expect(request.input).toEqual({ command: 'ls' });

    const response: ControlResponse = {
      requestId: request.requestId,
      toolUseId: 'tool-123',
      behavior: 'allow',
    };
    bridge.resolve(response);

    const result = await resultPromise;
    expect(result.behavior).toBe('allow');
  });

  it('canUseTool resolves with deny and message', async () => {
    const sink = createMockSink();
    const bridge = new PermissionBridge(sink);

    const resultPromise = bridge.canUseTool(
      'Bash',
      { command: 'rm -rf /' },
      {
        signal: AbortSignal.timeout(5000),
        toolUseID: 'tool-456',
      },
    );

    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0][0];

    bridge.resolve({
      requestId: request.requestId,
      toolUseId: 'tool-456',
      behavior: 'deny',
      message: 'User denied',
    });

    const result = await resultPromise;
    expect(result.behavior).toBe('deny');
    if (result.behavior === 'deny') {
      expect(result.message).toBe('User denied');
    }
  });

  it('passes suggestions through as ControlRequest suggestions', async () => {
    const sink = createMockSink();
    const bridge = new PermissionBridge(sink);

    const suggestions = [
      {
        type: 'addRules' as const,
        rules: [{ toolName: 'Bash' }],
        behavior: 'allow' as const,
        destination: 'session' as const,
      },
    ];

    bridge.canUseTool(
      'Bash',
      { command: 'ls' },
      {
        signal: AbortSignal.timeout(5000),
        toolUseID: 'tool-789',
        suggestions,
      },
    );

    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.suggestions).toEqual(suggestions);
  });

  it('rejectAll denies all pending permissions', async () => {
    const sink = createMockSink();
    const bridge = new PermissionBridge(sink);

    const result1 = bridge.canUseTool(
      'Bash',
      { command: 'ls' },
      {
        signal: AbortSignal.timeout(5000),
        toolUseID: 'tool-a',
      },
    );
    const result2 = bridge.canUseTool(
      'Read',
      { file_path: '/tmp' },
      {
        signal: AbortSignal.timeout(5000),
        toolUseID: 'tool-b',
      },
    );

    bridge.rejectAll();

    const r1 = await result1;
    const r2 = await result2;
    expect(r1.behavior).toBe('deny');
    expect(r2.behavior).toBe('deny');
  });
});
