/**
 * §workflows — Workflows fullview modal (plan spec #30, Cluster D).
 *
 * Scope: docs/plans/2026-07-03-tauri-e2e-test-plan.md spec #30. The "opens the
 * modal" scenario is already covered by sidebar-chrome.spec.ts ("workflows button
 * opens the workflows modal") — not re-asserted here, only used as a precondition.
 *
 * Fixed since the previous pass: `editor/yaml-serialize.ts`'s `serializeWorkflow()`
 * no longer emits a top-level `scope:` line (was colliding with the daemon's
 * `.strict()` `workflowSchema`, which has no `scope` field) — a builder-built
 * document now parses and can reach a savable state. `WorkflowEditor.tsx`'s
 * `scheduleValidation` also now sets `validationError` (surfaced via the
 * `workflows-editor-validation-error` testid in `WfEditorChrome.tsx`) on a
 * thrown `validateYaml()` request instead of silently swallowing it — see the
 * "Editor" describe below for both the success path and the validation-error
 * path (an invalid `name:`, which the daemon rejects at parse time — a 400 —
 * distinct from `verifyWorkflow`'s semantic errors, which return 200 with a
 * `{valid:false, errors:[...]}` body rendered in the normal footer instead).
 *
 * The "Runs" and "Needs you" describes below still seed workflows directly via
 * `PUT /api/workflows/:id` with hand-written YAML (the same REST path
 * `wfApi.putWorkflow` uses) rather than the builder — this keeps those describes
 * independent of the Editor describe's builder-interaction sequencing, and lets
 * both seeded workflows use step kinds that never spawn an agent or chat (`set`,
 * `question`) so runs are safe to execute for real inside the suite.
 *
 * Testid reference (verified against packages/ui/src/features/workflows/):
 *   sidebar-workflows-button          — layout/SidebarHeader.tsx (dispatches mf:open-workflows)
 *   workflows-modal                   — WorkflowsModalHost.tsx DialogContent
 *   workflows-nav-<needs|runs|library> — WorkflowsView.tsx left nav
 *   workflows-library / -new / -scope-<all|project|global>
 *   workflows-library-row/-run/-edit-<wf.id>
 *   workflows-editor / -close / -cancel / -save / -mode-<builder|split|yaml>
 *   workflows-builder / -name / -description / -scope-<global|project>
 *   workflows-builder-add-step / -add-trigger / -add-output
 *   workflows-steplib / -steplib-<kind>
 *   workflows-builder-step-<id> / -title-<id> / -configure-<id> / -remove-<id>
 *   workflows-editor-yaml             — WfYamlPane.tsx textarea
 *   workflows-run-row-<run.id> / workflows-runs-filter-<id>
 *   workflows-run-back / -cancel / -banner / -parent-link
 *   workflows-step-<stepPath> / -<stepPath>-pip / -chat-<stepPath>
 *   workflows-needsyou / -needsyou-empty
 *   workflows-interaction-answer-<id> / -viewrun-<id>
 *   workflows-field-<key>             — WfField.tsx
 *   workflows-answer-submit           — WfAnswerForm.tsx
 * Testids referenced only by role/text (no data-testid on the element):
 *   per-trigger-kind popover option buttons (WfbDropdowns.tsx) — "Remove trigger" /
 *   "Schedule" etc. are plain buttons with an aria-label or visible text only.
 */

import { test, expect, type Page } from '@playwright/test';
import { launchTauriApp, closeTauriApp, type TauriAppFixture } from '../fixtures/app-tauri.js';
import { createTauriProject, cleanupTauriProject, type TauriProject } from '../helpers/tauri/setup.js';
import { DAEMON_BASE } from '../fixtures/daemon.js';

// ── REST seeding helpers (bypass the broken builder serializer; exercise the
//    same daemon write/run contract the app itself uses) ──────────────────────

async function putWorkflowYaml(id: string, yaml: string): Promise<void> {
  const res = await fetch(`${DAEMON_BASE}/api/workflows/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ yaml }),
  });
  if (!res.ok) throw new Error(`putWorkflowYaml(${id}) failed: ${res.status} ${await res.text()}`);
}

async function startRunRest(id: string): Promise<string> {
  const res = await fetch(`${DAEMON_BASE}/api/workflows/${encodeURIComponent(id)}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`startRunRest(${id}) failed: ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { data: { id: string } };
  return body.data.id;
}

async function waitForRunStatus(runId: string, statuses: string[], timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${DAEMON_BASE}/api/workflow-runs/${encodeURIComponent(runId)}`);
    if (res.ok) {
      const body = (await res.json()) as { data: { run: { status: string } } };
      if (statuses.includes(body.data.run.status)) return body.data.run.status;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`waitForRunStatus(${runId}): did not reach [${statuses.join(',')}] within ${timeoutMs}ms`);
}

