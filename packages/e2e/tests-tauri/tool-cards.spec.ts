/**
 * §tool-cards — every tool as the transcript draws it: steps as rows inside the
 * turn's one work row, events as pills outside it (redesign T1a, T1g).
 *
 * Recordings are content-agnostic replay (`send_message`/`respondToPermission`
 * just advance a cursor; the text sent and the button clicked don't have to
 * match what was recorded, only the call ORDER does), so these fixtures serve
 * as canned tool-call payloads:
 *   messaging.0 → Bash                    permissions-interactive.0 → Write
 *   changes-tab.0 → Read, Edit            plan-approval.0 → ExitPlanMode (approved)
 *   ask-question.0 → AskUserQuestion      task-subagent.0 → Task
 *   web-fetch.0 → WebFetch                mcp-tool.0 → mcp__linear__get_issue (done + error)
 *   unregistered-tool.0 → a tool with no row of its own
 *   schedule-pills.0 → ScheduleWakeup/CronCreate/CronList/CronDelete/Monitor
 *   worktree-pills.0 → EnterWorktree ×2 / ExitWorktree (keep + remove)
 *   tool-result-truncated.0 → Bash with a 51191-byte result
 *   tool-group.0 → Read + Grep            bash-exit-code.0 → `exit 0`, then `exit 127`
 *   transcript-rows.0 → a realistic thread: every row kind, retried and failed steps, markers
 *
 * A row is found by the tool it stands for (`[data-tool]`, helpers/tauri/transcript.ts);
 * its body keeps the test ids of what it shows (chat-bash-output, read-card-code-preview, …).
 */

import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';
import { expectRowClosed, openRow, openWork, toolRow, workRows } from '../helpers/tauri/transcript.js';

// ─── Bash card — deep dive (messaging recording) ──────────────────────────────

test.describe('§tool-cards — Bash (messaging)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');

    // mock-cli replay is purely positional (mainframe-adapter-mock's `advance()` only
    // checks the `in` marker's METHOD, never its args) — `messaging.0.ndjson` encodes two turns
    // in order, "What is 2+2?" (→ "4") THEN the Bash "List the files..." turn. Skipping straight
    // to the second prompt would actually consume and replay the first. Send both, in order, same
    // as chat.spec.ts's §messaging describe and composer-advanced.spec.ts's quote describe.
    await sendMessage(app.page, 'What is 2 + 2? Reply with just the number.');
    await waitForIdle(app.page, 60_000);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a row says the command and its exit; opening it shows the description and the output', async () => {
    const { page } = app;
    await sendMessage(page, 'List the files in this project using bash ls.');
    await waitForIdle(page, 90_000);
    await openWork(page);

    const row = toolRow(page, 'Bash').first();
    await expect(row).toContainText('Ran');
    await expect(row).toContainText('ls -la');
    await expect(row).toContainText('exit 0');
    await expect(row.getByTestId('chat-bash-output')).toHaveCount(0);

    await openRow(row);
    const output = row.getByTestId('chat-bash-output');
    await expect(output).toContainText('CLAUDE.md');
    await expect(output).toContainText('index.ts');
    await expect(row.getByTestId('chat-bash-description')).toHaveText('List files in the project directory');
  });
});

// ─── Write card — after Allow Once permits the tool (permissions-interactive) ─

test.describe('§tool-cards — Write (permissions-interactive)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'permissions-interactive' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'default');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a written file says it is new; opening it shows its content', async () => {
    const { page } = app;

    // Recording replay is positional: the first Write is scripted to be rejected regardless of
    // which button is clicked, so this deny is required to advance to the second (successful) Write —
    // mirrors chat.spec.ts's §permissions-interactive two-turn sequence.
    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    await page.getByTestId('chat-permission-gate').waitFor({ timeout: 45_000 });
    await page.getByTestId('chat-permission-option-reject-once').click();
    await waitForIdle(page, 60_000);

    await sendMessage(page, 'Create /tmp/mf-e2e-test.txt again');
    await page.getByTestId('chat-permission-gate').waitFor({ timeout: 45_000 });
    await page.getByTestId('chat-permission-option-allow-once').click();
    await waitForIdle(page, 60_000);

    await openWork(page);
    const row = toolRow(page, 'Write').last();
    await expect(row).toContainText('Wrote');
    await expect(row).toContainText('mf-e2e-test.txt');
    await expect(row).toContainText('new · 1 line');
    await expectRowClosed(row);
    await openRow(row);
    await expect(row.getByTestId('chat-write-code').getByText('hello', { exact: true })).toBeVisible();
  });
});

