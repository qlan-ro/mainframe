/**
 * §transcript — Chat transcript rendering: user/assistant message chrome, the
 * thread scroll shell, and in-chat find.
 *
 * Cluster B, spec #11 of docs/plans/2026-07-03-tauri-e2e-test-plan.md.
 *
 * Source read: packages/ui/src/features/chat/{thread/ChatThread,
 * messages/{UserMessage,ReadMoreBubble,MessageActionBar,SystemMessage,
 * MessageTimestamp,MessageTiming,AssistantMessage},
 * parts/{markdown-text,CodeHeader}, find/{FindBar,use-find-hotkey,
 * search-messages,find-in-chat-store}}.tsx plus components/ui/read-more.tsx.
 *
 * Recordings: `thread` (a deliberately-long user turn + a Bash-tool turn —
 * read from fixtures/recordings/thread.0.ndjson) and `chat-status` (reused
 * per the harness convention's "unwired but reusable" list — its second
 * assistant reply is the only committed recording whose text contains fenced
 * code blocks, needed for the CodeHeader copy-button scenario). `messaging`
 * was deliberately NOT reused here — `thread`'s two turns (long text +
 * Bash-tool call w/ a bold/list markdown reply) already cover everything this
 * spec needs from an agent turn, and chat.spec.ts's §messaging describe
 * already asserts the bash-card-appears behavior against that recording;
 * reusing it here would just re-spin a daemon for no new coverage.
 *
 * Testid reference (verified against source):
 *   chat-user-readmore-toggle — the Read more/Show less button. ReadMoreBubble is now a thin
 *     wrapper that passes this id as `testId` into the shared components/ui/read-more.tsx
 *     primitive, which owns the button, its label swap and `aria-expanded`.
 *   chat-message-copy / chat-message-more / chat-message-export — MessageActionBar.
 *     `data-copied` is set by the native ActionBarPrimitive.Copy (asChild → our Button),
 *     not by us — see @assistant-ui/react's ActionBarCopy.
 *   chat-message-timestamp / chat-message-timing — assistant footer row
 *   chat-code-copy — CodeHeader's Copy/Copied button (fenced code blocks only)
 *   chat-scroll-to-bottom — ThreadPrimitive.ScrollToBottom (native `disabled` at-bottom state)
 *   find-bar / thread-find-input / thread-find-prev / thread-find-next / thread-find-close
 *   chat-thread-viewport (+ [data-mf-chat-thread]) — the scrollable transcript viewport
 *   chat-user-bubble — the sent user turn's card shell (todo #298 containment probe)
 *
 * The floating selection toolbar (chat-selection-toolbar / -quote / -new-session) is NOT
 * covered here despite once being listed: composer-advanced.spec.ts owns it, because its
 * two actions land in the composer. Kept out rather than duplicated.
 *
 * The `thread` recording now carries three turns: the long-text turn, the Bash-tool
 * turn, and (todo #298) a third short turn whose send is the long-unbreakable-token
 * containment probe below.
 */
import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

/** A single sentence repeated 12x (803 chars) — comfortably over ReadMoreBubble's
 *  600-char CHAR_THRESHOLD, and "deliberately" appears in it exactly 12 times
 *  (verified: no other transcript text in this recording contains the word, and
 *  reasoning/thinking blocks render without `data-text-part` so they're outside
 *  search-messages.ts's walk regardless). */
const LONG_TEXT = Array.from(
  { length: 12 },
  () => 'This is a deliberately long sentence for the read-more clamp test.',
).join(' ');

/** One ~200-char token, a long bare URL, a long absolute path and a long inline-code
 *  span — the four AC cases, all under ReadMoreBubble's 600-char threshold so the
 *  bubble renders UNCLAMPED (a collapsed clamp sets overflow:hidden and would hide
 *  the very spill this measures). */
const UNBREAKABLE = 'A'.repeat(200);
const OVERFLOW_TEXT = [
  UNBREAKABLE,
  `https://example.com/${'segment'.repeat(10)}`,
  `/Users/dev/${'deeply-nested-directory/'.repeat(4)}file.ts`,
  `\`${'x'.repeat(80)}\``,
].join(' ');

