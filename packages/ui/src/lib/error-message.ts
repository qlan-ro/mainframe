/** A rejection in words. JSON-RPC calls reject with a plain `{ code, message }`, not an Error. */
export function errorMessage(error: unknown): string {
  const message = typeof error === 'string' ? error : (error as { message?: unknown } | null | undefined)?.message;
  return typeof message === 'string' && message ? message : 'Unknown error';
}
