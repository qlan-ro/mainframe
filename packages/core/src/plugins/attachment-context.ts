import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { nanoid } from 'nanoid';
import type { PluginAttachmentContext, PluginAttachmentMeta } from '@mainframe/types';

interface AttachmentRecord {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}

export function createPluginAttachmentContext(baseDir: string): PluginAttachmentContext {
  const entityDir = (id: string) => join(baseDir, id);

  function sanitize(name: string): string {
    const f = basename(name)
      .replace(/[^\w.\-() ]+/g, '_')
      .trim();
    return f.length > 0 ? f : 'attachment.bin';
  }

  return {
    async save(entityId, file) {
      const dir = entityDir(entityId);
      await mkdir(dir, { recursive: true });
      const id = nanoid();
      const safeName = sanitize(file.filename);
      await writeFile(join(dir, `${id}-${safeName}`), Buffer.from(file.data, 'base64'));
      const record: AttachmentRecord = {
        id,
        filename: file.filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        createdAt: new Date().toISOString(),
      };
      await writeFile(join(dir, `${id}.json`), JSON.stringify(record));
      return record;
    },

    async get(entityId, id) {
      const dir = entityDir(entityId);
      try {
        const metaRaw = await readFile(join(dir, `${id}.json`), 'utf-8');
        const meta = JSON.parse(metaRaw) as AttachmentRecord;
        const files = await readdir(dir);
        const dataFile = files.find((f) => f.startsWith(`${id}-`) && !f.endsWith('.json'));
        if (!dataFile) return null;
        const buf = await readFile(join(dir, dataFile));
        return { data: buf.toString('base64'), meta };
      } catch {
        return null;
      }
    },

    async list(entityId) {
      const dir = entityDir(entityId);
      try {
        await stat(dir);
      } catch {
        return [];
      }
      const files = await readdir(dir);
      const metas = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f): Promise<PluginAttachmentMeta | null> => {
            try {
              return JSON.parse(await readFile(join(dir, f), 'utf-8')) as PluginAttachmentMeta;
            } catch {
              return null;
            }
          }),
      );
      return metas.filter((m): m is PluginAttachmentMeta => m !== null);
    },

    async delete(entityId, id) {
      const dir = entityDir(entityId);
      try {
        const files = await readdir(dir);
        await Promise.all(
          files
            .filter((f) => f === `${id}.json` || f.startsWith(`${id}-`))
            .map((f) => rm(join(dir, f), { force: true })),
        );
      } catch {
        // directory may not exist; nothing to delete
      }
    },
  };
}
