import { getProviderCliStatuses } from '@/lib/api/cli-update';
import { seedProviderCliStatuses } from './cli-update';

let seedGeneration = 0;

/**
 * Seed provider CLI status after a (re)connect or switch, mirroring `seedQuota`. A
 * newer call supersedes an in-flight fetch via the generation guard. Quiet on failure
 * (console.warn only) — offline must never produce a persistent error UI; the Settings
 * pane simply renders no version section until the next successful seed or push.
 */
export function seedProviderCliStatusesFor(port: number): void {
  const gen = ++seedGeneration;
  getProviderCliStatuses(port)
    .then((list) => {
      if (gen === seedGeneration) seedProviderCliStatuses(list);
    })
    .catch((err: unknown) => console.warn('[store/cli-update] seed failed', err));
}
