import { test, expect } from '@playwright/test';
import { writeFileSync } from 'fs';
import path from 'path';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { sendMessage, waitForAIIdle } from '../helpers/wait.js';

type SandboxStore = { getState: () => { addCapture: (c: Record<string, unknown>) => void; clearCaptures: () => void } };
type AppWindow = typeof globalThis & { __sandboxStore?: SandboxStore };

// Minimal 1x1 red PNG — valid image, tiny payload
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

test.describe('§25 Image lightbox', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;
  let testImagePath: string;

  test.beforeAll(async () => {
    fixture = await launchApp();
    project = await createTestProject(fixture.page);

    // Create a test PNG file inside the project dir
    testImagePath = path.join(project.projectPath, 'test-image.png');
    writeFileSync(testImagePath, Buffer.from(TINY_PNG_BASE64, 'base64'));

    await createTestChat(fixture.page, project.projectId, 'yolo');
  });

  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  // --- Composer: file attachment lightbox ---

  test('file attachment thumbnail appears in composer', async () => {
    const { page } = fixture;

    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[aria-label="Add attachment"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);

    const thumb = page.locator('[data-testid="attachment-thumb"]');
    await thumb.waitFor({ timeout: 5_000 });
    await expect(thumb).toBeVisible();
  });

  test('clicking file attachment thumbnail opens lightbox', async () => {
    const { page } = fixture;

    await page.locator('[data-testid="attachment-thumb"]').click();

    const lightbox = page.locator('[data-testid="image-lightbox"]');
    await lightbox.waitFor({ timeout: 3_000 });
    await expect(lightbox).toBeVisible();
    await expect(page.locator('[data-testid="lightbox-image"]')).toBeVisible();
  });

  test('lightbox closes with Escape key', async () => {
    const { page } = fixture;

    // Lightbox is still open from the previous test
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-testid="image-lightbox"]')).not.toBeVisible();
  });

  // --- Composer: capture thumbnail lightbox ---

  test('capture thumbnail appears in composer when injected', async () => {
    const { page } = fixture;

    // Inject a capture via the exposed sandbox store
    await page.evaluate((dataUrl) => {
      const store = (window as AppWindow).__sandboxStore;
      if (!store) throw new Error('__sandboxStore not exposed on window');
      store.getState().addCapture({
        type: 'element',
        imageDataUrl: dataUrl,
        selector: 'div.hero',
      });
    }, TINY_PNG_DATA_URL);

    const captureThumb = page.locator('[data-testid="capture-thumb"]');
    await captureThumb.waitFor({ timeout: 5_000 });
    await expect(captureThumb).toBeVisible();
  });

  test('clicking capture thumbnail opens lightbox', async () => {
    const { page } = fixture;

    await page.locator('[data-testid="capture-thumb"]').click();

    const lightbox = page.locator('[data-testid="image-lightbox"]');
    await lightbox.waitFor({ timeout: 3_000 });
    await expect(lightbox).toBeVisible();
    await expect(page.locator('[data-testid="lightbox-image"]')).toBeVisible();

    // Close for next test
    await page.keyboard.press('Escape');
    await expect(lightbox).not.toBeVisible();
  });

  test('lightbox closes when clicking the overlay background', async () => {
    const { page } = fixture;

    // Re-open lightbox from capture thumb
    await page.locator('[data-testid="capture-thumb"]').click();
    const lightbox = page.locator('[data-testid="image-lightbox"]');
    await lightbox.waitFor({ timeout: 3_000 });

    // Click the overlay background (top-left corner, away from center image)
    await lightbox.click({ position: { x: 5, y: 5 } });
    await expect(lightbox).not.toBeVisible();
  });

  // --- Chat message: image thumbnail lightbox ---

  test('sending a message with image shows thumbnail in chat', async () => {
    const { page } = fixture;

    // Clear captures and start a fresh chat to get a clean composer
    await page.evaluate(() => {
      (window as AppWindow).__sandboxStore!.getState().clearCaptures();
    });
    await createTestChat(page, project.projectId, 'yolo');

    // Attach an image
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('[aria-label="Add attachment"]').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(testImagePath);

    await page.locator('[data-testid="attachment-thumb"]').first().waitFor({ timeout: 5_000 });

    // Send with an attached image — AI responds (yolo mode, no permissions)
    await sendMessage(page, 'I attached a test image. Reply with just "ok".');
    await waitForAIIdle(page);

    // The user message should now have an image thumbnail
    const messageThumb = page.locator('[data-testid="message-image-thumb"]').first();
    await messageThumb.waitFor({ timeout: 10_000 });
    await expect(messageThumb).toBeVisible();
  });

  test('clicking message image thumbnail opens lightbox', async () => {
    const { page } = fixture;

    const messageThumb = page.locator('[data-testid="message-image-thumb"]').first();
    await messageThumb.click();

    const lightbox = page.locator('[data-testid="image-lightbox"]');
    await lightbox.waitFor({ timeout: 3_000 });
    await expect(lightbox).toBeVisible();
    await expect(page.locator('[data-testid="lightbox-image"]')).toBeVisible();

    // Close
    await page.keyboard.press('Escape');
    await expect(lightbox).not.toBeVisible();
  });

  // --- Multiple captures: lightbox navigation ---

  test('lightbox supports arrow key navigation with multiple images', async () => {
    const { page } = fixture;

    // Inject two captures
    await page.evaluate((dataUrl) => {
      const store = (window as AppWindow).__sandboxStore!;
      store.getState().clearCaptures();
      store.getState().addCapture({
        type: 'element',
        imageDataUrl: dataUrl,
        selector: 'div.first',
      });
      store.getState().addCapture({
        type: 'screenshot',
        imageDataUrl: dataUrl,
      });
    }, TINY_PNG_DATA_URL);

    const captureThumb = page.locator('[data-testid="capture-thumb"]');
    await expect(captureThumb).toHaveCount(2);

    // Click the first capture
    await captureThumb.first().click();
    const lightbox = page.locator('[data-testid="image-lightbox"]');
    await lightbox.waitFor({ timeout: 3_000 });

    // Should show "1 / 2" counter
    await expect(lightbox.getByText('1 / 2')).toBeVisible();

    // Navigate right
    await page.keyboard.press('ArrowRight');
    await expect(lightbox.getByText('2 / 2')).toBeVisible();

    // Navigate back left
    await page.keyboard.press('ArrowLeft');
    await expect(lightbox.getByText('1 / 2')).toBeVisible();

    // Clean up
    await page.keyboard.press('Escape');
    await page.evaluate(() => {
      (window as AppWindow).__sandboxStore!.getState().clearCaptures();
    });
  });
});
