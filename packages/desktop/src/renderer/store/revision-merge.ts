/** Only-if-newer guard for monotonic-revision fields. Shaped for reuse by other revisioned stores. */
export function applyIfNewer(current: number | undefined, incoming: number | undefined): boolean {
  if (incoming === undefined) return false;
  return current === undefined || incoming > current;
}
