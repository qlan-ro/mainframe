// packages/core/src/__tests__/codex-approval-handler.test.ts
import { describe, it, expect, vi } from 'vitest';
import { ApprovalHandler } from '../plugins/builtin/codex/approval-handler.js';
import type { SessionSink, ControlResponse } from '@qlan-ro/mainframe-types';

function createSink(): SessionSink {
  return {
    onInit: vi.fn(),
    onMessage: vi.fn(),
    onToolResult: vi.fn(),
    onPermission: vi.fn(),
    onResult: vi.fn(),
    onExit: vi.fn(),
    onError: vi.fn(),
    onCompact: vi.fn(),
    onCompactStart: vi.fn(),
    onContextUsage: vi.fn(),
    onPlanFile: vi.fn(),
    onSkillFile: vi.fn(),
    onQueuedProcessed: vi.fn(),
    onTodoUpdate: vi.fn(),
    onPrDetected: vi.fn(),
    onCliMessage: vi.fn(),
    onSkillLoaded: vi.fn(),
  };
}

describe('ApprovalHandler', () => {
  it('maps commandExecution approval to sink.onPermission', () => {
    const sink = createSink();
    const respond = vi.fn();
    const handler = new ApprovalHandler(sink);

    handler.handleRequest(
      'item/commandExecution/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'rm -rf /', cwd: '/home' },
      42,
      respond,
    );

    expect(sink.onPermission).toHaveBeenCalledOnce();
    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(request.toolName).toBe('command_execution');
    expect(request.input).toEqual({ command: 'rm -rf /', cwd: '/home' });
    expect(request.toolUseId).toBe('i1');
  });

  it('maps fileChange approval to sink.onPermission', () => {
    const sink = createSink();
    const respond = vi.fn();
    const handler = new ApprovalHandler(sink);

    handler.handleRequest(
      'item/fileChange/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i2', reason: 'Write access needed' },
      43,
      respond,
    );

    expect(sink.onPermission).toHaveBeenCalledOnce();
    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(request.toolName).toBe('file_change');
    expect(request.input).toEqual({ reason: 'Write access needed' });
  });

  it('resolve with allow sends accept decision', () => {
    const sink = createSink();
    const respond = vi.fn();
    const handler = new ApprovalHandler(sink);

    handler.handleRequest(
      'item/commandExecution/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'ls' },
      42,
      respond,
    );

    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    const response: ControlResponse = {
      requestId: request.requestId,
      toolUseId: 'i1',
      behavior: 'allow',
    };
    handler.resolve(response);

    expect(respond).toHaveBeenCalledWith(42, { decision: 'accept' });
  });

  it('resolve with deny sends decline decision', () => {
    const sink = createSink();
    const respond = vi.fn();
    const handler = new ApprovalHandler(sink);

    handler.handleRequest(
      'item/commandExecution/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'ls' },
      42,
      respond,
    );

    const request = (sink.onPermission as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    handler.resolve({
      requestId: request.requestId,
      toolUseId: 'i1',
      behavior: 'deny',
    });

    expect(respond).toHaveBeenCalledWith(42, { decision: 'decline' });
  });

  it('rejectAll declines all pending approvals', () => {
    const sink = createSink();
    const respond1 = vi.fn();
    const respond2 = vi.fn();
    const handler = new ApprovalHandler(sink);

    handler.handleRequest(
      'item/commandExecution/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i1', command: 'a' },
      1,
      respond1,
    );
    handler.handleRequest(
      'item/fileChange/requestApproval',
      { threadId: 't1', turnId: 'turn1', itemId: 'i2' },
      2,
      respond2,
    );

    handler.rejectAll();

    expect(respond1).toHaveBeenCalledWith(1, { decision: 'decline' });
    expect(respond2).toHaveBeenCalledWith(2, { decision: 'decline' });
  });
});
