export interface LoadRetryOptions {
  /** Performs one navigation attempt; rejects on a failed/aborted load. */
  load: () => Promise<unknown>;
  /** Maximum number of attempts. */
  attempts: number;
  /** Delay between attempts. */
  delayMs: number;
  /** Aborts the retry loop (effect cleanup / unmount / scope change). */
  isCancelled: () => boolean;
  /** Reports a failed attempt (1-based attempt index). */
  onError: (err: unknown, attempt: number) => void;
  /** Injectable sleep (tests pass a no-op). */
  sleep?: (ms: number) => Promise<void>;
}

export async function loadUrlWithRetry(opts: LoadRetryOptions): Promise<boolean> {
  const { load, attempts, delayMs, isCancelled, onError } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (isCancelled()) return false;
    try {
      await load();
      return true;
    } catch (err) {
      onError(err, attempt);
      if (attempt >= attempts || isCancelled()) return false;
      await sleep(delayMs);
    }
  }
  return false;
}
