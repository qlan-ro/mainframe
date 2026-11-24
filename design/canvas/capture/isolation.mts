// Where a capture run lives, and what its daemon may see of the machine: nothing.
import { mkdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Everything a run writes besides the boards. Ignored by git and cleared at the start of a run. */
export const WORK_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '.work');

/** A group's launch options with a data dir of its own and an empty HOME, which also clears the environment. */
export function isolated<T extends object>(
  launch: T | undefined,
  group: number,
  workDir = WORK_DIR,
): T & { dataDir: string; home: string } {
  const dataDir = path.join(workDir, `data-${group}`);
  const home = path.join(workDir, 'home');
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(home, { recursive: true });
  return { ...(launch as T), dataDir, home: realpathSync(home) };
}
