import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** An execFile rejection, carrying the captured streams git wrote before exiting. */
export interface GitExecError extends Error {
  code?: number | string;
  stdout?: string;
  stderr?: string;
}

/**
 * Runs a git command in `cwd` and returns stdout.
 *
 * Mirrors `server/routes/exec-git.ts`: array args (no shell), a 30s default
 * timeout suited to the fast read/parse commands most callers issue, and
 * `timeout: 0` for genuinely long-running operations (`execFile` treats 0 as
 * no timeout). On a non-zero exit the rejection carries `stdout`/`stderr`/`code`
 * so callers can classify failures (merge conflicts, rejected pushes).
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
