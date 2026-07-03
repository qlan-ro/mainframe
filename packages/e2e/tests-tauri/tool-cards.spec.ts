/**
 * §tool-cards — Per-family tool-card rendering (Cluster B, spec #12 of
 * docs/plans/2026-07-03-tauri-e2e-test-plan.md).
 *
 * chat.spec.ts's §messaging describe already asserts a bare `chat-bash-card`
 * appears after a Bash tool call — this spec goes deeper (expand/collapse,
 * command/description/output text) and covers every OTHER card family that a
 * committed recording can reach. Recordings are content-agnostic replay
 * (packages/e2e/plugins/mock-cli/src/session.ts — `sendMessage`/
 * `respondToPermission` just advance a cursor; the text sent and the button
 * clicked don't have to match what was recorded, only the call ORDER does),
 * so the daemon reuses these fixtures as pure canned tool-call payloads.
 *
 * Recording inventory (every tool a fixture actually replays — see report for
 * the full grep):
 *   messaging.0, thread.0            → Bash
 *   permissions-interactive.0        → Write
 *   changes-tab.0, context-tab.0     → Read, Edit
 *   plan-approval.0/.1               → Read, Write, Edit, ExitPlanMode
 *   ask-question.0                   → AskUserQuestion
 *   chat-status.0                    → Skill (SlashCommandCard) + onSkillLoaded (SkillLoadedCard)
 *   task-subagent.0                  → Task (nested onSubagentChild transcript)
 *   task-progress.0                  → TaskCreate/TaskUpdate (_TaskProgress reduction)
 *   web-fetch.0                      → WebFetch
 *   mcp-tool.0                       → mcp__linear__get_issue (done + error)
 *   unregistered-tool.0              → CustomAnalyticsReport (ToolFallback)
 *   app-restart.0, composer-attachments.0, context-picker.0, image-lightbox.0,
 *   multi-chat.0/.1                  → no tool calls
 *
 * No recording exercises: WebSearch, Schedule/Cron/Monitor, EnterWorktree/
 * ExitWorktree, a truncated (>threshold) tool result, two consecutive
 * explore-family tool calls (ToolGroup), or a Bash call with a trailing
 * `exit N` line. Those families are `test.skip`ped below with a precise
 * recording wishlist in the report.
 *
 * Testid reference (verified against source; all asserted below):
 *   chat-bash-card / -trigger / -command / -description / -bash-output
 *   chat-write-card / -trigger ; tool-card-file-path
 *   read-card-root / -trigger ; read-card-code-preview
 *   chat-edit-card / -open-diff ; diff-tab (Files surface) ; editor-diff (CmDiffEditor mount)
 *   chat-ask-card / -header / -body / -question-text
 *   chat-plan-bubble (approved) ; chat-plan-card / -label / -body (not approved)
 *   chat-slash-command-row (Skill tool call)
 *   chat-skill-loaded-pill ; chat-system-message (onSkillLoaded system message)
 *   chat-task-card / -toggle / -agent / -description (Task subagent card)
 *   chat-task-progress-card / -toggle / -item-{status} (TaskProgress card)
 *   web-fetch-card-root / -trigger / -url / -summary
 *   chat-mcp-pill ; marker-body (MCP tool pill)
 *   chat-tool-fallback-card / -trigger / -args / -result (ToolFallback)
 * Not testid-covered: StatusDot (no data-testid on the tri-state dot in any card — see report).
 */

import { test, expect } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, createTauriChat, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { sendMessage, waitForIdle } from '../helpers/tauri/wait.js';

// ─── Bash card — deep dive (messaging recording) ──────────────────────────────

