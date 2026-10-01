/**
 * §selection-hold — a text selection in the transcript must survive streaming
 * and re-renders elsewhere (product bug: "while text was streaming, if I
 * selected something and a re-render happened, my selection was gone").
 *
 * Uses the `selection-hold-stream` recording (two turns: a short settled
 * reply, then a reply with two individually-paced `onMessagePartial` ticks)
 * with `mockMaxDelayMs` widened well past both ticks (`E2E_MOCK_MAX_DELAY_MS`,
 * `mainframe-adapter-mock`'s `pump.rs` — the cap is an ABSOLUTE ceiling on how
 * far into a turn any event can be scheduled, not a per-event pace: anything
 * recorded past it bursts out instantly once the ceiling elapses). That gives
 * a real, known wall-clock window between the two real ticks and the burst to
 * select text — both in the OLDER settled message and, immediately after the
 * SECOND tick lands (independent review round 2, finding 1 — selecting while
 * the smooth reveal may still be lagging the just-grown text), in the
 * paragraph that is itself STILL growing — exercising `markdown-text.tsx`'s
 * hold/release fix (`selection-hold.ts`), not just its unit tests.
 *
 * NOTE: this spec's timing-sensitive step (selecting immediately after the
 * second tick) could not be re-run locally this round — Playwright/Tauri
 * launches are deliberately not exercised locally here; confirm in CI.
 */
import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

/**
 * Selects the first occurrence of `needle` inside `scopeTestId`'s rendered
 * `.aui-md` text and fires the native `mouseup` `SelectionToolbarPrimitive`
 * listens for — same technique `composer-advanced.spec.ts`'s quote test uses
 * (a Range inside `.aui-md` specifically, never the `user-select: none`
 * surrounding chrome). Also dispatches `selectionchange` itself: a real
 * WebKit webview does not reliably fire it for a programmatic `addRange`
 * either, and `selection-hold.ts`'s listener is what engages the hold.
 */
async function selectTextIn(
  page: import('@playwright/test').Page,
  scopeTestId: string,
  needle: string,
  within: 'first' | 'last',
): Promise<string> {
  return page.evaluate(
    ({ scopeTestId, needle, within }) => {
      const messages = document.querySelectorAll(`[data-testid="${scopeTestId}"]`);
      const scope = within === 'first' ? messages[0] : messages[messages.length - 1];
      if (!scope) throw new Error(`no [data-testid="${scopeTestId}"] found`);
      const markdown = scope.querySelector('.aui-md');
      if (!markdown) throw new Error('no rendered markdown (.aui-md) in scope');
      const walker = document.createTreeWalker(markdown, NodeFilter.SHOW_TEXT);
      let target: Text | null = null;
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const t = node as Text;
        if (t.textContent?.includes(needle)) {
          target = t;
          break;
        }
      }
      if (!target?.textContent) throw new Error(`selection target "${needle}" not found`);
      const idx = target.textContent.indexOf(needle);
      const range = document.createRange();
      range.setStart(target, idx);
      range.setEnd(target, idx + needle.length);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      const text = sel?.toString() ?? '';
      document.dispatchEvent(new Event('selectionchange'));
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return text;
    },
    { scopeTestId, needle, within },
  );
}

/** The browser's OWN live selection text — the precise, direct signal (not a DOM-visibility proxy). */
async function currentSelectionText(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => window.getSelection()?.toString() ?? '');
}

test.describe('§selection-hold — a selection survives streaming elsewhere in the thread', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    // Widened so the recording's ~300ms-paced partials actually take that
    // long to replay — the suite's default ~120ms cap would compress the
    // whole multi-word stream into a sliver too short for a script (even a
    // fast one) to reliably land a selection mid-stream.
    app = await launchTauriApp({ recordingKey: 'selection-hold-stream', mockMaxDelayMs: 4000 });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await sendMessage(app.page, 'Say a short one-line greeting.');
    await waitForIdle(app.page, 30_000);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('selecting an older settled message, then text inside the paragraph that is itself still growing, keeps the toolbar usable and Quote captures the right text', async () => {
    const { page } = app;

    // Start the long second turn and wait for it to actually begin streaming
    // before touching any selection.
    await sendMessage(page, 'Write a two-paragraph explanation, one sentence per paragraph, and take your time.');
    await expect(page.getByTestId('chat-assistant-message').last()).toContainText('PARAGRAPH-ONE', { timeout: 15_000 });

    // 1) Select inside the OLDER (first turn's) settled message while the
    // second turn is actively streaming elsewhere in the thread.
    const olderSelected = await selectTextIn(page, 'chat-assistant-message', 'OLDER-REPLY', 'first');
    expect(olderSelected).toBe('OLDER-REPLY');
    await expect(page.getByTestId('chat-selection-toolbar')).toBeVisible({ timeout: 5_000 });

    // Let the other message keep growing for a few real ticks, then confirm
    // THIS selection (in a message nothing ever touches) is still exact.
    await page.waitForTimeout(400);
    expect(await currentSelectionText(page)).toBe('OLDER-REPLY');
    await expect(page.getByTestId('chat-selection-toolbar')).toBeVisible();
    await expect(page.getByTestId('chat-selection-quote')).toBeVisible();

    // 2) Wait for the SECOND real tick's own distinguishing text to land,
    // then select 'growing word by word' (present since the FIRST tick,
    // stable since) IMMEDIATELY — no extra wait in between. That is the
    // exact window independent review round-2 finding 1 flagged: selecting
    // right after a growth tick, while the SMOOTH REVEAL of that new text
    // may still be lagging behind it. An earlier, buggy version froze the
    // live INPUT text (not the DISPLAYED one) here, jumping the DOM straight
    // from whatever had been revealed to the full live text in one commit —
    // the exact "replace data" collapse this feature exists to prevent.
    await expect(page.getByTestId('chat-assistant-message').last()).toContainText('keeps extending', {
      timeout: 10_000,
    });
    const streamingSelected = await selectTextIn(page, 'chat-assistant-message', 'growing word by word', 'last');
    expect(streamingSelected).toBe('growing word by word');
    await expect(page.getByTestId('chat-selection-toolbar')).toBeVisible({ timeout: 5_000 });

    // Wait past the recording's SECOND real tick (~1.8s into this turn,
    // comfortably inside the 4s ceiling the final/burst text is pinned
    // behind). Without the hold, that tick is the DOM update that collapses
    // the Range the instant it replaces the text node's whole `data` (the
    // "replace data" algorithm); with the hold, nothing is visible here at
    // all — the rendered text stays pinned at its snapshot because `smooth`
    // itself is paused, not just the input — so there is nothing to poll the
    // DOM for the way the untouched older message above could be.
    await page.waitForTimeout(1700);
    await expect(page.getByTestId('chat-assistant-message').last()).not.toContainText('finally ends here');
    expect(await currentSelectionText(page)).toBe('growing word by word');

    await page.getByTestId('chat-selection-quote').click();
    const preview = page.getByTestId('composer-quote-preview');
    await expect(preview).toBeVisible({ timeout: 5_000 });
    await expect(preview).toContainText('growing word by word');

    // Clean up the pill, then let the turn finish — the paragraph that was
    // held catches up to its final text once released (selection cleared by
    // the Quote click above).
    const segmentId = await preview.getAttribute('data-segment-id');
    if (segmentId) await page.locator(`[data-testid="composer-quote-dismiss"][data-segment-id="${segmentId}"]`).click();
    await waitForIdle(page, 30_000);
    await expect(page.getByTestId('chat-assistant-message').last()).toContainText('finally ends here', {
      timeout: 10_000,
    });
  });
});
