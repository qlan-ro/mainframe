// packages/core/src/automations/actions/github.ts
//
// Curated connector (Task 15). Params arrive pre-rendered plain strings —
// the run_action executor renders ChipText before invoking any action other
// than run_command (Task 23). `github.list_prs` has no `repo` param (see
// packages/types/fixtures/automations/morning-pr-sweep.json): it uses the
// search API's `author:@me` qualifier to find PRs across all repos.
import { z } from 'zod';
import type { ActionDef } from './types.js';

const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';

function authHeaders(token: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function throwOnError(res: { status: number; text(): Promise<string> }, label: string): Promise<void> {
  if (res.status < 400) return;
  const body = await res.text();
  throw new Error(`${label} failed (${res.status}): ${body.slice(0, 500)}`);
}

const CreatePrInputSchema = z
  .object({
    repo: z.string().min(1),
    title: z.string().min(1),
    body: z.string().default(''),
    head: z.string().min(1),
    base: z.string().min(1),
  })
  .strict();

export const githubCreatePrAction: ActionDef = {
  id: 'github.create_pr',
  title: 'GitHub: create pull request',
  group: 'connector',
  auth: 'token',
  credentialLabelHint: 'github',
  input: CreatePrInputSchema,
  outputs: [
    { name: 'prUrl', type: 'text' },
    { name: 'prNumber', type: 'number' },
  ],
  idempotent: false,
  async run(ctx, rawInput) {
    const input = CreatePrInputSchema.parse(rawInput);
    const res = await fetch(`${GITHUB_API}/repos/${input.repo}/pulls`, {
      method: 'POST',
      headers: { ...authHeaders(ctx.creds?.token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: input.title, body: input.body, head: input.head, base: input.base }),
      signal: ctx.signal,
    });
    await throwOnError(res, 'GitHub create PR');
    const json = (await res.json()) as { html_url: string; number: number };
    return { prUrl: json.html_url, prNumber: json.number };
  },
};

const ListPrsInputSchema = z.object({ author: z.string().default('@me') }).strict();

interface GithubSearchItem {
  html_url: string;
  title: string;
  number: number;
  user: { login: string };
}

export const githubListPrsAction: ActionDef = {
  id: 'github.list_prs',
  title: 'GitHub: list my open pull requests',
  group: 'connector',
  auth: 'token',
  credentialLabelHint: 'github',
  input: ListPrsInputSchema,
  outputs: [{ name: 'prs', type: 'list' }],
  idempotent: true,
  async run(ctx, rawInput) {
    const input = ListPrsInputSchema.parse(rawInput);
    const query = `is:pr state:open author:${input.author}`;
    const res = await fetch(`${GITHUB_API}/search/issues?q=${encodeURIComponent(query)}`, {
      headers: authHeaders(ctx.creds?.token),
      signal: ctx.signal,
    });
    await throwOnError(res, 'GitHub list PRs');
    const json = (await res.json()) as { items: GithubSearchItem[] };
    return {
      prs: json.items.map((item) => ({
        url: item.html_url,
        title: item.title,
        number: item.number,
        author: item.user.login,
      })),
    };
  },
};
