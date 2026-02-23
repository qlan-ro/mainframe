import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { sendMessage, waitForAIIdle, waitForAskQuestionCard } from '../helpers/wait.js';

test.describe('§8 AskUserQuestion', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await fixture.page.keyboard.press('Meta+n');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('renders question with options and submit disabled until selection', async () => {
    await sendMessage(fixture.page, 'Use AskUserQuestion to ask me a single-select question with 2 options');
    await waitForAskQuestionCard(fixture.page, 60_000);
    const card = fixture.page.locator('[data-testid="ask-question-card"]');
    await expect(card.getByRole('button', { name: /submit/i })).toBeDisabled();
    await card.getByRole('radio').first().click();
    await expect(card.getByRole('button', { name: /submit/i })).not.toBeDisabled();
    await card.getByRole('button', { name: /submit/i }).click();
    await waitForAIIdle(fixture.page);
  });
});
