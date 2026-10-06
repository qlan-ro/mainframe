import type { ToolStatus } from './types';
import { displayText } from './values';

const verbs = {
  read: ['Read', 'Reading', 'Read'],
  edit: ['Edit', 'Editing', 'Edited'],
  write: ['Write', 'Writing', 'Wrote'],
  glob: ['Find files', 'Finding files', 'Found files'],
  grep: ['Search', 'Searching', 'Searched'],
  list: ['List', 'Listing', 'Listed'],
  'web-search': ['Search the web', 'Searching the web', 'Searched the web'],
  fetch: ['Fetch', 'Fetching', 'Fetched'],
  subagent: ['Run agent', 'Running agent', 'Ran agent'],
  // The row's status icon already says running or done, so a generic command carries no verb there.
  command: ['Run', '', ''],
  lint: ['Run lint', 'Running lint', 'Lint passed'],
  typecheck: ['Run typecheck', 'Running typecheck', 'Typecheck passed'],
  test: ['Run tests', 'Running tests', 'Tests passed'],
  format: ['Format code', 'Formatting code', 'Formatted code'],
  build: ['Build', 'Building', 'Build passed'],
  install: ['Install dependencies', 'Installing dependencies', 'Installed dependencies'],
  'git-status': ['Check Git status', 'Checking Git status', 'Checked Git status'],
  'git-diff': ['View Git diff', 'Viewing Git diff', 'Viewed Git diff'],
  'git-log': ['View Git history', 'Viewing Git history', 'Viewed Git history'],
  'git-show': ['View Git changes', 'Viewing Git changes', 'Viewed Git changes'],
  'git-add': ['Stage changes', 'Staging changes', 'Staged changes'],
  'git-commit': ['Commit changes', 'Committing changes', 'Committed changes'],
  'git-push': ['Push changes', 'Pushing changes', 'Pushed changes'],
  'git-pull': ['Pull changes', 'Pulling changes', 'Pulled changes'],
  'git-fetch': ['Fetch changes', 'Fetching changes', 'Fetched changes'],
  'git-switch': ['Switch branches', 'Switching branches', 'Switched branches'],
} as const;
export type ActionKind = keyof typeof verbs;
export type Action = { kind: ActionKind; target?: string };

export function actionLabel({ kind, target }: Action, status: ToolStatus): string {
  const [base, running, success] = verbs[kind];
  const suffix = target ? ` ${displayText(target)}` : '';
  if (status === 'running') return (running + suffix).trim();
  if (status === 'success') return (success + suffix).trim();
  if (status === 'unknown') return base + suffix + ' (status unknown)';
  const action = base.charAt(0).toLowerCase() + base.slice(1) + suffix;
  if (status === 'failed') return `Failed to ${action}`;
  if (status === 'stopped') return `Stopped: ${action}`;
  if (status === 'declined') return `Declined: ${action}`;
  return `Waiting for approval: ${action}`;
}
