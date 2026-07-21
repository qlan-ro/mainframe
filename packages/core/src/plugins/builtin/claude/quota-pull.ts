import { execFile } from 'node:child_process';
import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { parseClaudeUsage } from './quota-parse.js';
import { readClaudeAccountIdentity } from './trust-store.js';

export interface PullClaudeQuotaDeps {
  /** Returns the raw stdout of `claude -p "/usage"`. Injected so tests need no real spawn. */
  runUsage: () => Promise<string>;
  /** Resolves the account identity (uuid/email/sentinel). Defaults to the ~/.claude.json reader. */
  readIdentity?: () => Promise<string>;
  now?: number;
}

/**
 * Harvest Claude's plan quota: pull `/usage`, parse its prose into windows, and
 * stamp the resolved account identity. Identity and usage are read concurrently.
 * The identity is stamped even on an `unknown` parse so the daemon can key the
 * blob (and reuse last-known on a transient identity sentinel).
 */
export async function pullClaudeQuota(deps: PullClaudeQuotaDeps): Promise<ProviderQuota> {
  const now = deps.now ?? Date.now();
  const readIdentity = deps.readIdentity ?? readClaudeAccountIdentity;
  const [text, accountIdentity] = await Promise.all([deps.runUsage(), readIdentity()]);
  const quota = parseClaudeUsage(text, now);
  quota.accountIdentity = accountIdentity;
  return quota;
}

/**
 * Default `runUsage`: a stateless one-shot `claude -p "/usage"` spawn mirroring
 * the title-generator (stdin closed, no session persistence, execFile array args).
 * Zero model tokens, ~1s. The CLI uses its own auth — no credential handling here.
 */
export function spawnClaudeUsage(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cp = execFile(
      binary,
      ['-p', '/usage', '--no-session-persistence', '--output-format', 'text'],
      { encoding: 'utf-8', timeout: 30_000, maxBuffer: 65_536, env: { ...process.env, NO_COLOR: '1' } },
      (error, stdout) => (error ? reject(error) : resolve(stdout as string)),
    );
    cp.stdin?.end();
  });
}
