/**
 * session-trigger-wiring — the `@` trigger's session-specific test-id/glyph
 * hooks and the label/path recording that ties an inserted `@session[label]`
 * token to the path the send will read (todo #240). AC 23, edge cases 3, 6.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import type { TriggerItem } from '@/components/trigger-engine/types';
import { useSessionReferences } from '../session-reference-store';
import { createSessionInsertion, sessionItemGlyph, sessionItemTestId } from '../session-trigger-wiring';

const SESSION_ITEM: TriggerItem = { id: 'chat-1', type: 'session', label: 'Fix foo handling' };
const FILE_ITEM: TriggerItem = { id: 'src/App.tsx', type: 'file', label: '@src/App.tsx' };
const AGENT_ITEM: TriggerItem = { id: 'agent-1', type: 'agent', label: 'code-reviewer' };
const DIRECTORY_ITEM: TriggerItem = { id: 'src/', type: 'directory', label: '@src/' };

describe('sessionItemTestId', () => {
  it('returns composer-mention-session-<chatId> for a session item', () => {
    expect(sessionItemTestId(SESSION_ITEM)).toBe('composer-mention-session-chat-1');
  });

  it('returns undefined for a file item', () => {
    expect(sessionItemTestId(FILE_ITEM)).toBeUndefined();
  });

  it('returns undefined for an agent item', () => {
    expect(sessionItemTestId(AGENT_ITEM)).toBeUndefined();
  });

  it('returns undefined for a directory item', () => {
    expect(sessionItemTestId(DIRECTORY_ITEM)).toBeUndefined();
  });
});

describe('sessionItemGlyph', () => {
  it('returns a node for a session item', () => {
    expect(sessionItemGlyph(SESSION_ITEM)).not.toBeNull();
  });

  it('returns null for a file item', () => {
    expect(sessionItemGlyph(FILE_ITEM)).toBeNull();
  });

  it('returns null for an agent item', () => {
    expect(sessionItemGlyph(AGENT_ITEM)).toBeNull();
  });

  it('returns null for a directory item', () => {
    expect(sessionItemGlyph(DIRECTORY_ITEM)).toBeNull();
  });
});

describe('createSessionInsertion — serialize-then-onInserted ordering', () => {
  beforeEach(() => {
    useSessionReferences.setState({ byThread: {} });
  });

  it('records label -> path, mimicking selectEntry calling serialize then onInserted', () => {
    const pathByChatId = new Map([['chat-1', '/tmp/chat-1.jsonl']]);
    const insertion = createSessionInsertion({ threadId: 'thread-1', pathByChatId });

    const label = insertion.resolveSessionLabel(SESSION_ITEM);
    insertion.onInserted(SESSION_ITEM);

    expect(label).toBe('Fix foo handling');
    expect(useSessionReferences.getState().byThread['thread-1']).toEqual({ 'Fix foo handling': '/tmp/chat-1.jsonl' });
  });

  it('re-picking the same session reuses the same label and writes no second entry', () => {
    const pathByChatId = new Map([['chat-1', '/tmp/chat-1.jsonl']]);
    const insertion = createSessionInsertion({ threadId: 'thread-1', pathByChatId });

    insertion.onInserted(SESSION_ITEM);
    insertion.onInserted(SESSION_ITEM);

    expect(useSessionReferences.getState().byThread['thread-1']).toEqual({ 'Fix foo handling': '/tmp/chat-1.jsonl' });
    expect(Object.keys(useSessionReferences.getState().byThread['thread-1']!)).toHaveLength(1);
  });

  it('picking a different session whose sanitized label collides takes (2) in both the token and the recorded key', () => {
    const pathByChatId = new Map([
      ['chat-1', '/tmp/chat-1.jsonl'],
      ['chat-2', '/tmp/chat-2.jsonl'],
    ]);
    const insertion = createSessionInsertion({ threadId: 'thread-1', pathByChatId });
    const otherItem: TriggerItem = { id: 'chat-2', type: 'session', label: 'Fix foo handling' };

    insertion.onInserted(SESSION_ITEM);
    const secondLabel = insertion.resolveSessionLabel(otherItem);
    insertion.onInserted(otherItem);

    expect(secondLabel).toBe('Fix foo handling (2)');
    expect(useSessionReferences.getState().byThread['thread-1']).toEqual({
      'Fix foo handling': '/tmp/chat-1.jsonl',
      'Fix foo handling (2)': '/tmp/chat-2.jsonl',
    });
  });

  it('a null threadId records nothing and does not throw', () => {
    const pathByChatId = new Map([['chat-1', '/tmp/chat-1.jsonl']]);
    const insertion = createSessionInsertion({ threadId: null, pathByChatId });

    expect(() => insertion.onInserted(SESSION_ITEM)).not.toThrow();
    expect(useSessionReferences.getState().byThread).toEqual({});
  });

  it('a chat id missing from pathByChatId records nothing and does not throw', () => {
    const insertion = createSessionInsertion({ threadId: 'thread-1', pathByChatId: new Map() });

    expect(() => insertion.onInserted(SESSION_ITEM)).not.toThrow();
    expect(useSessionReferences.getState().byThread['thread-1']).toBeUndefined();
  });
});
