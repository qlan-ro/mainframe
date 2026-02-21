import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentStore } from '../attachment/attachment-store.js';

let baseDir: string;
let store: AttachmentStore;

beforeEach(async () => {
  baseDir = await mkdtemp(join(tmpdir(), 'mf-attach-test-'));
  store = new AttachmentStore(baseDir);
});

afterEach(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

describe('AttachmentStore', () => {
  describe('save + get round-trip', () => {
    it('saves an image attachment and retrieves it by id', async () => {
      const [meta] = await store.save('chat-1', [
        {
          name: 'photo.png',
          mediaType: 'image/png',
          sizeBytes: 100,
          kind: 'image',
          data: Buffer.from('fake-image-data').toString('base64'),
        },
      ]);

      expect(meta).toBeDefined();
      expect(meta!.name).toBe('photo.png');
      expect(meta!.kind).toBe('image');

      const retrieved = await store.get('chat-1', meta!.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.name).toBe('photo.png');
      expect(retrieved!.data).toBe(Buffer.from('fake-image-data').toString('base64'));
    });

    it('returns null for non-existent attachment', async () => {
      const result = await store.get('chat-1', 'nonexistent-id');
      expect(result).toBeNull();
    });
  });

  describe('list', () => {
    it('returns empty array for unknown chat', async () => {
      expect(await store.list('unknown-chat')).toEqual([]);
    });

    it('lists all attachments for a chat', async () => {
      await store.save('chat-2', [
        { name: 'a.png', mediaType: 'image/png', sizeBytes: 10, kind: 'image', data: '' },
        { name: 'b.png', mediaType: 'image/png', sizeBytes: 20, kind: 'image', data: '' },
      ]);
      const list = await store.list('chat-2');
      expect(list).toHaveLength(2);
      expect(list.map((a) => a.name)).toEqual(expect.arrayContaining(['a.png', 'b.png']));
    });
  });

  describe('deleteChat', () => {
    it('removes all attachments for the chat', async () => {
      await store.save('chat-3', [{ name: 'c.png', mediaType: 'image/png', sizeBytes: 10, kind: 'image', data: '' }]);
      await store.deleteChat('chat-3');
      expect(await store.list('chat-3')).toEqual([]);
    });

    it('does not throw when chat directory does not exist', async () => {
      await expect(store.deleteChat('nonexistent-chat')).resolves.not.toThrow();
    });
  });

  describe('sanitizeFileName', () => {
    it('strips path traversal sequences', async () => {
      const [meta] = await store.save('chat-4', [
        {
          name: '../../etc/passwd',
          mediaType: 'text/plain',
          sizeBytes: 10,
          kind: 'file',
          data: Buffer.from('data').toString('base64'),
        },
      ]);
      // materializedPath should not contain ../../
      expect(meta!.materializedPath).not.toContain('..');
      expect(meta!.materializedPath).toContain(baseDir);
    });

    it('handles empty-after-sanitize name by falling back to attachment.bin', async () => {
      // A name consisting only of spaces will be trimmed to empty string -> fallback
      const [meta] = await store.save('chat-5', [
        {
          name: '   ',
          mediaType: 'text/plain',
          sizeBytes: 5,
          kind: 'file',
          data: Buffer.from('hello').toString('base64'),
        },
      ]);
      expect(meta!.materializedPath).toMatch(/attachment\.bin$/);
    });
  });
});
