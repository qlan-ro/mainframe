import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import path from 'path';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { sendMessage, waitForAIIdle } from '../helpers/wait.js';

// Minimal 1x1 red PNG — valid image, tiny payload
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

test.describe('§30 Composer attachments', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let testImagePath: string;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);
    testImagePath = path.join(project.projectPath, 'test-image.png');
    writeFileSync(testImagePath, Buffer.from(TINY_PNG_BASE64, 'base64'));
    await createTestChat(fixture.page, project.projectId, 'acceptEdits');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('attaching an image shows thumbnail in composer', async () => {
    const { page } = fixture;

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[aria-label="Add attachment"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);

    const thumb = page.locator('[data-testid="attachment-thumb"]');
    await thumb.waitFor({ timeout: 5_000 });
    await expect(thumb).toBeVisible();
  });

  test('removing attachment clears it from composer', async () => {
    const { page } = fixture;

    // Thumb still visible from prior test
    const thumb = page.locator('[data-testid="attachment-thumb"]');
    await expect(thumb).toBeVisible();

    // Hover to reveal remove button, then click
    const group = thumb.locator('..');
    await group.hover();
    await page.locator('[aria-label="Remove"]').first().click();

    await expect(thumb).not.toBeVisible({ timeout: 3_000 });
  });

  test('sending a message with attachment gets AI response', async () => {
    const { page } = fixture;

    // Re-attach
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[aria-label="Add attachment"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);
    await page.locator('[data-testid="attachment-thumb"]').waitFor({ timeout: 5_000 });

    await sendMessage(page, 'I attached a test image. Reply with just "received".');
    await waitForAIIdle(page, 60_000);

    // AI should have responded (verifies the attachment was processed)
    const messageThumb = page.locator('[data-testid="message-image-thumb"]').first();
    await messageThumb.waitFor({ timeout: 10_000 });
    await expect(messageThumb).toBeVisible();
    await expect(page.getByText('received', { exact: true }).first()).toBeVisible({ timeout: 5_000 });
  });
});