async function getPendingInteractions(): Promise<Array<{ id: string; runId: string; title: string }>> {
  const res = await fetch(`${DAEMON_BASE}/api/workflow-interactions`);
  const body = (await res.json()) as { data: Array<{ id: string; runId: string; title: string }> };
  return body.data;
}

/** Open the modal fresh and navigate straight to the Library nav item. */
async function openLibrary(page: Page): Promise<void> {
  await page.getByTestId('sidebar-workflows-button').click();
  await expect(page.getByTestId('workflows-modal')).toBeVisible({ timeout: 10_000 });
  await page.getByTestId('workflows-nav-library').click();
  await expect(page.getByTestId('workflows-library')).toBeVisible({ timeout: 10_000 });
}

const SAFE_SET_YAML = (name: string): string =>
  `version: 1\nname: ${name}\ndescription: "Safe e2e workflow — single set step, no side effects"\nsteps:\n  - id: set_greeting\n    set: { message: "hello from e2e" }\n`;

const NEEDSYOU_YAML = (name: string): string =>
  `version: 1\nname: ${name}\ndescription: "Needs-you e2e workflow — single question step"\nsteps:\n  - id: ask_color\n    question:\n      title: "What is your favorite color?"\n      fields:\n        - { key: answer, type: text, required: true }\n`;

// ─── §workflows Library — scope tabs, new → editor, cancel/close ──────────────

test.describe('§workflows Library', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let globalId: string;
  let projectId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    globalId = 'global:e2e-lib-global';
    projectId = `${project.projectId}:e2e-lib-project`;
    await putWorkflowYaml(globalId, SAFE_SET_YAML('e2e-lib-global'));
    await putWorkflowYaml(projectId, SAFE_SET_YAML('e2e-lib-project'));
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('scope tabs filter workflows by All / This project / Global', async () => {
    const { page } = app;
    await openLibrary(page);

    const globalRow = page.getByTestId(`workflows-library-row-${globalId}`);
    const projectRow = page.getByTestId(`workflows-library-row-${projectId}`);

    await expect(globalRow).toBeVisible({ timeout: 10_000 });
    await expect(projectRow).toBeVisible();

    await page.getByTestId('workflows-library-scope-project').click();
    await expect(projectRow).toBeVisible();
    await expect(globalRow).toHaveCount(0);

    await page.getByTestId('workflows-library-scope-global').click();
    await expect(globalRow).toBeVisible();
    await expect(projectRow).toHaveCount(0);

    await page.getByTestId('workflows-library-scope-all').click();
    await expect(globalRow).toBeVisible();
    await expect(projectRow).toBeVisible();
  });

  test('New workflow opens a blank editor in split mode', async () => {
    const { page } = app;
    await page.getByTestId('workflows-library-new').click();

    await expect(page.getByTestId('workflows-editor')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('workflows-builder')).toBeVisible();
    await expect(page.getByTestId('workflows-editor-yaml')).toBeVisible();
    await expect(page.getByTestId('workflows-builder-name')).toHaveValue('');
    await expect(page.getByTestId('workflows-builder-description')).toHaveValue('');
    await expect(page.getByTestId('workflows-editor-yaml')).toHaveValue(/name: untitled/);
  });

  test('Cancel discards the draft and returns to the library with no new row', async () => {
    const { page } = app;
    await page.getByTestId('workflows-builder-name').fill('Cancelled Draft');
    await page.getByTestId('workflows-editor-cancel').click();

    await expect(page.getByTestId('workflows-editor')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('workflows-library')).toBeVisible();
    await expect(page.getByTestId('workflows-library-row-global:cancelled-draft')).toHaveCount(0);
  });

  test('the header Close button also discards an in-progress draft', async () => {
    const { page } = app;
    await page.getByTestId('workflows-library-new').click();
    await expect(page.getByTestId('workflows-editor')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('workflows-builder-name').fill('Closed Draft');
    await page.getByTestId('workflows-editor-close').click();

    await expect(page.getByTestId('workflows-editor')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByTestId('workflows-library-row-global:closed-draft')).toHaveCount(0);
  });
});

// ─── §workflows Editor — builder round-trip, the scope-key contract bug, invalid YAML ──

