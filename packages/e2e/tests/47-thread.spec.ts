import { test, expect } from '@playwright/test';
import { launchApp, closeApp } from '../fixtures/app.js';
import { createTestProject, cleanupProject } from '../fixtures/project.js';
import { createTestChat } from '../fixtures/chat.js';
import { chat, sendMessage, waitForAIIdle } from '../helpers/wait.js';

// New coverage from scenarios/thread-messages.md (TH7, TH8). Uses AI (yolo so no permission cards).
test.describe('§47 Thread interactions', () => {
  let fixture: Awaited<ReturnType<typeof launchApp>>;
  let project: Awaited<ReturnType<typeof createTestProject>>;

  test.beforeAll(async () => {
    fixture = await launchApp({ recordingKey: 'thread' });
    project = await createTestProject(fixture.page);
    await createTestChat(fixture.page, project.projectId, 'yolo');
  });
  test.afterAll(async () => {
    await cleanupProject(project);
    await closeApp(fixture);
  });

  test('TH7: a long user message shows the read-more toggle', async () => {
    const longText = 'This is a deliberately long sentence for the read-more clamp test. '.repeat(12); // ~800 chars
    await sendMessage(fixture.page, longText);
    const readMore = fixture.page.locator('[data-testid="message-read-more"]').first();
    await expect(readMore).toBeVisible({ timeout: 10_000 });
    await readMore.click(); // expand → "Show less"
    await waitForAIIdle(fixture.page, 90_000); // let the turn settle before the next test
  });

  test('TH8: a tool call renders an expandable tool card', async () => {
    await chat(fixture.page, "Use the Bash tool to run 'ls' and show me the files.", 90_000);
    const card = fixture.page.locator('[data-testid="tool-card"]').first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Generic tool cards expand via their toggle (when a result is present).
    const toggle = fixture.page.locator('[data-testid="tool-card-toggle"]').first();
    if (await toggle.isVisible().catch(() => false)) {
      await toggle.click();
    }
  });

  test('TH1: find-in-thread finds matches and closes', async () => {
    const { page } = fixture;
    await page.keyboard.press('Meta+f');
    const findInput = page.locator('[data-testid="thread-find-input"]');
    await expect(findInput).toBeVisible({ timeout: 5_000 });
    await findInput.fill('sentence'); // appears in the long TH7 message
    // With matches, next/prev become enabled.
    await expect(page.locator('[data-testid="thread-find-next"]')).toBeEnabled({ timeout: 5_000 });
    await page.locator('[data-testid="thread-find-close"]').click();
    await expect(page.locator('[data-testid="find-bar"]')).toHaveCount(0);
  });

  test('TH2: quoting a message inserts it into the composer', async () => {
    const { page } = fixture;
    // Select some message text (triple-click selects the paragraph), then click Quote.
    await page.getByText('deliberately long sentence', { exact: false }).first().click({ clickCount: 3 });
    const quote = page.locator('[data-testid="thread-quote"]');
    await expect(quote).toBeVisible({ timeout: 5_000 });
    await quote.click();
    // The quoted text is blockquote-prefixed into the composer.
    await expect(page.locator('[data-testid="composer-prompt-input"]')).toHaveValue(/>/, { timeout: 5_000 });
  });
});
