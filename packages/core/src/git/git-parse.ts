/** Shared git output parsers used by route handlers and GitService. */

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

export interface BranchList {
  current: string;
  all: string[];
}

export interface StatusFile {
  path: string;
  index: string;
  working_dir: string;
}

export interface PorcelainStatus {
  conflicted: string[];
  files: StatusFile[];
}

export interface DiffStatSummary {
  changes: number;
  insertions: number;
  deletions: number;
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

/**
 * Parses `git branch --no-color [-a]` output into the current branch and the
 * full list of branch names. Remote branches keep their `remotes/<remote>/...`
 * prefix; the `remotes/origin/HEAD -> origin/main` pointer keeps its name so
 * callers can filter it. Detached HEAD lines resolve to the ref they point at,
 * matching the `.current`/`.all` shape GitService relied on before.
 */
export function parseBranchList(output: string): BranchList {
  const all: string[] = [];
  let current = '';
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    const isCurrent = line.startsWith('* ');
    const rest = line.replace(/^[*+]?\s+/, '');
    const detached = rest.match(/^\((?:HEAD )?detached (?:from|at) (\S+)\)/);
    const name = detached ? detached[1]! : rest.split(/\s+/)[0]!;
    if (!name) continue;
    all.push(name);
    if (isCurrent) current = name;
  }
  return { current, all };
}

/** Branch names from `git remote` (one per line). */
export function parseRemotes(output: string): string[] {
  return output
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * Extracts the commit hash from `git commit` output, whose first line is
 * `[<branch> (root-commit)? <hash>] <subject>`. Returns '' when absent
 * (e.g. nothing to commit). `-c core.abbrev=40` makes the hash the full sha.
 */
export function parseCommitHash(output: string): string {
  const match = output.match(/^\[[^\s]+(?: \([^)]+\))? ([^\]]+)\]/m);
  return match ? match[1]!.trim() : '';
}

/**
 * Parses the diffstat summary line git prints for pull/merge, e.g.
 * `3 files changed, 10 insertions(+), 2 deletions(-)`. Missing insertion or
 * deletion clauses count as 0. `changes` is the "N files changed" count.
 */
export function parseDiffStatSummary(output: string): DiffStatSummary {
  const match = output.match(/(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/);
  if (!match) return { changes: 0, insertions: 0, deletions: 0 };
  return {
    changes: parseInt(match[1]!, 10) || 0,
    insertions: match[2] ? parseInt(match[2], 10) || 0 : 0,
    deletions: match[3] ? parseInt(match[3], 10) || 0 : 0,
  };
}

/** Count of `Auto-merging <file>` lines git prints during a merge. */
export function countAutoMerges(output: string): number {
  return output.split('\n').filter((l) => l.startsWith('Auto-merging ')).length;
}

const CONFLICT_CODES = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

/**
 * Parses NUL-separated `git status --porcelain -z` output into per-file entries
 * (index/working-dir status chars) plus the conflicted-path list. Renamed and
 * copied entries consume the following NUL-separated old-path token. The
 * conflicted set is git's both-modified/unmerged XY codes.
 */
export function parseStatusZ(output: string): PorcelainStatus {
  const files: StatusFile[] = [];
  const conflicted: string[] = [];
  const tokens = output.split('\0');
  for (let i = 0; i < tokens.length; i++) {
    const entry = tokens[i];
    if (!entry) continue;
    const index = entry[0] ?? ' ';
    const working = entry[1] ?? ' ';
    const path = entry.slice(3);
    const code = `${index}${working}`;
    // Renamed/copied entries carry the source path in the next NUL token.
    if (index === 'R' || index === 'C') i++;
    if (code === '!!') continue;
    files.push({ path, index, working_dir: working });
    if (CONFLICT_CODES.has(code)) conflicted.push(path);
  }
  return { conflicted, files };
}
