import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPluginAttachmentContext } from '../../plugins/attachment-context.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mf-attach-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('createPluginAttachmentContext', () => {
  it('saves and retrieves an attachment', async () => {
    const ctx = createPluginAttachmentContext(tmpDir);
    const meta = await ctx.save('entity1', {
      filename: 'test.txt',
      mimeType: 'text/plain',
      data: Buffer.from('hello').toString('base64'),
      sizeBytes: 5,
    });
    expect(meta.id).toBeDefined();
    expect(meta.filename).toBe('test.txt');

    const result = await ctx.get('entity1', meta.id);
    expect(result).not.toBeNull();
    expect(Buffer.from(result!.data, 'base64').toString()).toBe('hello');
  });

  it('lists attachments for an entity', async () => {
    const ctx = createPluginAttachmentContext(tmpDir);
    await ctx.save('e1', { filename: 'a.txt', mimeType: 'text/plain', data: 'aGk=', sizeBytes: 2 });
    await ctx.save('e1', { filename: 'b.txt', mimeType: 'text/plain', data: 'aGk=', sizeBytes: 2 });
    const list = await ctx.list('e1');
    expect(list).toHaveLength(2);
  });

  it('returns empty list for unknown entity', async () => {
    const ctx = createPluginAttachmentContext(tmpDir);
    const list = await ctx.list('unknown');
    expect(list).toHaveLength(0);
  });

  it('returns null for unknown attachment', async () => {
    const ctx = createPluginAttachmentContext(tmpDir);
    const result = await ctx.get('entity1', 'nonexistent');
    expect(result).toBeNull();
  });

  it('deletes an attachment', async () => {
    const ctx = createPluginAttachmentContext(tmpDir);
    const meta = await ctx.save('e1', { filename: 'del.txt', mimeType: 'text/plain', data: 'aGk=', sizeBytes: 2 });
    await ctx.delete('e1', meta.id);
    const result = await ctx.get('e1', meta.id);
    expect(result).toBeNull();
    const list = await ctx.list('e1');
    expect(list).toHaveLength(0);
  });
});
