/**
 * Whether the daemon shares the app's local filesystem.
 *
 * Today the app always connects to a daemon on 127.0.0.1 (see `ws-client` /
 * `lsp-client`, which hardcode the loopback host), so this is always `true`.
 *
 * This is the single gate for local-only affordances — actions that operate on
 * the *app's* machine rather than through the daemon (e.g. "Reveal in Finder",
 * which opens the OS file manager locally). When the remote-daemon work lets the
 * app point at a daemon on another host, this becomes dynamic (derived from the
 * daemon's address) and those affordances switch off automatically.
 */
export function useDaemonIsLocal(): boolean {
  return true;
}
