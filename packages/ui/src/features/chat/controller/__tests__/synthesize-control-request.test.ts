/**
 * `resolveGateControlRequest` — behavior tests (spec decision 27). Covers
 * the boundary `AcpSessionPlane.handleGate` delegates to: pick the carried
 * `ControlRequest` when it has a usable `requestId`, else synthesize one
 * from the wire-level `RequestPermissionRequest` and the arrival rpc id.
 */
import { describe, expect, it } from 'vitest';
import type { ControlRequest, RequestPermissionRequest } from '@qlan-ro/mainframe-types';
import { resolveGateControlRequest } from '../synthesize-control-request';

function bareRequest(overrides: Partial<RequestPermissionRequest> = {}): RequestPermissionRequest {
  return { sessionId: 'chat-1', title: 'Allow Write to run?', options: [], ...overrides };
}

describe('resolveGateControlRequest', () => {
  it('keeps the carried ControlRequest when it has a usable requestId', () => {
    const carried: ControlRequest = {
      requestId: 'req-1',
      toolName: 'Bash',
      toolUseId: 'tu-1',
      input: { command: 'ls' },
      suggestions: [],
    };

    const result = resolveGateControlRequest('gate-req-1', bareRequest(), carried);

    expect(result).toEqual({ control: carried, synthesized: false });
  });

  it('synthesizes a stand-in when carried is undefined, deriving requestId from the gate- prefixed rpc id', () => {
    const result = resolveGateControlRequest('gate-req-9', bareRequest(), undefined);

    expect(result).toEqual({
      control: { requestId: 'req-9', toolName: '(unknown tool)', toolUseId: 'req-9', input: {}, suggestions: [] },
      synthesized: true,
    });
  });

  it('synthesizes a stand-in when carried has no requestId string', () => {
    const carried = { toolName: 'Bash' } as unknown as ControlRequest;

    const result = resolveGateControlRequest('gate-req-2', bareRequest(), carried);

    expect(result.synthesized).toBe(true);
    expect(result.control.requestId).toBe('req-2');
  });

  it('uses the raw rpc id verbatim when it carries no gate- prefix', () => {
    const result = resolveGateControlRequest(42, bareRequest(), undefined);

    expect(result.control.requestId).toBe('42');
    expect(result.control.toolUseId).toBe('42');
  });

  it('pulls toolName/toolUseId off a tool_call subject when present', () => {
    const request = bareRequest({
      subject: { type: 'tool_call', toolCall: { toolCallId: 'tu-7', title: 'Write' } },
    });

    const result = resolveGateControlRequest('gate-req-7', request, undefined);

    expect(result.control).toEqual({
      requestId: 'req-7',
      toolName: 'Write',
      toolUseId: 'tu-7',
      input: {},
      suggestions: [],
    });
  });
});
