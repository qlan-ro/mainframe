type Release = () => void;

const locks = new Map<string, Promise<void>>();

/**
 * Acquire a mutex for a project path. Returns a release function.
 * Concurrent callers on the same path wait in FIFO order.
 */
export function acquireProjectLock(projectPath: string): Promise<Release> {
  const prev = locks.get(projectPath) ?? Promise.resolve();
  let release!: Release;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  locks.set(
    projectPath,
    prev.then(() => next),
  );
  return prev.then(() => release);
}