// ─── Read + Edit cards, incl. "Open in diff editor" (changes-tab) ─────────────

test.describe('§tool-cards — Read + Edit (changes-tab)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'changes-tab' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a read says its line count and opens on numbered code', async () => {
    const { page } = app;
    await sendMessage(page, 'Read index.ts and add a comment above the greeting export.');
    await waitForIdle(page, 60_000);
    await openWork(page);

    const row = toolRow(page, 'Read').first();
    await expect(row).toContainText('index.ts');
    // Recorded Read result is "1\texport const greeting = \"hello\";\n2\t" → 2 lines.
    await expect(row).toContainText('2 lines');
    await expectRowClosed(row);
    await openRow(row);
    await expect(row.getByTestId('read-card-code-preview')).toContainText('export const greeting');
  });

  test('an edit says what it changed and opens on the diff', async () => {
    const { page } = app;
    const row = toolRow(page, 'Edit').first();
    await expect(row).toContainText('Edited');
    // The edit adds exactly one line ("// changed by AI"); the rest stays context.
    await expect(row).toContainText('+1');
    await openRow(row);
    const diff = row.getByTestId('chat-edit-diff');
    await expect(diff.locator('[data-diff="add"]')).toContainText('changed by AI');
  });

  test('"Open in the diff editor" opens the workspace diff tab with the edit\'s sides', async () => {
    const { page } = app;
    await toolRow(page, 'Edit').first().locator('[data-testid^="chat-row-open-diff-"]').click();

    const diffTab = page.getByTestId('diff-tab');
    await expect(diffTab).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('editor-diff')).toBeVisible({ timeout: 10_000 });
    await expect(diffTab).toContainText('index.ts');
    // Modified side carries the Edit tool's new_string.
    await expect(diffTab).toContainText('changed by AI');
  });
});

// ─── Message path context menu (274-A1, A2, A3, A5, A10) — changes-tab ───────

test.describe('§tool-cards — Message path context menu (changes-tab)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'changes-tab' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
    await app.page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    // Both tests below use the same Read row. Sent here, not in the first test,
    // so a worker restart after a failure re-seeds it for whichever test runs next.
    await sendMessage(app.page, 'Read index.ts and add a comment above the greeting export.');
    await waitForIdle(app.page, 60_000);
    await openWork(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('right-clicking the row of a file opens the two copy items, which copy the absolute/relative path (274-A1, A2, A3, A10)', async () => {
    const { page } = app;
    const pill = toolRow(page, 'Read').first().locator('[data-file-path]');
    await expect(pill).toHaveAttribute('data-file-path', /index\.ts$/);

    await pill.click({ button: 'right' });
    const absoluteItem = page.getByTestId('tool-card-path-copy-absolute');
    const relativeItem = page.getByTestId('tool-card-path-copy-relative');
    await expect(absoluteItem).toBeVisible({ timeout: 5_000 });
    await expect(relativeItem).toBeVisible();

    await absoluteItem.click();
    await expect(absoluteItem).toContainText('Copied');
    const absoluteCopied = await page.evaluate(() => navigator.clipboard.readText());
    expect(absoluteCopied).toBe(`${project.projectPath}/index.ts`);
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('tool-card-path-copy-absolute')).toHaveCount(0);

    await pill.click({ button: 'right' });
    await expect(relativeItem).toBeVisible({ timeout: 5_000 });
    await relativeItem.click();
    const relativeCopied = await page.evaluate(() => navigator.clipboard.readText());
    expect(relativeCopied).toBe('index.ts');
    await page.keyboard.press('Escape');
  });

  test('right-clicking assistant content outside the row of any file opens no menu at all (274-A5)', async () => {
    const { page } = app;
    const message = page.getByTestId('chat-assistant-message').filter({ has: toolRow(page, 'Read') });
    const outsideAnyPath = message.locator('[data-work-turn] p, [data-testid="chat-answer"] p').first();

    // A menu left open by a FAILING previous test blocks pointer events for the
    // full 120s timeout; dismissing first keeps that failure reported once.
    await page.keyboard.press('Escape');
    await outsideAnyPath.click({ button: 'right' });
    // Settles the open animation a menu would have started; every assertion below
    // is a negative one, and those pass vacuously on the first poll.
    await page.waitForTimeout(500);

    // With nothing to copy the trigger must stay closed, so the webview's own
    // Copy / Look Up / Search menu survives. Opening a disabled "no actions"
    // item instead replaced it with a dead menu.
    const trigger = message.getByTestId('chat-message-menu-trigger');
    await expect(trigger).toHaveAttribute('data-state', 'closed');
    await expect(page.getByTestId('tool-card-path-copy-absolute')).toHaveCount(0);
    await expect(page.getByTestId('tool-card-path-copy-relative')).toHaveCount(0);
  });
});

