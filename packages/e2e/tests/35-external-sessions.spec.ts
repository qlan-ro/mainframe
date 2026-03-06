import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { homedir } from 'os';
import path from 'path';

const DAEMON_BASE = `http://127.0.0.1:${process.env['PORT'] ?? '31415'}`;

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
      message: {
        content: [{ type: 'text', text: opts.firstPrompt ?? 'Test external session' }],
      },
    }),
  ];
  writeFileSync(filePath, lines.join('\n') + '\n');
  return claudeDir;
}

test.describe('§35 External session import', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let claudeDir: string;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);

    // Seed two external sessions
    claudeDir = seedExternalSession(project.projectPath, 'ext-session-aaa', {
      firstPrompt: 'Fix the login bug',
      gitBranch: 'feat/login-fix',
    });
    seedExternalSession(project.projectPath, 'ext-session-bbb', {
      firstPrompt: 'Add unit tests for auth module',
      gitBranch: 'feat/auth-tests',
    });

    // Trigger a re-scan so the daemon picks up the seeded sessions
    await fixture.page.request.get(`${DAEMON_BASE}/api/projects/${project.projectId}/external-sessions`);
    // Wait for the WS count event to propagate
    await fixture.page.waitForTimeout(1000);
  });

  test.afterAll(async () => {
    // Clean up seeded Claude session files
    rmSync(claudeDir, { recursive: true, force: true });
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('shows external sessions badge', async () => {
    const section = fixture.page.locator('[data-testid="external-sessions-section"]');
    await expect(section).toBeVisible({ timeout: 10_000 });
    // Badge should show count
    await expect(section.locator('[data-testid="external-sessions-toggle"]')).toContainText('2');
  });

  test('expands to show importable sessions', async () => {
    await fixture.page.locator('[data-testid="external-sessions-toggle"]').click();
    const items = fixture.page.locator('[data-testid="external-session-item"]');
    await expect(items).toHaveCount(2, { timeout: 10_000 });
    // Verify session content is displayed
    await expect(items.first()).toContainText(/(Fix the login bug|Add unit tests)/);
  });

  test('external session titles have tooltips', async () => {
    const firstTitle = fixture.page.locator('[data-testid="external-session-item"]').first().locator('.truncate');
    const titleAttr = await firstTitle.getAttribute('title');
    expect(titleAttr).toBeTruthy();
  });

  test('imports an external session', async () => {
    const chatsBefore = await fixture.page.locator('[data-testid="chat-list-item"]').count();

    // Click the first Import button
    const firstItem = fixture.page.locator('[data-testid="external-session-item"]').first();
    await firstItem.locator('[data-testid="import-session-btn"]').click();

    // Session should disappear from import list
    await expect(fixture.page.locator('[data-testid="external-session-item"]')).toHaveCount(1, { timeout: 10_000 });

    // Chat list should have one more entry
    await expect(fixture.page.locator('[data-testid="chat-list-item"]')).toHaveCount(chatsBefore + 1, {
      timeout: 10_000,
    });
  });

  test('imported session has a title', async () => {
    // The most recently imported chat should be at the top of the list
    const firstChat = fixture.page.locator('[data-testid="chat-list-item"]').first();
    // It should NOT say "New Chat" — it should have the firstPrompt as title
    const text = await firstChat.textContent();
    expect(text).not.toContain('New Chat');
  });

  test('import does not switch active chat', async () => {
    // Click the first chat to make it active
    const firstChat = fixture.page.locator('[data-testid="chat-list-item"]').first();
    await firstChat.click();
    // Wait for active state (font-medium class)
    await expect(firstChat.locator('.font-medium')).toBeVisible({ timeout: 5_000 });
    const activeTextBefore = await firstChat.locator('.font-medium').textContent();

    // Import the remaining session
    const remainingItem = fixture.page.locator('[data-testid="external-session-item"]').first();
    await remainingItem.locator('[data-testid="import-session-btn"]').click();

    // Wait for import to complete
    await expect(fixture.page.locator('[data-testid="external-session-item"]')).toHaveCount(0, { timeout: 10_000 });

    // Active chat should NOT have changed
    const activeAfter = fixture.page.locator('[data-testid="chat-list-item"]').locator('.font-medium');
    await expect(activeAfter).toHaveText(activeTextBefore!);
  });
});
