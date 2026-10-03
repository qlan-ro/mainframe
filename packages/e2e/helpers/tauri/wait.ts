import type { Page } from '@playwright/test';
import { composer } from './page-objects.js';

/** Submit a message through the composer. */
export async function sendMessage(page: Page, text: string): Promise<void> {
  await composer(page).submit(text);
}

/**
 * Wait until the app shows a connected daemon.
 *
 * The old `app-status-bar` ("Daemon Connected" text) was retired (~2026-06-23) — connection
 * status now lives in the sidebar footer's daemon trigger (`DaemonFooterStatus.tsx`), whose
 * `ConnDot` renders `aria-label="Connected"` once `useConnectionStatus().state === 'connected'`.
 */
export async function waitConnected(page: Page, timeout = 20_000): Promise<void> {
  await page.locator('[data-testid="daemon-footer-trigger"]').locator('[aria-label="Connected"]').waitFor({ timeout });
}

/**
 * Wait until the assistant is idle — the running indicator appeared for this turn and has
 * now gone again.
 *
 * This used to also wait for the previous assistant message's `.aui-md[data-status="running"]`
 * to detach, a fallback that relied on the markdown container carrying a `running` status for
 * the length of a new turn. #754 (todo #382/#376) retired that: with `authoritativeItemStreaming`
 * advertised, `projectServerMessages` marks every assistant message complete as soon as it
 * lands, and the mock adapter replays whole messages with no partials, so that selector never
 * matches at all anymore — the fallback became a permanent no-op.
 *
 * A bare "wait for `chat-thread-running` to be hidden" has the same race: right after
 * `sendMessage`, the indicator may not have mounted yet, so "hidden" is trivially already true
 * and the wait returns before the turn even reaches the daemon. Waiting for the indicator to
 * become visible first turns this into a real turn boundary — appeared (a run is in flight),
 * then gone (it ended) — in both Verbose and Compact, under every adapter the mock suite
 * exercises.
 */
export async function waitForIdle(page: Page, timeout = 60_000): Promise<void> {
  const running = page.locator('[data-testid="chat-thread-running"]');
  // Bounded well below `timeout`: a turn that never starts should fail on the
  // `hidden` wait below with a clear timeout, not silently pass here and then
  // trivially pass `hidden` too because the indicator never showed up.
  await running.waitFor({ state: 'visible', timeout: Math.min(timeout, 5_000) }).catch(() => {});
  await running.waitFor({ state: 'hidden', timeout });
}