// ─── AskUserQuestion: the answered question's card — ask-question ──────────

test.describe('§tool-cards — AskUserQuestion display (ask-question)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'ask-question' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'yolo');
  });

  test.afterAll(async () => {
    // Mirrors chat.spec.ts's §ask-question teardown ordering (the recording's final fx event
    // fires async shortly after onResult — stop the daemon before removing the project dir).
    await closeTauriApp(app);
    cleanupTauriProject(project);
  });

  test('keeps the answered question and its chosen answer in the transcript', async () => {
    const { page } = app;
    await sendMessage(page, 'Use AskUserQuestion to ask me a single-select question with 2 options');

    await page.getByTestId('chat-question-gate').waitFor({ timeout: 60_000 });
    await page.locator('[data-testid^="chat-question-option-0-"]').first().click();
    await page.getByTestId('chat-question-submit').click();
    await waitForIdle(page, 60_000);

    // The daemon parses the recorded tool_result string into a structured `askUserQuestion` array,
    // whichever option the live test clicked: replay is positional.
    const card = page.getByTestId('chat-ask-card').first();
    await expect(card.getByTestId('chat-ask-header')).toHaveText('Next Step · answered');
    await expect(card.getByTestId('chat-ask-question-text')).toContainText(
      'Would you like to start working on the index.ts file',
    );
    await expect(card.getByTestId('chat-ask-answer').first()).toContainText('Work on index.ts');
    // It stays outside the folded work.
    await expect(card.locator('xpath=ancestor::*[@data-work-turn]')).toHaveCount(0);
  });
});

// ─── Plan approved — plan-approval ────────────────────────────────────────────

test.describe('§tool-cards — Plan (plan-approval)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'plan-approval' });
    project = await createTauriProject(app.page, {
      claudeMd:
        '# E2E Test Project\n\nThis is an automated test environment.\n' +
        'In plan mode, proceed with reasonable assumptions. Do not use AskUserQuestion. ' +
        'Call ExitPlanMode immediately after reading the relevant files.\n',
    });
    await createTauriChat(app.page, project.projectId, 'plan');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('an approved plan is a pill that opens on its markdown', async () => {
    const { page } = app;
    await sendMessage(page, 'Add `export function greet(name: string) { return "Hello " + name; }` to utils.ts');
    await page.getByTestId('chat-plan-gate').waitFor({ timeout: 45_000 });
    await page.getByTestId('chat-plan-approve').click();

    const pill = page.getByTestId('chat-marker-exitplanmode').filter({ hasText: 'Plan approved' });
    await pill.waitFor({ timeout: 15_000 });
    await pill.click();
    await expect(page.getByTestId('chat-marker-exitplanmode-body').last()).toContainText('greet');

    // Clean up: the approval triggers an Edit permission gate next (plan-approval.0.ndjson) —
    // deny so the mock session ends cleanly.
    await page.getByTestId('chat-permission-gate').waitFor({ timeout: 45_000 });
    await page.getByTestId('chat-permission-option-reject-once').click();
    await waitForIdle(page, 90_000);
  });
});

// ─── Task subagent card (nested transcript) — task-subagent ──────────────────

