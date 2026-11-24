// Seeding helpers: realistic, stable projects and sessions, so boards read like the app in use and
// re-capturing an unchanged screen gives the same board.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DAEMON_BASE } from '../../../packages/e2e/fixtures/daemon.js';
import { waitConnected } from '../../../packages/e2e/helpers/tauri/wait.js';
import { workspace } from '../../../packages/e2e/helpers/tauri/page-objects.js';
import { createTauriChat } from '../../../packages/e2e/helpers/tauri/setup.js';
import { WORK_DIR } from './isolation.mts';
import type { Page } from '../../../packages/e2e/node_modules/@playwright/test/index.mjs';

const PROJECTS_DIR = path.join(WORK_DIR, 'projects');

/** What the run's own paths are drawn as on the boards, longest first. */
export const PATH_ALIASES: [string, string][] = [
  [PROJECTS_DIR, '~/Code'],
  [path.join(WORK_DIR, 'home'), '~'],
];

async function api<T>(method: string, route: string, body?: unknown): Promise<T> {
  const res = await fetch(`${DAEMON_BASE}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${route} failed (${res.status} ${await res.text()})`);
  return ((await res.json()) as { data: T }).data;
}

const DEFAULT_FILES: Record<string, string> = {
  'CLAUDE.md': '# Project\n\nUse pnpm. Run the tests before every commit.\n',
  'index.ts': 'export const greeting = "hello";\n',
};

/** A fresh git project, registered with the daemon. Returns its id. */
export async function seedProject(name: string, files: Record<string, string> = DEFAULT_FILES): Promise<string> {
  const dir = path.join(PROJECTS_DIR, name);
  rmSync(dir, { recursive: true, force: true });
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), text);
  }
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'user.email=capture@mainframe.test', '-c', 'user.name=Capture', ...args], { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Initial commit');
  const { id } = await api<{ id: string }>('POST', '/api/projects', { path: dir, name });
  return id;
}

/** The app reads its project list once, on mount: call after seeding the projects of a group. */
export async function reload(page: Page): Promise<void> {
  await page.reload();
  await waitConnected(page);
}

/** Creates, opens and names a session. */
export async function seedChat(page: Page, projectId: string, title: string): Promise<string> {
  const id = await createTauriChat(page, projectId);
  await renameChat(page, id, title);
  return id;
}

/** Call again after a turn has run: the first reply renames a session. */
export async function renameChat(page: Page, id: string, title: string): Promise<void> {
  await api('PATCH', `/api/chats/${id}/title`, { title });
  await page.locator(`[data-testid="sessions-row"][data-chat-id="${id}"]`, { hasText: title }).waitFor();
}

/** Answers `GET url` with `data`, for state the mock daemon has no source for. */
export async function stub(page: Page, url: string | RegExp, data: unknown): Promise<void> {
  await page.route(url, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { success: true, data }, headers: { 'access-control-allow-origin': '*' } })
      : route.fallback(),
  );
}

/** Makes a route fail, for error states. */
export async function fail(page: Page, url: string | RegExp, error: string, method = 'GET'): Promise<void> {
  await page.route(url, (route) =>
    route.request().method() === method
      ? route.fulfill({
          status: 500,
          json: { success: false, error },
          headers: { 'access-control-allow-origin': '*' },
        })
      : route.fallback(),
  );
}

/** Parks the pointer where it hovers nothing, so no hover leaks into the next state. */
export async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(1, 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
}

/** Opens a session from the sidebar and keeps its tab, so the next one opens beside it. */
export async function openTab(page: Page, chatId: string): Promise<void> {
  await page.locator(`[data-testid="sessions-row"][data-chat-id="${chatId}"]`).click();
  await page.getByTestId(`session-tab-${chatId}`).dblclick();
  await page.getByTestId('chat-composer-input').waitFor();
}

/** Closes whatever menu, popover or dialog the previous state left open. */
export async function escape(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  // Not just closed but unmounted: a menu animating out would answer the next state's test ids too.
  await page.waitForFunction(() => !document.querySelector('[role="menu"], [role="dialog"]'));
  await parkPointer(page);
}

const HOUR = 3_600_000;

/** Plan usage for both providers; the mock daemon has none. */
export async function stubUsage(page: Page): Promise<void> {
  const now = Date.now();
  // Half an hour of slack keeps the rounded "resets in 3h" the same for as long as a run takes.
  const window = (kind: string, usedPercent: number, hours: number) => ({
    kind,
    usedPercent,
    resetsAt: now + hours * HOUR + HOUR / 2,
    observedAt: now,
  });
  await stub(page, /\/api\/providers\/claude\/quota$/, {
    status: 'ok',
    session: window('session', 42, 3),
    weekly: window('weekly', 61, 52),
    modelWindows: [],
    observedAt: now,
  });
  await stub(page, /\/api\/providers\/codex\/quota$/, {
    status: 'ok',
    session: window('session', 18, 4),
    weekly: window('weekly', 35, 90),
    modelWindows: [],
    observedAt: now,
  });
}

export interface Workbench {
  atlas: string;
  ledger: string;
  /** Session ids, newest last. */
  chats: string[];
}

const SESSIONS: ['atlas' | 'ledger', string][] = [
  ['ledger', 'Reconcile the November export'],
  ['ledger', 'Add idempotency keys to transfers'],
  ['atlas', 'Trim the bundle below 300 kB'],
  ['atlas', 'Fix the flaky checkout test'],
  ['ledger', 'Document the webhook retries'],
  ['atlas', 'Where is greeting defined?'],
];

/** Two projects and six sessions: the populated window most boards start from. */
export async function seedWorkbench(page: Page, atlasFiles?: Record<string, string>): Promise<Workbench> {
  const atlas = await seedProject('atlas-web', atlasFiles);
  const ledger = await seedProject('ledger-api');
  await reload(page);
  const chats: string[] = [];
  for (const [project, title] of SESSIONS) {
    chats.push(await seedChat(page, project === 'atlas' ? atlas : ledger, title));
  }
  return { atlas, ledger, chats };
}

/** Files a workspace state opens: one per kind of name a tab has to cope with. */
export const WORKSPACE_FILES: Record<string, string> = {
  ...DEFAULT_FILES,
  'UsageCapsule.tsx': 'export function UsageCapsule() {\n  return <button className="capsule">42%</button>;\n}\n',
  'use-quota.ts': 'export const useQuota = () => ({ percent: 42 });\n',
  'quota.rs': 'pub fn percent() -> u8 {\n    42\n}\n',
};

/** Shows the workspace and opens files in it as kept tabs; the last one is selected. */
export async function openWorkspaceFiles(page: Page, files: string[]): Promise<void> {
  if ((await page.getByTestId('workspace-surface').count()) === 0) {
    await page.getByTestId('surface-rail-workspace').click();
    await page.getByTestId('workspace-surface').waitFor();
  }
  for (const file of files) {
    await workspace(page).openFilePicker();
    await page.getByTestId('file-picker-input').fill(file);
    await page.locator('[data-testid^="file-picker-row-"]', { hasText: file }).first().click();
    const tab = workspace(page).tab(file);
    await tab.waitFor();
    // A picked file opens as a preview the next one would replace.
    await tab.dblclick();
  }
}
