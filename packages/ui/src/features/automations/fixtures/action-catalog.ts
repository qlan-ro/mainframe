/**
 * ACTION_CATALOG_FIXTURE — the nine launch actions (contract §5). Mirrors
 * what the real daemon now sends (Part 0 of the 2026-08-18
 * automations-provider-connections plan fixed the gap where it didn't):
 * `paramsSchema` is the real JSON Schema each action's `parse_input`
 * validates against (`packages/core-rs/crates/mainframe-automations/src/
 * actions/*.rs`), copied verbatim; `fields`/`hasOutputAs` are the daemon's
 * field schema, a sibling projection, not a JSON-Schema translation. No
 * mcp:* entries — contract §9: MCP discovery is post-launch, behind
 * `AUTOMATIONS_MCP_ENABLED` (default off); the launch catalog returns none.
 *
 * `notion.add_row` only exposes `databaseId` as a field: its row columns are
 * freeform `additionalProperties` in the Rust schema (any string key becomes
 * a rich_text property) and there is no database-schema lookup endpoint to
 * enumerate them into structured rows (§9's acknowledged gap) — so, unlike
 * an earlier version of this fixture, there is no hardcoded database/column
 * list here pretending that endpoint exists.
 *
 * `credentialLabelHint` values are lowercase storage labels (`notion`,
 * `ado`, `github`), matching the daemon exactly — the label is the
 * credential store's key, so a mismatch here would connect a provider under
 * one label and look for it under another. The two `github.*` actions moved
 * to `auth: 'token'` when the REST migration replaced the `gh` CLI (2026-08-19
 * provider-connections plan).
 */
import type { ActionCatalogEntry, ActionField } from '../contract';

function entry(
  base: Omit<ActionCatalogEntry, 'fields' | 'hasOutputAs'>,
  fields: ActionField[],
  hasOutputAs?: boolean,
): ActionCatalogEntry {
  return hasOutputAs ? { ...base, fields, hasOutputAs } : { ...base, fields };
}

