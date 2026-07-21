import type { ProviderQuota } from '@qlan-ro/mainframe-types';
import { collectQuotaWindows, isWindowTrusted } from './window-lifecycle.js';

/** Fail-closed (#251): any single untrusted window is fine, but zero trusted windows fails the whole provider. */
export function deriveProviderStatus(quota: ProviderQuota, now: number): 'ok' | 'unknown' {
  const hasTrustedWindow = collectQuotaWindows(quota).some((window) =>
    isWindowTrusted(window, quota.observedAt, now),
  );
  return hasTrustedWindow ? 'ok' : 'unknown';
}