async function scrollViewportToTop(page: Page): Promise<void> {
  await page.getByTestId('chat-thread-viewport').evaluate((el) => {
    el.scrollTop = 0;
  });
}

// Serial in fact, so declared serial. Every describe here builds its transcript
// with sends from its OWN earlier tests, and `beforeAll` re-runs on a retry — so
// an undeclared retry handed the later tests a brand-new EMPTY chat, and each
// failure re-seeded the app empty for every test after it. Declared, a retry
// re-runs the whole block, sends included, and the transcript is there.
test.describe.configure({ mode: 'serial' });

// ─── §11 Transcript — thread turn (long text + Bash tool call) ────────────────

test.describe('§transcript — thread turn', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'thread' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
    // Copy-button assertions read data-copied / the button's own "Copied" state,
    // both of which only flip once navigator.clipboard.writeText() resolves.
    await app.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('read-more toggle clamps text over 600 characters and expands/collapses on click', async () => {
    const { page } = app;
    await sendMessage(page, LONG_TEXT);
    await waitForIdle(page, 60_000);

    const toggle = page.getByTestId('chat-user-readmore-toggle');
    await toggle.waitFor({ timeout: 10_000 });
    await expect(toggle).toHaveText('Read more');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(toggle).toHaveText('Show less');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await toggle.click();
    await expect(toggle).toHaveText('Read more');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  test('assistant reply renders markdown (bold list) and a Bash tool card', async () => {
    const { page } = app;
    await sendMessage(page, "Use the Bash tool to run 'ls' and show me the files.");
    await waitForIdle(page, 90_000);

    await expect(page.getByTestId('chat-bash-card').first()).toBeVisible({ timeout: 10_000 });

    const lastAssistant = page.getByTestId('chat-assistant-message').last();
    await expect(lastAssistant.locator('strong').filter({ hasText: 'CLAUDE.md' })).toBeVisible();
  });

  test('assistant message action bar: copy sets the copied state, More exports Markdown, timestamp renders', async () => {
    const { page } = app;
    const lastAssistant = page.getByTestId('chat-assistant-message').last();

    // autohide="not-last" — the LAST assistant message's bar is visible without hover.
    const copyBtn = lastAssistant.getByTestId('chat-message-copy');
    await expect(copyBtn).toBeVisible();
    await expect(copyBtn).not.toHaveAttribute('data-copied', 'true');
    await copyBtn.click();
    await expect(copyBtn).toHaveAttribute('data-copied', 'true', { timeout: 5_000 });

    const moreBtn = lastAssistant.getByTestId('chat-message-more');
    await moreBtn.click();
    const exportItem = page.getByTestId('chat-message-export');
    await expect(exportItem).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10_000 }), exportItem.click()]);
    expect(download.suggestedFilename()).toMatch(/^message-\d+\.md$/);

    const timestamp = lastAssistant.getByTestId('chat-message-timestamp');
    await expect(timestamp).toBeVisible();
    await expect(timestamp).toHaveText(/^\d{1,2}:\d{2}\s?(AM|PM)$/i);
  });

  // Previously: MessageTiming.tsx reads `useMessageTiming()?.totalStreamTime`,
  // sourced from a `system`-type message's `metadata.turnDurationMs`, but
  // nothing in packages/core ever wrote that field — `chat-message-timing`
  // could never render. Fixed by the product-bug-fix campaign:
  // `event-handler.ts`'s `onResult` now computes `turnDurationMs` from
  // `active.turnStartedAt` and emits a transient system message carrying it,
  // which `groupMessages` merges onto the preceding assistant message.
  test('assistant message action bar: timing pill shows total duration on hover', async () => {
    const { page } = app;
    const lastAssistant = page.getByTestId('chat-assistant-message').last();
    const timingPill = lastAssistant.getByTestId('chat-message-timing');
    await expect(timingPill).toBeVisible({ timeout: 10_000 });
    // formatDurationMs: "412ms" / "8.94s" / "1m 15s" / "2h 15m".
    await expect(timingPill).toHaveText(/^(\d+ms|\d+\.\d{2}s|\d+m \d{2}s|\d+h \d{2}m)$/);

    // Hovering reveals the tooltip's "Total" breakdown row. Radix Tooltip
    // portals content twice (an aria-live announcer copy plus the visible
    // one) — scope to the first match rather than the ambiguous bare text.
    await timingPill.hover();
    await expect(page.getByText('Total').first()).toBeVisible({ timeout: 5_000 });
  });

  test('scroll-to-bottom button appears when scrolled up and returns to the tail on click', async () => {
    const { page } = app;
    const scrollBtn = page.getByTestId('chat-scroll-to-bottom');
    // At rest (post-idle autoscroll) the native ScrollToBottom is disabled — already at the tail.
    await expect(scrollBtn).toBeDisabled();

    // Scroll and click as ONE retried unit: the viewport re-anchors to the tail on
    // its own, and it did so between the enabled assertion and the click — leaving
    // the button `disabled:invisible` and the click waiting out the whole test
    // budget. Retrying the gesture rides that out; a button that can never be
    // clicked still fails, here, saying so.
    await expect(async () => {
      await scrollViewportToTop(page);
      await expect(scrollBtn).toBeEnabled({ timeout: 2_000 });
      await scrollBtn.click({ timeout: 2_000 });
    }).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] });
    await expect(scrollBtn).toBeDisabled({ timeout: 5_000 });
    // Corroborate "disabled" with the actual scroll position: within a few px of the tail.
    await expect
      .poll(async () =>
        page.getByTestId('chat-thread-viewport').evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop),
      )
      .toBeLessThan(4);
  });

  test('find-in-chat (⌘F): opens, counts matches, cycles with Enter/Shift+Enter, closes with Escape', async () => {
    const { page } = app;
    await page.keyboard.press('ControlOrMeta+f');

    const findBar = page.getByTestId('find-bar');
    await expect(findBar).toBeVisible({ timeout: 5_000 });
    const input = page.getByTestId('thread-find-input');
    await expect(input).toBeFocused();

    await input.fill('deliberately');
    await expect(findBar).toContainText('1/12', { timeout: 3_000 });

    await input.press('Enter');
    await expect(findBar).toContainText('2/12');

    await input.press('Shift+Enter');
    await expect(findBar).toContainText('1/12');

    await input.press('Escape');
    await expect(findBar).toBeHidden();
  });

  test('a long unbreakable token wraps inside the user bubble instead of painting outside it', async () => {
    const { page } = app;
    // Load-bearing: stays under ReadMoreBubble's 600-char threshold, or a collapsed
    // clamp's overflow:hidden would neuter this measurement (see the constant above).
    expect(OVERFLOW_TEXT.length).toBeLessThan(600);

    await sendMessage(page, OVERFLOW_TEXT);
    // `sendMessage` doesn't wait for the new turn to mount, so `.last()` alone could
    // resolve to the PREVIOUS turn's bubble — bind to this turn's content instead.
    const bubble = page.getByTestId('chat-user-bubble').filter({ hasText: UNBREAKABLE });
    await expect(bubble).toBeVisible({ timeout: 10_000 });
    await expect(bubble).toContainText(UNBREAKABLE);

    // `data-clamp` is emitted by components/ui/read-more.tsx whenever the measured text
    // exceeds the threshold — present means a clamp is in play (expanded or not), so its
    // absence is what makes the scrollWidth probe below meaningful.
    const box = await bubble.evaluate((el) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      width: el.getBoundingClientRect().width,
      clamped: el.querySelector('[data-clamp]') !== null,
    }));
    expect(box.clamped).toBe(false);
    // 470px cap + the 0.5px hairline border on each side.
    expect(box.width).toBeLessThanOrEqual(471);
    // scrollWidth includes content painted past the padding box — this is the
    // containment assertion itself.
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);

    await waitForIdle(page, 60_000);
  });
});

