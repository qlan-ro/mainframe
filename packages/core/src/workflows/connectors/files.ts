import { z } from 'zod';
import { appendFile, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Connector } from './types.js';

export const filesConnector: Connector = {
  id: 'files',
  title: 'Local files',
  auth: { kind: 'none' },
  actions: {
    append: {
      title: 'Append to file',
      input: z.object({ path: z.string(), content: z.string() }),
      output: z.object({ path: z.string(), bytesWritten: z.number() }),
      idempotent: false,
      async run(ctx, input) {
        const { path, content } = input as { path: string; content: string };
        const resolved = ctx.resolvePath(path);
        await mkdir(dirname(resolved), { recursive: true });
        await appendFile(resolved, content);
        return { path: resolved, bytesWritten: Buffer.byteLength(content) };
      },
    },
    write: {
      title: 'Write file (overwrite)',
      input: z.object({ path: z.string(), content: z.string() }),
      output: z.object({ path: z.string() }),
      idempotent: true,
      async run(ctx, input) {
        const { path, content } = input as { path: string; content: string };
        const resolved = ctx.resolvePath(path);
        await mkdir(dirname(resolved), { recursive: true });
        await writeFile(resolved, content);
        return { path: resolved };
      },
    },
    read: {
      title: 'Read file',
      input: z.object({ path: z.string() }),
      output: z.object({ content: z.string() }),
      idempotent: true,
      async run(ctx, input) {
        const { path } = input as { path: string };
        return { content: await readFile(ctx.resolvePath(path), 'utf8') };
      },
    },
  },
};
