import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createChildLogger } from '../../../logger.js';

const log = createChildLogger('claude:trust');

/** Keyless/unidentifiable account → a fixed synthetic bucket (carries no quota). */
export const CLAUDE_IDENTITY_UNKNOWN = 'unknown';
/** A transient read failure (lock, torn write) → the engine reuses the last-known identity. */
export const CLAUDE_IDENTITY_TRANSIENT = 'transient:identity-read-failed';

/**
 * Resolve the logged-in Claude account identity from ~/.claude.json (plaintext,
 * no keychain, no OAuth token). Returns the `oauthAccount.accountUuid`, falling
 * back to `emailAddress`. A missing file or a config with no `oauthAccount` yields
 * `CLAUDE_IDENTITY_UNKNOWN` (degrade safe); a read/parse failure yields
 * `CLAUDE_IDENTITY_TRANSIENT` so a momentary file lock never flips a healthy
 * gauge to the wrong account.
 */
export async function readClaudeAccountIdentity(
  claudeJsonPath: string = join(homedir(), '.claude.json'),
): Promise<string> {
  let raw: string;
  try {
    raw = await readFile(claudeJsonPath, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      log.info({ claudeJsonPath }, 'claude.json missing; account identity unknown');
      return CLAUDE_IDENTITY_UNKNOWN;
    }
    log.warn({ err, claudeJsonPath }, 'claude.json unreadable; identity transient');
    return CLAUDE_IDENTITY_TRANSIENT;
  }

  let account: { accountUuid?: unknown; emailAddress?: unknown } | undefined;
  try {
    account = (JSON.parse(raw) as { oauthAccount?: typeof account }).oauthAccount;
  } catch {
    log.warn({ claudeJsonPath }, 'claude.json malformed; identity transient');
    return CLAUDE_IDENTITY_TRANSIENT;
  }

  if (account && typeof account.accountUuid === 'string' && account.accountUuid) return account.accountUuid;
  if (account && typeof account.emailAddress === 'string' && account.emailAddress) return account.emailAddress;
  log.info({ claudeJsonPath }, 'claude.json has no oauthAccount identity; unknown');
  return CLAUDE_IDENTITY_UNKNOWN;
}

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

  // Unique per call (not just per process) so two concurrent trust writes
  // never share a tmp file and clobber or steal each other's rename.
  const tmp = `${claudeJsonPath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(tmp, JSON.stringify(config, null, 2));
    await rename(tmp, claudeJsonPath);
    log.info({ projectPath }, 'workspace trusted');
  } finally {
    // No-op once the rename above has succeeded; only cleans up an orphan
    // left behind when writeFile/rename throws partway through.
    await rm(tmp, { force: true });
  }
}
