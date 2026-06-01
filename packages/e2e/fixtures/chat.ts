import type { Page } from '@playwright/test';
import { DAEMON_PORT } from './app.js';

/**
 * Creates a new chat for the given project, then waits for the renderer to open the chat tab.
 *
 * Use this instead of Meta+n when the test needs a specific mode. Pass 'acceptEdits' so
 * file-editing tests never stall on a plan card, or 'plan' to start in plan mode.
 *
 * Note: plan mode is no longer a permission mode (it became a standalone composer toggle), so
 * 'plan' creates a default-permission chat and then flips the plan-mode toggle.
 */
export async function createTestChat(
  page: Page,
  projectId: string,
  permissionMode: 'default' | 'acceptEdits' | 'plan' | 'yolo' = 'default',
  adapterId = process.env['E2E_MODE'] === 'mock' ? 'mock-cli' : 'claude',
): Promise<void> {
  const wantsPlanMode = permissionMode === 'plan';
  // createChat's permissionMode no longer accepts 'plan'; map it to 'default' (cast is safe — the
  // 'plan' case is handled separately via the toggle below).
  const createMode = wantsPlanMode ? 'default' : (permissionMode as 'default' | 'acceptEdits' | 'yolo');

  // Create the chat via the daemon's REST API. The WS→REST transport refactor removed
  // DaemonClient.createChat, so the old window.__daemonClient.createChat shortcut no longer exists.
  const res = await fetch(`http://127.0.0.1:${DAEMON_PORT}/api/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId, adapterId, permissionMode: createMode }),
  });
  if (!res.ok) {
    throw new Error(`createTestChat: POST /api/chats failed (${res.status} ${await res.text()})`);
  }
  const created = (await res.json()) as { data?: { id?: string } };
  const chatId = created.data?.id;
  if (!chatId) {
    throw new Error(`createTestChat: POST /api/chats returned no chat id (${JSON.stringify(created)})`);
  }

  // The WS→REST refactor made the chat.created broadcast pure list-sync —
  // navigation now lives in the REST caller (startChat). This raw-REST harness
  // bypasses startChat, so we must navigate explicitly: the daemon broadcasts
  // chat.created → the renderer adds the row → we click it. The row's onClick
  // (handleSelect) does setActiveChat + openChatTab + resumeChat (subscribe),
  // exactly what startChat does, so the new chat becomes active AND subscribed.
  const row = page.locator(`[data-testid="chat-list-item"][data-chat-id="${chatId}"]`);
  try {
    await row.waitFor({ timeout: 12_000 });
  } catch {
    // chat.created occasionally missed — reload to force a full resync, then retry.
    await page.reload();
    await page
      .locator('[data-testid="connection-status"]')
      .getByText('Connected', { exact: true })
      .waitFor({ timeout: 15_000 });
    await row.waitFor({ timeout: 15_000 });
  }
  await row.click();
  await page.getByRole('textbox').first().waitFor({ timeout: 12_000 });

  // Plan mode is a standalone composer toggle now — enable it for plan-mode chats.
  if (wantsPlanMode) {
    const toggle = page.locator('[data-testid="plan-mode-toggle"]');
    await toggle.waitFor({ timeout: 10_000 });
    if ((await toggle.getAttribute('aria-label'))?.includes('disabled')) {
      await toggle.click();
    }
  }
}
