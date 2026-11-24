/** The worktree's name on the session's hover card. */
export function worktreeBasename(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}
