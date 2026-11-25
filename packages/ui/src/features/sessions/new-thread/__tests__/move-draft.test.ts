// @vitest-environment jsdom
/** A draft moved by the pickers (C14): what stays, what goes, what the toast says, and its Undo. */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const toast = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/toast', () => ({ mfToast: toast }));
const create = vi.hoisted(() => ({ isCreatePending: vi.fn(() => false), abandonCreateForLocal: vi.fn() }));
vi.mock('../../runtime/new-thread-coordinator', () => create);
const adopted = vi.hoisted(() => vi.fn(() => false));
vi.mock('../../runtime/chat-controller-registry', () => ({
  chatControllerRegistry: { get: () => ({ hasRemoteId: adopted }) },
}));

import { draftItemsOf, useDraftContent } from '@/features/chat/composer/draft-content/draft-content-store';
import { useComposerSegments } from '@/features/chat/composer/segments/segment-store';
import { sessionReferencesFor, useSessionReferences } from '@/features/chat/composer/sessions/session-reference-store';
import { useProjectsStore } from '@/store/projects';
import { useSandboxStore } from '@/store/sandbox';
import { getDraftConfig, patchDraftConfig, setDraftConfig, type DraftCfg } from '../../runtime/draft-config';
import { useNewThreadReady } from '../../runtime/new-thread-ready-store';
import { endDraftGenerations } from '../draft-generation';
import { moveDraft } from '../move-draft';
import { rescopeNewThreadDraft, resetNewThreadDraft } from '../reset-new-thread-draft';

const ID = '__LOCALID_1';
const ATLAS: DraftCfg = { projectId: 'atlas', adapterId: 'claude', model: 'opus' };
const BEACON: DraftCfg = { projectId: 'beacon', adapterId: 'claude', model: 'opus' };
const CAPTURE = { kind: 'capture', type: 'screenshot', imageDataUrl: 'data:image/png;base64,A', note: 'c' } as const;
const CODE = { kind: 'code', filePath: 'a.ts', startLine: 1, endLine: 1, lineContent: 'a', note: 'n' } as const;

const items = () => draftItemsOf(ID).map(({ note }) => note);
const move = (to: DraftCfg, from = getDraftConfig(ID)) => moveDraft(ID, from, to, () => setDraftConfig(ID, to));
const lastToast = () =>
  toast.info.mock.lastCall as [
    string,
    { description: string; duration: number; action: { label: string; onClick: () => void } },
  ];
const undo = () => lastToast()[1].action.onClick();

beforeEach(() => {
  vi.clearAllMocks();
  endDraftGenerations();
  create.isCreatePending.mockReturnValue(false);
  adopted.mockReturnValue(false);
  useDraftContent.setState({ byThread: {} });
  useComposerSegments.setState({ byThread: {} });
  useSessionReferences.setState({ byThread: {} });
  useSandboxStore.setState({ captures: [] });
  useProjectsStore.setState({
    projects: [
      { id: 'atlas', name: 'atlas-web', path: '/p/atlas' },
      { id: 'beacon', name: 'beacon', path: '/p/beacon' },
    ] as never,
  });
  setDraftConfig(ID, ATLAS);
});

function fill() {
  useDraftContent.getState().add(ID, [CAPTURE, CODE]);
  useComposerSegments.getState().append(ID, { quote: 'quoted', liveText: 'prose' });
  useSessionReferences.getState().record(ID, 'Prior', '/logs/prior.jsonl');
  useSandboxStore.getState().addCapture({ type: 'screenshot', imageDataUrl: 'data:image/png;base64,B' });
}

it('removes what belongs to the old project, keeps the quotes and their prose, and says so', () => {
  fill();
  const quotes = useComposerSegments.getState().byThread[ID];
  move(BEACON);
  expect(items()).toEqual([]);
  expect(useSandboxStore.getState().captures).toEqual([]);
  expect(sessionReferencesFor(ID).size).toBe(0);
  expect(useComposerSegments.getState().byThread[ID]).toBe(quotes);
  expect(lastToast()[1].description).toBe('Removed 2 captures, 1 code note and 1 session mention from atlas-web');
  expect(lastToast()[1].duration).toBeGreaterThan(10_000);
});

it('says nothing when there was nothing to remove', () => {
  useComposerSegments.getState().append(ID, { quote: 'quoted', liveText: 'prose' });
  move(BEACON);
  expect(toast.info).not.toHaveBeenCalled();
});

