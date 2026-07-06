/**
 * Whether the daemon shares the app's local filesystem.
 *
 * Returns `true` when the active daemon target is `kind === 'local'` (loopback),
 * `false` for any remote target. This is the single gate for local-only
 * affordances such as "Reveal in Finder", which opens the OS file manager on
 * the app's own machine.
 */
import { useActiveDaemon } from '@/features/daemon/active-daemon-context';

export function useDaemonIsLocal(): boolean {
  return useActiveDaemon().target.kind === 'local';
}