test.describe('§tool-cards — Bash (messaging)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'messaging' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');

    // mock-cli replay is purely positional (plugins/mock-cli/src/session.ts's `advance()` only
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

  test('is collapsed by default; expanding reveals command, description, and colorized output', async () => {
    const { page } = app;
    await sendMessage(page, 'List the files in this project using bash ls.');

    const card = page.getByTestId('chat-bash-card').first();
    await card.waitFor({ timeout: 90_000 });

    // Header text is present without expanding.
    await expect(card.getByTestId('chat-bash-command')).toHaveText('ls -la');
    await expect(card.getByTestId('chat-bash-description')).toHaveText('List files in the project directory');

    // Body is not mounted until the trigger is clicked (Radix Collapsible unmounts closed content).
    await expect(card.getByTestId('chat-bash-output')).toHaveCount(0);

    await card.getByTestId('chat-bash-trigger').click();
    const output = card.getByTestId('chat-bash-output');
    await expect(output).toBeVisible({ timeout: 5_000 });
    await expect(output).toContainText('CLAUDE.md');
    await expect(output).toContainText('index.ts');
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

  test('collapsed by default; expanding shows the written content once the write succeeds', async () => {
    const { page } = app;

    // Recording replay is positional: the first Write is scripted to be rejected regardless of
    // which button is clicked, so this deny is required to advance to the second (successful) Write —
    // mirrors chat.spec.ts's §permissions-interactive two-turn sequence.
    await sendMessage(page, 'Create a file at /tmp/mf-e2e-test.txt with content "hello"');
    await page.getByTestId('chat-permission-gate').waitFor({ timeout: 45_000 });
    await page.getByTestId('chat-permission-deny').click();
    await waitForIdle(page, 60_000);

    await sendMessage(page, 'Create /tmp/mf-e2e-test.txt again');
    await page.getByTestId('chat-permission-gate').waitFor({ timeout: 45_000 });
    await page.getByTestId('chat-permission-allow-once').click();
    await waitForIdle(page, 60_000);

    const card = page.getByTestId('chat-write-card').first();
    await card.waitFor({ timeout: 15_000 });
    await expect(card.getByTestId('tool-card-file-path')).toContainText('mf-e2e-test.txt');

    // No structuredPatch on this result (plain "File created successfully" string) — body starts
    // collapsed (Radix Collapsible.Root exposes data-state on the same element as the testid).
    await expect(card).toHaveAttribute('data-state', 'closed');
    await card.getByTestId('chat-write-trigger').click();
    await expect(card).toHaveAttribute('data-state', 'open');
    await expect(card.getByText('hello', { exact: true })).toBeVisible({ timeout: 5_000 });
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

  test('Read card shows the line-count meta and a collapsed code preview', async () => {
    const { page } = app;
    await sendMessage(page, 'Read index.ts and add a comment above the greeting export.');

    const readCard = page.getByTestId('read-card-root').first();
    await readCard.waitFor({ timeout: 60_000 });
    await expect(readCard.getByTestId('tool-card-file-path')).toContainText('index.ts');
    // Recorded Read result is "1\texport const greeting = \"hello\";\n2\t" → 2 lines.
    await expect(readCard).toContainText('· 2 lines');

    await expect(readCard.getByTestId('read-card-code-preview')).toHaveCount(0);
    await readCard.getByTestId('read-card-trigger').click();
    const preview = readCard.getByTestId('read-card-code-preview');
    await expect(preview).toBeVisible({ timeout: 5_000 });
    await expect(preview).toContainText('export const greeting');
  });

  test('Edit card is open by default with +/- stat pills and the diff body visible', async () => {
    const { page } = app;
    const editCard = page.getByTestId('chat-edit-card').first();
    await editCard.waitFor({ timeout: 15_000 });

    await expect(editCard.getByTestId('tool-card-file-path')).toContainText('index.ts');
    // No trigger click needed — Edit cards default open.
    await expect(editCard).toContainText('changed by AI');
    // old_string → new_string adds exactly one line ("// changed by AI"); computeFallbackHunks
    // reports it as +1 (the unchanged "export const greeting" line stays context).
    await expect(editCard).toContainText('+1');
  });

  test('"Open in diff editor" opens the Files surface diff tab with the edit\'s sides', async () => {
    const { page } = app;
    const editCard = page.getByTestId('chat-edit-card').first();
    await editCard.getByTestId('chat-edit-open-diff').click();

    const diffTab = page.getByTestId('diff-tab');
    await expect(diffTab).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('editor-diff')).toBeVisible({ timeout: 10_000 });
    await expect(diffTab).toContainText('index.ts');
    // Modified side carries the Edit tool's new_string.
    await expect(diffTab).toContainText('changed by AI');
  });
});

// ─── AskUserQuestion display card (answered preview) — ask-question ──────────

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

  test('renders the answered question with its selected-answer pill once the gate resolves', async () => {
    const { page } = app;
    await sendMessage(page, 'Use AskUserQuestion to ask me a single-select question with 2 options');

    await page.getByTestId('chat-question-gate').waitFor({ timeout: 60_000 });
    await page.locator('[data-testid^="chat-question-option-0-"]').first().click();
    await page.getByTestId('chat-question-submit').click();
    await waitForIdle(page, 60_000);

    // The daemon parses the recorded tool_result string into a structured `askUserQuestion` array
    // (packages/core/src/messages/parse-ask-user-question.ts) — deterministic regardless of which
    // option the live test clicked, since replay is positional/content-agnostic.
    const askCard = page.getByTestId('chat-ask-card').first();
    await askCard.waitFor({ timeout: 15_000 });
    await expect(askCard.getByTestId('chat-ask-header')).toContainText('Next Step');
    await expect(askCard.getByTestId('chat-ask-header')).toContainText('Work on index.ts');

    // FIXED: AskUserQuestionCard now derives its open state via
    // useAutoOpenOnTransition (packages/ui/src/features/chat/tools/cards/use-auto-open-on-transition.ts)
    // instead of an uncontrolled `defaultOpen`. This mock-cli path mounts the card PENDING first
    // (getToolCategories() here doesn't hide AskUserQuestion while pending, unlike the real Claude
    // adapter), so the answer arrives on a rerender of the SAME instance — `defaultOpen` only seeds
    // the initial mount and never re-fires, which is what caused the body to stay closed. The hook
    // watches the pending→answered transition on that instance and forces `open` to true exactly
    // once, while still honoring a manual collapse afterward.
    const body = askCard.getByTestId('chat-ask-body');
    await expect(body).toBeVisible({ timeout: 5_000 });
    await expect(body).toContainText('Would you like to start working on the index.ts file');
  });
});

