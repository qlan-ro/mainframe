/**
 * readLiveComposerState — the composer's LIVE state, not the tap-memoized
 * client snapshot.
 *
 * `composer.getState()` only refreshes on the NEXT render, so reading it
 * synchronously in the same tick as a `setText` (native trigger insertion,
 * quote append) returns the PRE-write text. `__internal_getRuntime()` reaches
 * the raw `ComposerRuntimeCore`, whose `getState()` is always current;
 * assistant-ui types it optional (unstable escape hatch) but it is always
 * present for a thread composer, so the client read stays as the fallback.
 */
export interface LiveReadableComposer<TState> {
  getState: () => TState;
  __internal_getRuntime?: () => { getState: () => TState } | undefined;
}

export function readLiveComposerState<TState>(composer: LiveReadableComposer<TState>): TState {
  const runtime = composer.__internal_getRuntime?.();
  return runtime ? runtime.getState() : composer.getState();
}
