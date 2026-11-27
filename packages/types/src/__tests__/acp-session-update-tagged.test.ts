/**
 * `SessionUpdateSchema` is a tagged union (on `sessionUpdate`, nested on
 * `state`). It must accept and reject exactly what the plain union of the same
 * twelve shapes did: the safety is unchanged, only the lookup is cheaper.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { SessionUpdateSchema } from '../acp/update.js';

/** The previous definition: every shape tried in turn. */
const flat = (schema: z.ZodType): z.ZodType[] => {
  const options = (schema as unknown as { options?: z.ZodType[] }).options;
  return options ? options.flatMap(flat) : [schema];
};
const LegacyUnion = z.union(flat(SessionUpdateSchema) as [z.ZodType, z.ZodType]);

const text = { type: 'text', text: 'hi' };
const valid: Record<string, unknown>[] = [
  { sessionUpdate: 'user_message_chunk', messageId: 'm', content: text },
  {
    sessionUpdate: 'agent_message_chunk',
    messageId: 'm',
    content: { type: 'image', data: 'AA', mimeType: 'image/png' },
  },
  { sessionUpdate: 'agent_thought_chunk', messageId: 'm', content: text },
  { sessionUpdate: 'user_message', messageId: 'm', content: [text] },
  { sessionUpdate: 'agent_message', messageId: 'm', content: null },
  { sessionUpdate: 'agent_thought', messageId: 'm' },
  { sessionUpdate: 'state_update', state: 'running', _meta: { '_mainframe.dev': { startedAtMs: 5 } } },
  { sessionUpdate: 'state_update', state: 'idle', stopReason: 'end_turn' },
  { sessionUpdate: 'state_update', state: 'requires_action' },
  { sessionUpdate: 'tool_call_content_chunk', toolCallId: 't', content: { type: 'content', content: text } },
  {
    sessionUpdate: 'tool_call_update',
    toolCallId: 't',
    kind: 'read',
    status: 'completed',
    content: [{ type: 'diff', changes: [{ operation: 'move', oldPath: 'a', path: 'b' }] }],
    rawInput: { x: 1 },
  },
  { sessionUpdate: 'usage_update', used: 1, size: 2, cost: { amount: 1, currency: 'USD' } },
  { sessionUpdate: 'usage_update', used: 1, size: 2, extra: 'kept by loose objects' },
];

const invalid: unknown[] = [
  null,
  'text',
  [],
  {},
  { messageId: 'm', content: text },
  { sessionUpdate: 'nope', messageId: 'm' },
  { sessionUpdate: 7 },
  { sessionUpdate: 'user_message_chunk', content: text },
  { sessionUpdate: 'agent_message_chunk', messageId: 'm', content: { type: 'audio' } },
  { sessionUpdate: 'agent_message', messageId: 5 },
  { sessionUpdate: 'state_update' },
  { sessionUpdate: 'state_update', state: 'paused' },
  { sessionUpdate: 'state_update', state: 'idle', stopReason: 'because' },
  { sessionUpdate: 'tool_call_update' },
  { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'finished' },
  {
    sessionUpdate: 'tool_call_update',
    toolCallId: 't',
    content: [{ type: 'diff', changes: [{ operation: 'rename' }] }],
  },
  { sessionUpdate: 'tool_call_content_chunk', toolCallId: 't', content: { type: 'terminal' } },
  { sessionUpdate: 'usage_update', used: -1, size: 2 },
  { sessionUpdate: 'usage_update', used: 1.5, size: 2 },
  { sessionUpdate: 'usage_update', used: 1 },
];

describe('SessionUpdateSchema as a tagged union', () => {
  it('covers the same twelve shapes the plain union held', () => {
    expect(flat(SessionUpdateSchema)).toHaveLength(12);
  });

  it.each(valid)('accepts %j and returns what the plain union returned', (update) => {
    const tagged = SessionUpdateSchema.safeParse(update);
    expect(tagged.success).toBe(true);
    expect(tagged.data).toEqual(LegacyUnion.safeParse(update).data);
  });

  it.each(invalid)('rejects %j like the plain union', (update) => {
    expect(SessionUpdateSchema.safeParse(update).success).toBe(false);
    expect(LegacyUnion.safeParse(update).success).toBe(false);
  });

  it('agrees with the plain union on every one-field mutation of the valid corpus', () => {
    for (const update of valid) {
      for (const key of Object.keys(update)) {
        for (const mutated of [
          { ...update, [key]: undefined },
          { ...update, [key]: 12345 },
          { ...update, [key]: {} },
        ]) {
          expect(SessionUpdateSchema.safeParse(mutated).success, JSON.stringify(mutated)).toBe(
            LegacyUnion.safeParse(mutated).success,
          );
        }
      }
    }
  });
});
