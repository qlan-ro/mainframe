import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { FakeHostBridge } from '@/lib/host/fake-adapter';
import { setHostForTesting, resetHostForTesting } from '@/lib/host';

const createSessionSpy = vi.fn();
vi.mock('@/features/terminal/create-terminal', () => ({
  createTerminalSession: (...a: unknown[]) => createSessionSpy(...a),
}));

// The orphan-cleanup path disposes the cache entry (which kills the PTY).
const disposeSpy = vi.fn();
vi.mock('@/features/terminal/terminal-cache', () => ({
  disposeCachedTerminal: (...a: unknown[]) => disposeSpy(...a),
}));

import { emitSurfaceIntent } from '../surface-intents';
import { useActiveBasesStore } from '../active-bases-store';
import { useLayoutStore } from '../layout';
import { subscribeToTerminalIntents } from '../terminal-intent-subscriber';

describe('subscribeToTerminalIntents', () => {
  let unsub: () => void;

  beforeEach(() => {
    vi.clearAllMocks();
    createSessionSpy.mockResolvedValue({ id: 'term-1', title: 'Terminal' });
    setHostForTesting(new FakeHostBridge({ app: { getHomedir: '/Users/me' } }));
    useActiveBasesStore.setState({ bases: {}, scopeKey: null });
    useLayoutStore.setState({
      layout: { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } },
      run: null,
      sessions: new Map(),
      activeSessionId: null,
    });
    unsub = subscribeToTerminalIntents();
  });

  afterEach(() => {
    unsub();
    resetHostForTesting();
  });

  it('resolves cwd to homedir when no project is active and adds a terminal RunTab', async () => {
    const addSpy = vi.spyOn(useLayoutStore.getState(), 'addRunTab').mockReturnValue(true);
    emitSurfaceIntent({ type: 'new-terminal' });
    await vi.waitFor(() => expect(createSessionSpy).toHaveBeenCalled());
    expect(createSessionSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/Users/me' }));
    await vi.waitFor(() => expect(addSpy).toHaveBeenCalled());
    expect(addSpy).toHaveBeenCalledWith({ id: 'term-1', kind: 'terminal', title: 'Terminal' }, undefined);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('uses worktreePath as cwd when active, stamps scopeKey, and passes paneId through', async () => {
    useActiveBasesStore.setState({ bases: { worktreePath: '/wt', projectPath: '/proj' }, scopeKey: 'proj-1:/wt' });
    const addSpy = vi.spyOn(useLayoutStore.getState(), 'addRunTab').mockReturnValue(true);
    emitSurfaceIntent({ type: 'new-terminal', paneId: 'pane-x' });
    await vi.waitFor(() => expect(createSessionSpy).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/wt' })));
    await vi.waitFor(() =>
      expect(addSpy).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'terminal', scopeKey: 'proj-1:/wt' }),
        'pane-x',
      ),
    );
  });

  // M6: the target pane was closed during the async createTerminalSession gap,
  // so addRunTab returns false. The subscriber must dispose the just-created
  // terminal (kills the PTY) rather than stranding it.
  it('disposes the orphaned terminal when the target pane vanished during create', async () => {
    vi.spyOn(useLayoutStore.getState(), 'addRunTab').mockReturnValue(false);
    emitSurfaceIntent({ type: 'new-terminal', paneId: 'pane-gone' });
    await vi.waitFor(() => expect(createSessionSpy).toHaveBeenCalled());
    await vi.waitFor(() => expect(disposeSpy).toHaveBeenCalledWith('term-1'));
  });

  it('ignores non-terminal intents', () => {
    emitSurfaceIntent({ type: 'open-file-picker' });
    expect(createSessionSpy).not.toHaveBeenCalled();
  });
});
