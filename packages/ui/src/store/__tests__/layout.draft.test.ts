/**
 * layout.draft.test.ts — dropSession / adoptSession (todo #354): the layout
 * store's per-draft handling, so a New session never inherits or leaks a
 * previous session's arrangement.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const killDisposeSpy = vi.fn();
const releaseUrlSpy = vi.fn();
vi.mock('../terminal-cleanup', () => ({ killAndDisposeCachedTerminals: (ids: string[]) => killDisposeSpy(ids) }));
vi.mock('../url-tunnel-cleanup', () => ({ releaseUrlTunnels: (ids: string[]) => releaseUrlSpy(ids) }));

import { useLayoutStore, type WorkspaceLayout } from '../layout';

const FRESH: WorkspaceLayout = { top: ['chat'], bottom: null, topFlex: {}, vFlex: { top: 1, bottom: 0.4 } };

function resetStores() {
  useLayoutStore.setState({ layout: { ...FRESH }, run: null, sessions: new Map(), activeSessionId: null });
  killDisposeSpy.mockClear();
  releaseUrlSpy.mockClear();
}

describe('layout store — dropSession', () => {
  beforeEach(resetStores);

  it('removes the entry and re-seeds a chat-only arrangement in place when it was the active session', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('__LOCALID_1');
    s.toggleSurface('workspace');
    expect(useLayoutStore.getState().layout.top).toContain('workspace');

    s.dropSession('__LOCALID_1');

    expect(useLayoutStore.getState().sessions.has('__LOCALID_1')).toBe(false);
    expect(useLayoutStore.getState().layout).toEqual(FRESH);
    expect(useLayoutStore.getState().run).toBeNull();
  });

  it('removes a non-active entry without disturbing the on-screen (different) session', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('__LOCALID_1');
    s.toggleSurface('workspace');
    s.setActiveSession('chat-a'); // chat-a is now active, chat-only

    s.dropSession('__LOCALID_1');

    expect(useLayoutStore.getState().sessions.has('__LOCALID_1')).toBe(false);
    expect(useLayoutStore.getState().activeSessionId).toBe('chat-a');
    expect(useLayoutStore.getState().layout.top).not.toContain('workspace');
  });

  it("disposes the dropped entry's terminals and URL tunnels (kill-before-remove)", () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('__LOCALID_1');
    s.addRunTab({ id: 't1', kind: 'terminal', title: 'sh' });
    s.addRunTab({ id: 'u1', kind: 'url', title: 'x', url: 'http://x/' });

    s.dropSession('__LOCALID_1');

    expect(killDisposeSpy).toHaveBeenCalledWith(['t1']);
    expect(releaseUrlSpy).toHaveBeenCalledWith(['u1']);
  });

  it('is a no-op for an id with no entry', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('chat-a');

    expect(() => s.dropSession('__LOCALID_ghost')).not.toThrow();
    expect(useLayoutStore.getState().activeSessionId).toBe('chat-a');
    expect(killDisposeSpy).not.toHaveBeenCalled();
  });
});

describe('layout store — adoptSession', () => {
  beforeEach(resetStores);

  it('moves the entry (layout + run) to the new key without disposing, and repoints activeSessionId', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('__LOCALID_1');
    s.toggleSurface('workspace');
    s.addRunTab({ id: 't1', kind: 'terminal', title: 'sh' });

    s.adoptSession('__LOCALID_1', 'chat-new');

    expect(killDisposeSpy).not.toHaveBeenCalled();
    expect(releaseUrlSpy).not.toHaveBeenCalled();
    expect(useLayoutStore.getState().sessions.has('__LOCALID_1')).toBe(false);
    const adopted = useLayoutStore.getState().sessions.get('chat-new');
    expect(adopted?.layout.top).toContain('workspace');
    expect(adopted?.run?.panes[0]?.tabs.map((t) => t.id)).toEqual(['t1']);
    expect(useLayoutStore.getState().activeSessionId).toBe('chat-new');
  });

  it('does not repoint activeSessionId when the moved session was not active', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('__LOCALID_1');
    s.toggleSurface('workspace');
    s.setActiveSession('chat-a'); // chat-a active now, __LOCALID_1 sits in the background

    s.adoptSession('__LOCALID_1', 'chat-new');

    expect(useLayoutStore.getState().activeSessionId).toBe('chat-a');
    expect(useLayoutStore.getState().sessions.get('chat-new')?.layout.top).toContain('workspace');
  });

  it('a second (re-entrant) call after the source is already gone is a no-op that leaves the adopted entry intact', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('__LOCALID_1');
    s.toggleSurface('workspace');
    s.adoptSession('__LOCALID_1', 'chat-new');

    s.adoptSession('__LOCALID_1', 'chat-new');

    expect(useLayoutStore.getState().sessions.get('chat-new')?.layout.top).toContain('workspace');
    expect(useLayoutStore.getState().activeSessionId).toBe('chat-new');
  });

  it('from an unknown id neither overwrites nor clears an existing destination entry', () => {
    const s = useLayoutStore.getState();
    s.setActiveSession('chat-existing');
    s.toggleSurface('workspace');
    s.setActiveSession('chat-other'); // move away; chat-existing's entry persists with the workspace

    s.adoptSession('__LOCALID_ghost', 'chat-existing');

    expect(useLayoutStore.getState().sessions.get('chat-existing')?.layout.top).toContain('workspace');
    expect(useLayoutStore.getState().activeSessionId).toBe('chat-other');
  });
});
