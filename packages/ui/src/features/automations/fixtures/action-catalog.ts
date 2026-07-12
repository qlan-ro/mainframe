/**
 * ACTION_CATALOG_FIXTURE — the nine launch actions (contract §5), each with
 * a UI-local `paramsSchema` (see `steps/action-fields.ts`'s doc comment for
 * why the wire type is `unknown` and this is a UI-owned stand-in). No
 * mcp:* entries — contract §9: MCP discovery is post-launch, behind
 * `AUTOMATIONS_MCP_ENABLED` (default off); the launch catalog returns none.
 *
 * Field key names match the six canonical fixtures exactly where one
 * exercises the action (`packages/types/fixtures/automations/*.json` —
 * `script`/`runIn`, `path`/`content`, `databaseId`+column names, `author`,
 * `org`/`project`/`type`/`title`/`description`, `repo`/`title`/`body`/
 * `head`/`base`); the http.request/files.write fields are UI-invented (no
 * fixture exercises them) but follow the same key-naming convention.
 */
import type { ActionCatalogEntry } from '../contract';
import type { ActionParamsSchema } from '../steps/action-fields';

const NOTION_DATABASES = ['Health Log', 'Reading list', 'Standup notes'];
const NOTION_COLUMNS: Record<string, string[]> = {
  'Health Log': ['Date', 'Mood', 'Sleep', 'Symptoms'],
  'Reading list': ['Title', 'Author', 'Status'],
  'Standup notes': ['Date', 'Summary'],
};

function schema(fields: ActionParamsSchema['fields'], hasOutputAs?: boolean): ActionParamsSchema {
  return hasOutputAs ? { fields, hasOutputAs } : { fields };
}

export const ACTION_CATALOG_FIXTURE: ActionCatalogEntry[] = [
  {
    id: 'run_command',
    title: 'Run a command',
    group: 'builtin',
    auth: 'none',
    outputs: [
      { name: 'output', type: 'text' },
      { name: 'exitCode', type: 'number' },
    ],
    paramsSchema: schema(
      [
        { key: 'script', label: 'Script', control: 'code', placeholder: 'pnpm test' },
        { key: 'runIn', label: 'Run in', control: 'select', options: ['project root', 'worktree', 'custom'] },
        {
          key: 'cwdPath',
          label: 'Path',
          control: 'chip',
          placeholder: '~/code/my-project',
          showWhen: { key: 'runIn', equals: 'custom' },
        },
      ],
      true,
    ),
  },
  {
    id: 'files.append',
    title: 'Append to a file',
    group: 'builtin',
    auth: 'none',
    outputs: [],
    paramsSchema: schema([
      { key: 'path', label: 'File', control: 'chip', placeholder: '~/notes/log.md' },
      { key: 'content', label: 'Text', control: 'chiparea' },
    ]),
  },
  {
    id: 'files.write',
    title: 'Write a file',
    group: 'builtin',
    auth: 'none',
    outputs: [],
    paramsSchema: schema([
      { key: 'path', label: 'File', control: 'chip', placeholder: '~/notes/log.md' },
      { key: 'content', label: 'Text', control: 'chiparea' },
    ]),
  },
  {
    id: 'files.read',
    title: 'Read a file',
    group: 'builtin',
    auth: 'none',
    outputs: [{ name: 'content', type: 'text' }],
    paramsSchema: schema([{ key: 'path', label: 'File', control: 'chip', placeholder: '~/notes/log.md' }]),
  },
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
    paramsSchema: schema([
      { key: 'method', label: 'Method', control: 'select', options: ['GET', 'POST', 'PUT', 'DELETE'] },
      { key: 'url', label: 'URL', control: 'chip', placeholder: 'https://api.example.com/…' },
      { key: 'body', label: 'Body', control: 'chiparea' },
    ]),
  },
  {
    id: 'github.create_pr',
    title: 'Create a pull request',
    group: 'connector',
    auth: 'token',
    credentialLabelHint: 'GitHub',
    outputs: [
      { name: 'prUrl', type: 'text' },
      { name: 'prNumber', type: 'number' },
    ],
    paramsSchema: schema([
      { key: 'repo', label: 'Repository', control: 'text', placeholder: 'org/repo' },
      { key: 'title', label: 'Title', control: 'chip' },
      { key: 'body', label: 'Body', control: 'chiparea' },
      { key: 'head', label: 'Branch', control: 'chip', placeholder: 'feature/…' },
      { key: 'base', label: 'Base branch', control: 'text', placeholder: 'main' },
    ]),
  },
  {
    id: 'github.list_prs',
    title: 'List my open PRs',
    group: 'connector',
    auth: 'token',
    credentialLabelHint: 'GitHub',
    outputs: [{ name: 'prs', type: 'list' }],
    paramsSchema: schema([{ key: 'author', label: 'Author', control: 'text', placeholder: '@me' }]),
  },
  {
    id: 'notion.add_row',
    title: 'Add a database row',
    group: 'connector',
    auth: 'token',
    credentialLabelHint: 'Notion',
    outputs: [{ name: 'pageUrl', type: 'text' }],
    paramsSchema: schema([
      { key: 'databaseId', label: 'Database', control: 'select', options: NOTION_DATABASES },
      {
        key: '__columns',
        label: 'Row',
        control: 'columns',
        columnsSourceKey: 'databaseId',
        columnsByOption: NOTION_COLUMNS,
      },
    ]),
  },
  {
    id: 'ado.create_item',
    title: 'Create a work item',
    group: 'connector',
    auth: 'token',
    credentialLabelHint: 'Azure DevOps',
    outputs: [
      { name: 'workItemId', type: 'number' },
      { name: 'url', type: 'text' },
    ],
    paramsSchema: schema([
      { key: 'org', label: 'Organization', control: 'text', placeholder: 'my-org' },
      { key: 'project', label: 'Project', control: 'text', placeholder: 'my-project' },
      { key: 'type', label: 'Type', control: 'select', options: ['Task', 'Bug', 'User Story'] },
      { key: 'title', label: 'Title', control: 'chip' },
      { key: 'description', label: 'Description', control: 'chiparea' },
    ]),
  },
];