export const ACTION_CATALOG_FIXTURE: ActionCatalogEntry[] = [
  entry(
    {
      id: 'run_command',
      title: 'Run a command',
      group: 'builtin',
      auth: 'none',
      outputs: [
        { name: 'output', type: 'text' },
        { name: 'exitCode', type: 'number' },
      ],
      idempotent: false,
      paramsSchema: {
        type: 'object',
        properties: {
          script: { type: 'array', minItems: 1 },
          runIn: { type: 'string', enum: ['project root', 'worktree', 'custom'] },
          customPath: { type: 'string' },
          outputAs: { type: 'string', enum: ['text', 'lines'] },
        },
        required: ['script', 'runIn'],
        additionalProperties: false,
      },
    },
    [
      { key: 'script', label: 'Script', control: 'code', placeholder: 'pnpm test' },
      { key: 'runIn', label: 'Run in', control: 'select', options: ['project root', 'worktree', 'custom'] },
      {
        key: 'customPath',
        label: 'Path',
        control: 'chip',
        placeholder: '~/code/my-project',
        showWhen: { key: 'runIn', equals: 'custom' },
      },
    ],
    true,
  ),
  entry(
    {
      id: 'files.append',
      title: 'Append to a file',
      group: 'builtin',
      auth: 'none',
      outputs: [],
      idempotent: false,
      paramsSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    [
      { key: 'path', label: 'File', control: 'chip', placeholder: '~/notes/log.md' },
      { key: 'content', label: 'Text', control: 'chiparea' },
    ],
  ),
  entry(
    {
      id: 'files.write',
      title: 'Write a file',
      group: 'builtin',
      auth: 'none',
      outputs: [],
      idempotent: true,
      paramsSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, content: { type: 'string' } },
        required: ['path', 'content'],
        additionalProperties: false,
      },
    },
    [
      { key: 'path', label: 'File', control: 'chip', placeholder: '~/notes/log.md' },
      { key: 'content', label: 'Text', control: 'chiparea' },
    ],
  ),
  entry(
    {
      id: 'files.read',
      title: 'Read a file',
      group: 'builtin',
      auth: 'none',
      outputs: [{ name: 'content', type: 'text' }],
      idempotent: true,
      paramsSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, outputAs: { type: 'string', enum: ['text', 'lines'] } },
        required: ['path'],
        additionalProperties: false,
      },
    },
    [{ key: 'path', label: 'File', control: 'chip', placeholder: '~/notes/log.md' }],
    true,
  ),
  entry(
    {
      id: 'http.request',
      title: 'HTTP request',
      group: 'builtin',
      auth: 'token',
      credentialLabelHint: 'This endpoint',
      outputs: [
        { name: 'status', type: 'number' },
        { name: 'body', type: 'text' },
      ],
      idempotent: false,
      paramsSchema: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], default: 'GET' },
          url: { type: 'string', format: 'uri' },
          headers: { type: 'object', additionalProperties: { type: 'string' } },
          body: { anyOf: [{ type: 'string' }, { type: 'object' }, { type: 'array' }] },
          timeoutMs: { type: 'integer', minimum: 1, maximum: 120000, default: 30000 },
        },
        required: ['url'],
        additionalProperties: false,
      },
    },
    [
      { key: 'method', label: 'Method', control: 'select', options: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      { key: 'url', label: 'URL', control: 'chip', placeholder: 'https://api.example.com/…' },
      { key: 'body', label: 'Body', control: 'chiparea' },
    ],
  ),
  entry(
    {
      id: 'github.create_pr',
      title: 'Create a pull request',
      group: 'connector',
      auth: 'token',
      credentialLabelHint: 'github',
      outputs: [
        { name: 'prUrl', type: 'text' },
        { name: 'prNumber', type: 'number' },
      ],
      idempotent: false,
      paramsSchema: {
        type: 'object',
        properties: {
          repo: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          body: { type: 'string', default: '' },
          head: { type: 'string', minLength: 1 },
          base: { type: 'string', minLength: 1 },
        },
        required: ['repo', 'title', 'head', 'base'],
        additionalProperties: false,
      },
    },
    [
      { key: 'repo', label: 'Repository', control: 'text', placeholder: 'org/repo' },
      { key: 'title', label: 'Title', control: 'chip' },
      { key: 'body', label: 'Body', control: 'chiparea' },
      { key: 'head', label: 'Branch', control: 'chip', placeholder: 'feature/…' },
      { key: 'base', label: 'Base branch', control: 'text', placeholder: 'main' },
    ],
  ),
  entry(
    {
      id: 'github.list_prs',
      title: 'List my open PRs',
      group: 'connector',
      auth: 'token',
      credentialLabelHint: 'github',
      outputs: [{ name: 'prs', type: 'list' }],
      idempotent: true,
      paramsSchema: {
        type: 'object',
        properties: { author: { type: 'string', default: '@me' } },
        additionalProperties: false,
      },
    },
    [{ key: 'author', label: 'Author', control: 'text', placeholder: '@me' }],
  ),
  entry(
    {
      id: 'notion.add_row',
      title: 'Add a database row',
      group: 'connector',
      auth: 'token',
      credentialLabelHint: 'notion',
      outputs: [{ name: 'pageUrl', type: 'text' }],
      idempotent: false,
      paramsSchema: {
        type: 'object',
        properties: { databaseId: { type: 'string', minLength: 1 } },
        required: ['databaseId'],
        additionalProperties: { type: 'string' },
      },
    },
    [{ key: 'databaseId', label: 'Database', control: 'chip' }],
  ),
  entry(
    {
      id: 'ado.create_item',
      title: 'Create a work item',
      group: 'connector',
      auth: 'token',
      credentialLabelHint: 'ado',
      outputs: [
        { name: 'workItemId', type: 'number' },
        { name: 'url', type: 'text' },
      ],
      idempotent: false,
      paramsSchema: {
        type: 'object',
        properties: {
          org: { type: 'string', minLength: 1 },
          project: { type: 'string', minLength: 1 },
          type: { type: 'string', minLength: 1 },
          title: { type: 'string', minLength: 1 },
          description: { type: 'string', default: '' },
        },
        required: ['org', 'project', 'type', 'title'],
        additionalProperties: false,
      },
    },
    [
      { key: 'org', label: 'Organization', control: 'text', placeholder: 'my-org' },
      { key: 'project', label: 'Project', control: 'text', placeholder: 'my-project' },
      { key: 'type', label: 'Type', control: 'select', options: ['Task', 'Bug', 'User Story'] },
      { key: 'title', label: 'Title', control: 'chip' },
      { key: 'description', label: 'Description', control: 'chiparea' },
    ],
  ),
];
