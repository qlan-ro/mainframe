/** Shared by SessionRowMetaIcons (hint label) and SessionMetaCard (hover text). */
export function worktreeBasename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
