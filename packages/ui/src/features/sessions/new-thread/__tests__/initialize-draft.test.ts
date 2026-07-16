import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdapterInfo, ProviderConfig } from '@qlan-ro/mainframe-types';
import { getDraftConfig, useDraftConfigStore, type DraftCfg } from '../../runtime/draft-config';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';

const getProviderSettings = vi.fn();
vi.mock('@/lib/api/settings', () => ({ getProviderSettings: (...args: unknown[]) => getProviderSettings(...args) }));

const { initializeDraft } = await import('../initialize-draft');

const adapters: AdapterInfo[] = [
  {
    id: 'claude',
    name: 'Claude',
    description: 'Claude Code',
    installed: true,
    models: [{ id: 'sonnet', label: 'Sonnet', isDefault: true, supportedEfforts: ['low', 'medium'] }],
    capabilities: { planMode: true },
  },
];

const expectedCompleteSnapshot: DraftCfg = {
  projectId: 'p1',
  adapterId: 'claude',
  model: 'sonnet',
  permissionMode: 'acceptEdits',
  planMode: true,
  effort: 'low',
  fast: false,
  ultracode: false,
  adaptiveThinking: false,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  getProviderSettings.mockReset();
  useDraftConfigStore.setState({ drafts: new Map() });
  useNewThreadReady.setState({ readyIds: new Set(), initializations: new Map() });
});

describe('initializeDraft', () => {
  it('stores a complete snapshot before marking the local id ready', async () => {
    getProviderSettings.mockResolvedValue({
      claude: { defaultMode: 'acceptEdits', defaultPlanMode: 'true', defaultEffort: 'low' },
    });

    await initializeDraft({
      localId: '__LOCALID_1',
      projectId: 'p1',
      port: 31415,
      defaultAdapterId: null,
      adapters,
    });

    expect(getDraftConfig('__LOCALID_1')).toEqual(expectedCompleteSnapshot);
    expect(useNewThreadReady.getState().isReady('__LOCALID_1')).toBe(true);
    expect(useNewThreadReady.getState().getInitialization('__LOCALID_1').status).toBe('ready');
  });

  it('remains initializing and unready until provider settings resolve', async () => {
    const request = deferred<Record<string, { defaultMode: 'acceptEdits' }>>();
    getProviderSettings.mockReturnValue(request.promise);

    const result = initializeDraft({
      localId: '__LOCALID_1',
      projectId: 'p1',
      port: 31415,
      defaultAdapterId: null,
      adapters,
    });

    expect(useNewThreadReady.getState().getInitialization('__LOCALID_1').status).toBe('initializing');
    expect(useNewThreadReady.getState().isReady('__LOCALID_1')).toBe(false);
    expect(getDraftConfig('__LOCALID_1')).toBeUndefined();

    request.resolve({ claude: { defaultMode: 'acceptEdits' } });
    await result;
    expect(useNewThreadReady.getState().isReady('__LOCALID_1')).toBe(true);
  });

  it('records an error without replacing a prior snapshot or marking ready', async () => {
    const prior = { ...expectedCompleteSnapshot, projectId: 'prior' };
    useDraftConfigStore.getState().setDraft('__LOCALID_1', prior);
    getProviderSettings.mockRejectedValue(new Error('settings unavailable'));

    await expect(
      initializeDraft({
        localId: '__LOCALID_1',
        projectId: 'p1',
        port: 31415,
        defaultAdapterId: null,
        adapters,
      }),
    ).rejects.toThrow('settings unavailable');

    expect(getDraftConfig('__LOCALID_1')).toEqual(prior);
    expect(useNewThreadReady.getState().isReady('__LOCALID_1')).toBe(false);
    expect(useNewThreadReady.getState().getInitialization('__LOCALID_1').status).toBe('error');
  });

  it('transitions an errored retry back to initializing', async () => {
    getProviderSettings.mockRejectedValueOnce(new Error('settings unavailable'));
    const args = {
      localId: '__LOCALID_1',
      projectId: 'p1',
      port: 31415,
      defaultAdapterId: null,
      adapters,
    };
    await expect(initializeDraft(args)).rejects.toThrow('settings unavailable');
    const request = deferred<Record<string, ProviderConfig>>();
    getProviderSettings.mockReturnValue(request.promise);

    const retry = useNewThreadReady.getState().getInitialization('__LOCALID_1').retry;
    const result = retry?.();
    expect(useNewThreadReady.getState().getInitialization('__LOCALID_1').status).toBe('initializing');

    request.resolve({});
    await result;
  });

  it('does not resurrect a draft cleared while initialization is pending', async () => {
    const request = deferred<Record<string, ProviderConfig>>();
    getProviderSettings.mockReturnValue(request.promise);
    const result = initializeDraft({
      localId: '__LOCALID_1',
      projectId: 'p1',
      port: 31415,
      defaultAdapterId: null,
      adapters,
    });

    useNewThreadReady.getState().clearReady('__LOCALID_1');
    request.resolve({});
    await result;

    expect(getDraftConfig('__LOCALID_1')).toBeUndefined();
    expect(useNewThreadReady.getState().getInitialization('__LOCALID_1').status).toBe('idle');
  });

  it('ignores an old response after cancellation and replacement initialization', async () => {
    const oldRequest = deferred<Record<string, ProviderConfig>>();
    const replacementRequest = deferred<Record<string, ProviderConfig>>();
    getProviderSettings.mockReturnValueOnce(oldRequest.promise).mockReturnValueOnce(replacementRequest.promise);
    const args = {
      localId: '__LOCALID_1',
      projectId: 'p1',
      port: 31415,
      defaultAdapterId: null,
      adapters,
    };

    const oldResult = initializeDraft(args);
    const oldAttempt = useNewThreadReady.getState().getInitialization(args.localId).attempt;
    if (oldAttempt == null) throw new Error('Expected old initialization attempt');
    useNewThreadReady.getState().cancelInitialization(args.localId, oldAttempt);
    const replacementResult = initializeDraft(args);
    oldRequest.resolve({ claude: { defaultMode: 'yolo' } });
    await oldResult;

    expect(getDraftConfig(args.localId)).toBeUndefined();
    expect(useNewThreadReady.getState().isReady(args.localId)).toBe(false);

    replacementRequest.resolve({ claude: { defaultMode: 'acceptEdits' } });
    await replacementResult;
    expect(getDraftConfig(args.localId)).toMatchObject({ permissionMode: 'acceptEdits' });
    expect(useNewThreadReady.getState().isReady(args.localId)).toBe(true);
  });

  it('stores an immutable snapshot of the resolved provider settings', async () => {
    const provider: ProviderConfig = { defaultMode: 'acceptEdits', defaultEffort: 'low' };
    getProviderSettings.mockResolvedValue({ claude: provider });

    await initializeDraft({
      localId: '__LOCALID_1',
      projectId: 'p1',
      port: 31415,
      defaultAdapterId: null,
      adapters,
    });
    provider.defaultEffort = 'medium';

    expect(getDraftConfig('__LOCALID_1')).toMatchObject({ effort: 'low' });
  });
});
