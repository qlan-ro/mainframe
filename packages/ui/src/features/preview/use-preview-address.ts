import { useCallback, useEffect, useState } from 'react';
import type { PreviewHandle } from '@qlan-ro/mainframe-types';
import { normalizePreviewUrl } from './normalize-url';

/**
 * Address-bar state for the preview tab.
 *
 * - Seeds `currentUrl` to `http://localhost:{port}` and re-seeds on port change
 *   / server (re)start — the typed URL is intentionally NOT persisted.
 * - Reflects in-webview navigation via `handle.onNavigate` (two-way).
 * - `navigateTo` normalizes input, navigates the webview, and optimistically
 *   sets `currentUrl`. Returns false for invalid input (caller shows an error).
 */
export function usePreviewAddress(
  handle: PreviewHandle | null,
  port: number | null,
): { currentUrl: string; navigateTo: (input: string) => boolean } {
  const [currentUrl, setCurrentUrl] = useState('');

  useEffect(() => {
    if (port !== null) setCurrentUrl(`http://localhost:${port}`);
  }, [port]);

  useEffect(() => {
    if (!handle) return;
    return handle.onNavigate((url) => setCurrentUrl(url));
  }, [handle]);

  const navigateTo = useCallback(
    (input: string): boolean => {
      const normalized = normalizePreviewUrl(input);
      if (!normalized || !handle) return false;
      setCurrentUrl(normalized);
      handle.navigate(normalized).catch((e: unknown) => console.warn('[preview] address navigate', e));
      return true;
    },
    [handle],
  );

  return { currentUrl, navigateTo };
}
