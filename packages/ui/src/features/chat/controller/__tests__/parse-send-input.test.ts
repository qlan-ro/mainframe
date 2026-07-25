/**
 * Unit tests for parseSendInput.
 *
 * Most of parseSendInput's behavior (trimmed text, empty-send null, attachment
 * upload-item mapping) is exercised at the controller level in
 * chat-thread-controller-send.test.ts via real sends. This file covers only
 * the one branch that isn't: the non-user-role guard, which short-circuits
 * before any of that other logic runs.
 */
import { describe, it, expect } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import { parseSendInput } from '../chat-reconcile';

function makeMsg(body: string, role: AppendMessage['role'] = 'user'): AppendMessage {
  return {
    role,
    content: body ? [{ type: 'text', text: body }] : [],
    attachments: [],
    metadata: { custom: {} },
    parentId: null,
  } as unknown as AppendMessage;
}

describe('parseSendInput — non-user role', () => {
  it('returns null for a message whose role is not user', () => {
    const msg = makeMsg('assistant says hi', 'assistant');
    expect(parseSendInput(msg)).toBeNull();
  });
});
