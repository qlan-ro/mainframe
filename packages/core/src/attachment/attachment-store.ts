import { mkdir, writeFile, readFile, readdir, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { nanoid } from 'nanoid';

export interface StoredAttachment {
  name: string;
  mediaType: string;
  sizeBytes: number;
  kind: 'image' | 'file';
  data: string;
  originalPath?: string;
  materializedPath?: string;
}

export interface StoredAttachmentMeta {
  id: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
  kind: 'image' | 'file';
  originalPath?: string;
  materializedPath?: string;
}

export class AttachmentStore {
  constructor(private baseDir: string) {}

  async save(chatId: string, attachments: StoredAttachment[]): Promise<StoredAttachmentMeta[]> {
    const dir = join(this.baseDir, chatId);
    await mkdir(dir, { recursive: true });
    const filesDir = join(dir, 'files');
    await mkdir(filesDir, { recursive: true });

    return Promise.all(
      attachments.map(async (attachment) => {
        const id = nanoid();
        let materializedPath = attachment.materializedPath;
        if (attachment.kind === 'file') {
          try {
            const safeName = this.sanitizeFileName(attachment.name);
            materializedPath = join(filesDir, `${id}-${safeName}`);
            await writeFile(materializedPath, Buffer.from(attachment.data, 'base64'));
          } catch {
            materializedPath = undefined;
          }
        }

        await writeFile(
          join(dir, `${id}.json`),
          JSON.stringify({
            ...attachment,
            materializedPath,
          }),
        );
        return {
          id,
          name: attachment.name,
          mediaType: attachment.mediaType,
          sizeBytes: attachment.sizeBytes,
          kind: attachment.kind,
          originalPath: attachment.originalPath,
          materializedPath,
        };
      }),
    );
  }

  async get(chatId: string, attachmentId: string): Promise<StoredAttachment | null> {
    const filePath = join(this.baseDir, chatId, `${attachmentId}.json`);
    try {
      const content = await readFile(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  async list(chatId: string): Promise<StoredAttachmentMeta[]> {
    const dir = join(this.baseDir, chatId);
    try {
      await stat(dir);
    } catch {
      return [];
    }
    try {
      const files = await readdir(dir);
      const results = await Promise.all(
        files
          .filter((f) => f.endsWith('.json'))
          .map(async (f): Promise<StoredAttachmentMeta | null> => {
            const id = f.replace('.json', '');
            try {
              const parsed = JSON.parse(await readFile(join(dir, f), 'utf-8')) as StoredAttachment;
              return {
                id,
                name: parsed.name,
                mediaType: parsed.mediaType,
                sizeBytes: parsed.sizeBytes,
                kind: parsed.kind,
                originalPath: parsed.originalPath,
                materializedPath: parsed.materializedPath,
              };
            } catch {
              return null;
            }
          }),
      );
      return results.filter((x): x is StoredAttachmentMeta => x !== null);
    } catch {
      return [];
    }
  }

  async deleteChat(chatId: string): Promise<void> {
    const dir = join(this.baseDir, chatId);
    try {
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Directory may not exist
    }
  }

  private sanitizeFileName(name: string): string {
    const file = basename(name)
      .replace(/[^\w.\-() ]+/g, '_')
      .trim();
    return file.length > 0 ? file : 'attachment.bin';
  }
}
