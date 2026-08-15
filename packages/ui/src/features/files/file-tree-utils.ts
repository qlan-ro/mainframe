/** Pure path/sort helpers shared by `FileTree` and `FileTreeNode`. */
import type { FileTreeEntry } from '@/lib/api/files';

/** Join an absolute base with a repo-relative path; falls back to the relative path when no base is known. */
export function toFullPath(base: string | undefined, relativePath: string): string {
  return base ? `${base}/${relativePath}` : relativePath;
}

/** Last path segment (folder/file name) of an absolute or relative path. */
export function lastSegment(path: string): string {
  const i = path.replace(/\/+$/, '').lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

/** Directories first, then files, each alphabetical. */
export function sortEntries(entries: FileTreeEntry[]): FileTreeEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/** True when `candidatePath` is a strict ancestor of `targetPath`. */
export function isAncestorOf(candidatePath: string, targetPath: string): boolean {
  return targetPath.startsWith(candidatePath + '/');
}