test.describe('§workflows Editor', () => {
  let app: TauriAppFixture;
  let project: TauriProject;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('builder edits (name, description, scope, a step, a trigger, an output) round-trip live into the YAML pane', async () => {
    const { page } = app;
    await openLibrary(page);
    await page.getByTestId('workflows-library-new').click();
    await expect(page.getByTestId('workflows-editor')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('workflows-builder-name').fill('My Deploy Flow');
    await page.getByTestId('workflows-builder-description').fill('Ships the thing');
    await page.getByTestId('workflows-builder-scope-project').click();

    // Add the simplest, safest leaf step kind: "set" (a pure in-memory value —
    // no connector call, no agent/chat spawn). Model kind 'set' == library card "Value".
    await page.getByTestId('workflows-builder-add-step').click();
    await expect(page.getByTestId('workflows-steplib')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('workflows-steplib-set').click();
    await expect(page.getByTestId('workflows-steplib')).toHaveCount(0, { timeout: 5_000 });

    const stepTitleInput = page.getByTestId(/^workflows-builder-step-title-set_/);
    await expect(stepTitleInput).toBeVisible({ timeout: 5_000 });

    // Configure toggle exists but only renders a placeholder for 'set' steps today
    // (WfbStepRow.tsx: composite/per-kind config panels are DEFERRED) — exercise
    // the toggle itself, don't assert real field editing that doesn't exist yet.
    const configureBtn = page.getByTestId(/^workflows-builder-step-configure-set_/);
    await configureBtn.click();
    await expect(page.getByText('Configure panel for')).toBeVisible();
    await configureBtn.click();

    await page.getByTestId('workflows-builder-add-trigger').click();
    await page.getByRole('button', { name: 'Schedule' }).click();

    await page.getByTestId('workflows-builder-add-output').click();

    const yamlPane = page.getByTestId('workflows-editor-yaml');
    await expect(yamlPane).toHaveValue(/name: my-deploy-flow/);
    await expect(yamlPane).toHaveValue(/scope: project/);
    await expect(yamlPane).toHaveValue(/description: "Ships the thing"/);
    await expect(yamlPane).toHaveValue(/set: \{ value: null \}/);
    await expect(yamlPane).toHaveValue(/- schedule: \{ cron: "0 9 \* \* \*", on_missed: run_once \}/);
    await expect(yamlPane).toHaveValue(/outputs:\n {2}output1: "\$\{ \.\.\. \}"/);

    // Remove-trigger control has no testid (WfBuilderPane.tsx TriggerRow) — there
    // are now 2 rows (default manual + the schedule just added, in that DOM
    // order); .last() targets the schedule row just added. Removing it drops the
    // whole `triggers:` section (serializeWorkflow only emits schedule/event
    // triggers — a manual-only draft serializes no `triggers:` key at all).
    await page.getByRole('button', { name: 'Remove trigger' }).last().click();
    await expect(yamlPane).not.toHaveValue(/schedule:/);
  });

  test('a builder-built workflow with a name and one step becomes savable and appears in the library', async () => {
    const { page } = app;
    // Fresh editor session — the previous test's draft carries an unresolved output
    // placeholder (`${ ... }`), which `verifyWorkflow` correctly flags as invalid; start
    // a minimal draft that's actually schema-valid instead of fighting that leftover state.
    await page.getByTestId('workflows-editor-cancel').click();
    await expect(page.getByTestId('workflows-editor')).toHaveCount(0, { timeout: 5_000 });
    await page.getByTestId('workflows-library-new').click();
    await expect(page.getByTestId('workflows-editor')).toBeVisible({ timeout: 10_000 });

    await page.getByTestId('workflows-builder-name').fill('My Safe Flow');
    // Explicit global scope: this describe never activates a session, so
    // useActiveIdentity().projectId is unset regardless — deriveWorkflowId's own
    // documented fallback would resolve 'project' scope to 'global:' anyway; picking
    // it explicitly keeps the expected row id self-evident from the test.
    await page.getByTestId('workflows-builder-scope-global').click();
    await page.getByTestId('workflows-builder-add-step').click();
    await expect(page.getByTestId('workflows-steplib')).toBeVisible({ timeout: 5_000 });
    await page.getByTestId('workflows-steplib-set').click();

    const saveButton = page.getByTestId('workflows-editor-save');
    await expect(saveButton).toBeEnabled({ timeout: 10_000 });
    await expect(page.getByTestId('workflows-editor-validation-error')).toHaveCount(0);

    await saveButton.click();
    await expect(page.getByTestId('workflows-editor')).toHaveCount(0, { timeout: 10_000 });
    await expect(page.getByTestId('workflows-library')).toBeVisible();
    await expect(page.getByTestId('workflows-library-row-global:my-safe-flow')).toBeVisible({ timeout: 10_000 });
  });

  test('an invalid `name:` fails schema parsing and surfaces via workflows-editor-validation-error', async () => {
    const { page } = app;
    await page.getByTestId('workflows-library-new').click();
    await expect(page.getByTestId('workflows-editor')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('workflows-editor-mode-yaml').click();

    // idSchema (packages/core/src/workflows/dsl/schema.ts) is `/^[a-zA-Z0-9_-]+$/` — a
    // name with spaces/punctuation fails schema parsing (a 400 from POST /validate),
    // distinct from a semantic error like the dangling-reference case below (which
    // parses fine and returns 200 with `{valid:false, errors:[...]}`).
    const yamlPane = page.getByTestId('workflows-editor-yaml');
    const invalidNameYaml =
      'version: 1\nname: "not a valid name!"\nsteps:\n  - id: set_value\n    set: { message: "hi" }\n';
    await yamlPane.fill(invalidNameYaml);

    const errorFooter = page.getByTestId('workflows-editor-validation-error');
    await expect(errorFooter).toBeVisible({ timeout: 10_000 });
    await expect(errorFooter).toContainText('name');
    await expect(page.getByTestId('workflows-editor-save')).toBeDisabled();
  });

  test('a dangling output reference in YAML mode surfaces a real validation error and blocks save', async () => {
    const { page } = app;
    await page.getByTestId('workflows-editor-cancel').click();
    await expect(page.getByTestId('workflows-editor')).toHaveCount(0, { timeout: 5_000 });
    await page.getByTestId('workflows-library-new').click();
    await expect(page.getByTestId('workflows-editor')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('workflows-editor-mode-yaml').click();

    const yamlPane = page.getByTestId('workflows-editor-yaml');
    const invalidYaml =
      'version: 1\nname: e2e-invalid-ref\nsteps:\n  - id: set_value\n    set: { message: "hi" }\noutputs:\n  bogus: "${ ghost_step.field }"\n';
    await yamlPane.fill(invalidYaml);

    await expect(page.getByText('is not in scope')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('workflows-editor-save')).toBeDisabled();
  });
});

// ─── §workflows Runs — run from library, run detail tree, runs filter tabs ────

test.describe('§workflows Runs', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  const wfId = 'global:e2e-run-safe';

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    await putWorkflowYaml(wfId, SAFE_SET_YAML('e2e-run-safe'));
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the library shows zero runs before anything has been started', async () => {
    const { page } = app;
    await openLibrary(page);
    await page.getByTestId('workflows-nav-runs').click();
    await expect(page.getByTestId('workflows-runs-filter-all')).toContainText('0');
    await expect(page.locator('[data-testid^="workflows-run-row-"]')).toHaveCount(0);
  });

  test('running the "set" workflow from the library navigates to a succeeding run detail', async () => {
    const { page } = app;
    await page.getByTestId('workflows-nav-library').click();
    await expect(page.getByTestId(`workflows-library-row-${wfId}`)).toBeVisible({ timeout: 10_000 });

    await page.getByTestId(`workflows-library-run-${wfId}`).click();

    await expect(page.getByTestId('workflows-run-back')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Succeeded')).toBeVisible({ timeout: 15_000 });

    const stepNode = page.getByTestId('workflows-step-steps.0');
    await expect(stepNode).toBeVisible();
    await expect(stepNode).toContainText('Done');

    await stepNode.click();
    await expect(page.getByText('hello from e2e')).toBeVisible({ timeout: 5_000 });
  });

  test('runs filter tabs show the completed run under "Done" and hide it under "Waiting"', async () => {
    const { page } = app;
    await page.getByTestId('workflows-run-back').click();
    await page.getByTestId('workflows-nav-runs').click();

    const runs = await (await fetch(`${DAEMON_BASE}/api/workflows/${encodeURIComponent(wfId)}/runs`)).json();
    const runId = (runs as { data: Array<{ id: string }> }).data[0]?.id;
    if (!runId) throw new Error('expected at least one run for e2e-run-safe');
    const row = page.getByTestId(`workflows-run-row-${runId}`);

    await expect(page.getByTestId('workflows-runs-filter-succeeded')).toContainText('1');
    await expect(page.getByTestId('workflows-runs-filter-waiting')).toContainText('0');
    await expect(row).toBeVisible();

    await page.getByTestId('workflows-runs-filter-waiting').click();
    await expect(row).toHaveCount(0);

    await page.getByTestId('workflows-runs-filter-all').click();
    await expect(row).toBeVisible();
  });

  test.skip(
    'cancelling an active run — TODO(app-tauri): the "set" step completes synchronously ' +
      "(engine.ts executeStep case 'set' has no async wait), leaving no reliable window to click " +
      'Cancel before the run finishes. Every other safe step kind (set/question) is either instant ' +
      "or requires a separate paused-run fixture (covered by the Needs-you describe's 'question' " +
      'workflow instead, which has no Cancel-specific assertion either since it resolves via answer, ' +
      'not cancel). Needs an intentionally slow/stalled connector or a long cron wait to test safely.',
    () => {},
  );

  test.skip(
    "opening a step's agent chat from the run tree — TODO(app-tauri): only 'agent' steps carry a " +
      "chatId (WfStepNode 'Open agent chat' button), and an agent step spawns a real chat/CLI turn — " +
      'excluded from this suite as unsafe per the dispatch (no trivially-safe step produces a chatId). ' +
      'Needs a purpose-built mock-cli recording wired through the workflow agent executor.',
    () => {},
  );
});

// ─── §workflows Needs you — interaction card, answer form, paused run detail ──

test.describe('§workflows Needs you', () => {
  let app: TauriAppFixture;
  let project: TauriProject;
  let wfId: string;
  let runId: string;
  let interactionId: string;

  test.beforeAll(async () => {
    app = await launchTauriApp();
    project = await createTauriProject(app.page);
    wfId = `${project.projectId}:e2e-needsyou-wf`;
    await putWorkflowYaml(wfId, NEEDSYOU_YAML('e2e-needsyou-wf'));
    runId = await startRunRest(wfId);
    await waitForRunStatus(runId, ['waiting']);
    const pending = await getPendingInteractions();
    const interaction = pending.find((i) => i.runId === runId);
    if (!interaction) throw new Error('expected a pending interaction for the needs-you run');
    interactionId = interaction.id;
  });

  test.afterAll(async () => {
    cleanupTauriProject(project);
    await closeTauriApp(app);
  });

  test('the needs-you section lists the pending interaction, expanded by default, with its answer field', async () => {
    const { page } = app;
    // openModal() defaults to the 'needs' section — this is the very first open
    // in this fresh app instance, so no explicit nav click is needed.
    await page.getByTestId('sidebar-workflows-button').click();
    await expect(page.getByTestId('workflows-needsyou')).toBeVisible({ timeout: 10_000 });

    await expect(page.getByText('1 run is waiting for your answer')).toBeVisible();
    await expect(page.getByText('What is your favorite color?')).toBeVisible();
    // First card is expanded by default (WfNeedsYou.tsx defaultExpanded={i===0}).
    await expect(page.getByTestId('workflows-field-answer')).toBeVisible();
  });

  test("View run opens the paused run's detail showing a Waiting step, Back returns to the needs list", async () => {
    const { page } = app;
    await page.getByTestId(`workflows-interaction-viewrun-${interactionId}`).click();

    await expect(page.getByTestId('workflows-run-back')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Waiting', { exact: true })).toBeVisible();

    const stepNode = page.getByTestId('workflows-step-steps.0');
    await expect(stepNode).toBeVisible();
    await expect(stepNode).toContainText('What is your favorite color?');

    await page.getByTestId('workflows-run-back').click();
    await expect(page.getByTestId('workflows-needsyou')).toBeVisible({ timeout: 5_000 });
  });

  test('submitting the answer resolves the interaction and clears the needs-you list', async () => {
    const { page } = app;
    await page.getByTestId('workflows-field-answer').fill('Blue');
    await page.getByTestId('workflows-answer-submit').click();

    await expect(page.getByText('Answer submitted — the run will continue.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('workflows-needsyou-empty')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("You're all caught up")).toBeVisible();
  });

  test('the run detail shows the step as Done with the submitted answer after resolution', async () => {
    const { page } = app;
    await page.getByTestId('workflows-nav-runs').click();
    const row = page.getByTestId(`workflows-run-row-${runId}`);
    await expect(row).toBeVisible({ timeout: 10_000 });
    await row.click();

    await expect(page.getByText('Succeeded')).toBeVisible({ timeout: 10_000 });
    const stepNode = page.getByTestId('workflows-step-steps.0');
    await stepNode.click();
    await expect(page.getByText('"Blue"')).toBeVisible({ timeout: 5_000 });
  });
});
