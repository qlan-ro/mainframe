import { writeImageToClipboard } from './write-image';

/** `message` is present only on failure, and only when a reason is worth showing. */
export interface CopyImageOutcome {
  ok: boolean;
  message?: string;
}

/**
 * Copies `src` to the system clipboard. Assumes `canCopyImage(src)` already
 * gated the call (D11) — this module does no host or source-kind checking of
 * its own.
 *
 * Not `async`, and deliberately `.then(...)` rather than `await`:
 * `writeImageToClipboard` must run inside the click's user activation, and an
 * `await` here would end it before the call happens.
 */
export function copyImageToClipboard(src: string): Promise<CopyImageOutcome> {
  try {
    return writeImageToClipboard(src).then(() => ({ ok: true }), onErr);
  } catch (err) {
    return Promise.resolve(onErr(err));
  }
}

function onErr(err: unknown): CopyImageOutcome {
  console.warn('[copy-image] copy failed', err);
  const message = err instanceof Error && err.message ? err.message : 'The clipboard refused the image.';
  return { ok: false, message };
}