// ─── §11 Transcript — fenced code block (reused `chat-status` recording) ──────

test.describe('§transcript — code block', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'chat-status' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
    await app.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('fenced code block renders a language label and a working copy button', async () => {
    const { page } = app;
    await sendMessage(page, 'Explain what TypeScript generics are in two sentences.');
    await waitForIdle(page, 60_000);
    // Second recorded reply contains three ```typescript fences.
    await sendMessage(
      page,
      'Now explain TypeScript mapped types, conditional types, and template literal types. Be thorough.',
    );
    await waitForIdle(page, 90_000);

    const codeCopy = page.getByTestId('chat-code-copy').first();
    await codeCopy.waitFor({ timeout: 10_000 });
    await expect(page.getByText('typescript', { exact: true }).first()).toBeVisible();

    await expect(codeCopy).toHaveText(/Copy$/);
    await codeCopy.click();
    await expect(codeCopy).toHaveText('Copied', { timeout: 3_000 });

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('type Readonly<T>');
  });
});

// ─── §11 Transcript — compaction pill (compaction) ─────────────────────────────

test.describe('§transcript — compaction pill', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'compaction' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('system message renders the compaction pill after a compaction event', async () => {
    const { page } = app;
    await sendMessage(page, 'Summarize our conversation so far and keep going');

    // The recording's onCompactStart/onCompact fire before the next assistant reply — the
    // resulting bare {type:'compaction'} system message sets isCompacted, so CompactionPill
    // renders instead of the plain-text SystemTextPill branch.
    const pill = page.getByTestId('chat-compaction-pill').first();
    await pill.waitFor({ timeout: 45_000 });
    await expect(pill).toContainText('Context compacted');

    await waitForIdle(page, 60_000);
  });
});

