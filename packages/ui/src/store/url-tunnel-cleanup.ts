/**
 * store/url-tunnel-cleanup.ts
 *
 * Release a set of URL tabs' tunnel-ownership claims, stopping any port whose
 * last owner just left.
 *
 * This module imports ONLY the url-tab feature — never a store — so layout.ts
 * can import it without creating a layout ↔ subscriber import cycle (mirrors
 * `store/terminal-cleanup.ts`).
 */
import { releaseUrlTunnelConsumers } from '@/features/url-tab/tunnel-consumers';

export function releaseUrlTunnels(tabIds: string[]): void {
  releaseUrlTunnelConsumers(tabIds);
}
