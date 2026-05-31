import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';

// New coverage from scenarios/skills-plugins-tutorial.md (SK1). No AI.
// Seeds a project skill (.claude/skills/<name>/SKILL.md) so discovery is deterministic — the
// Claude adapter's listSkills scans projectPath/.claude/skills.
test.describe('§46 Skills panel', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);

    const skillDir = path.join(project.projectPath, '.claude', 'skills', 'e2e-test-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: e2e-test-skill\ndescription: Seeded skill for e2e testing\n---\n\nDo the thing.\n',
    );

    // Skills are project-scoped via the active chat's project; this triggers fetchSkills.
    await createTestChat(fixture.page, project.projectId, 'default');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('SK1: skills panel lists the project skill and clicking it queues its slash command', async () => {
    const { page } = fixture;
    // The Skills panel is the default-active tab in the left-bottom zone, so it's already shown —
    // clicking its rail button would toggle it closed. Just wait for the seeded skill to load.
    const seeded = page.locator('[data-testid^="skills-item-name-"]').filter({ hasText: 'e2e-test-skill' });
    await expect(seeded.first()).toBeVisible({ timeout: 15_000 });

    await seeded.first().click();
    // Clicking a skill pre-fills the composer with "/<invocationName> ".
    await expect(page.getByRole('textbox').first()).toHaveValue(/^\/e2e-test-skill/, { timeout: 5_000 });
  });
});
