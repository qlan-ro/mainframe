/**
 * saveIssuesFrom — a rejected save, in the editor's own vocabulary.
 *
 * The daemon validates the definition again on write and answers 400 with a
 * per-step `errors[]` (`engine_error`). Those steps are on screen, so the
 * verdict belongs on them: mapped to `ValidationIssue[]`, a daemon rejection
 * renders through the same red strips and footer as `validate()`'s own output.
 *
 * A rejection with no `errors[]` (network, 500, an unreachable daemon) is not
 * a verdict on the draft and yields nothing — the toast reports it. Turning it
 * into an issue would gate Save on a draft the daemon never judged, leaving
 * the user to edit something arbitrary just to get a retry.
 */
import { ApiRequestError } from '@/lib/api/http';
import type { ValidationIssue } from '../domain/validate';

export function saveIssuesFrom(err: unknown): ValidationIssue[] {
  if (!(err instanceof ApiRequestError)) return [];
  return err.details.map((detail) => ({ stepId: detail.stepId, level: 'error', msg: detail.message }));
}
