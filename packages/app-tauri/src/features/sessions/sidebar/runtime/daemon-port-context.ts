/**
 * Re-export of useDaemonPort for sidebar components.
 *
 * This indirection allows test mocks in sidebar/__tests__/ to intercept the
 * import via a relative path (`../runtime/daemon-port-context`) without
 * needing to know the full path to the runtime layer.
 */
export { useDaemonPort } from '../../runtime/daemon-port-context';
