/**
 * Shared request builders and frame helpers for the §facade-protocol e2e
 * suite (todo #350, plan task 37, R2.13) — split out of
 * `facade-protocol.spec.ts` so `facade-protocol-streaming.spec.ts` does not
 * duplicate them.
 */
import { expect } from '@playwright/test';
import { openSocket, sendJson, nextJsonMessage } from './raw-ws-client.js';

export const PROFILE = 'mock-cli';

export const QUEUE_STATE = '_mainframe.dev/queue_state';
export const REPLAY_COMPLETE = '_mainframe.dev/replay_complete';

/** The `_meta["_mainframe.dev"]` keys these specs read off a `session/update`. */
export interface MainframeItemMeta {
  attempt?: number;
  reason?: string;
  created?: boolean;
  streaming?: boolean;
  containerId?: string;
}

export interface SessionUpdateFrame {
  method?: string;
  id?: unknown;
  params?: {
    sessionId?: string;
    update?: {
      sessionUpdate?: string;
      messageId?: string;
      toolCallId?: string;
      title?: string;
      content?: unknown;
      rawInput?: unknown;
      _meta?: Record<string, MainframeItemMeta>;
    };
  };
}

/** `_meta["_mainframe.dev"]` of a `session/update`, or undefined when the frame carries none. */
export function mainframeMeta(frame: SessionUpdateFrame): MainframeItemMeta | undefined {
  return frame.params?.update?._meta?.['_mainframe.dev'];
}

/**
 * Spec Decision 38: a successful `session/resume` reply is followed, after the
 * replay's closing `queue_state`, by exactly one `_mainframe.dev/replay_complete`
 * for that session, with no `aborted` key on a normal close. `frames` is the
 * connection's arrival-ordered capture starting at (or before) the resume
 * request with id `replyId`. Returns the marker's index so a caller can
 * assert on what arrives after it (the live catch-up).
 */
export function expectReplayClosedAfterQueueState(frames: unknown[], sessionId: string, replyId: number): number {
  const list = frames as { id?: unknown; method?: string; params?: { sessionId?: string } }[];
  const replyIndex = list.findIndex((f) => f.id === replyId && f.method === undefined);
  expect(replyIndex, `the resume reply (id ${replyId}) must arrive`).toBeGreaterThanOrEqual(0);

  const markers = list
    .map((f, index) => ({ f, index }))
    .filter(({ f }) => f.method === REPLAY_COMPLETE && f.params?.sessionId === sessionId);
  expect(markers, 'exactly one replay_complete per resume reply').toHaveLength(1);
  const markerIndex = markers[0]!.index;
  expect(markerIndex).toBeGreaterThan(replyIndex);
  expect(list[markerIndex]!.params).toEqual({ sessionId });

  // The marker immediately follows the replay's closing queue snapshot.
  const before = list[markerIndex - 1];
  expect(before?.method, 'replay_complete must directly follow queue_state').toBe(QUEUE_STATE);
  expect(before?.params?.sessionId).toBe(sessionId);
  return markerIndex;
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
