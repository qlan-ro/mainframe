/**
 * Masks the parts of a captured DaemonEvent stream that are legitimately nondeterministic
 * (minted ids, timestamps, absolute paths) while leaving frame shape — event `type`s, key
 * sets, array lengths, content text — untouched. Used by the legacy-freeze baseline (todo
 * #350 task 24 / plan decision 5): a diff against the masked baseline is a shape+
 * deterministic-field check, not a byte-for-byte id pin (plan decision 5 rules that out).
 */

const ID_KEY = /(^id$|Id$|uuid|Uuid)/;
const TIME_KEY = /(timestamp|Timestamp|createdAt|updatedAt|startedAt|endedAt|At$|Duration)/;

function maskValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskValue);
  if (value !== null && typeof value === 'object') return maskObject(value as Record<string, unknown>);
  if (typeof value === 'string') return maskPath(value);
  return value;
}

/** Absolute paths bake the e2e temp project dir (`mf-e2e-<random>`), same convention as the
 *  `{{PROJECT_PATH}}` remap used for recordings elsewhere in this package. */
function maskPath(value: string): string {
  return value.replace(/\/[^\s"]*\/mf-e2e-[A-Za-z0-9]+(\/[^\s"]*)?/g, '{{PROJECT_PATH}}');
}

function maskObject(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (ID_KEY.test(key) && typeof value === 'string') {
      out[key] = 'ID';
    } else if (TIME_KEY.test(key) && (typeof value === 'string' || typeof value === 'number')) {
      out[key] = 'TIME';
    } else {
      out[key] = maskValue(value);
    }
  }
  return out;
}

export function normalizeFrames(frames: unknown[]): unknown[] {
  return frames.map(maskValue);
}
