import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDraft,
  saveDraft,
  deleteDraft,
} from '../../../renderer/components/chat/assistant-ui/composer/composer-drafts.js';

describe('composer-drafts', () => {
  beforeEach(() => {
    deleteDraft('test-chat-1');
    deleteDraft('test-chat-2');
  });

  it('returns undefined for unknown chatId', () => {
    expect(getDraft('nonexistent')).toBeUndefined();
  });

  it('saves and retrieves a draft', () => {
    const draft = { text: 'hello', attachments: [], captures: [] };
    saveDraft('test-chat-1', draft);
    expect(getDraft('test-chat-1')).toEqual(draft);
  });

  it('overwrites an existing draft', () => {
    saveDraft('test-chat-1', { text: 'old', attachments: [], captures: [] });
    saveDraft('test-chat-1', { text: 'new', attachments: [], captures: [] });
    expect(getDraft('test-chat-1')?.text).toBe('new');
  });

  it('deletes a draft', () => {
    saveDraft('test-chat-1', { text: 'hello', attachments: [], captures: [] });
    deleteDraft('test-chat-1');
    expect(getDraft('test-chat-1')).toBeUndefined();
  });

  it('does not throw when deleting nonexistent draft', () => {
    expect(() => deleteDraft('nonexistent')).not.toThrow();
  });

  it('isolates drafts between chat IDs', () => {
    saveDraft('test-chat-1', { text: 'one', attachments: [], captures: [] });
    saveDraft('test-chat-2', { text: 'two', attachments: [], captures: [] });
    expect(getDraft('test-chat-1')?.text).toBe('one');
    expect(getDraft('test-chat-2')?.text).toBe('two');
  });

  it('does not save empty drafts', () => {
    saveDraft('test-chat-1', { text: '', attachments: [], captures: [] });
    expect(getDraft('test-chat-1')).toBeUndefined();
  });

  it('does not save whitespace-only drafts', () => {
    saveDraft('test-chat-1', { text: '   ', attachments: [], captures: [] });
    expect(getDraft('test-chat-1')).toBeUndefined();
  });

  it('saves draft with only attachments (no text)', () => {
    const draft = {
      text: '',
      attachments: [{ type: 'image', name: 'photo.png', contentType: 'image/png', content: [] }],
      captures: [],
    };
    saveDraft('test-chat-1', draft);
    expect(getDraft('test-chat-1')).toEqual(draft);
  });

  it('saves draft with only captures (no text)', () => {
    const draft = {
      text: '',
      attachments: [],
      captures: [{ type: 'screenshot' as const, imageDataUrl: 'data:image/png;base64,abc' }],
    };
    saveDraft('test-chat-1', draft);
    expect(getDraft('test-chat-1')).toEqual(draft);
  });
});
