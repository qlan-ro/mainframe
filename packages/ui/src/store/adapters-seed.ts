import { getAdapters } from '@/lib/api/adapters';
import { seedAdapters, resetRevisionBaseline } from './adapters';

let seedGeneration = 0;

/** Invalidate any in-flight seed fetch — call on a daemon SWITCH so a slow fetch from the old
 *  target cannot repopulate after the switch (blocker #4). resetAdapters alone does not do this. */
export function invalidateSeedFetches(): void {
  seedGeneration++;
}

/**
 * Seed the catalog for a daemon after a (re)connect or switch. Drops the revision baseline
 * (keeps last-known models visible — no blank flash, blocker #8) so the fresh snapshot applies
 * even at a tied revision (restarted daemon). A newer call supersedes an older in-flight fetch
 * via the generation guard.
 * ONLY call this on connection-identity changes (reconnect, switch, first port). For a
 * same-connection refetch, use `refreshAdapters` — dropping the baseline mid-connection would
 * let a stale WS event pass the only-if-newer guard during the fetch window.
 */
export function seedAdaptersFor(port: number): void {
  const gen = ++seedGeneration;
  resetRevisionBaseline();
  getAdapters(port)
    .then((list) => {
      if (gen === seedGeneration) seedAdapters(list);
    })
    .catch((err: unknown) => console.warn('[store/adapters] seed failed', err));
}

/**
 * Baseline-PRESERVING refetch on the same connection (e.g. Settings-open resilience refetch).
 * The snapshot lands through the normal only-if-newer path; revisions stay authoritative.
 */
export function refreshAdapters(port: number): void {
  const gen = ++seedGeneration;
  getAdapters(port)
    .then((list) => {
      if (gen === seedGeneration) seedAdapters(list);
    })
    .catch((err: unknown) => console.warn('[store/adapters] refresh failed', err));
}
