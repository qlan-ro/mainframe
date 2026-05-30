import { test, expect } from '@playwright/test';
import { launchApp, closeApp, DAEMON_PORT } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const DAEMON_BASE = `http://127.0.0.1:${DAEMON_PORT}`;

/** Encode a project path the same way the Claude adapter does. */
function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9-]/g, '-');
}

/** Create a fake JSONL session file in the Claude project directory. */
function seedExternalSession(
  projectPath: string,
  sessionId: string,
  opts: { firstPrompt?: string; gitBranch?: string } = {},
): string {
  const claudeDir = path.join(homedir(), '.claude', 'projects', encodeProjectPath(projectPath));
  mkdirSync(claudeDir, { recursive: true });

  const filePath = path.join(claudeDir, `${sessionId}.jsonl`);
  const lines = [
    JSON.stringify({
      type: 'user',
      timestamp: new Date().toISOString(),
      gitBranch: opts.gitBranch ?? 'main',
      // The adapter only lists a session whose cwd is under the project path (cwdBelongsToProject),
      // so the seeded JSONL must carry cwd just like the real Claude CLI writes it.
      cwd: projectPath,
      message: {
        content: [{ type: 'text', text: opts.firstPrompt ?? 'Test external session' }],
      },
    }),
  ];
  writeFileSync(filePath, lines.join('\n') + '\n');
  return claudeDir;
}

/**
 * Open the import popover and select the project. With no project filter active, the popover first
 * asks which project to import from (selectedProjectId defaults to filterProjectId, which is null),
 * so we click through the project picker before sessions load.
 */
async function openImportPopover(page: import('@playwright/test').Page, projectId: string): Promise<void> {
  await page.locator('[data-testid="import-sessions-btn"]').click();
  const projectBtn = page.locator(`[data-testid="chats-import-project-${projectId}"]`);
  await projectBtn.waitFor({ timeout: 5_000 }).catch(() => {}); // absent if a filter is already active
  if (await projectBtn.isVisible().catch(() => false)) await projectBtn.click();
}

test.describe('§35 External session import', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let claudeDir: string;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);

    claudeDir = seedExternalSession(project.projectPath, 'ext-session-aaa', {
      firstPrompt: 'Fix the login bug',
      gitBranch: 'feat/login-fix',
    });
    seedExternalSession(project.projectPath, 'ext-session-bbb', {
      firstPrompt: 'Add unit tests for auth module',
      gitBranch: 'feat/auth-tests',
    });

    await fixture.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/external-sessions`);
    await fixture.page.waitForTimeout(1000);
  });

  test.afterAll(async () => {
    rmSync(claudeDir, { recursive: true, force: true });
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('import button is enabled when external sessions exist', async () => {
    const btn = fixture.page.locator('[data-testid="import-sessions-btn"]');
    await expect(btn).toBeVisible({ timeout: 10_000 });
    await expect(btn).toBeEnabled();
  });

  test('opens popover and shows importable sessions', async () => {
    await openImportPopover(fixture.page, project.projectId);
    const items = fixture.page.locator('[data-testid="external-session-item"]');
    await expect(items).toHaveCount(2, { timeout: 10_000 });
    await expect(items.first()).toContainText(/(Fix the login bug|Add unit tests)/);
  });

  test('imports a session and closes popover', async () => {
    // Re-open popover if closed
    const items = fixture.page.locator('[data-testid="external-session-item"]');
    if ((await items.count()) === 0) {
      await openImportPopover(fixture.page, project.projectId);
      await expect(items.first()).toBeVisible({ timeout: 10_000 });
    }

    const chatsBefore = await fixture.page.locator('[data-testid="chat-list-item"]').count();

    await items.first().locator('[data-testid="import-session-btn"]').click();

    // Popover should close after import
    await expect(items).toHaveCount(0, { timeout: 10_000 });

    // Chat list should have one more entry
    await expect(fixture.page.locator('[data-testid="chat-list-item"]')).toHaveCount(chatsBefore + 1, {
      timeout: 10_000,
    });
  });

  test('imported session has a title', async () => {
    const firstChat = fixture.page.locator('[data-testid="chat-list-item"]').first();
    const text = await firstChat.textContent();
    expect(text).not.toContain('Untitled session');
  });

  test('import does not switch active chat', async () => {
    const firstChat = fixture.page.locator('[data-testid="chat-list-item"]').first();
    await firstChat.click();
    // The active session's title renders bold (font-medium); scope to the title span so the row's
    // other bold elements don't trip strict mode.
    const activeTitle = fixture.page.locator('[data-testid="session-title-text"].font-medium').first();
    await expect(activeTitle).toBeVisible({ timeout: 5_000 });
    const activeTextBefore = await activeTitle.textContent();

    // Open popover and import the remaining session
    await openImportPopover(fixture.page, project.projectId);
    const remaining = fixture.page.locator('[data-testid="external-session-item"]').first();
    await expect(remaining).toBeVisible({ timeout: 10_000 });
    await remaining.locator('[data-testid="import-session-btn"]').click();

    // Popover closes
    await expect(fixture.page.locator('[data-testid="external-session-item"]')).toHaveCount(0, { timeout: 10_000 });

    // Active chat unchanged (the bold title still matches)
    await expect(fixture.page.locator('[data-testid="session-title-text"].font-medium').first()).toHaveText(
      activeTextBefore!,
    );
  });
});