// ─── Plan family: PlanBubble (approved) + PlanCard (rejected) — plan-approval ─

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

  test('an approved plan renders the PlanBubble ("Implementing plan") in the transcript', async () => {
    const { page } = app;
    await sendMessage(page, 'Add `export function greet(name: string) { return "Hello " + name; }` to utils.ts');
    await page.getByTestId('chat-plan-gate').waitFor({ timeout: 45_000 });
    await page.getByTestId('chat-plan-approve').click();

    const bubble = page.getByTestId('chat-plan-bubble').first();
    await bubble.waitFor({ timeout: 15_000 });
    await expect(bubble).toContainText('Implementing plan');
    await expect(bubble).toContainText('Approved');
    await expect(bubble).toContainText('greet');
    // The approved path replaces the raw "Updated plan" card entirely.
    await expect(page.getByTestId('chat-plan-card')).toHaveCount(0);

    // Clean up: the approval triggers an Edit permission gate next (plan-approval.0.ndjson) —
    // deny so the mock session ends cleanly.
    await page.getByTestId('chat-permission-gate').waitFor({ timeout: 45_000 });
    await page.getByTestId('chat-permission-deny').click();
    await waitForIdle(page, 90_000);
  });

  // Mid-test createTauriChat: same documented navigation-race guard as chat.spec.ts's
  // §plan-approval "revision" test (the row click + plan-mode toggle fire chat.updated →
  // runtime.threads.reload(), which can revert the active thread before sendMessage runs).
  // Reuses the exact interaction sequence chat.spec.ts already proves works against
  // plan-approval.1.ndjson; this test only ADDS assertions at a point chat.spec.ts already
  // safely reaches (right after the second chat-plan-gate appears), then performs the identical
  // final reject to close out the recording.
  test('a rejected plan (keep-planning → feedback) echoes the feedback as a user message and leaves the first PlanCard resultless', async () => {
    const { page } = app;
    await createTauriChat(app.page, project.projectId, 'plan');
    await sendMessage(page, 'Add `export function multiply(a: number, b: number) { return a * b; }` to utils.ts');
    await page.getByTestId('chat-plan-gate').waitFor({ timeout: 45_000 });

    await page.getByTestId('chat-plan-keep-planning').click();
    await expect(page.getByTestId('chat-plan-feedback-input')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('chat-plan-feedback-input').fill('Please also add a divide function');
    await page.getByTestId('chat-plan-send-feedback').click();

    // Root-caused live (read packages/core/src/chat/permission-handler.ts:62-69 +
    // .../plugins/builtin/claude/session.ts's respondToPermission): a deny-with-feedback response
    // is asymmetric by design — `response.message` is (a) echoed into chat history as a brand-new
    // TRANSIENT USER MESSAGE (createTransientMessage), and (b) forwarded to the CLI over stdin
    // ONLY. It is NEVER attached as a `tool_result` for the rejected ExitPlanMode tool_use — the
    // recording confirms no `tool_result` NDJSON event follows it, matching how the real CLI
    // itself behaves (a rejected-with-feedback plan just starts a new turn, it doesn't emit a
    // result for the old one). So the feedback text surfaces as a `chat-user-message` bubble, not
    // inside the first PlanCard's body.
    await expect(
      page.getByTestId('chat-user-message').filter({ hasText: 'Please also add a divide function' }),
    ).toBeVisible({
      timeout: 10_000,
    });

    // A second plan gate appears for the revised plan (chat.spec.ts's existing assertion).
    await page.getByTestId('chat-plan-gate').waitFor({ timeout: 45_000 });

    // The first (rejected) ExitPlanMode's display card is still in the transcript, but — per the
    // above — permanently resultless: `hasResult` stays false, so its trigger stays disabled and
    // no `chat-plan-body` ever mounts for it. (Only one `chat-plan-card` is visible at this point:
    // the second, now-pending ExitPlanMode's own card is suppressed from the main stream while its
    // gate is active, same as the first was before this reject.)
    const planCard = page.getByTestId('chat-plan-card').first();
    await expect(planCard).toBeVisible({ timeout: 10_000 });
    await expect(planCard.getByTestId('chat-plan-label')).toHaveText('Updated plan');
    await expect(planCard.getByTestId('chat-plan-trigger')).toBeDisabled();
    await expect(planCard.getByTestId('chat-plan-body')).toHaveCount(0);

    // Clean up exactly as chat.spec.ts does: reject the revised plan so the mock session ends cleanly.
    await page.getByTestId('chat-plan-reject').click();
    await waitForIdle(page, 60_000);
  });
});

