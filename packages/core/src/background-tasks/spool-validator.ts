import path from 'node:path';
import os from 'node:os';
import { realpath as fsRealpath } from 'node:fs/promises';

export interface SpoolValidatorDeps {
  platform: NodeJS.Platform;
  getuid: (() => number) | undefined;
  env: NodeJS.ProcessEnv;
  realpath?: (p: string) => Promise<string>;
  tmpdir?: () => string;
}

export type SpoolValidator = (outputPath: string, taskId: string) => Promise<boolean>;

export function makeSpoolValidator(deps: SpoolValidatorDeps): SpoolValidator {
  const realpath = deps.realpath ?? fsRealpath;
  const tmpdir = deps.tmpdir ?? os.tmpdir;
  // Use the platform-specific path parser, NOT the host's. Host node:path on
  // POSIX cannot parse 'C:\\…' (basename/split would return the whole string).
  // We always parse against the simulated platform.
  const pathImpl = deps.platform === 'win32' ? path.win32 : path.posix;

  return async (outputPath, taskId) => {
    if (pathImpl.basename(outputPath) !== `${taskId}.output`) return false;

    const baseTmpDir = deps.env['CLAUDE_CODE_TMPDIR'] ?? (deps.platform === 'win32' ? tmpdir() : '/tmp');
    const tempDirName = deps.platform === 'win32' ? 'claude' : `claude-${deps.getuid?.() ?? 0}`;

    let resolvedBase: string;
    let resolvedOutput: string;
    try {
      resolvedBase = await realpath(baseTmpDir);
      resolvedOutput = await realpath(outputPath);
    } catch {
      // realpath failure (ENOENT, EACCES) = path does not exist or is not readable.
      return false;
    }

    const root = pathImpl.join(resolvedBase, tempDirName);
    const startsOk = resolvedOutput === root || resolvedOutput.startsWith(root + pathImpl.sep);
    const segments = resolvedOutput.split(pathImpl.sep);
    return startsOk && segments.includes('tasks');
  };
}