describe('Undo', () => {
  it('switches back and restores everything', () => {
    fill();
    move(BEACON);
    undo();
    expect(getDraftConfig(ID)).toEqual(ATLAS);
    expect(useNewThreadReady.getState().isReady(ID)).toBe(true);
    expect(items()).toEqual(['c', 'n']);
    expect(Object.fromEntries(sessionReferencesFor(ID))).toEqual({ Prior: '/logs/prior.jsonl' });
    expect(useSandboxStore.getState().captures).toHaveLength(1);
    expect(toast.info).toHaveBeenCalledTimes(1);
  });

  it('ends the other project’s setup, still loading', () => {
    useDraftContent.getState().add(ID, [CODE]);
    moveDraft(ID, ATLAS, BEACON, () => rescopeNewThreadDraft(ID));
    useNewThreadReady.getState().beginInitialization(ID, vi.fn(), 'beacon');
    const { attempt } = useNewThreadReady.getState().getInitialization(ID);
    undo();
    expect(useNewThreadReady.getState().completeInitialization(ID, attempt!)).toBe(false);
    expect(getDraftConfig(ID)).toEqual(ATLAS);
  });

  it('leaves behind what was added in the other project, and says that too', () => {
    useDraftContent.getState().add(ID, [CODE]);
    move(BEACON);
    useDraftContent.getState().add(ID, [{ ...CAPTURE, note: 'beacon’s' }]);
    undo();
    expect(items()).toEqual(['n']);
    expect(lastToast()[1].description).toBe('Removed 1 capture from beacon');
    undo();
    expect(items()).toEqual(['beacon’s']);
    expect(getDraftConfig(ID)).toEqual(BEACON);
  });

  it('keeps what else was chosen since, in the same project', () => {
    useDraftContent.getState().add(ID, [CODE]);
    move({ ...ATLAS, worktreePath: '/w/x', branchName: 'feat/x' });
    patchDraftConfig(ID, { model: 'sonnet' });
    undo();
    expect(getDraftConfig(ID)).toMatchObject({ projectId: 'atlas', model: 'sonnet', worktreePath: undefined });
    expect(items()).toEqual(['n']);
  });

  it.each([
    ['is being sent', () => create.isCreatePending.mockReturnValue(true)],
    ['became a session', () => adopted.mockReturnValue(true)],
    ['was replaced by a new one', () => resetNewThreadDraft(ID)],
    ['ended with its daemon', () => endDraftGenerations()],
  ])('does nothing once the draft %s', (_what, end) => {
    useDraftContent.getState().add(ID, [CODE]);
    move(BEACON);
    end();
    const config = getDraftConfig(ID);
    undo();
    expect(items()).toEqual([]);
    expect(getDraftConfig(ID)).toEqual(config);
    expect(toast.info).toHaveBeenLastCalledWith('Nothing to undo', expect.anything());
  });
});

describe('what counts as a move', () => {
  it.each<[string, Partial<DraftCfg>, Partial<DraftCfg>, boolean]>([
    ['another project', {}, { projectId: 'beacon' }, true],
    ['no project', {}, { projectId: null }, true],
    ['into a worktree', {}, { worktreePath: '/w/x' }, true],
    ['out of a worktree', { worktreePath: '/w/x' }, {}, true],
    ['another worktree', { worktreePath: '/w/x' }, { worktreePath: '/w/y' }, true],
    ['a new worktree', {}, { pendingWorktree: { baseBranch: 'main', branchName: 's-1' } }, true],
    [
      'a new worktree’s name',
      { pendingWorktree: { baseBranch: 'main', branchName: 's-1' } },
      { pendingWorktree: { baseBranch: 'dev', branchName: 's-2' } },
      false,
    ],
    ['a temporary session', {}, { temporary: true }, false],
    ['the model', {}, { model: 'sonnet' }, false],
    ['the same project again', {}, {}, false],
  ])('%s', (_what, from, to, moves) => {
    useDraftContent.getState().add(ID, [CODE]);
    move({ ...ATLAS, ...to }, { ...ATLAS, ...from });
    expect(items()).toEqual(moves ? [] : ['n']);
    expect(toast.info).toHaveBeenCalledTimes(moves ? 1 : 0);
  });

  it('not a setup that loads late', () => {
    useDraftContent.getState().add(ID, [CODE]);
    moveDraft(ID, undefined, BEACON, () => setDraftConfig(ID, BEACON));
    expect(items()).toEqual(['n']);
  });

  it.each([
    [{ ...ATLAS, worktreePath: '/w/x', branchName: 'feat/x' }, 'Removed 1 code note from feat/x'],
    [{ ...ATLAS, worktreePath: '/w/detached' }, 'Removed 1 code note from detached'],
    [{ ...ATLAS, projectId: null }, 'Removed 1 code note'],
  ])('names the place left', (from, title) => {
    useDraftContent.getState().add(ID, [CODE]);
    move(BEACON, from);
    expect(lastToast()[1].description).toBe(title);
  });
});
