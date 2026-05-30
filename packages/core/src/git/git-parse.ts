/** Shared git output parsers used by route handlers. */

export interface DiffEntry {
  status: string;
  path: string;
  oldPath?: string;
}

export interface StatusBuckets {
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

/**
 * Returns true when an error originates from running git in a non-repo directory.
 * Used to suppress noisy warnings for expected "not a git repository" failures.
 */
export function isNotGitRepo(err: unknown): boolean {
  return (
    typeof (err as { message?: unknown }).message === 'string' &&
    (err as { message: string }).message.includes('not a git repository')
  );
}

/**
 * Parses `git diff --name-status` output (tab-separated) into structured entries.
 * Renamed (R) and copied (C) entries carry an `oldPath`.
 */
export function parseDiffNameStatus(output: string): DiffEntry[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const status = parts[0] ?? '';
      if (status.startsWith('R') || status.startsWith('C')) {
        return { status: status[0]!, path: parts[2] ?? '', oldPath: parts[1] };
      }
      return { status, path: parts[1] ?? '' };
    })
    .filter((f) => f.path.length > 0);
}

/**
 * Parses `git status --porcelain` output into structured file entries.
 * Each line's first two characters are the XY status code; the rest (after 3 chars) is the path.
 * Renamed (R) and copied (C) entries use " -> " to separate old and new paths.
 * Directory entries (trailing slash) are filtered out.
 */
export function parseStatusLines(output: string): DiffEntry[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line: string) => {
      const code = line.slice(0, 2).trim();
      const rest = line.slice(3);
      if (code.startsWith('R') || code.startsWith('C')) {
        const arrow = rest.indexOf(' -> ');
        if (arrow !== -1) return { status: code, path: rest.slice(arrow + 4), oldPath: rest.slice(0, arrow) };
      }
      return { status: code, path: rest };
    })
    .filter((f) => !f.path.endsWith('/'));
}

/**
 * Parses `git status --porcelain` output into staged/unstaged/untracked buckets.
 * Uses the two-character XY format: X = index status, Y = working-tree status.
 * Renamed from the original `parsePortcelainStatus` (fixing the typo).
 */
export function parseStatusBuckets(output: string): StatusBuckets {
  const staged: string[] = [];
  const unstaged: string[] = [];
  const untracked: string[] = [];

  for (const line of output.split('\n').filter(Boolean)) {
    const indexStatus = line[0] ?? ' ';
    const workingStatus = line[1] ?? ' ';
    const filename = line.slice(3);

    if (indexStatus === '?' && workingStatus === '?') {
      untracked.push(filename);
      continue;
    }
    if (indexStatus !== ' ') staged.push(filename);
    if (workingStatus !== ' ') unstaged.push(filename);
  }

  return { staged, unstaged, untracked };
}
