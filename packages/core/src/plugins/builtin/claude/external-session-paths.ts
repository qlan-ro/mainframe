import { readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** basename (minus `.jsonl`) is a UUID — skips progress.jsonl, queue-operation.jsonl, etc. */
export function isUuidJsonl(filename: string): boolean {
  if (!filename.endsWith('.jsonl')) return false;
  return UUID_RE.test(filename.slice(0, -'.jsonl'.length));
}

/** CLI parity: replace EVERY non-alphanumeric char with '-'. */
export function encodePath(p: string): string {
  return p.replace(/[^a-zA-Z0-9]/g, '-');
}

export function projectsRoot(): string {
  return path.join(homedir(), '.claude', 'projects');
}

/**
 * Canonicalize like the CLI before encoding: resolve symlinks (realpath) and
 * normalize Unicode (NFC) so a symlinked project root maps to the same encoded
 * dir the CLI wrote under. Falls back to NFC-only if the path can't be realpath'd.
 */
export async function canonicalizeProjectPath(p: string): Promise<string> {
  const nfc = p.normalize('NFC');
  try {
    return (await realpath(nfc)).normalize('NFC');
  } catch {
    /* expected: project path may not exist on disk (still encode it) */
    return nfc;
  }
}

/** Belongs to this project if cwd equals the root or is nested under it. */
export function cwdBelongsToProject(cwd: string | undefined, projectPath: string): boolean {
  if (!cwd) return false;
  if (cwd === projectPath) return true;
  return cwd.startsWith(projectPath + path.sep);
}

/** Discover every encoded dir under ~/.claude/projects whose prefix matches the project. */
export async function discoverProjectDirs(projectPath: string): Promise<string[]> {
  const root = projectsRoot();
  const encodedPrefix = encodePath(projectPath);
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    /* expected: no Claude session dir for this project */
    return [];
  }
  return entries
    .filter((name) => name === encodedPrefix || name.startsWith(encodedPrefix + '-'))
    .map((name) => path.join(root, name));
}
