import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Runs a git command and returns stdout.
 *
 * `timeout` defaults to 30s, which suits the fast read/parse commands most
 * callers issue. Pass `timeout: 0` for genuinely long-running operations
 * (e.g. `worktree add`, which may clone/checkout and run hooks) so they are
 * not capped — `execFile` treats 0 as no timeout.
 */
export async function execGit(args: string[], cwd: string, opts?: { timeout?: number }): Promise<string> {
  await access(cwd).catch(() => {
    throw Object.assign(new Error(`Directory not accessible: ${cwd}`), { code: 128 });
  });
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf-8',
    timeout: opts?.timeout ?? 30_000,
  });
  return stdout;
}
