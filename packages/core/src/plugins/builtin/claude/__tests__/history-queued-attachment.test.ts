import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertHistoryEntry } from '../history.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixtures/queued-command-attachment.jsonl');

const attachmentEntry = (over: Record<string, unknown> = {}, attachmentOver: Record<string, unknown> = {}) => ({
  type: 'attachment',
  uuid: 'e1',
  timestamp: '2026-07-04T00:00:01Z',
  attachment: {
    type: 'queued_command',
    prompt: [{ type: 'text', text: 'original queued text' }],
    source_uuid: 'u-src',
    commandMode: 'prompt',
    timestamp: '2026-07-04T00:00:00Z',
    ...attachmentOver,
  },
  ...over,
});

describe('convertHistoryEntry — queued_command attachment entries', () => {
  it('converts a prompt-mode queued_command into a user message with the original text', () => {
    const msg = convertHistoryEntry(attachmentEntry(), 'c1')!;
    expect(msg).toBeTruthy();
    expect(msg.type).toBe('user');
    expect(msg.content).toEqual([{ type: 'text', text: 'original queued text' }]);
    expect(msg.id).toBe('e1');
    expect(msg.timestamp).toBe('2026-07-04T00:00:01Z');
    expect(msg.metadata).toEqual({ source: 'history' });
  });

  it('handles a plain-string prompt', () => {
    const msg = convertHistoryEntry(attachmentEntry({}, { prompt: 'string prompt' }), 'c1')!;
    expect(msg.content).toEqual([{ type: 'text', text: 'string prompt' }]);
  });

  it('returns null for task-notification commandMode', () => {
    expect(convertHistoryEntry(attachmentEntry({}, { commandMode: 'task-notification' }), 'c1')).toBeNull();
  });

  it('returns null for non-queued_command attachments', () => {
    expect(convertHistoryEntry(attachmentEntry({}, { type: 'edited_text_file' }), 'c1')).toBeNull();
  });

  it('converts the real captured fixture entry', () => {
    const lines = readFileSync(FIXTURE, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const entry = lines.find((e) => e.type === 'attachment' && e.attachment?.type === 'queued_command');
    expect(entry, 'fixture must contain a queued_command attachment entry').toBeTruthy();
    const msg = convertHistoryEntry(entry, 'c1')!;
    expect(msg.type).toBe('user');
    const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain('queued_command');
  });
});