// ─── §11 Transcript — not reachable in mock mode ───────────────────────────────

test.describe('§transcript — no fixture / not deterministically reachable', () => {
  test.skip('slash-command message renders the pill variant', () => {
    // TODO(recording): the pill only renders when server metadata carries
    // `command.name`, which core's convertUserContent() derives ONLY from a raw
    // transcript text containing a real CLI-echoed `<command-message>…
    // <command-name>…</command-name>` wrapper (see packages/core/src/messages/
    // display-helpers.ts + message-parsing.ts parseCommandMessage). The mock CLI
    // replays canned assistant/tool events positionally and never synthesizes
    // this wrapper for a plain typed "/foo" — no committed recording produces it.
  });

  test.skip('assistant link right-click menu offers Copy link / Open link', () => {
    // TODO(recording): none of the committed fixtures/recordings/*.ndjson assistant
    // replies contain a markdown link (`](http...)`); LinkWithPreview's
    // ContextMenu (chat-link-copy / chat-link-open) needs a recording whose text
    // includes one.
  });

  test.skip('a failed send shows "Failed to send" + Retry', () => {
    // TODO(recording): meta.error (chat-user-message-send-failed / -retry) is only
    // set via the controller's `local.message.failed` action, which fires from
    // exactly one path — an uploadAttachments() rejection inside sendMessage()
    // (see chat-thread-controller.ts). The WS client's own send() never throws by
    // design (DaemonWsClient.send buffers on a closed socket and flushes on
    // reconnect — see lib/daemon/ws-client.ts), so severing the WS connection is
    // NOT a route to this state. Reaching it deterministically would require a
    // composer attachment + a routed network failure on the upload POST, which
    // composer.spec.ts already flags as an unverified flow in this harness
    // (see its skipped "sending a message with attachment gets AI response").
    // Left as a follow-up rather than fabricated here.
  });

  test.skip('a load failure shows the load-error banner with Retry', () => {
    // TODO(fixture): ChatManager.getMessages() (packages/core/src/chat/
    // chat-manager.ts) is deliberately best-effort — it catches any history-load
    // failure (missing/corrupt session file, even an unknown chatId) and resolves
    // to an empty array, so GET /api/chats/:id/messages returns `success:true,
    // data:[]` rather than an HTTP error in every case reachable from a browser
    // e2e test. The only way to trip loadState → 'error' is a live network/daemon
    // failure exactly during the in-flight request, which isn't a clean,
    // deterministic race to script.
  });
});
