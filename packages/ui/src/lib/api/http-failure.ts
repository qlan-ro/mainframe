/**
 * Pure mapping from an HTTP status to a human sentence — the single copy of
 * the fallback wording used whenever a REST call's error body carries no
 * usable `error`/`message` field (missing JSON field, or not JSON at all).
 */
export function describeHttpFailure(status: number): string {
  if (status === 401 || status === 403) {
    return `The daemon rejected this request as unauthorized (HTTP ${status}).`;
  }
  if (status === 413) {
    return `The daemon rejected this request as too large (HTTP ${status}).`;
  }
  if (status >= 500) {
    return `The daemon failed to handle this request (HTTP ${status}).`;
  }
  return `The daemon rejected this request (HTTP ${status}).`;
}
