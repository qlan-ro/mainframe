import { readFile, writeFile, rename } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude:trust');

/**
 * Marks a project as trusted in ~/.claude.json (the CLI's per-project trust store),
 * so Claude stops ignoring the project's permissions.allow entries. Read-modify-write
 * with an atomic rename; preserves all other keys. Only a missing file is tolerated —
 * a corrupt/unreadable existing file throws rather than clobbering login/other projects.
 */
export async function writeWorkspaceTrust(
  projectPath: string,
  claudeJsonPath: string = join(homedir(), '.claude.json'),
): Promise<void> {
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(await readFile(claudeJsonPath, 'utf8')) as Record<string, unknown>;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    log.info({ claudeJsonPath }, 'claude.json missing; creating on first trust');
  }
  const projects = (config.projects ?? {}) as Record<string, Record<string, unknown>>;
  projects[projectPath] = { ...(projects[projectPath] ?? {}), hasTrustDialogAccepted: true };
  config.projects = projects;

  const tmp = `${claudeJsonPath}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(config, null, 2));
  await rename(tmp, claudeJsonPath);
  log.info({ projectPath }, 'workspace trusted');
}