// ─── Skill tool call + onSkillLoaded system pill (chat-status) ────────────────

test.describe('§tool-cards — Skill + SkillLoaded (chat-status)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'chat-status' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('Skill tool call renders the slash-command row; onSkillLoaded renders an expandable system pill', async () => {
    const { page } = app;

    // First turn carries no Skill tool call — consume it to reach the recording's second turn.
    await sendMessage(page, 'Explain what TypeScript generics are in two sentences.');
    await waitForIdle(page, 60_000);

    await sendMessage(
      page,
      'Now explain TypeScript mapped types, conditional types, and template literal types. Be thorough.',
    );

    const slashRow = page.getByTestId('chat-slash-command-row').first();
    await slashRow.waitFor({ timeout: 60_000 });
    await expect(slashRow).toContainText('/writing-clearly-and-concisely');

    const pill = page.getByTestId('chat-skill-loaded-pill').first();
    await pill.waitFor({ timeout: 15_000 });
    await expect(pill).toBeEnabled();

    // MarkerBody (the expand disclosure) carries no data-testid — assert the effect structurally via
    // the already-testid'd system-message container growing once the body mounts.
    const systemMessage = page.getByTestId('chat-system-message').filter({ has: pill });
    const collapsedBox = await systemMessage.boundingBox();
    await pill.click();
    await expect
      .poll(async () => (await systemMessage.boundingBox())?.height ?? 0, { timeout: 5_000 })
      .toBeGreaterThan(collapsedBox?.height ?? 0);
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

  test('collapsed by default with agent name/description; expanding renders the nested subagent transcript', async () => {
    const { page } = app;
    await sendMessage(page, 'Delegate finding the greeting export to a subagent');

    const card = page.getByTestId('chat-task-card').first();
    await card.waitFor({ timeout: 60_000 });
    await expect(card.getByTestId('chat-task-agent')).toHaveText('general-purpose');
    await expect(card.getByTestId('chat-task-description')).toContainText('Find the greeting export');

    // Nested transcript isn't mounted until expanded (Radix Collapsible unmounts closed content).
    await expect(card.getByTestId('chat-bash-card')).toHaveCount(0);
    await expect(card).toHaveAttribute('data-state', 'closed');

    await card.getByTestId('chat-task-toggle').click();
    await expect(card).toHaveAttribute('data-state', 'open');

    // The recorded onSubagentChild carries a nested Bash call (search) rendered via the same
    // tool-card registry the main thread uses.
    const nestedBash = card.getByTestId('chat-bash-card').first();
    await expect(nestedBash).toBeVisible({ timeout: 5_000 });
    await expect(nestedBash.getByTestId('chat-bash-command')).toContainText('export const greeting');
  });
});

