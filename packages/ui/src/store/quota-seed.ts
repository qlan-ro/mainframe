import { getQuota } from '@/lib/api/quota';
import { QUOTA_PROVIDERS } from '@/features/quota/quota-format';
import { applyProviderQuota } from './quota';

let seedGeneration = 0;

/**
 * Seed quota for both quota-capable providers after a (re)connect or switch. A
 * newer call supersedes an in-flight fetch via the generation guard; a provider
 * with no known quota simply stays absent (the card renders its designed
 * "quota unknown" row). Applied through the only-if-newer path so a live WS
 * push that lands mid-fetch is never overwritten by a staler REST snapshot.
 */
export function seedQuota(port: number): void {
  const gen = ++seedGeneration;
  for (const { id } of QUOTA_PROVIDERS) {
    getQuota(id, port)
      .then((quota) => {
        if (gen === seedGeneration && quota) applyProviderQuota(id, quota);
      })
      .catch((err: unknown) => console.warn(`[store/quota] seed failed for ${id}`, err));
  }
}
