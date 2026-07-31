import { useCallback, useEffect, useState } from 'react';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { normalizePreviewUrl } from './normalize-url';

/**
 * Address-bar state for a webview tab.
 *
 * - Seeds `currentUrl` from `seedUrl` and re-seeds when it changes (a preview
 *   tab passes `http://localhost:{port}`, a URL tab its committed address) —
 *   the typed URL is intentionally NOT persisted.
 * - Reflects in-webview navigation via `handle.onNavigate` (two-way).
 * - `navigateTo` normalizes input, navigates the webview, and optimistically
 *   sets `currentUrl`. Returns false for invalid input (caller shows an error).
 */
export function usePreviewAddress(
  handle: PreviewHandle | null,
  seedUrl: string | null,
): { currentUrl: string; navigateTo: (input: string) => boolean } {
  const [currentUrl, setCurrentUrl] = useState('');

  // A null seed leaves the last address up: a stopped process or a torn-down
  // tunnel should not blank the bar the user types their way out of.
  useEffect(() => {
    if (seedUrl !== null) setCurrentUrl(seedUrl);
  }, [seedUrl]);

  useEffect(() => {
    if (!handle) return;
    return handle.onNavigate((url) => setCurrentUrl(url));
  }, [handle]);

  const navigateTo = useCallback(
    (input: string): boolean => {
      const normalized = normalizePreviewUrl(input);
      if (!normalized || !handle) return false;
      // V1: optimistic — currentUrl is set immediately and NOT reverted if
      // handle.navigate rejects (failed load). A two-way onNavigate event or a
      // reload self-heals the bar. Revert-on-failure is a deliberate post-V1 gap.
      setCurrentUrl(normalized);
      handle.navigate(normalized).catch((e: unknown) => console.warn('[preview] address navigate', e));
      return true;
    },
    [handle],
  );

  return { currentUrl, navigateTo };
}
