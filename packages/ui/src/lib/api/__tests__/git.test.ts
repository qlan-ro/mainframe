/**
 * git.test.ts — git API client shaping tests.
 *
 * Behaviors covered (URL / method / body / result passthrough):
 *  1.  getGitBranch — GET /git/branch, no chatId
 *  2.  getGitBranch — GET /git/branch?chatId=... when chatId is provided
 *  3.  getGitBranches — GET /git/branches, no chatId
 *  4.  getGitBranches — GET /git/branches?chatId=... when chatId is provided
 *  5.  gitCheckout — POST /git/checkout with {branch}
 *  6.  gitCheckout — POST /git/checkout includes chatId when provided
 *  7.  gitCreateBranch — POST /git/branch with {name}
 *  8.  gitCreateBranch — includes startPoint + chatId when provided
 *  9.  gitFetch — POST /git/fetch, no body fields when no opts
 *  10. gitFetch — includes remote + chatId when provided
 *  11. gitPull — POST /git/pull passes opts object through
 *  12. gitPush — POST /git/push passes opts object through
 *  13. gitMerge — POST /git/merge with {branch}
 *  14. gitMerge — includes chatId when provided
 *  15. gitRebase — POST /git/rebase with {branch}
 *  16. gitAbort — POST /git/abort with empty body when no chatId
 *  17. gitAbort — includes {chatId} body when chatId is provided
 *  18. gitRenameBranch — POST /git/rename-branch with {oldName, newName}
 *  19. gitDeleteBranch — POST /git/delete-branch with {name}
 *  20. gitDeleteBranch — includes {force, remote} when provided
 *  21. gitUpdateAll — POST /git/update-all with empty body when no chatId
 *  22. gitUpdateAll — includes {chatId} when provided
 *  23. getProjectWorktrees — GET /git/worktrees; extracts .worktrees array
 *  24. deleteWorktree — POST /git/delete-worktree with {worktreePath}, no branchName
 *  25. deleteWorktree — includes {branchName} when provided
 *  26. projectId is URL-encoded in all routes
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PORT = 31415;
const PROJECT_ID = 'proj-abc';
const BASE = `http://127.0.0.1:${PORT}/api/projects/${PROJECT_ID}/git`;

// ---------------------------------------------------------------------------
// fetch mock helpers — git routes use the ApiResponse envelope (request/requestEmpty)
// ---------------------------------------------------------------------------

function mockFetchOk(data: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, data }),
    }),
  );
}

function mockFetchEmpty(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true }),
    }),
  );
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BRANCH_LIST_FIXTURE = {
  current: 'main',
  local: [{ name: 'main', current: true }],
  remote: ['origin/main'],
  worktrees: [],
};

const WORKTREES_FIXTURE = [
  { path: '/repo/.git/worktrees/feat', branch: 'feat/my-feature' },
  { path: '/repo/.git/worktrees/fix', branch: null },
];

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Helper to extract the called URL and body
// ---------------------------------------------------------------------------

function lastCall(): { url: string; init: RequestInit } {
  const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls;
  const last = calls[calls.length - 1];
  return { url: last?.[0] as string, init: last?.[1] as RequestInit };
}

// ---------------------------------------------------------------------------
// 1–2. getGitBranch
// ---------------------------------------------------------------------------

describe('getGitBranch', () => {
  it('GETs /git/branch with no query string when chatId is omitted', async () => {
    mockFetchOk({ branch: 'main' });

    await getGitBranch(PORT, PROJECT_ID);

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/branch`);
    expect(init.method).toBe('GET');
  });

  it('appends ?chatId= when chatId is provided', async () => {
    mockFetchOk({ branch: 'feat/foo' });

    await getGitBranch(PORT, PROJECT_ID, 'chat-1');

    const { url } = lastCall();
    expect(url).toBe(`${BASE}/branch?chatId=chat-1`);
  });

  it('returns the {branch} data from the response', async () => {
    mockFetchOk({ branch: 'feat/bar' });

    const result = await getGitBranch(PORT, PROJECT_ID);

    expect(result).toEqual({ branch: 'feat/bar' });
  });
});

// ---------------------------------------------------------------------------
// 3–4. getGitBranches
// ---------------------------------------------------------------------------

describe('getGitBranches', () => {
  it('GETs /git/branches with no query string when chatId is omitted', async () => {
    mockFetchOk(BRANCH_LIST_FIXTURE);

    await getGitBranches(PORT, PROJECT_ID);

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/branches`);
    expect(init.method).toBe('GET');
  });

  it('appends ?chatId= when chatId is provided', async () => {
    mockFetchOk(BRANCH_LIST_FIXTURE);

    await getGitBranches(PORT, PROJECT_ID, 'chat-2');

    const { url } = lastCall();
    expect(url).toBe(`${BASE}/branches?chatId=chat-2`);
  });

  it('returns the BranchListResult data from the response', async () => {
    mockFetchOk(BRANCH_LIST_FIXTURE);

    const result = await getGitBranches(PORT, PROJECT_ID);

    expect(result).toEqual(BRANCH_LIST_FIXTURE);
  });
});

// ---------------------------------------------------------------------------
// 5–6. gitCheckout
// ---------------------------------------------------------------------------

describe('gitCheckout', () => {
  it('POSTs /git/checkout with {branch} and no chatId when omitted', async () => {
    mockFetchEmpty();

    await gitCheckout(PORT, PROJECT_ID, 'feat/xyz');

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/checkout`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ branch: 'feat/xyz' });
  });

  it('includes chatId in the body when provided', async () => {
    mockFetchEmpty();

    await gitCheckout(PORT, PROJECT_ID, 'main', 'chat-3');

    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ branch: 'main', chatId: 'chat-3' });
  });
});

// ---------------------------------------------------------------------------
// 7–8. gitCreateBranch
// ---------------------------------------------------------------------------

describe('gitCreateBranch', () => {
  it('POSTs /git/branch with {name} only when startPoint and chatId are omitted', async () => {
    mockFetchEmpty();

    await gitCreateBranch(PORT, PROJECT_ID, 'feat/new');

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/branch`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'feat/new' });
  });

  it('includes startPoint and chatId in body when provided', async () => {
    mockFetchEmpty();

    await gitCreateBranch(PORT, PROJECT_ID, 'feat/new', 'main', 'chat-4');

    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ name: 'feat/new', startPoint: 'main', chatId: 'chat-4' });
  });
});

// ---------------------------------------------------------------------------
// 9–10. gitFetch
// ---------------------------------------------------------------------------

describe('gitFetch', () => {
  it('POSTs /git/fetch with an empty body when remote and chatId are omitted', async () => {
    mockFetchOk({ status: 'success', remote: 'origin' });

    await gitFetch(PORT, PROJECT_ID);

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/fetch`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('includes remote and chatId in body when provided', async () => {
    mockFetchOk({ status: 'success', remote: 'upstream' });

    await gitFetch(PORT, PROJECT_ID, 'upstream', 'chat-5');

    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ remote: 'upstream', chatId: 'chat-5' });
  });

  it('returns the FetchResult data', async () => {
    mockFetchOk({ status: 'success', remote: 'origin' });

    const result = await gitFetch(PORT, PROJECT_ID);

    expect(result).toEqual({ status: 'success', remote: 'origin' });
  });
});

// ---------------------------------------------------------------------------
// 11. gitPull
// ---------------------------------------------------------------------------

describe('gitPull', () => {
  it('POSTs /git/pull with the opts object passed through', async () => {
    mockFetchOk({ status: 'success', summary: { changes: 3, insertions: 5, deletions: 2 } });

    await gitPull(PORT, PROJECT_ID, { remote: 'origin', branch: 'main', localBranch: 'main', chatId: 'chat-6' });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/pull`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      remote: 'origin',
      branch: 'main',
      localBranch: 'main',
      chatId: 'chat-6',
    });
  });

  it('returns the PullResult data', async () => {
    mockFetchOk({ status: 'up-to-date' });

    const result = await gitPull(PORT, PROJECT_ID);

    expect(result).toEqual({ status: 'up-to-date' });
  });
});

// ---------------------------------------------------------------------------
// 12. gitPush
// ---------------------------------------------------------------------------

describe('gitPush', () => {
  it('POSTs /git/push with opts passed through', async () => {
    mockFetchOk({ status: 'success', branch: 'main', remote: 'origin' });

    await gitPush(PORT, PROJECT_ID, { branch: 'main', remote: 'origin', chatId: 'chat-7' });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/push`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ branch: 'main', remote: 'origin', chatId: 'chat-7' });
  });

  it('returns the PushResult data', async () => {
    mockFetchOk({ status: 'success', branch: 'feat', remote: 'origin' });

    const result = await gitPush(PORT, PROJECT_ID, { branch: 'feat' });

    expect(result).toEqual({ status: 'success', branch: 'feat', remote: 'origin' });
  });
});

// ---------------------------------------------------------------------------
// 13–14. gitMerge
// ---------------------------------------------------------------------------

describe('gitMerge', () => {
  it('POSTs /git/merge with {branch} and no chatId when omitted', async () => {
    mockFetchOk({ status: 'success', summary: { commits: 1, insertions: 10, deletions: 0 } });

    await gitMerge(PORT, PROJECT_ID, 'feat/x');

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/merge`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ branch: 'feat/x' });
  });

  it('includes chatId in body when provided', async () => {
    mockFetchOk({ status: 'success', summary: { commits: 2, insertions: 5, deletions: 3 } });

    await gitMerge(PORT, PROJECT_ID, 'main', 'chat-8');

    const body = JSON.parse(lastCall().init.body as string);
    expect(body.chatId).toBe('chat-8');
    expect(body.branch).toBe('main');
  });

  it('returns the MergeResult data', async () => {
    mockFetchOk({ status: 'conflict', conflicts: ['src/a.ts'], message: 'Conflict in a.ts' });

    const result = await gitMerge(PORT, PROJECT_ID, 'feat/x');

    expect(result).toEqual({ status: 'conflict', conflicts: ['src/a.ts'], message: 'Conflict in a.ts' });
  });
});

// ---------------------------------------------------------------------------
// 15. gitRebase
// ---------------------------------------------------------------------------

describe('gitRebase', () => {
  it('POSTs /git/rebase with {branch}', async () => {
    mockFetchOk({ status: 'success' });

    await gitRebase(PORT, PROJECT_ID, 'main');

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/rebase`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ branch: 'main' });
  });

  it('returns the RebaseResult data', async () => {
    mockFetchOk({ status: 'conflict', conflicts: ['src/b.ts'], message: 'Conflict in b.ts' });

    const result = await gitRebase(PORT, PROJECT_ID, 'main');

    expect(result).toEqual({ status: 'conflict', conflicts: ['src/b.ts'], message: 'Conflict in b.ts' });
  });
});

// ---------------------------------------------------------------------------
// 16–17. gitAbort
// ---------------------------------------------------------------------------

describe('gitAbort', () => {
  it('POSTs /git/abort with empty body when chatId is omitted', async () => {
    mockFetchEmpty();

    await gitAbort(PORT, PROJECT_ID);

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/abort`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('includes {chatId} body when chatId is provided', async () => {
    mockFetchEmpty();

    await gitAbort(PORT, PROJECT_ID, 'chat-9');

    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ chatId: 'chat-9' });
  });
});

// ---------------------------------------------------------------------------
// 18. gitRenameBranch
// ---------------------------------------------------------------------------

describe('gitRenameBranch', () => {
  it('POSTs /git/rename-branch with {oldName, newName}', async () => {
    mockFetchEmpty();

    await gitRenameBranch(PORT, PROJECT_ID, 'old-branch', 'new-branch');

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/rename-branch`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ oldName: 'old-branch', newName: 'new-branch' });
  });

  it('includes chatId when provided', async () => {
    mockFetchEmpty();

    await gitRenameBranch(PORT, PROJECT_ID, 'old', 'new', 'chat-10');

    const body = JSON.parse(lastCall().init.body as string);
    expect(body.chatId).toBe('chat-10');
    expect(body.oldName).toBe('old');
    expect(body.newName).toBe('new');
  });
});

// ---------------------------------------------------------------------------
// 19–20. gitDeleteBranch
// ---------------------------------------------------------------------------

describe('gitDeleteBranch', () => {
  it('POSTs /git/delete-branch with {name} and no extra opts when omitted', async () => {
    mockFetchOk({ status: 'success' });

    await gitDeleteBranch(PORT, PROJECT_ID, 'feat/done');

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/delete-branch`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: 'feat/done' });
  });

  it('includes force and remote opts when provided', async () => {
    mockFetchOk({ status: 'success' });

    await gitDeleteBranch(PORT, PROJECT_ID, 'feat/done', { force: true, remote: true, chatId: 'chat-11' });

    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ name: 'feat/done', force: true, remote: true, chatId: 'chat-11' });
  });

  it('returns the DeleteBranchResult data', async () => {
    mockFetchOk({ status: 'not-merged', message: 'Branch not fully merged' });

    const result = await gitDeleteBranch(PORT, PROJECT_ID, 'feat/unmerged');

    expect(result).toEqual({ status: 'not-merged', message: 'Branch not fully merged' });
  });
});

// ---------------------------------------------------------------------------
// 21–22. gitUpdateAll
// ---------------------------------------------------------------------------

describe('gitUpdateAll', () => {
  it('POSTs /git/update-all with empty body when chatId is omitted', async () => {
    mockFetchOk({ fetched: true, pull: { status: 'up-to-date' }, branches: [] });

    await gitUpdateAll(PORT, PROJECT_ID);

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/update-all`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it('includes {chatId} when provided', async () => {
    mockFetchOk({ fetched: true, pull: { status: 'up-to-date' }, branches: [] });

    await gitUpdateAll(PORT, PROJECT_ID, 'chat-12');

    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ chatId: 'chat-12' });
  });

  it('returns the UpdateAllResult data', async () => {
    mockFetchOk({
      fetched: true,
      pull: { status: 'success', summary: { changes: 2, insertions: 4, deletions: 1 } },
      branches: [{ branch: 'feat/a', status: 'updated' }],
    });

    const result = await gitUpdateAll(PORT, PROJECT_ID);

    expect(result.fetched).toBe(true);
    expect(result.pull.status).toBe('success');
    expect(result.branches).toHaveLength(1);
    expect(result.branches[0]?.branch).toBe('feat/a');
  });
});

// ---------------------------------------------------------------------------
// 23. getProjectWorktrees
// ---------------------------------------------------------------------------

describe('getProjectWorktrees', () => {
  it('GETs /git/worktrees and extracts the .worktrees array', async () => {
    mockFetchOk({ worktrees: WORKTREES_FIXTURE });

    const result = await getProjectWorktrees(PORT, PROJECT_ID);

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/worktrees`);
    expect(init.method).toBe('GET');
    expect(result).toEqual(WORKTREES_FIXTURE);
  });

  it('returns an empty array when the response contains an empty worktrees list', async () => {
    mockFetchOk({ worktrees: [] });

    const result = await getProjectWorktrees(PORT, PROJECT_ID);

    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 24–25. deleteWorktree
// ---------------------------------------------------------------------------

describe('deleteWorktree', () => {
  it('POSTs /git/delete-worktree with {worktreePath} and no branchName when omitted', async () => {
    mockFetchEmpty();

    await deleteWorktree(PORT, PROJECT_ID, '/repo/.git/worktrees/feat');

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/delete-worktree`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ worktreePath: '/repo/.git/worktrees/feat' });
  });

  it('includes {branchName} in the body when provided', async () => {
    mockFetchEmpty();

    await deleteWorktree(PORT, PROJECT_ID, '/repo/.git/worktrees/feat', 'feat/my-feature');

    const body = JSON.parse(lastCall().init.body as string);
    expect(body).toEqual({ worktreePath: '/repo/.git/worktrees/feat', branchName: 'feat/my-feature' });
  });
});

// ---------------------------------------------------------------------------
// 26. URL-encoding of projectId
// ---------------------------------------------------------------------------

describe('projectId URL-encoding', () => {
  it('URL-encodes a projectId with spaces and slashes in the path', async () => {
    mockFetchOk({ branch: 'main' });

    await getGitBranch(PORT, 'my project/1');

    const { url } = lastCall();
    expect(url).toContain('/api/projects/my%20project%2F1/git/branch');
  });
});

// ---------------------------------------------------------------------------
// 27. enableWorktree — POST /api/chats/:id/enable-worktree
// ---------------------------------------------------------------------------

describe('enableWorktree', () => {
  const CHAT_BASE = `http://127.0.0.1:${PORT}/api/chats/c1`;

  it('POSTs baseBranch+branchName to enable-worktree', async () => {
    mockFetchEmpty();

    await enableWorktree(PORT, 'c1', 'main', 'feat/x');

    const { url, init } = lastCall();
    expect(url).toBe(`${CHAT_BASE}/enable-worktree`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ baseBranch: 'main', branchName: 'feat/x' });
  });

  it('URL-encodes the chatId in the path', async () => {
    mockFetchEmpty();

    await enableWorktree(PORT, 'chat/has spaces', 'main', 'feat/x');

    const { url } = lastCall();
    expect(url).toContain('/api/chats/chat%2Fhas%20spaces/enable-worktree');
  });
});

// ---------------------------------------------------------------------------
// 28. attachWorktree — POST /api/chats/:id/attach-worktree
// ---------------------------------------------------------------------------

describe('attachWorktree', () => {
  const CHAT_BASE = `http://127.0.0.1:${PORT}/api/chats/c1`;

  it('POSTs worktreePath+branchName to attach-worktree', async () => {
    mockFetchEmpty();

    await attachWorktree(PORT, 'c1', '/wt/x', 'feat/x');

    const { url, init } = lastCall();
    expect(url).toBe(`${CHAT_BASE}/attach-worktree`);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ worktreePath: '/wt/x', branchName: 'feat/x' });
  });

  it('URL-encodes the chatId in the path', async () => {
    mockFetchEmpty();

    await attachWorktree(PORT, 'chat/has spaces', '/wt/x', 'feat/x');

    const { url } = lastCall();
    expect(url).toContain('/api/chats/chat%2Fhas%20spaces/attach-worktree');
  });
});
