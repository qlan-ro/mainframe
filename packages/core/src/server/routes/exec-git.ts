import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function execGit(args: string[], cwd: string): Promise<string> {
  await access(cwd).catch(() => {
    throw Object.assign(new Error(`Directory not accessible: ${cwd}`), { code: 128 });
  });
  const { stdout } = await execFileAsync('git', args, { cwd, encoding: 'utf-8', timeout: 30_000 });
  return stdout;
}
