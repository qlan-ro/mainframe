/**
 * SessionsNewButton — behavior tests for the "All view" project picker.
 *
 * The `useAssistantRuntime` mock below models the REAL assistant-ui contract
 * (verified against node_modules/@assistant-ui/core RemoteThreadListThreadListRuntimeCore):
 * `newThreadId` is `undefined` until `switchToNewThread()` mints a `__LOCALID_*`
 * slot — it is NOT always present. A mock that hands back a ready-made
 * `__LOCALID_1` regardless of whether switchToNewThread was called cannot catch
 * the regression this file guards against: `pick()` used to read `newThreadId`
 * BEFORE switching, saw `undefined` in the common case (boot auto-selects a real
 * session, so no draft slot pre-exists), and silently no-opped — "New session"
 * then picking a project did nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { Project } from '@qlan-ro/mainframe-types';
import { getDraftConfig, useDraftConfigStore } from '../../runtime/draft-config';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
import { useDraftReturnTarget } from '../../new-thread/use-draft-return-target';
import { useSettingsStore } from '@/store/settings';
import { useAdaptersStore } from '@/store/adapters';

const runtimeState = { newThreadId: undefined as string | undefined, mainThreadId: null as string | null };
let switchCounter = 0;
let initializationGate: Promise<void> | null = null;
const completeSnapshot = (projectId: string, adapterId: string) => ({
  projectId,
  adapterId,
  model: 'default-model',
  permissionMode: 'default' as const,
  planMode: false,
  effort: 'medium' as const,
  fast: false,
  ultracode: false,
  adaptiveThinking: false,
});
const switchToNewThread = vi.fn(async () => {
  switchCounter += 1;
  runtimeState.newThreadId = `__LOCALID_${switchCounter}`;
  // Mirrors the real runtime: switching activates the new local slot.
  runtimeState.mainThreadId = runtimeState.newThreadId;
});

vi.mock('@assistant-ui/react', async () => {
  const actual = await vi.importActual<typeof import('@assistant-ui/react')>('@assistant-ui/react');
  return {
    ...actual,
    useAssistantRuntime: () => ({
      threads: {
        getState: () => ({ newThreadId: runtimeState.newThreadId, mainThreadId: runtimeState.mainThreadId }),
        switchToNewThread,
      },
    }),
  };
});

vi.mock('../../runtime/daemon-port-context', () => ({ useDaemonPort: () => 31415 }));

vi.mock('../../new-thread/initialize-draft', () => ({
  initializeDraft: async (args: { localId: string; projectId: string; defaultAdapterId: string | null }) => {
    if (initializationGate) await initializationGate;
    const adapterId = args.defaultAdapterId ?? 'claude';
    const snapshot = completeSnapshot(args.projectId, adapterId);
    useDraftConfigStore.getState().setDraft(args.localId, snapshot);
    useNewThreadReady.getState().markReady(args.localId);
    return snapshot;
  },
}));

import { useNewSessionPickerTarget } from '../use-new-session-picker-target';
import { SessionsNewButton } from '../SessionsNewButton';

const projects: Project[] = [{ id: 'p1', name: 'Alpha', path: '/a' } as Project];

function renderAllView() {
  return render(
    <SessionsNewButton
      filterProjectId={null}
      filterProjectName={null}
      projects={projects}
      sessionCounts={{ p1: 0 }}
      onAddProject={vi.fn()}
    />,
  );
}

async function pickProjectP1() {
  fireEvent.click(screen.getByTestId('sessions-new-button'));
  await act(async () => {
    fireEvent.click(screen.getByTestId('sessions-new-picker-project-p1'));
  });
}

beforeEach(() => {
  switchToNewThread.mockClear();
  switchCounter = 0;
  initializationGate = null;
  runtimeState.newThreadId = undefined;
  runtimeState.mainThreadId = null;
  useNewSessionPickerTarget.setState({ open: false });
  useDraftConfigStore.setState({ drafts: new Map() });
  useNewThreadReady.setState({ readyIds: new Set() });
  useDraftReturnTarget.setState({ returnThreadId: null });
  useSettingsStore.setState((s) => ({ general: { ...s.general, defaultAdapterId: null } }));
  useAdaptersStore.setState({ byId: {} });
});

describe('SessionsNewButton — All view, clicking the "+" trigger', () => {
  it('opens the picker via the shared store', () => {
    renderAllView();
    fireEvent.click(screen.getByTestId('sessions-new-button'));

    expect(screen.getByTestId('sessions-new-picker')).toBeInTheDocument();
    expect(useNewSessionPickerTarget.getState().open).toBe(true);
  });
});

describe('SessionsNewButton — All view, externally driven open', () => {
  it('opens the anchored popover when useNewSessionPickerTarget.setOpen(true) is called externally', () => {
    renderAllView();
    expect(screen.queryByTestId('sessions-new-picker')).toBeNull();

    act(() => {
      useNewSessionPickerTarget.getState().setOpen(true);
    });

    expect(screen.getByTestId('sessions-new-picker')).toBeInTheDocument();
  });
});

describe('SessionsNewButton — All view, picking a project closes the shared store', () => {
  it('sets the store back to closed after a project pick', () => {
    renderAllView();
    fireEvent.click(screen.getByTestId('sessions-new-button'));
    fireEvent.click(screen.getByTestId('sessions-new-picker-project-p1'));

    expect(useNewSessionPickerTarget.getState().open).toBe(false);
  });
});

describe('SessionsNewButton — All view, picking a project with NO pre-existing draft slot (bug repro)', () => {
  it('mints a new-thread slot via switchToNewThread and seeds its draft config', async () => {
    expect(runtimeState.newThreadId).toBeUndefined();
    renderAllView();

    await pickProjectP1();

    expect(switchToNewThread).toHaveBeenCalledTimes(1);
    expect(getDraftConfig('__LOCALID_1')).toEqual(completeSnapshot('p1', 'claude'));
  });

  it('marks the minted id ready so the composer can render', async () => {
    renderAllView();

    await pickProjectP1();

    expect(useNewThreadReady.getState().isReady('__LOCALID_1')).toBe(true);
  });
});

describe('SessionsNewButton — All view, picking a project uses the configured default adapter', () => {
  it('seeds the draft with the user default adapter instead of always "claude"', async () => {
    useSettingsStore.setState((s) => ({ general: { ...s.general, defaultAdapterId: 'codex' } }));
    renderAllView();

    await pickProjectP1();

    expect(getDraftConfig('__LOCALID_1')).toEqual(completeSnapshot('p1', 'codex'));
  });
});

describe('SessionsNewButton — All view, picking a project remembers the pre-switch session', () => {
  it('snapshots the session active BEFORE switchToNewThread, not the new local slot', async () => {
    runtimeState.mainThreadId = 'chat-existing';
    renderAllView();

    await pickProjectP1();

    // switchToNewThread's mock reassigns mainThreadId to the new local slot;
    // the remembered return target must be the PRE-switch value.
    expect(runtimeState.mainThreadId).toBe('__LOCALID_1');
    expect(useDraftReturnTarget.getState().returnThreadId).toBe('chat-existing');
  });
});

describe('SessionsNewButton — asynchronous initialization', () => {
  it('does not mark the minted id ready before initialization resolves', async () => {
    let release!: () => void;
    initializationGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderAllView();

    void pickProjectP1();
    await act(async () => undefined);
    expect(useNewThreadReady.getState().isReady('__LOCALID_1')).toBe(false);

    release();
    await act(async () => undefined);
    expect(useNewThreadReady.getState().isReady('__LOCALID_1')).toBe(true);
  });
});