test.describe('§tool-cards — Task subagent (task-subagent)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'task-subagent' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a sub-agent names itself and its errand; opening it shows its prompt and steps as rows', async () => {
    const { page } = app;
    await sendMessage(page, 'Delegate finding the greeting export to a subagent');

    const row = toolRow(page, 'Task').first();
    await row.waitFor({ timeout: 60_000 });
    await expect(row).toContainText('general-purpose');
    await expect(row).toContainText('Find the greeting export');
    await expectRowClosed(row);

    await openRow(row);
    await expect(row.getByTestId('chat-agent-prompt')).toContainText('Search the project');
    const step = toolRow(row, 'Bash').first();
    await expect(step).toContainText('export const greeting');
    await openRow(step);
    await expect(step.getByTestId('chat-bash-output')).toBeVisible();
  });
});

// ─── WebFetch card — web-fetch ────────────────────────────────────────────────

test.describe('§tool-cards — WebFetch (web-fetch)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'web-fetch' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a fetched page opens on its address and what it said', async () => {
    const { page } = app;
    await sendMessage(page, 'Fetch https://example.com/docs and summarize it');
    await waitForIdle(page, 60_000);
    await openWork(page);

    const row = toolRow(page, 'WebFetch').first();
    await expect(row).toContainText('Fetched');
    await expect(row).toContainText('example.com/docs');
    await expectRowClosed(row);
    await openRow(row);
    await expect(row.getByTestId('web-fetch-card-url')).toHaveText('https://example.com/docs');
    await expect(row.getByTestId('web-fetch-card-summary')).toContainText('REST API');
  });
});

// ─── MCP tool pill — mcp-tool ──────────────────────────────────────────────────

test.describe('§tool-cards — MCP pill (mcp-tool)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'mcp-tool' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a call opens on its arguments and result; a failed one opens by itself and is counted', async () => {
    const { page } = app;
    await sendMessage(page, 'Use the linear MCP server to look up issue MF-42');
    await waitForIdle(page, 60_000);
    await openWork(page);

    const rows = page.locator('[data-tool^="mcp__linear__"]');
    const done = rows.nth(0);
    await expect(done).toContainText('Called');
    await expect(done).toContainText('get_issue');
    await expect(done).toContainText('on Linear');
    await expectRowClosed(done);
    await openRow(done);
    await expect(done.getByTestId('chat-call-args')).toContainText('MF-42');
    await expect(done.getByTestId('chat-call-result')).toContainText('In Progress');

    const failed = rows.nth(1);
    await expect(failed).toContainText('failed');
    await expect(failed.getByTestId('chat-call-body')).toContainText('Error');
    await expect(page.locator('[data-testid^="chat-work-failed-"]')).toHaveText('1 failed');
  });
});

// ─── A tool without a row of its own — unregistered-tool ──────────────────────

test.describe('§tool-cards — a tool without a row of its own (unregistered-tool)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'unregistered-tool' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a tool with no row of its own uses the call row', async () => {
    const { page } = app;
    await sendMessage(page, 'Use the custom analytics tool to report a build event');
    await waitForIdle(page, 60_000);
    await openWork(page);

    const row = toolRow(page, 'CustomAnalyticsReport').first();
    await expect(row).toContainText('Called');
    await expect(row).toContainText('CustomAnalyticsReport');
    await openRow(row);
    await expect(row.getByTestId('chat-call-args')).toContainText('build_completed');
    await expect(row.getByTestId('chat-call-result')).toContainText('Event recorded');
  });
});

// ─── Schedule/Cron/Monitor pills — schedule-pills ─────────────────────────────

