import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { sendMessage, waitForAIIdle, waitForPlanCard } from '../helpers/wait.js';

test.describe('§7 Plan approval', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'plan');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('PlanApprovalCard appears and plan can be approved', async () => {
    await sendMessage(fixture.page, 'Add a greet function to utils.ts');
    await waitForPlanCard(fixture.page, 90_000);
    await expect(fixture.page.locator('[data-testid="plan-approval-card"]')).toBeVisible();
    await fixture.page
      .locator('[data-testid="plan-approval-card"]')
      .getByRole('button', { name: /approve plan/i })
      .click();
    await waitForAIIdle(fixture.page, 120_000);
  });

  test('plan revision feedback is sent back to AI', async () => {
    await createTestChat(fixture.page, project.projectId, 'plan');
    await sendMessage(fixture.page, 'Add a multiply function to utils.ts');
    await waitForPlanCard(fixture.page, 90_000);
    const card = fixture.page.locator('[data-testid="plan-approval-card"]');
    await card.getByRole('button', { name: /revise/i }).click();
    await card.getByRole('textbox').waitFor({ timeout: 5_000 });
    await card.getByRole('textbox').fill('Please also add a divide function');
    await card.getByRole('button', { name: /send feedback/i }).click();
    await waitForPlanCard(fixture.page, 90_000);
    await expect(fixture.page.locator('[data-testid="plan-approval-card"]')).toBeVisible();
  });
});
