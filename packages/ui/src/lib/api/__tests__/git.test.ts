/**
 * git.test.ts — git API client URL/method/body contract tests.
 *
 * Every wrapper here is a thin `request`/`requestEmpty` call, so envelope
 * unwrap and error behavior is pinned once in http-envelope.test.ts. This
 * file pins only what each function owns: the route, the method, and the
 * body/query shaping — one table row per executed case.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getGitBranch,
  getGitBranches,
  gitCheckout,
  gitCreateBranch,
  gitFetch,
  gitPull,
  gitPush,
  gitMerge,
  gitRebase,
  gitAbort,
  gitRenameBranch,
  gitDeleteBranch,
  gitUpdateAll,
  getProjectWorktrees,
  deleteWorktree,
  enableWorktree,
  attachWorktree,
} from '../git';
import { setActiveDaemon } from '../../daemon/active-daemon';

const PORT = 31415;
const PROJECT_ID = 'proj-abc';
const BASE = `http://127.0.0.1:${PORT}/api/projects/${PROJECT_ID}/git`;
const CHAT_BASE = `http://127.0.0.1:${PORT}/api/chats`;

const LOCAL_DAEMON = {
  id: 'local',
  kind: 'local',
  label: 'Local',
  baseUrl: `http://127.0.0.1:${PORT}`,
  token: null,
} as const;

beforeEach(() => {
  // {success:true, data:{}} satisfies both request and requestEmpty consumers.
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ success: true, data: {} }) }),
  );
  setActiveDaemon({ ...LOCAL_DAEMON });
});

afterEach(() => {
  vi.unstubAllGlobals();
  setActiveDaemon({ ...LOCAL_DAEMON });
});

function lastCall(): { url: string; init: RequestInit } {
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  const last = calls[calls.length - 1];
  return { url: last?.[0] as string, init: last?.[1] as RequestInit };
}

interface ContractCase {
  name: string;
  call: () => Promise<unknown>;
  url: string;
  method: 'GET' | 'POST';
  /** Expected parsed JSON body; omit for GET (no body). */
  body?: Record<string, unknown>;
}

