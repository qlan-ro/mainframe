/**
 * Unit tests for parseSendInput — select-to-quote blockquote prepend.
 *
 * The quote is stored by the native SelectionToolbar at
 * `message.metadata.custom.quote = { text, messageId }`.  parseSendInput
 * prepends it as a markdown blockquote ("> " per line) followed by "\n\n"
 * then the typed body, then trims the whole result.
 *
 * Every expected string is hardcoded — no logic re-derives it.
 */
import { describe, it, expect } from 'vitest';
import type { AppendMessage } from '@assistant-ui/react';
import { parseSendInput } from '../chat-reconcile';

// ---------------------------------------------------------------------------
// Minimal AppendMessage fixture builder.
// parseSendInput reads: role, content[].text, attachments, metadata.custom.quote
// ---------------------------------------------------------------------------

function makeMsg(
  body: string,
  quote?: { text: string; messageId: string },
  role: AppendMessage['role'] = 'user',
): AppendMessage {
  return {
    role,
    content: body ? [{ type: 'text', text: body }] : [],
    attachments: [],
    metadata: { custom: quote ? { quote } : {} },
    parentId: null,
  } as unknown as AppendMessage;
}

// ---------------------------------------------------------------------------
// 1. Quote present — single-line quote prepended before body
// ---------------------------------------------------------------------------

describe('parseSendInput — quote present (single-line)', () => {
  it('prepends a single-line quote as a blockquote before the typed body', () => {
    const msg = makeMsg('explain that', { text: 'the answer is 4', messageId: 'msg-1' });
    const result = parseSendInput(msg);
    expect(result?.text).toBe('> the answer is 4\n\nexplain that');
  });
});

// ---------------------------------------------------------------------------
// 2. Multiline quote — each line gets its own "> " prefix
// ---------------------------------------------------------------------------

describe('parseSendInput — multiline quote', () => {
  it('prefixes every line of the quote with "> " and separates them from the body', () => {
    const msg = makeMsg('why', { text: 'line one\nline two', messageId: 'msg-2' });
    const result = parseSendInput(msg);
    expect(result?.text).toBe('> line one\n> line two\n\nwhy');
  });
});

// ---------------------------------------------------------------------------
// 3. No quote — text is just the trimmed body
// ---------------------------------------------------------------------------

describe('parseSendInput — no quote', () => {
  it('returns the trimmed body unchanged when metadata.custom carries no quote', () => {
    const msg = makeMsg('hello');
    const result = parseSendInput(msg);
    expect(result?.text).toBe('hello');
  });
});

// ---------------------------------------------------------------------------
// 4. Quote only, empty body — result is the blockquote with no trailing content
// ---------------------------------------------------------------------------

describe('parseSendInput — quote only, empty body', () => {
  it('returns only the blockquote (trimmed) when the body is empty', () => {
    const msg = makeMsg('', { text: 'q', messageId: 'msg-3' });
    const result = parseSendInput(msg);
    // The raw concat is "> q\n\n" + "" → "> q\n\n"; after .trim() → "> q"
    expect(result?.text).toBe('> q');
  });
});

// ---------------------------------------------------------------------------
// 5. Non-user role — returns null unconditionally
// ---------------------------------------------------------------------------

describe('parseSendInput — non-user role', () => {
  it('returns null for a message whose role is not user', () => {
    const msg = makeMsg('assistant says hi', undefined, 'assistant');
    expect(parseSendInput(msg)).toBeNull();
  });
});
