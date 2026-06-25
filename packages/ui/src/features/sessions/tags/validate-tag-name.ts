/**
 * Client-side tag name validation mirroring the server validate-tag-name.ts.
 *
 * Server lowercases names so uppercase is NOT a 400 — we lowercase before
 * sending. The real 400s are: the reserved 'mf:' prefix, length < 2 or > 24,
 * or a disallowed charset (anything outside [a-z0-9-]).
 */
export type TagNameError = 'too-short' | 'too-long' | 'reserved-prefix' | 'invalid-chars';

export function validateTagName(raw: string): TagNameError | null {
  const name = raw.trim().toLowerCase();
  if (name.startsWith('mf:')) return 'reserved-prefix';
  if (name.length < 2) return 'too-short';
  if (name.length > 24) return 'too-long';
  if (!/^[a-z0-9-]+$/.test(name)) return 'invalid-chars';
  return null;
}

export function tagNameErrorMessage(err: TagNameError): string {
  switch (err) {
    case 'too-short':
      return 'Tag name must be at least 2 characters';
    case 'too-long':
      return 'Tag name must be 24 characters or fewer';
    case 'reserved-prefix':
      return 'Tag names may not use the mf: prefix';
    case 'invalid-chars':
      return 'Only lowercase letters, numbers, and hyphens allowed';
  }
}
