import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useDirectoryPicker } from '../use-directory-picker';

// NOTE: resetting only store `pending` does NOT clear the module-scoped `resolver`
// (same shape as archive-confirm-bridge). A leftover resolver from a prior test
// would let the "second request cancels first" test cross-settle. Mirror
// archive-confirm-bridge's teardown: settle any in-flight request to null so the
// module-scoped resolver is cleared between tests.
beforeEach(() => {
  useDirectoryPicker.setState({ pending: null });
});
afterEach(() => {
  useDirectoryPicker.getState().resolve(null);
  useDirectoryPicker.setState({ pending: null });
});

describe('useDirectoryPicker', () => {
  it('request() returns a pending promise that resolve() settles', async () => {
    const p = useDirectoryPicker.getState().pickDirectory({ mode: 'directory' });
    expect(useDirectoryPicker.getState().pending).not.toBeNull();
    useDirectoryPicker.getState().resolve('/Users/me/proj');
    await expect(p).resolves.toBe('/Users/me/proj');
    expect(useDirectoryPicker.getState().pending).toBeNull();
  });

  it('resolve(null) yields null (cancel)', async () => {
    const p = useDirectoryPicker.getState().pickDirectory({});
    useDirectoryPicker.getState().resolve(null);
    await expect(p).resolves.toBeNull();
  });

  it('a second request cancels the first with null', async () => {
    const p1 = useDirectoryPicker.getState().pickDirectory({});
    const p2 = useDirectoryPicker.getState().pickDirectory({});
    await expect(p1).resolves.toBeNull();
    useDirectoryPicker.getState().resolve('/x');
    await expect(p2).resolves.toBe('/x');
  });
});