const CASES: ContractCase[] = [
  {
    name: 'getGitBranch (no chatId)',
    call: () => getGitBranch(PORT, PROJECT_ID),
    url: `${BASE}/branch`,
    method: 'GET',
  },
  {
    name: 'getGitBranch (chatId)',
    call: () => getGitBranch(PORT, PROJECT_ID, 'chat-1'),
    url: `${BASE}/branch?chatId=chat-1`,
    method: 'GET',
  },
  {
    name: 'getGitBranches (no chatId)',
    call: () => getGitBranches(PORT, PROJECT_ID),
    url: `${BASE}/branches`,
    method: 'GET',
  },
  {
    name: 'getGitBranches (chatId)',
    call: () => getGitBranches(PORT, PROJECT_ID, 'chat-2'),
    url: `${BASE}/branches?chatId=chat-2`,
    method: 'GET',
  },
  {
    name: 'gitCheckout (no chatId)',
    call: () => gitCheckout(PORT, PROJECT_ID, 'feat/xyz'),
    url: `${BASE}/checkout`,
    method: 'POST',
    body: { branch: 'feat/xyz' },
  },
  {
    name: 'gitCheckout (chatId)',
    call: () => gitCheckout(PORT, PROJECT_ID, 'main', 'chat-3'),
    url: `${BASE}/checkout`,
    method: 'POST',
    body: { branch: 'main', chatId: 'chat-3' },
  },
  {
    name: 'gitCreateBranch (name only)',
    call: () => gitCreateBranch(PORT, PROJECT_ID, 'feat/new'),
    url: `${BASE}/branch`,
    method: 'POST',
    body: { name: 'feat/new' },
  },
  {
    name: 'gitCreateBranch (startPoint + chatId)',
    call: () => gitCreateBranch(PORT, PROJECT_ID, 'feat/new', 'main', 'chat-4'),
    url: `${BASE}/branch`,
    method: 'POST',
    body: { name: 'feat/new', startPoint: 'main', chatId: 'chat-4' },
  },
  {
    name: 'gitFetch (no opts)',
    call: () => gitFetch(PORT, PROJECT_ID),
    url: `${BASE}/fetch`,
    method: 'POST',
    body: {},
  },
  {
    name: 'gitFetch (remote + chatId)',
    call: () => gitFetch(PORT, PROJECT_ID, 'upstream', 'chat-5'),
    url: `${BASE}/fetch`,
    method: 'POST',
    body: { remote: 'upstream', chatId: 'chat-5' },
  },
  { name: 'gitPull (no opts)', call: () => gitPull(PORT, PROJECT_ID), url: `${BASE}/pull`, method: 'POST', body: {} },
  {
    name: 'gitPull (opts passthrough)',
    call: () => gitPull(PORT, PROJECT_ID, { remote: 'origin', branch: 'main', localBranch: 'main', chatId: 'chat-6' }),
    url: `${BASE}/pull`,
    method: 'POST',
    body: { remote: 'origin', branch: 'main', localBranch: 'main', chatId: 'chat-6' },
  },
  {
    name: 'gitPush (opts passthrough)',
    call: () => gitPush(PORT, PROJECT_ID, { branch: 'main', remote: 'origin', chatId: 'chat-7' }),
    url: `${BASE}/push`,
    method: 'POST',
    body: { branch: 'main', remote: 'origin', chatId: 'chat-7' },
  },
  {
    name: 'gitMerge (no chatId)',
    call: () => gitMerge(PORT, PROJECT_ID, 'feat/x'),
    url: `${BASE}/merge`,
    method: 'POST',
    body: { branch: 'feat/x' },
  },
  {
    name: 'gitMerge (chatId)',
    call: () => gitMerge(PORT, PROJECT_ID, 'main', 'chat-8'),
    url: `${BASE}/merge`,
    method: 'POST',
    body: { branch: 'main', chatId: 'chat-8' },
  },
  {
    name: 'gitRebase',
    call: () => gitRebase(PORT, PROJECT_ID, 'main'),
    url: `${BASE}/rebase`,
    method: 'POST',
    body: { branch: 'main' },
  },
  {
    name: 'gitAbort (no chatId)',
    call: () => gitAbort(PORT, PROJECT_ID),
    url: `${BASE}/abort`,
    method: 'POST',
    body: {},
  },
  {
    name: 'gitAbort (chatId)',
    call: () => gitAbort(PORT, PROJECT_ID, 'chat-9'),
    url: `${BASE}/abort`,
    method: 'POST',
    body: { chatId: 'chat-9' },
  },
  {
    name: 'gitRenameBranch',
    call: () => gitRenameBranch(PORT, PROJECT_ID, 'old-branch', 'new-branch'),
    url: `${BASE}/rename-branch`,
    method: 'POST',
    body: { oldName: 'old-branch', newName: 'new-branch' },
  },
  {
    name: 'gitRenameBranch (chatId)',
    call: () => gitRenameBranch(PORT, PROJECT_ID, 'old', 'new', 'chat-10'),
    url: `${BASE}/rename-branch`,
    method: 'POST',
    body: { oldName: 'old', newName: 'new', chatId: 'chat-10' },
  },
  {
    name: 'gitDeleteBranch (name only)',
    call: () => gitDeleteBranch(PORT, PROJECT_ID, 'feat/done'),
    url: `${BASE}/delete-branch`,
    method: 'POST',
    body: { name: 'feat/done' },
  },
  {
    name: 'gitDeleteBranch (force + remote + chatId)',
    call: () => gitDeleteBranch(PORT, PROJECT_ID, 'feat/done', { force: true, remote: true, chatId: 'chat-11' }),
    url: `${BASE}/delete-branch`,
    method: 'POST',
    body: { name: 'feat/done', force: true, remote: true, chatId: 'chat-11' },
  },
  {
    name: 'gitUpdateAll (no chatId)',
    call: () => gitUpdateAll(PORT, PROJECT_ID),
    url: `${BASE}/update-all`,
    method: 'POST',
    body: {},
  },
  {
    name: 'gitUpdateAll (chatId)',
    call: () => gitUpdateAll(PORT, PROJECT_ID, 'chat-12'),
    url: `${BASE}/update-all`,
    method: 'POST',
    body: { chatId: 'chat-12' },
  },
  {
    name: 'deleteWorktree (no branchName)',
    call: () => deleteWorktree(PORT, PROJECT_ID, '/repo/.git/worktrees/feat'),
    url: `${BASE}/delete-worktree`,
    method: 'POST',
    body: { worktreePath: '/repo/.git/worktrees/feat' },
  },
  {
    name: 'deleteWorktree (branchName)',
    call: () => deleteWorktree(PORT, PROJECT_ID, '/repo/.git/worktrees/feat', 'feat/my-feature'),
    url: `${BASE}/delete-worktree`,
    method: 'POST',
    body: { worktreePath: '/repo/.git/worktrees/feat', branchName: 'feat/my-feature' },
  },
  {
    name: 'enableWorktree',
    call: () => enableWorktree(PORT, 'c1', 'main', 'feat/x'),
    url: `${CHAT_BASE}/c1/enable-worktree`,
    method: 'POST',
    body: { baseBranch: 'main', branchName: 'feat/x' },
  },
  {
    name: 'attachWorktree',
    call: () => attachWorktree(PORT, 'c1', '/wt/x', 'feat/x'),
    url: `${CHAT_BASE}/c1/attach-worktree`,
    method: 'POST',
    body: { worktreePath: '/wt/x', branchName: 'feat/x' },
  },
];

