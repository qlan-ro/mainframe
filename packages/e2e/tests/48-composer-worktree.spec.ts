import { test, expect } from '@playwright/test';
import { execSync } from 'child_process';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

// New coverage from scenarios/composer.md (M11 new-branch worktree, M12 attach existing). No AI.
// Worktrees land under projectPath/<worktreeDir>/<branch>, so cleanupProject removes them.
test.describe('§48 Composer worktree', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  const git = (cmd: string): string => execSync(cmd, { cwd: project.projectPath, stdio: 'pipe' }).toString();

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'default');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('M11: enable a worktree on a new branch', async () => {
    const { page } = fixture;
    await page.locator('[data-testid="composer-worktree"]').click();
    // Popover defaults to the "new" tab.
    await expect(page.locator('[data-testid="composer-worktree-branch-name"]')).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="composer-worktree-branch-name"]').fill('feat/wt-e2e');
    await page.locator('[data-testid="composer-worktree-enable"]').click();
    await expect(() => expect(git('git worktree list')).toContain('feat/wt-e2e')).toPass({ timeout: 20_000 });
  });

  test('M12: attach a second session to the existing worktree', async () => {
    const { page } = fixture;
    // A fresh chat (no worktree yet) to attach.
    await createTestChat(page, project.projectId, 'default');
    await page.locator('[data-testid="composer-worktree"]').click();
    await page.locator('[data-testid="composer-worktree-tab-existing"]').click();
    const attach = page.locator('[data-testid^="composer-worktree-attach-"]').first();
    await expect(attach).toBeVisible({ timeout: 10_000 });
    await attach.click();
    // The worktree popover closes and the worktree button reflects the attached state.
    await expect(page.locator('[data-testid="composer-worktree-tab-existing"]')).toHaveCount(0, { timeout: 10_000 });
  });
});
