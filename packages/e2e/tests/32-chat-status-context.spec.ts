import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { sendMessage, waitForAIIdle, chat } from '../helpers/wait.js';

test.describe('§32 Chat status & context usage', () => {
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

  test('session bar shows adapter label', async () => {
    const { page } = fixture;

    const adapterLabel = page.locator('[data-testid="session-bar-adapter"]');
    await expect(adapterLabel).toBeVisible({ timeout: 5_000 });
    await expect(adapterLabel).toHaveText('Claude');
  });

  test('status shows "Thinking" while AI is working', async () => {
    const { page } = fixture;

    // Send a message that takes a moment to process
    await sendMessage(page, 'Explain what TypeScript generics are in two sentences.');

    // Check for "Thinking" in the status area — may appear briefly
    const statusArea = page.locator('[data-testid="session-bar-status"]');
    await expect(statusArea.getByText('Thinking')).toBeVisible({ timeout: 10_000 });

    // Wait for completion
    await waitForAIIdle(page, 60_000);
  });

  test('context usage percentage appears after AI response', async () => {
    const { page } = fixture;

    // After the first AI response, context usage should be non-zero
    const pct = page.locator('[data-testid="session-bar-context-pct"]');
    await expect(pct).toBeVisible({ timeout: 5_000 });
    const text = await pct.textContent();
    expect(text).toMatch(/^\d+%$/);
  });

  test('context usage increases with conversation length', async () => {
    const { page } = fixture;

    // Record current percentage
    const pct = page.locator('[data-testid="session-bar-context-pct"]');
    const beforeText = await pct.textContent();
    const beforeValue = parseInt(beforeText!.replace('%', ''), 10);

    // Send a longer message to grow context
    await chat(
      page,
      'Now explain TypeScript mapped types, conditional types, and template literal types. Be thorough.',
      90_000,
    );

    // Percentage should have increased
    await expect(pct).toBeVisible();
    const afterText = await pct.textContent();
    const afterValue = parseInt(afterText!.replace('%', ''), 10);
    expect(afterValue).toBeGreaterThan(beforeValue);
  });
});
