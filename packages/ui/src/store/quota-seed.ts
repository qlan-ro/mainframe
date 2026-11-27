import { getQuota } from '@/lib/api/quota';
import { QUOTA_PROVIDERS } from '@/features/quota/quota-format';
import { applyProviderQuota, markQuotaSeeded } from './quota';

let seedGeneration = 0;

/** A provider that has not answered by now is unknown; the seed settles without it. */
export const QUOTA_SEED_TIMEOUT_MS = 5000;

/**
 * Seed quota for both quota-capable providers after a (re)connect or switch. A
 * newer call supersedes an in-flight fetch via the generation guard; a provider
 * with no known quota simply stays absent (the card renders its designed
 * "quota unknown" row). Applied through the only-if-newer path so a live WS
 * push that lands mid-fetch is never overwritten by a staler REST snapshot.
 */
export function seedQuota(port: number): void {
  const gen = ++seedGeneration;
  const answers = QUOTA_PROVIDERS.map(({ id }) =>
    getQuota(id, port)
      .then((quota) => {
        if (gen === seedGeneration && quota) applyProviderQuota(id, quota);
      })
      .catch((err: unknown) => console.warn(`[store/quota] seed failed for ${id}`, err)),
  );
  // Seeded once every provider has answered, whatever the answer: only then does an empty
  // store mean "unknown" rather than "not asked yet".
  // A request that hangs must not leave the capsule empty for good: the seed also settles on a timeout.
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, QUOTA_SEED_TIMEOUT_MS));
  void Promise.race([Promise.all(answers), timeout]).then(() => {
    if (gen === seedGeneration) markQuotaSeeded();
  });
}