describe('git route contracts (method / URL / body)', () => {
  it.each(CASES)('$name', async ({ call, url, method, body }) => {
    await call();

    const { url: calledUrl, init } = lastCall();
    expect(calledUrl).toBe(url);
    expect(init.method).toBe(method);
    if (body === undefined) {
      expect(init.body).toBeUndefined();
    } else {
      expect(JSON.parse(init.body as string)).toEqual(body);
    }
  });
});

describe('URL encoding', () => {
  it('URL-encodes a projectId with spaces and slashes in the path', async () => {
    await getGitBranch(PORT, 'my project/1');

    expect(lastCall().url).toContain('/api/projects/my%20project%2F1/git/branch');
  });

  it.each([
    {
      name: 'enableWorktree',
      call: () => enableWorktree(PORT, 'chat/has spaces', 'main', 'feat/x'),
      suffix: 'enable-worktree',
    },
    {
      name: 'attachWorktree',
      call: () => attachWorktree(PORT, 'chat/has spaces', '/wt/x', 'feat/x'),
      suffix: 'attach-worktree',
    },
  ])('$name URL-encodes the chatId in the path', async ({ call, suffix }) => {
    await call();

    expect(lastCall().url).toContain(`/api/chats/chat%2Fhas%20spaces/${suffix}`);
  });
});

describe('getProjectWorktrees', () => {
  const WORKTREES_FIXTURE = [
    { path: '/repo/.git/worktrees/feat', branch: 'feat/my-feature' },
    { path: '/repo/.git/worktrees/fix', branch: null },
  ];

  it('GETs /git/worktrees and extracts the .worktrees array', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { worktrees: WORKTREES_FIXTURE } }),
      }),
    );

    const result = await getProjectWorktrees(PORT, PROJECT_ID);

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/worktrees`);
    expect(init.method).toBe('GET');
    expect(result).toEqual(WORKTREES_FIXTURE);
  });

  it('returns an empty array when the response contains an empty worktrees list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { worktrees: [] } }),
      }),
    );

    await expect(getProjectWorktrees(PORT, PROJECT_ID)).resolves.toEqual([]);
  });
});
