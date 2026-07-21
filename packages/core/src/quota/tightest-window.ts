import type { ProviderQuota, QuotaWindow } from '@qlan-ro/mainframe-types';
import { collectQuotaWindows, isWindowTrusted } from './window-lifecycle.js';

/** The single number that will actually stop the user: max usedPercent among trusted windows. */
export function selectTightestWindow(quota: ProviderQuota, now: number): QuotaWindow | undefined {
  const trusted = collectQuotaWindows(quota).filter((window) => isWindowTrusted(window, quota.observedAt, now));
  if (trusted.length === 0) return undefined;
  return trusted.reduce((tightest, window) => (window.usedPercent > tightest.usedPercent ? window : tightest));
}
