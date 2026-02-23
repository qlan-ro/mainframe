import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import {
  sendMessage,
  waitForAIIdle,
  waitForPermissionCard,
  waitForPermissionCardHandlingPlan,
  waitForAskQuestionCard,
} from '../helpers/wait.js';

test.describe('§6 Permission system — Interactive', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'default');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('shows PermissionCard for a file creation request', async () => {
    await sendMessage(fixture.page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    // Claude may enter plan mode before executing — approve it to reach the file-write permission card
    await waitForPermissionCardHandlingPlan(fixture.page);
    await expect(fixture.page.locator('[data-testid="permission-card"]')).toBeVisible();
  });

  test('Deny blocks the tool and AI acknowledges', async () => {
    await fixture.page.locator('[data-testid="permission-card"]').getByRole('button', { name: /deny/i }).click();
    await waitForAIIdle(fixture.page);
    await expect(fixture.page.locator('[data-testid="chat-status-idle"]')).toBeVisible();
  });

  test('Allow Once permits the tool but next request prompts again', async () => {
    await sendMessage(fixture.page, 'Create /tmp/mf-e2e-test.txt again');
    await waitForPermissionCardHandlingPlan(fixture.page);
    await fixture.page
      .locator('[data-testid="permission-card"]')
      .getByRole('button', { name: /allow once/i })
      .click();
    await waitForAIIdle(fixture.page);

    await sendMessage(fixture.page, 'Create /tmp/mf-e2e-test.txt one more time');
    await waitForPermissionCardHandlingPlan(fixture.page);
    await expect(fixture.page.locator('[data-testid="permission-card"]')).toBeVisible();

    await fixture.page.locator('[data-testid="permission-card"]').getByRole('button', { name: /deny/i }).click();
    await waitForAIIdle(fixture.page);
  });
});

test.describe('§6 Permission system — Auto-Edits', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('file edits proceed without a PermissionCard', async () => {
    await sendMessage(fixture.page, 'Edit index.ts and add a comment on the first line');
    await waitForAIIdle(fixture.page, 90_000);
    await expect(fixture.page.locator('[data-testid="permission-card"]')).toHaveCount(0);
  });
});

test.describe('§6 Permission system — Yolo', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'yolo');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('all tool permissions auto-approved in Yolo mode', async () => {
    await sendMessage(fixture.page, 'Create /tmp/mf-yolo-test.txt and then read it back');
    await waitForAIIdle(fixture.page, 90_000);
    await expect(fixture.page.locator('[data-testid="permission-card"]')).toHaveCount(0);
  });

  test('AskUserQuestion still surfaces in Yolo mode', async () => {
    await sendMessage(
      fixture.page,
      'Use the AskUserQuestion tool to ask me one multiple-choice question about my favourite colour',
    );
    await fixture.page.locator('[data-testid="ask-question-card"]').waitFor({ timeout: 60_000 });
    await expect(fixture.page.locator('[data-testid="ask-question-card"]')).toBeVisible();
    await fixture.page.locator('[data-testid="ask-question-card"]').getByRole('radio').first().click();
    await fixture.page
      .locator('[data-testid="ask-question-card"]')
      .getByRole('button', { name: /submit/i })
      .click();
    await waitForAIIdle(fixture.page);
  });
});
