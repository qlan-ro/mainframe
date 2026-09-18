/**
 * Shared request builders and frame helpers for the §facade-protocol e2e
 * suite (todo #350, plan task 37, R2.13) — split out of
 * `facade-protocol.spec.ts` so `facade-protocol-streaming.spec.ts` does not
 * duplicate them.
 */
import { openSocket, sendJson, nextJsonMessage } from './raw-ws-client.js';

export const PROFILE = 'mock-cli';

export interface SessionUpdateFrame {
  method?: string;
  id?: unknown;
  params?: {
    sessionId?: string;
    update?: {
      sessionUpdate?: string;
      messageId?: string;
      toolCallId?: string;
      content?: unknown;
      rawInput?: unknown;
      _meta?: Record<string, { attempt?: number; reason?: string }>;
    };
  };
}

export function initializeRequest(id: number) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: { protocolVersion: 2, info: { name: 'mainframe-e2e', version: '0.0.0' } },
  };
}

export function promptRequest(id: number, sessionId: string, text: string) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'session/prompt',
    params: { sessionId, prompt: [{ type: 'text', text }] },
  };
}

export function resumeRequest(id: number, sessionId: string, replayFrom?: unknown) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'session/resume',
    params: { sessionId, cwd: '/tmp', ...(replayFrom !== undefined ? { replayFrom } : {}) },
  };
}

export function updates(frames: unknown[]): SessionUpdateFrame[] {
  return (frames as SessionUpdateFrame[]).filter((f) => f.method === 'session/update');
}

export function itemId(frame: SessionUpdateFrame): string | undefined {
  return frame.params?.update?.messageId ?? frame.params?.update?.toolCallId;
}

export function itemIds(frames: SessionUpdateFrame[]): Set<string> {
  return new Set(frames.map(itemId).filter((id): id is string => id !== undefined));
}

export async function connectAndInitialize(id = 1): Promise<WebSocket> {
  const ws = await openSocket(`/acp/${PROFILE}`);
  sendJson(ws, initializeRequest(id));
  await nextJsonMessage(ws);
  return ws;
}
