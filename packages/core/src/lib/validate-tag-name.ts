import { RESERVED_TAG_PREFIX } from '@qlan-ro/mainframe-types';

const PATTERN = /^[a-z0-9-]+$/;
const MIN_LEN = 2;
const MAX_LEN = 24;

export type ValidateResult = { ok: true; normalized: string } | { ok: false; error: string };

export function validateTagName(input: string): ValidateResult {
  const normalized = input.trim().toLowerCase();
  if (normalized.length < MIN_LEN) return { ok: false, error: 'Tag name too short (min 2 chars).' };
  if (normalized.length > MAX_LEN) return { ok: false, error: 'Tag name too long (max 24 chars).' };
  if (normalized.startsWith(RESERVED_TAG_PREFIX)) {
    return { ok: false, error: `Names starting with "${RESERVED_TAG_PREFIX}" are reserved.` };
  }
  if (!PATTERN.test(normalized)) {
    return { ok: false, error: 'Tag name must use lowercase letters, numbers, or hyphens only.' };
  }
  return { ok: true, normalized };
}