// ─── TaskProgress card (TaskCreate/TaskUpdate reduction) — task-progress ──────

test.describe('§tool-cards — TaskProgress (task-progress)', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp({ recordingKey: 'task-progress' });
    project = await createTauriProject(app.page);
    await createTauriChat(app.page, project.projectId, 'acceptEdits');
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('default-open card shows rows reduced to their latest status', async () => {
    const { page } = app;
    await sendMessage(
      page,
      'Track three tasks: add a login form, write its tests, update the docs. Use TaskCreate/TaskUpdate to track progress.',
    );

    const card = page.getByTestId('chat-task-progress-card').first();
    await card.waitFor({ timeout: 60_000 });
    // Default open — rows are mounted without a trigger click.
    await expect(card).toHaveAttribute('data-state', 'open');
    await expect(card.getByTestId('chat-task-progress-toggle')).toContainText('(3)');

    // Recording: task 1 → in_progress → completed; task 2 → in_progress; task 3 never updated.
    const completed = card.getByTestId('chat-task-progress-item-completed');
    await expect(completed).toContainText('Add login form');
    const inProgress = card.getByTestId('chat-task-progress-item-in_progress');
    await expect(inProgress).toContainText('Write login form tests');
    const pending = card.getByTestId('chat-task-progress-item-pending');
    await expect(pending).toContainText('Update login form docs');
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

  test('collapsed by default; expanding shows the fetched url and a summary body', async () => {
    const { page } = app;
    await sendMessage(page, 'Fetch https://example.com/docs and summarize it');

    const card = page.getByTestId('web-fetch-card-root').first();
    await card.waitFor({ timeout: 60_000 });
    await expect(card).toHaveAttribute('data-state', 'closed');
    await expect(card.getByTestId('web-fetch-card-url')).toHaveCount(0);

    await card.getByTestId('web-fetch-card-trigger').click();
    await expect(card).toHaveAttribute('data-state', 'open');
    await expect(card.getByTestId('web-fetch-card-url')).toHaveText('https://example.com/docs');
    await expect(card.getByTestId('web-fetch-card-summary')).toContainText('REST API');
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

  test('done pill is expandable to ARGUMENTS/RESULT; the errored second call renders the failed variant', async () => {
    const { page } = app;
    await sendMessage(page, 'Use the linear MCP server to look up issue MF-42');

    const pills = page.getByTestId('chat-mcp-pill');
    const donePill = pills.nth(0);
    await donePill.waitFor({ timeout: 60_000 });
    await expect(donePill).toContainText('Linear executed');
    await expect(donePill).toContainText('get_issue');

    await expect(page.getByTestId('marker-body')).toHaveCount(0);
    await donePill.click();
    const body = page.getByTestId('marker-body');
    await expect(body).toBeVisible({ timeout: 5_000 });
    await expect(body).toContainText('MF-42');
    await expect(body).toContainText('In Progress');

    // Second call errors — its pill renders the failed variant and is not expandable.
    const errorPill = pills.nth(1);
    await expect(errorPill).toBeVisible({ timeout: 10_000 });
    await expect(errorPill).toContainText('Linear failed:');
    await expect(errorPill).toContainText('get_issue');
    await expect(errorPill).toBeDisabled();
  });
});

// ─── ToolFallback card for an unregistered tool name — unregistered-tool ──────

test.describe('§tool-cards — ToolFallback (unregistered-tool)', () => {
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

  test('a tool name absent from TOOL_REGISTRY falls through to the generic card', async () => {
    const { page } = app;
    await sendMessage(page, 'Use the custom analytics tool to report a build event');

    const card = page.getByTestId('chat-tool-fallback-card').first();
    await card.waitFor({ timeout: 60_000 });
    await expect(card.getByTestId('chat-tool-fallback-trigger')).toContainText('CustomAnalyticsReport');

    await expect(card.getByTestId('chat-tool-fallback-args')).toHaveCount(0);
    await card.getByTestId('chat-tool-fallback-trigger').click();

    await expect(card.getByTestId('chat-tool-fallback-args')).toContainText('build_completed');
    await expect(card.getByTestId('chat-tool-fallback-result')).toContainText('Event recorded');
  });
});

// ─── Card families with no recording today ────────────────────────────────────

test.describe('§tool-cards — families needing a recording', () => {
  test.skip('Schedule/Cron/Monitor pills (all 5 kinds)', async () => {
    // TODO(recording): needs `schedule-pills` — ScheduleWakeup, CronCreate, CronDelete, CronList
    // (with >=1 job, for the expandable job-list body), and Monitor calls. No existing recording
    // calls any of these tool names.
  });

  test.skip('EnterWorktree / ExitWorktree pills', async () => {
    // TODO(recording): needs `worktree-pills` — an EnterWorktree call (name/worktreePath in the
    // result) and an ExitWorktree call (action: keep vs remove). No existing recording calls
    // either tool name.
  });

  test.skip('ToolResultExpand "Show full output" for a truncated tool result', async () => {
    // TODO(recording): needs any tool call (Bash/Read/Grep are simplest) whose result carries
    // `{truncated: true, fullBytes: N}` — i.e. an output large enough for the daemon to truncate.
    // Every existing recording's tool output is small (a handful of lines), so isTruncatedResult()
    // is false everywhere; ToolResultExpand's toggle/collapse/fetch-error states are unreached.
  });

  test.skip('ToolGroup — consecutive explore-family tool calls collapse under one header', async () => {
    // TODO(recording): needs `tool-group` — 2+ consecutive Read/Glob/Grep/LS calls in one assistant
    // turn with no non-explore tool call between them, so the daemon's tool_group encoding fires
    // (see group-parts.ts: "a LONE explore tool ... has no recorded groupId"). changes-tab/
    // context-tab each call exactly one Read before an Edit — not consecutive explore tools, so no
    // grouping occurs today. Also needs the group to still be RUNNING at some point during replay to
    // exercise ToolGroupTrigger's aria-busy state.
  });

  test.skip('Bash card exit-code coloring (ExitLine green/red) and error-bordered card', async () => {
    // TODO(recording): needs `bash-exit-code` — a Bash call whose result ends with a trailing
    // "exit N" line (both N=0 and N!=0 variants), and/or an isError:true Bash result, to exercise
    // BashCard's ExitLine color branch and cardStyle's destructive border. messaging/thread's `ls -la`
    // result has no trailing exit line and isError:false.
  });
});
