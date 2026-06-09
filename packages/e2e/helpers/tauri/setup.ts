import { execSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import type { Page } from '@playwright/test';
import { DAEMON_PORT } from '../../fixtures/daemon.js';
import { sessionsSidebar, composer } from './page-objects.js';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;
const DEFAULT_CLAUDE_MD =
  '# E2E Test Project\n\nAutomated test environment. Do not use plan mode. Execute tool calls directly.\n';

export interface TauriProject {
  projectPath: string;
  projectId: string;
}

/** Seed a project via REST. MUST be called before navigating, OR followed by reload():
 *  useProjects fetches once on mount and POST /api/projects broadcasts nothing. */
export async function createTauriProject(page: Page | undefined, opts?: { claudeMd?: string }): Promise<TauriProject> {
  const tmpBase = path.join(homedir(), 'tmp');
  mkdirSync(tmpBase, { recursive: true });
  const projectPath = realpathSync(mkdtempSync(path.join(tmpBase, 'mf-e2e-')));
  execSync(
    'git init -b main && git -c user.email=e2e@mainframe.test -c user.name="Mainframe E2E" commit --allow-empty -m "init"',
    { cwd: projectPath, stdio: 'pipe' },
  );
  writeFileSync(path.join(projectPath, 'CLAUDE.md'), opts?.claudeMd ?? DEFAULT_CLAUDE_MD);
  writeFileSync(path.join(projectPath, 'index.ts'), 'export const greeting = "hello";\n');

  const res = await fetch(`${DAEMON_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: projectPath, name: path.basename(projectPath) }),
  });
  if (!res.ok && res.status !== 409) {
    throw new Error(`createTauriProject: POST /api/projects failed (${res.status} ${await res.text()})`);
  }
  const body = (await res.json()) as { data?: { id?: string } };
  const projectId = body.data?.id;
  if (!projectId) throw new Error(`createTauriProject: no project id (${JSON.stringify(body)})`);

  if (page) {
    await page.reload();
    await page
      .locator('[data-testid="app-status-bar"]')
      .getByText('Daemon Connected', { exact: true })
      .waitFor({ timeout: 20_000 });
  }
  return { projectPath, projectId };
}

/** Create a chat via REST and select its row (uses data-chat-id). Returns the chat id. */
export async function createTauriChat(
  page: Page,
  projectId: string,
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'yolo' = 'default',
  adapterId = process.env['E2E_MODE'] === 'mock' ? 'mock-cli' : 'claude',
): Promise<string> {
  const wantsPlanMode = permissionMode === 'plan';
  const createMode = wantsPlanMode ? 'default' : permissionMode;
  const res = await fetch(`${DAEMON_BASE}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, adapterId, permissionMode: createMode }),
  });
  if (!res.ok) throw new Error(`createTauriChat: POST /api/chats failed (${res.status} ${await res.text()})`);
  const created = (await res.json()) as { data?: { id?: string } };
  const chatId = created.data?.id;
  if (!chatId) throw new Error(`createTauriChat: no chat id (${JSON.stringify(created)})`);

  const sidebar = sessionsSidebar(page);
  const row = sidebar.row(chatId);
  try {
    await row.waitFor({ timeout: 12_000 });
  } catch {
    // chat.created broadcast occasionally missed — reload to force a list resync, then retry.
    await page.reload();
    await page
      .locator('[data-testid="app-status-bar"]')
      .getByText('Daemon Connected', { exact: true })
      .waitFor({ timeout: 15_000 });
    await row.waitFor({ timeout: 15_000 });
  }
  await row.click();
  await composer(page).input().waitFor({ timeout: 12_000 });

  if (wantsPlanMode) {
    // Verified: PlanModeToggle exposes aria-pressed={active}.
    const toggle = page.getByTestId('composer-plan-toggle');
    await toggle.waitFor({ timeout: 10_000 });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
  }
  return chatId;
}

export function cleanupTauriProject(project?: TauriProject): void {
  if (!project) return;
  rmSync(project.projectPath, { recursive: true, force: true });
}
