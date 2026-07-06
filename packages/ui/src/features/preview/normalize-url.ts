/**
 * Normalize raw address-bar input into an absolute, navigable URL.
 *
 * - Trims whitespace.
 * - Adds an `http://` scheme when none is present (dev servers are plain HTTP).
 * - Validates via `URL`; returns `null` when the result can't be parsed so the
 *   caller can show an invalid state instead of navigating to garbage.
 */
export function normalizePreviewUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    /* expected: invalid input — caller shows the invalid state */
    return null;
  }
}
