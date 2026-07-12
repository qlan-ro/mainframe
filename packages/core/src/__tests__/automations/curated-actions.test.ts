// packages/core/src/__tests__/automations/curated-actions.test.ts
//
// Task 15: curated connectors (github.create_pr/list_prs, notion.add_row,
// ado.create_item) against a mocked fetch — request shape + camelCase
// output names per contract §5.
import { describe, it, expect, afterEach, vi } from 'vitest';
import pino from 'pino';
import { githubCreatePrAction, githubListPrsAction } from '../../automations/actions/github.js';
import { notionAddRowAction } from '../../automations/actions/notion.js';
import { adoCreateItemAction } from '../../automations/actions/ado.js';
import type { ActionCtx } from '../../automations/actions/types.js';

const silentLogger = pino({ level: 'silent' });

function ctx(overrides: Partial<ActionCtx> = {}): ActionCtx {
  return {
    creds: { kind: 'token', token: 'sekret' },
    idempotencyKey: 'run-1:step-1:0',
    signal: new AbortController().signal,
    logger: silentLogger,
    resolvePath: (p) => p,
    projectRoot: '/tmp',
    ...overrides,
  };
}

describe('github.create_pr action', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to /repos/:repo/pulls with a bearer token and returns camelCase outputs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 201,
      json: () => Promise.resolve({ html_url: 'https://github.com/o/r/pull/42', number: 42 }),
    });
    global.fetch = fetchMock;

    const outcome = await githubCreatePrAction.run(ctx(), {
      repo: 'o/r',
      title: 'Ship it',
      body: 'Ships the work.',
      head: 'ship/2026-07-12',
      base: 'main',
    });

    expect(outcome).toEqual({ prUrl: 'https://github.com/o/r/pull/42', prNumber: 42 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/o/r/pulls');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sekret');
    expect(JSON.parse(init.body as string)).toEqual({
      title: 'Ship it',
      body: 'Ships the work.',
      head: 'ship/2026-07-12',
      base: 'main',
    });
  });

  it('throws on a non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 422, text: () => Promise.resolve('validation failed') });
    await expect(
      githubCreatePrAction.run(ctx(), { repo: 'o/r', title: 't', body: '', head: 'h', base: 'main' }),
    ).rejects.toThrow(/422/);
  });

  it('declares id/outputs/idempotent per the contract', () => {
    expect(githubCreatePrAction.id).toBe('github.create_pr');
    expect(githubCreatePrAction.outputs).toEqual([
      { name: 'prUrl', type: 'text' },
      { name: 'prNumber', type: 'number' },
    ]);
    expect(githubCreatePrAction.idempotent).toBe(false);
  });
});

describe('github.list_prs action', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('searches open PRs by author and maps items to camelCase fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          items: [
            { html_url: 'https://github.com/o/r/pull/1', title: 'Fix bug', number: 1, user: { login: 'octocat' } },
            { html_url: 'https://github.com/o/r/pull/2', title: 'Add feature', number: 2, user: { login: 'octocat' } },
          ],
        }),
    });
    global.fetch = fetchMock;

    const outcome = await githubListPrsAction.run(ctx(), { author: '@me' });

    expect(outcome).toEqual({
      prs: [
        { url: 'https://github.com/o/r/pull/1', title: 'Fix bug', number: 1, author: 'octocat' },
        { url: 'https://github.com/o/r/pull/2', title: 'Add feature', number: 2, author: 'octocat' },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://api.github.com/search/issues?q=${encodeURIComponent('is:pr state:open author:@me')}`);
    expect(init.method).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sekret');
  });

  it('defaults author to @me when omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ status: 200, json: () => Promise.resolve({ items: [] }) });
    global.fetch = fetchMock;
    await githubListPrsAction.run(ctx(), {});
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain(encodeURIComponent('author:@me'));
  });

  it('throws on a non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 403, text: () => Promise.resolve('rate limited') });
    await expect(githubListPrsAction.run(ctx(), { author: '@me' })).rejects.toThrow(/403/);
  });

  it('declares id/outputs/idempotent per the contract', () => {
    expect(githubListPrsAction.id).toBe('github.list_prs');
    expect(githubListPrsAction.outputs).toEqual([{ name: 'prs', type: 'list' }]);
    expect(githubListPrsAction.idempotent).toBe(true);
  });
});

describe('notion.add_row action', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs to /v1/pages with every non-databaseId key as a rich_text property', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.resolve({ url: 'https://notion.so/abc123' }),
    });
    global.fetch = fetchMock;

    const outcome = await notionAddRowAction.run(ctx(), {
      databaseId: 'Health Log',
      Date: '2026-07-12',
      Mood: 'good',
    });

    expect(outcome).toEqual({ pageUrl: 'https://notion.so/abc123' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.notion.com/v1/pages');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sekret');
    expect((init.headers as Record<string, string>)['Notion-Version']).toBe('2022-06-28');
    expect(JSON.parse(init.body as string)).toEqual({
      parent: { database_id: 'Health Log' },
      properties: {
        Date: { rich_text: [{ text: { content: '2026-07-12' } }] },
        Mood: { rich_text: [{ text: { content: 'good' } }] },
      },
    });
  });

  it('throws on a non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 400, text: () => Promise.resolve('bad request') });
    await expect(notionAddRowAction.run(ctx(), { databaseId: 'db1' })).rejects.toThrow(/400/);
  });

  it('declares id/outputs/idempotent per the contract', () => {
    expect(notionAddRowAction.id).toBe('notion.add_row');
    expect(notionAddRowAction.outputs).toEqual([{ name: 'pageUrl', type: 'text' }]);
    expect(notionAddRowAction.idempotent).toBe(false);
  });
});

describe('ado.create_item action', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('POSTs a JSON-patch body with PAT basic auth and returns camelCase outputs', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      json: () =>
        Promise.resolve({
          id: 123,
          _links: { html: { href: 'https://dev.azure.com/my-org/my-project/_workitems/edit/123' } },
        }),
    });
    global.fetch = fetchMock;

    const outcome = await adoCreateItemAction.run(ctx(), {
      org: 'my-org',
      project: 'my-project',
      type: 'Task',
      title: 'Ship it',
      description: 'Ships the work.',
    });

    expect(outcome).toEqual({
      workItemId: 123,
      url: 'https://dev.azure.com/my-org/my-project/_workitems/edit/123',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://dev.azure.com/my-org/my-project/_apis/wit/workitems/$Task?api-version=7.1');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Basic ${Buffer.from(':sekret').toString('base64')}`,
    );
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json-patch+json');
    expect(JSON.parse(init.body as string)).toEqual([
      { op: 'add', path: '/fields/System.Title', value: 'Ship it' },
      { op: 'add', path: '/fields/System.Description', value: 'Ships the work.' },
    ]);
  });

  it('throws on a non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ status: 401, text: () => Promise.resolve('unauthorized') });
    await expect(
      adoCreateItemAction.run(ctx(), { org: 'o', project: 'p', type: 'Task', title: 't', description: 'd' }),
    ).rejects.toThrow(/401/);
  });

  it('declares id/outputs/idempotent per the contract', () => {
    expect(adoCreateItemAction.id).toBe('ado.create_item');
    expect(adoCreateItemAction.outputs).toEqual([
      { name: 'workItemId', type: 'number' },
      { name: 'url', type: 'text' },
    ]);
    expect(adoCreateItemAction.idempotent).toBe(false);
  });
});
