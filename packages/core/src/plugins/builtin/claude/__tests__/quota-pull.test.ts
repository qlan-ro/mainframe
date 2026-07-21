import { describe, it, expect } from 'vitest';
import { pullClaudeQuota } from '../quota-pull.js';

const NOW = Date.UTC(2026, 6, 18, 6, 0, 0);
const USAGE = 'Current session: 19% used · resets Jul 18 at 10:10am (Europe/Bucharest)';

describe('pullClaudeQuota', () => {
  it('parses the injected /usage output and stamps the resolved account identity', async () => {
    const quota = await pullClaudeQuota({
      runUsage: async () => USAGE,
      readIdentity: async () => 'uuid-123',
      now: NOW,
    });
    expect(quota.status).toBe('ok');
    expect(quota.session?.usedPercent).toBe(19);
    expect(quota.accountIdentity).toBe('uuid-123');
    expect(quota.observedAt).toBe(NOW);
  });

  it('stamps the identity even when the provider parses to unknown', async () => {
    const quota = await pullClaudeQuota({
      runUsage: async () => 'garbage line',
      readIdentity: async () => 'unknown',
      now: NOW,
    });
    expect(quota.status).toBe('unknown');
    expect(quota.accountIdentity).toBe('unknown');
  });
});
