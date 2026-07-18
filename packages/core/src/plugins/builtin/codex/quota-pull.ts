import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import type { Account, GetAccountResult, GetAccountRateLimitsResult } from './types.js';
import { normalizeRateLimitSnapshot } from './quota-rate-limit.js';
import { readCodexAccountIdentity } from './quota-identity.js';
import { spawnTempAppServer } from './app-server-spawn.js';

export interface PullCodexQuotaDeps {
  /** `account/rateLimits/read` over a live (or freshly spawned) app-server connection. */
  runRateLimits: () => Promise<GetAccountRateLimitsResult>;
  /** `account/read` over the same connection. Defaults to the identity reader's own resolution. */
  readAccount: () => Promise<Account | null>;
  now?: number;
}

/**
 * Harvest Codex's plan quota: pull `account/rateLimits/read`, normalize its windows,
 * and stamp the resolved account identity. Rate limits and identity are read
 * concurrently over the same connection — the caller (manual-refresh puller) owns
 * spawning/closing the app-server, never spawning purely to poll.
 */
export async function pullCodexQuota(deps: PullCodexQuotaDeps): Promise<ProviderQuota> {
  const now = deps.now ?? Date.now();
  const [result, accountIdentity] = await Promise.all([
    deps.runRateLimits(),
    readCodexAccountIdentity({ readAccount: deps.readAccount }),
  ]);
  const quota = normalizeRateLimitSnapshot(result.rateLimits, now);
  quota.accountIdentity = accountIdentity;
  return quota;
}

/**
 * Default connection: spawn one temp app-server, issue `account/rateLimits/read` and
 * `account/read` back-to-back, then close it. Used by the manual-refresh puller only —
 * never wired to a scheduler (Codex has no timer-based polling, unlike Claude).
 */
export async function pullCodexQuotaViaTempAppServer(executable: string): Promise<ProviderQuota> {
  const client = await spawnTempAppServer(executable);
  try {
    return await pullCodexQuota({
      runRateLimits: () => client.request<GetAccountRateLimitsResult>('account/rateLimits/read'),
      readAccount: async () => (await client.request<GetAccountResult>('account/read')).account,
    });
  } finally {
    client.close();
  }
}
