import { homedir } from 'node:os';
import path from 'node:path';
import { mkdir, rename, readdir, cp, rm, access, constants } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export function getClaudeProjectDir(projectPath: string): string {
  const encoded = projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
  return path.join(homedir(), '.claude', 'projects', encoded);
}

/** Move a CLI session's files from one Claude project dir to another. */
export async function moveSessionFiles(
  sessionId: string,
  sourceDir: string,
  targetDir: string,
): Promise<void> {
  await mkdir(targetDir, { recursive: true });

  // 1. Move main JSONL
  await moveFile(
    path.join(sourceDir, `${sessionId}.jsonl`),
    path.join(targetDir, `${sessionId}.jsonl`),
  );

  // 2. Move session directory (subagents + tool-results)
  const sessionDir = path.join(sourceDir, sessionId);
  try {
    await access(sessionDir, constants.R_OK);
    await moveFile(sessionDir, path.join(targetDir, sessionId));
  } catch {
    // No session directory — that's fine
  }

  // 3. Move sidechain JSONL files that reference this session
  try {
    const entries = await readdir(sourceDir);
    for (const entry of entries) {
      if (!entry.endsWith('.jsonl') || entry === `${sessionId}.jsonl`) continue;
      const filePath = path.join(sourceDir, entry);
      if (await isSidechainOf(filePath, sessionId)) {
        await moveFile(filePath, path.join(targetDir, entry));
      }
    }
  } catch {
    // Directory read failed — proceed without sidechains
  }
}

async function isSidechainOf(filePath: string, sessionId: string): Promise<boolean> {
  const stream = createReadStream(filePath);
  try {
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.trim()) continue;
      const first = JSON.parse(line) as { sessionId?: string };
      return first.sessionId === sessionId;
    }
  } catch {
    // Unreadable — skip
  } finally {
    stream.destroy();
  }
  return false;
}

/** Move a file or directory, falling back to copy+delete for cross-device moves. */
async function moveFile(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
      await cp(src, dest, { recursive: true });
      await rm(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
}