test.describe('§tool-cards — Schedule/Cron/Monitor pills (schedule-pills)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'schedule-pills' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('Schedule/Cron/Monitor pills (all 5 kinds)', async () => {
    const { page } = app;
    await sendMessage(page, 'Schedule a wakeup, create a cron job, list schedules, delete one, and monitor the build');

    const marker = (tool: string) => page.getByTestId(`chat-marker-${tool}`);
    await marker('monitor').waitFor({ timeout: 60_000 });
    await waitForIdle(page, 60_000);

    // Markers stay on the spine: a turn of events alone has no work row at all.
    await expect(workRows(page)).toHaveCount(0);

    await expect(marker('schedulewakeup')).toContainText('Scheduled a wakeup in 1h 30m');
    await expect(marker('croncreate')).toContainText('Scheduled every day at 9:00 AM');
    await expect(marker('croncreate')).toContainText('recurring');
    await expect(marker('crondelete')).toContainText('Removed schedule cron-1');
    await expect(marker('crondelete')).toBeDisabled();

    await expect(marker('cronlist')).toContainText('Listed schedules');
    await expect(marker('cronlist')).toContainText('1 job');
    const jobs = page.getByTestId('chat-marker-cronlist-body');
    await expect(jobs).toHaveCount(0);
    await marker('cronlist').click();
    await expect(jobs).toContainText('cron-1');
    await expect(jobs).toContainText('every day at 9:00 AM');
    await expect(jobs).toContainText('Send the weekly report');
    await marker('cronlist').click();
    await expect(jobs).toHaveCount(0);

    await expect(marker('monitor')).toContainText('Monitored Watch the build');
    await marker('monitor').click();
    await expect(page.getByTestId('chat-marker-monitor-body')).toContainText('Build succeeded in 42s');
  });
});

// ─── EnterWorktree / ExitWorktree pills — worktree-pills ──────────────────────

test.describe('§tool-cards — EnterWorktree / ExitWorktree pills (worktree-pills)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'worktree-pills' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('EnterWorktree / ExitWorktree pills', async () => {
    const { page } = app;
    await sendMessage(
      page,
      'Enter a worktree for feature-x, exit keeping it, enter one for feature-y, then exit removing it',
    );

    const enter = page.getByTestId('chat-marker-enterworktree');
    const exit = page.getByTestId('chat-marker-exitworktree');
    await enter.nth(1).waitFor({ timeout: 60_000 });

    await expect(enter.nth(0)).toContainText('Entered worktree feature-x');
    await expect(exit.nth(0)).toContainText('Left worktree');
    await expect(exit.nth(0)).toContainText('kept');
    await expect(enter.nth(1)).toContainText('Entered worktree feature-y');
    await expect(exit.nth(1)).toContainText('Removed worktree');
    // Nothing to open on any of the four.
    await expect(enter.nth(0)).toBeDisabled();
    await expect(exit.nth(1)).toBeDisabled();
  });
});

// ─── ToolResultExpand "Show full output" — tool-result-truncated ──────────────

test.describe('§tool-cards — ToolResultExpand (tool-result-truncated)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'tool-result-truncated' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('ToolResultExpand "Show full output" for a truncated tool result', async () => {
    const { page } = app;
    await sendMessage(page, 'Print the contents of build.log');

    await waitForIdle(page, 60_000);
    await openWork(page);
    const row = toolRow(page, 'Bash').first();
    await openRow(row);

    // truncateToolContent kicks in above its 32KB threshold — the recorded
    // result is 51191 bytes, so fmtBytes rounds to "50 KB".
    const toggle = row.getByTestId('tool-result-expand-toggle');
    await expect(toggle).toContainText('Show full output');
    await expect(toggle).toContainText('50 KB');
    await expect(row.getByTestId('chat-bash-output')).toContainText(
      '[INFO] build step 1 completed successfully at 00:00:01',
    );
  });
});

// ─── A short exploration — tool-group ─────────────────────────────────────────

test.describe('§tool-cards — a short exploration (tool-group)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'tool-group' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the work row sums up the steps, which stay rows of their own', async () => {
    const { page } = app;
    await sendMessage(page, 'Find where greeting is defined and used');
    await waitForIdle(page, 60_000);

    await expect(workRows(page)).toHaveAccessibleName(/read 1 file, searched 1 pattern/);
    await expect(toolRow(page, 'Read')).toHaveCount(0);
    await openWork(page);
    await expect(toolRow(page, 'Read')).toBeVisible();
    await expect(toolRow(page, 'Grep')).toContainText('Searched');
    await expect(page.locator('[data-activity-group]')).toHaveCount(0);
  });
});

// ─── Exit codes and failures — bash-exit-code ─────────────────────────────────

