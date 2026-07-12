// packages/core/src/automations/actions/files.ts
//
// Ports v1 workflows/connectors/files.ts onto the flat-id v2 registry (Task
// 13). Output shape changes (contract §5): append/write have no outputs;
// read drops `path`, keeping only `content`, and gains `outputAs`.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';
import type { ActionDef } from './types.js';

const WriteInputSchema = z.object({ path: z.string(), content: z.string() }).strict();
const ReadInputSchema = z.object({ path: z.string(), outputAs: z.enum(['text', 'lines']).optional() }).strict();

function splitLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

async function ensureParentDir(resolvedPath: string): Promise<void> {
  await mkdir(dirname(resolvedPath), { recursive: true });
}

export const filesAppendAction: ActionDef = {
  id: 'files.append',
  title: 'Append to file',
  group: 'builtin',
  auth: 'none',
  input: WriteInputSchema,
  outputs: [],
  idempotent: false,
  async run(ctx, rawInput) {
    const { path, content } = WriteInputSchema.parse(rawInput);
    const resolved = ctx.resolvePath(path);
    await ensureParentDir(resolved);
    await appendFile(resolved, content);
    return {};
  },
};

export const filesWriteAction: ActionDef = {
  id: 'files.write',
  title: 'Write file (overwrite)',
  group: 'builtin',
  auth: 'none',
  input: WriteInputSchema,
  outputs: [],
  idempotent: true,
  async run(ctx, rawInput) {
    const { path, content } = WriteInputSchema.parse(rawInput);
    const resolved = ctx.resolvePath(path);
    await ensureParentDir(resolved);
    await writeFile(resolved, content);
    return {};
  },
};

export const filesReadAction: ActionDef = {
  id: 'files.read',
  title: 'Read file',
  group: 'builtin',
  auth: 'none',
  input: ReadInputSchema,
  outputs: [{ name: 'content', type: 'text' }],
  idempotent: true,
  async run(ctx, rawInput) {
    const { path, outputAs } = ReadInputSchema.parse(rawInput);
    const raw = await readFile(ctx.resolvePath(path), 'utf8');
    return { content: outputAs === 'lines' ? splitLines(raw) : raw };
  },
};
