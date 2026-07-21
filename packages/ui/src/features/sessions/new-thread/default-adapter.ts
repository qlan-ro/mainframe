/**
 * resolveDefaultAdapterId — which adapter a brand-new draft starts on.
 *
 * Shared by both entry points into a new thread (useNewThreadAutoConfig for the
 * pill-active path, SessionsNewButton's picker for the "All" view) so a session
 * starts on the same adapter however it was created.
 */
import type { AdapterInfo } from '@qlan-ro/mainframe-types';

/** Last-resort adapter when no default is configured and nothing is installed yet. */
const FALLBACK_ADAPTER_ID = 'claude';

export function resolveDefaultAdapterId(
  defaultAdapterId: string | null | undefined,
  adapters: readonly AdapterInfo[],
): string {
  return defaultAdapterId ?? adapters.find((a) => a.installed)?.id ?? FALLBACK_ADAPTER_ID;
}