test.describe('§tool-cards — exit codes (bash-exit-code)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'bash-exit-code' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('a failed command is counted in the work row, which opens on its output', async () => {
    const { page } = app;
    await sendMessage(page, 'Run the test suite, then run a bad command');
    await waitForIdle(page, 60_000);

    const failed = page.locator('[data-testid^="chat-work-failed-"]');
    await expect(failed).toHaveText('1 failed');
    await failed.click();

    const bad = toolRow(page, 'Bash').nth(1);
    await expect(bad).toContainText('exit 127');
    // It is open already: an unresolved failure opens by itself.
    await expect(bad.getByTestId('chat-bash-output')).toContainText('exit 127');
    await expect(toolRow(page, 'Bash').nth(0)).toContainText('exit 0');
    await expect(bad.locator('span.text-fail')).toHaveText(/exit 127/);
    await expect(bad.getByText('Failed:', { exact: true })).toBeAttached();
    await expect(bad.getByTestId('chat-bash-output').getByText('exit 127')).toHaveClass(/text-mf-tr-term-err/);

    const good = toolRow(page, 'Bash').nth(0);
    await expectRowClosed(good);
    await good.getByRole('button', { name: /Ran/ }).click();
    await expect(good.getByTestId('chat-bash-output').getByText('exit 0')).toHaveClass(/text-mf-tr-term-ok/);
  });
});

// ─── A realistic thread — transcript-rows ─────────────────────────────────────

test.describe('§tool-cards — a realistic thread (transcript-rows)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'transcript-rows' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
    for (const turn of ['Why is it stuck?', 'Fix it.', 'Set up the follow-ups.', 'Explore it with an agent.']) {
      await sendMessage(app.page, turn);
      await waitForIdle(app.page, 60_000);
    }
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('each turn folds to one work row and the answer stays', async () => {
    const { page } = app;
    // The events-only turn has no work row.
    await expect(workRows(page)).toHaveCount(3);
    for (const row of await workRows(page).all()) await expect(row).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('Lint still fails.')).toBeVisible();
  });

  test('a retried failure stays closed, an unresolved one is open', async () => {
    const { page } = app;
    await openWork(page, 1);
    const turn = page.getByTestId('chat-assistant-message').filter({ has: toolRow(page, 'Edit') });
    await expectRowClosed(turn.locator('[data-tool="Bash"]').first());
    await expect(turn.locator('[data-tool="mcp__github__get_issue"]').nth(1)).toContainText('404 Not Found');
  });

  test('a long run of reads is one Explored row, which opens on its steps', async () => {
    const { page } = app;
    const group = page.locator('[data-activity-group]');
    await expect(group).toContainText('4 files, 1 search');
    await openRow(group);
    await expect(group.locator('[data-tool="Read"]')).toHaveCount(4);
  });

  test("a skill's text is in its marker, with no message of its own", async () => {
    const { page } = app;
    const skill = page.getByTestId('chat-marker-skill');
    // The rows opened above may have pushed this turn out of the rendered window.
    await page.getByTestId('chat-thread-viewport').evaluate((node) => node.scrollTo({ top: node.scrollHeight }));
    // On the spine, outside the folded work: centred in its message, above its turn's answer.
    const message = page.getByTestId('chat-assistant-message').filter({ has: skill });
    const [pill, column] = [(await skill.boundingBox())!, (await message.boundingBox())!];
    expect(Math.abs(pill.x + pill.width / 2 - (column.x + column.width / 2))).toBeLessThan(2);
    await expect(message.locator('[data-work-turn]').filter({ has: skill })).toHaveCount(0);
    await expect(skill).toContainText('Used skill /mainframe-design-system');
    await expect(page.getByTestId('chat-system-message')).toHaveCount(0);
    await skill.click();
    await expect(page.getByTestId('chat-skill-content')).toContainText('# Design system');
  });

  test('the work row names its agents and opens on them', async () => {
    const { page } = app;
    await page.getByRole('button', { name: '1 agent: show it' }).click();
    const agent = toolRow(page, 'Task');
    await expect(agent).toBeVisible();
    await openRow(agent);
    await expect(agent.getByTestId('chat-agent-result')).toContainText('One nit');
  });
});
