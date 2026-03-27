// packages/core/src/__tests__/codex-types.test.ts
import { describe, it, expect } from 'vitest';
import {
  isJsonRpcResponse,
  isJsonRpcError,
  isJsonRpcNotification,
  isJsonRpcServerRequest,
} from '../plugins/builtin/codex/types.js';

describe('JSON-RPC message type guards', () => {
  it('identifies a response (has id + result)', () => {
    expect(isJsonRpcResponse({ id: 1, result: { thread: { id: 'thr_1' } } })).toBe(true);
  });

  it('identifies an error (has id + error)', () => {
    expect(isJsonRpcError({ id: 1, error: { code: -32600, message: 'Invalid' } })).toBe(true);
  });

  it('identifies a notification (has method, no id)', () => {
    expect(isJsonRpcNotification({ method: 'thread/started', params: {} })).toBe(true);
  });

  it('identifies a server request (has method + id)', () => {
    expect(isJsonRpcServerRequest({ id: 5, method: 'item/commandExecution/requestApproval', params: {} })).toBe(true);
  });

  it('does not confuse response with server request', () => {
    expect(isJsonRpcServerRequest({ id: 1, result: {} })).toBe(false);
  });

  it('does not confuse notification with response', () => {
    expect(isJsonRpcResponse({ method: 'turn/started', params: {} })).toBe(false);
  });
});
