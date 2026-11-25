// Composer & gates: the card, its strips, its menus, the flow of a running turn, and the gates above it.
import type { Page } from '../../../../packages/e2e/node_modules/@playwright/test/index.mjs';
import { daemonFetch, fetchRoute } from '../../../../packages/e2e/fixtures/daemon.js';
import { sendMessage, waitForIdle } from '../../../../packages/e2e/helpers/tauri/wait.js';
import { escape, openWorkspaceFiles, parkPointer, seedWorkbench, stub, stubUsage } from '../seed.mts';
import type { CaptureArea, CaptureContext, CaptureState, Crop } from '../types.mts';

const field = (page: Page) => page.getByTestId('chat-composer-input');

/** The composer and what is around it, read off the page so a frame never cuts a strip or a menu. */
const around =
  (above: number, below = 24, side = 40) =>
  async (page: Page): Promise<Crop> => {
    const box = await page.getByTestId('chat-thread-footer').boundingBox();
    if (!box) throw new Error('no composer on the page');
    const y = Math.max(0, Math.floor(box.y - above));
    const bottom = Math.min(page.viewportSize()!.height, Math.ceil(box.y + box.height + below));
    return [Math.floor(box.x - side), y, Math.ceil(box.width + side * 2), bottom - y];
  };

/** The daemon's own adapters, with the given capabilities on: the mock can neither steer nor run `auto`. */
async function stubCapabilities(page: Page): Promise<void> {
  await page.route(/\/api\/adapters$/, async (route) => {
    const response = await fetchRoute(route);
    const body = await response.json();
    for (const adapter of body.data) adapter.capabilities = { ...adapter.capabilities, steer: true, autoMode: true };
    await route.fulfill({ response, json: body });
  });
}

const MINUTE = 60_000;

/** Background work the mock daemon has no source for. */
async function stubActivity(page: Page): Promise<void> {
  const now = Date.now();
  const task = (id: string, kind: string, description: string, minutes: number, extra: object = {}) => ({
    id,
    kind,
    toolName: 'Bash',
    toolUseId: '',
    command: '',
    description,
    outputPath: null,
    startedAt: now - minutes * MINUTE,
    endedAt: null,
    status: 'running',
    lastOutputLine: null,
    summary: null,
    usage: null,
    ...extra,
  });
  await stub(page, /\/background-tasks$/, {
    tasks: [
      task('a1', 'agent', 'Review the scope diff', 6),
      task('a2', 'agent', 'Find every caller of snapshot()', 4),
      task('w1', 'workflow', 'release-readiness', 12, { toolName: 'Workflow', workflowName: 'release-readiness' }),
      task('m1', 'bash', 'Watch CI on the branch', 9, { toolName: 'Monitor' }),
      task('b1', 'bash', 'pnpm dev', 31, { command: 'pnpm dev' }),
    ],
  });
}

const before = async (page: Page) => {
  await stubUsage(page);
  await stubCapabilities(page);
};

async function seed(ctx: CaptureContext): Promise<void> {
  const { chats, atlas } = await seedWorkbench(ctx.page);
  ctx.vars['chat'] = chats.at(-1)!;
  ctx.vars['project'] = atlas;
}

/** Open tasks for the empty state to start from (K11). */
async function seedTasks(projectId: string): Promise<void> {
  for (const title of [
    'Preview captures leave out native scrollbars',
    'Remember file tree expansion per project',
    'Auto mode is ignored after a resume',
  ]) {
    await daemonFetch('/api/plugins/todos/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, title }),
    });
  }
}

/** A small picture of a bar, for the image tile. */
const CAPSULE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAoCAIAAADBrGu+AAAASklEQVR42u3VQQkAIBAAwctnKVteCvFhAkt4oDiwBea1MeZ6ugAAAAAAAAAAAAAAOAhoPUsDAAAAALgb4MQAAAAAAAAAAAAAnwA2nTjMhz2GqAEAAAAASUVORK5CYII=',
  'base64',
);

/** Runs the recording's first turn, so the session has a transcript and a context reading. */
async function turn(page: Page, text: string): Promise<void> {
  await sendMessage(page, text);
  await waitForIdle(page);
}

const menu = (
  id: string,
  caption: string,
  open: (ctx: CaptureContext) => Promise<void>,
  above = 420,
): CaptureState => ({
  id,
  caption,
  crop: around(above),
  wait: 500,
  setup: async (ctx) => {
    await escape(ctx.page);
    await open(ctx);
  },
});

const narrow = (width: number, caption: string, id = `width-${width}`): CaptureState => ({
  id,
  caption,
  crop: around(12, 16, 0),
  wait: 600,
  setup: async ({ page }) => {
    await page.evaluate((px) => {
      for (const part of ['chat-composer-frame', 'composer-bottom-strip']) {
        const element = document.querySelector<HTMLElement>(`[data-testid="${part}"]`);
        if (!element) continue;
        element.style.maxWidth = `${px}px`;
        element.style.minWidth = '0';
      }
    }, width);
    await parkPointer(page);
  },
});

const area: CaptureArea = {
  boards: [
    {
      file: 'Chat-Composer',
      title: 'Chat — composer',
      subtitle: 'The card, the strips above and below it, and what the toolbar shows in each state.',
      width: 2800,
    },
    {
      file: 'Chat-ComposerMenus',
      title: 'Chat — composer menus',
      subtitle: 'Everything that opens from the composer.',
      width: 2800,
    },
    {
      file: 'Chat-ComposerFlow',
      title: 'Chat — composer, from draft to stop',
      subtitle: 'One turn: send, queue or steer while it runs, stop it, send what was held.',
      width: 2800,
    },
    {
      file: 'Chat-ComposerFocus',
      title: 'Chat — composer focus and gates',
      subtitle: 'The focused composer, and each request pinned above it.',
      width: 2800,
    },
  ],
  groups: [
    // ── New session: the empty state, and the strip with the project and where it runs ──
    {
      board: 'Chat-Composer',
      launch: { recordingKey: 'composer-running' },
      before,
      seed: async (ctx) => {
        await seed(ctx);
        await seedTasks(ctx.vars['project']!);
      },
      states: [
        {
          id: 'empty-no-project',
          caption: '**No project chosen.** The empty state asks for one (K11).',
          crop: around(200),
          setup: async ({ page }) => {
            await page.getByTestId('sidebar-action-new-thread').click();
            await page.getByTestId('sessions-welcome').waitFor();
            await page.getByTestId('welcome-project').click();
            await page.getByTestId('welcome-project-picker-no-project').click();
            await page.getByText('No project: the agent works without a repository').waitFor();
            await parkPointer(page);
          },
          wait: 800,
        },
        {
          id: 'empty',
          caption:
            '**A new session is about its project** (K11): where it will run, recent sessions to continue, open tasks to start from.',
          crop: around(420),
          setup: async ({ page, vars }) => {
            await page.getByTestId('welcome-project').click();
            await page.getByTestId(`welcome-project-${vars['project']}`).click();
            await page.getByTestId('sessions-welcome-tasks').waitFor();
            await parkPointer(page);
          },
          wait: 800,
        },
        {
          id: 'new-session',
          caption: '**New session.** Project and branch sit above the card (K3); nothing below it yet (K7).',
          crop: around(120),
          setup: async ({ page }) => {
            await page.getByTestId('composer-branch-picker').waitFor();
            await parkPointer(page);
          },
          wait: 800,
        },
        {
          id: 'new-session-typed',
          caption: '**Ready to send.** Send fills with the accent; the field draws the card’s focus line (C3, C8).',
          crop: around(40),
          setup: async ({ page }) => field(page).fill('Fix the quota reset after the machine sleeps'),
        },
        {
          id: 'new-worktree',
          caption:
            '**In a new worktree.** The branch part names what it starts from, and the empty state follows (K11).',
          crop: around(420),
          setup: async ({ page }) => {
            await page.getByTestId('composer-branch-picker').click();
            await page.getByTestId('composer-branch-new-worktree').click();
            await escape(page);
          },
        },
        {
          id: 'temporary',
          caption: '**Temporary.** Excludes a worktree; fixed once the session starts.',
          crop: around(40),
          setup: async ({ page }) => {
            await page.getByTestId('composer-branch-picker').click();
            await page.getByTestId('composer-temporary-toggle').click();
            await escape(page);
          },
        },
      ],
    },
    // ── What a draft carries (C14). A preview capture needs the native webview, which the mock has not. ──
    {
      board: 'Chat-Composer',
      launch: { recordingKey: 'composer-running', mockMaxDelayMs: 3_600_000 },
      before,
      seed: async (ctx) => {
        await seed(ctx);
        await turn(ctx.page, 'Where does the quota reset?');
      },
      states: [
        {
          id: 'draft-files',
          caption: '**Files and images**, one tile each: extension or thumbnail, name, dimensions and size (C14).',
          crop: around(24),
          setup: async ({ page }) => {
            const chooser = page.waitForEvent('filechooser');
            await page.getByTestId('composer-add-menu').click();
            await page.getByTestId('composer-add-attachment').click();
            await (
              await chooser
            ).setFiles([
              { name: 'quota-trace.log', mimeType: 'text/plain', buffer: Buffer.alloc(14 * 1024, 'x') },
              { name: 'capsule-after-the-weekly-reset.png', mimeType: 'image/png', buffer: CAPSULE_PNG },
            ]);
            await page.getByTestId('composer-attachment-tile').nth(1).waitFor();
            await parkPointer(page);
          },
          wait: 600,
        },
        {
          id: 'draft-code',
          caption: '**A code annotation** from the editor: its lines, and a note edited from the tile (C14).',
          crop: around(24),
          setup: async ({ page }) => {
            await openWorkspaceFiles(page, ['index.ts']);
            await page.getByTestId('editor-code').locator('.cm-line').first().click();
            await page.getByTestId('editor-code').locator('.cm-line').first().click({ button: 'right' });
            await page.getByTestId('editor-context-menu-add-context').click();
            await page.getByTestId('composer-note-add').click();
            await page.getByTestId('composer-note-input').fill('Keep the greeting');
            await page.getByTestId('composer-note-input').press('Enter');
            await page.getByTestId('surface-rail-workspace').click();
            await page.getByTestId('composer-code-tile').hover();
          },
          wait: 600,
        },
        {
          id: 'draft-quote',
          caption:
            '**A quote** sits right above the field: one line, where it is from, the whole of it in its tooltip.',
          crop: around(24),
          setup: async ({ page }) => {
            await page.getByTestId('chat-assistant-message').last().locator('p').first().selectText();
            await page.mouse.up();
            await page.getByTestId('chat-selection-quote').click();
            await page.getByTestId('composer-quote-preview').waitFor();
            await field(page).fill('And keep the reset time.');
            await parkPointer(page);
          },
          wait: 600,
        },
      ],
    },
    // ── An ongoing session: context ring, permissions, widths ────────────────
    {
      board: 'Chat-Composer',
      launch: { recordingKey: 'composer-running', mockMaxDelayMs: 3_600_000 },
      before,
      seed: async (ctx) => {
        await seed(ctx);
        await turn(ctx.page, 'Where does the quota reset?');
      },
      states: [
        {
          id: 'idle',
          caption:
            '**Idle.** `+`, model with its effort, permissions, context ring, Send (C4). Where it runs below (K8).',
          crop: around(40),
          setup: async ({ page }) => parkPointer(page),
        },
        {
          id: 'planning',
          caption: '**Planning** is a status on the permissions, with the mode that follows the plan (C1).',
          crop: around(16),
          setup: async (ctx) => {
            await daemonFetch(`/api/chats/${ctx.vars['chat']}/config`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ planMode: true, permissionMode: 'acceptEdits' }),
            });
            await ctx.page.locator('[data-testid="composer-permission-mode-select"][data-planning]').waitFor();
          },
        },
        {
          id: 'context-warn',
          caption: '**Context at 84 %**: warning colour from 80 % (C2).',
          crop: around(16),
          setup: async ({ page, vars }) => {
            await daemonFetch(`/api/chats/${vars['chat']}/config`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ planMode: false, permissionMode: 'default' }),
            });
            await turn(page, 'Read the tests around it');
            await parkPointer(page);
          },
        },
        {
          id: 'context-critical',
          caption: '**Context at 96 %**: critical from 95 %, and the ring offers “Compact conversation”.',
          crop: around(16),
          setup: async ({ page }) => {
            await turn(page, 'Write the missing test');
            await parkPointer(page);
          },
        },
        {
          id: 'unattended',
          caption: '**Unattended** shows only here: warning ink on a tinted chip (C13).',
          crop: around(16),
          setup: async ({ page }) => {
            await page.getByTestId('composer-permission-mode-select').click();
            await page.getByTestId('composer-permission-mode-select-option-yolo').click();
            await page.getByTestId('composer-unattended-confirm-confirm').click();
            await parkPointer(page);
          },
        },
        narrow(520, '**Under 560 px** the model truncates first.'),
        narrow(380, '**Under 400 px** model and permissions are one chip; only the model name truncates (C6).'),
        narrow(300, '**Under 320 px** the chip is the permission alone; the controls wrap onto a second row.'),
      ],
    },
    // ── The activity strip ───────────────────────────────────────────────────
    {
      board: 'Chat-Composer',
      launch: { recordingKey: 'composer-running', mockMaxDelayMs: 3_600_000 },
      before: async (page) => {
        await before(page);
        await stubActivity(page);
      },
      seed: async (ctx) => {
        await seed(ctx);
        await turn(ctx.page, 'Where does the quota reset?');
      },
      states: [
        {
          id: 'activity',
          caption: '**Ongoing work**, one row each, in a drawer tucked behind the card (K2, K4).',
          crop: around(16),
          setup: async ({ page }) => {
            await page.getByTestId('composer-activity-strip').waitFor();
            await parkPointer(page);
          },
        },
        {
          id: 'activity-folded',
          caption: '**Folded** to the first row and how many more there are (K5).',
          crop: around(16),
          setup: async ({ page }) => {
            await page.getByTestId('composer-activity-toggle').click();
            await parkPointer(page);
          },
        },
      ],
    },
    // ── Delegated work: rows with their own Stop, and needs you ──────────────
    {
      board: 'Chat-Composer',
      launch: { recordingKey: 'delegate-gate', mockMaxDelayMs: 2_500 },
      before,
      seed: async (ctx) => {
        await seed(ctx);
        await turn(ctx.page, 'Have another agent check the migration');
      },
      states: [
        {
          id: 'delegated-waiting',
          caption: '**A request shows above**, so the strip steps back: the row being answered is left out (K10).',
          crop: around(16),
          setup: async ({ page }) => {
            await page.getByText('1 more waiting').waitFor();
            await page.getByTestId('composer-activity-summary').waitFor();
            await parkPointer(page);
          },
          wait: 600,
        },
        {
          id: 'delegated-expanded',
          caption: '**Unfolded while it waits**: the rest of the ongoing work, each row with its own Stop.',
          crop: around(16),
          setup: async ({ page }) => {
            await page.getByTestId('composer-activity-gate-toggle').click();
            await parkPointer(page);
          },
        },
      ],
    },
    // ── Menus ────────────────────────────────────────────────────────────────
    {
      board: 'Chat-ComposerMenus',
      launch: { recordingKey: 'composer-running', mockMaxDelayMs: 3_600_000, mockSwitch: true },
      before,
      seed,
      states: [
        menu('project', '**Project** (⌘;): recent first, then “No project”.', async ({ page }) => {
          await page.getByTestId('sidebar-action-new-thread').click();
          await page.getByTestId('composer-branch-picker').waitFor();
          await page.getByTestId('welcome-project').click();
        }),
        menu(
          'branch',
          '**Branch** (K7): search, the branches, then a new worktree or a temporary session.',
          async ({ page }) => {
            await page.getByTestId('composer-branch-picker').click();
            await page.getByTestId('composer-branch-option-main').waitFor();
          },
        ),
        menu('branch-worktree', '**New worktree on**: name the branch it creates.', async ({ page }) => {
          await page.getByTestId('composer-branch-picker').click();
          await page.getByTestId('composer-branch-new-worktree').click();
        }),
        menu('model-draft', '**Model, before the first message**: a tab picks the provider.', async ({ page }) => {
          await page.getByTestId('composer-model-select').click();
        }),
        menu(
          'add',
          '**`+`**: attach files, or mention a file or agent (C4).',
          async ({ page }) => {
            await page.getByTestId('composer-add-menu').click();
          },
          120,
        ),
        menu(
          'permissions',
          '**Permissions**, least to most permissive.',
          async ({ page }) => {
            await page.getByTestId('composer-permission-mode-select').click();
          },
          260,
        ),
        {
          id: 'unattended-confirm',
          caption: '**Unattended asks once per session** (C13).',
          crop: [317, 0, 1123, 900],
          setup: async ({ page }) => {
            await page.getByTestId('composer-permission-mode-select-option-yolo').click();
            await page.getByTestId('composer-unattended-confirm').waitFor();
          },
          wait: 500,
        },
        {
          id: 'model-session',
          caption:
            '**Model, in a session**: a tab only browses. Picking another provider’s model switches in place (C5).',
          crop: around(420),
          wait: 500,
          setup: async ({ page, vars }) => {
            await page.getByTestId('composer-unattended-confirm-cancel').click();
            await page.locator(`[data-testid="sessions-row"][data-chat-id="${vars['chat']}"]`).click();
            await turn(page, 'Where does the quota reset?');
            await page.getByTestId('composer-model-select').click();
          },
        },
        menu('model-other', '**Another provider’s tab**, browsed.', async ({ page }) => {
          await page.getByTestId('composer-model-select').click();
          await page.getByTestId('composer-adapter-select-option-mock-cli-b').click();
        }),
        menu(
          'worktree',
          '**Where it runs** (K8): isolate the session in a worktree.',
          async ({ page }) => {
            await page.getByTestId('composer-worktree-trigger').click();
            await page.getByTestId('composer-worktree-tab-new').waitFor();
          },
          260,
        ),
        menu(
          'branches',
          '**Branch**: today’s branch menu, from the bottom strip.',
          async ({ page }) => {
            await page.getByTestId('composer-branch').click();
            await page.getByTestId('git-branch-popover').waitFor();
          },
          320,
        ),
        menu(
          'model-locked',
          '**Running**: the model is locked, readable, and says when it applies (C5).',
          async ({ page }) => {
            await turn(page, 'Read the tests around it');
            await turn(page, 'Write the missing test');
            await sendMessage(page, 'Fix the reset');
            await page.getByTestId('chat-composer-cancel').waitFor();
            await page.getByTestId('composer-model-select').hover();
          },
          60,
        ),
        menu(
          'queue-steer',
          '**Queue or Steer** (C9). ⌥↵ does the one Enter doesn’t.',
          async ({ page }) => {
            await field(page).fill('Also cover the DST case');
            await page.getByTestId('chat-composer-send-options').click();
          },
          120,
        ),
      ],
    },
    // ── One turn ─────────────────────────────────────────────────────────────
    {
      board: 'Chat-ComposerFlow',
      launch: { recordingKey: 'composer-running', mockMaxDelayMs: 3_600_000 },
      before,
      seed: async (ctx) => {
        await seed(ctx);
        const { page } = ctx;
        await turn(page, 'Where does the quota reset?');
        await turn(page, 'Read the tests around it');
        await turn(page, 'Write the missing test');
      },
      states: [
        {
          id: 'running',
          caption: '**1. Running.** Stop takes Send’s place; the placeholder says what Enter does (C7, C8).',
          crop: around(120),
          setup: async ({ page }) => {
            await sendMessage(page, 'Fix the reset');
            await page.getByTestId('chat-composer-cancel').waitFor();
            await page.waitForTimeout(400);
            await parkPointer(page);
          },
        },
        {
          id: 'running-typed',
          caption: '**2. Typing.** Queue ↵ with its chevron; Stop stays its own button (C9).',
          crop: around(40),
          setup: async ({ page }) => field(page).fill('Also cover the DST case'),
        },
        {
          id: 'queued',
          caption: '**3. Queued.** Rows at the top of the card, each with edit and remove (C10).',
          crop: around(40),
          setup: async ({ page }) => {
            await page.keyboard.press('Enter');
            await page.getByTestId('chat-queued-message').first().waitFor();
            await field(page).fill('Then open a PR');
            await page.keyboard.press('Enter');
            await page.getByTestId('chat-queued-message').nth(1).waitFor();
            await parkPointer(page);
          },
        },
        {
          id: 'editing',
          caption: '**4. Editing a queued message** in the composer; it stays queued.',
          crop: around(40),
          setup: async ({ page }) => {
            await page.getByTestId('chat-queued-edit').first().click();
            await page.getByTestId('chat-composer-edit').waitFor();
          },
        },
        {
          id: 'stopped',
          caption: '**5. Stopped.** The first row says it was not sent, with Send now; the next waits behind it (C10).',
          crop: around(40),
          setup: async ({ page }) => {
            await page.getByTestId('chat-composer-edit-cancel').click();
            await page.getByTestId('chat-composer-cancel').click();
            await page.getByTestId('chat-queued-send-now').waitFor();
            await page.getByTestId('chat-composer-cancel').waitFor({ state: 'detached' });
            await parkPointer(page);
          },
          wait: 1_500,
        },
      ],
    },
    // ── Focus and gates ──────────────────────────────────────────────────────
    {
      board: 'Chat-ComposerFocus',
      launch: { recordingKey: 'permissions-no-suggestions' },
      before,
      seed,
      states: [
        {
          id: 'focused',
          caption: '**Focused.** The card’s hairline becomes the solid 2 px focus line (C3).',
          crop: around(16),
          setup: async ({ page }) => {
            await field(page).click();
            await page.keyboard.type('Add a test for the greeting');
          },
        },
        {
          id: 'chip-focused',
          caption: '**A toolbar control focused** draws its own line; the card’s stays off.',
          crop: around(16),
          setup: async ({ page }) => {
            await field(page).focus();
            await page.keyboard.press('Tab');
            await page.keyboard.press('Tab');
          },
        },
        {
          id: 'permission',
          caption: '**Permission** (G2): allow once is the default answer; the composer below stays usable.',
          crop: around(40),
          setup: async ({ page }) => {
            await field(page).fill('');
            await escape(page);
            await sendMessage(page, 'Write /tmp/mf-e2e-nosuggest.txt');
            await page.getByTestId('chat-permission-gate').waitFor();
            await parkPointer(page);
          },
          wait: 800,
        },
      ],
    },
    {
      board: 'Chat-ComposerFocus',
      launch: { recordingKey: 'permissions-many' },
      before,
      seed,
      states: [
        {
          id: 'permission-long',
          caption:
            '**A long list** (G2): the button counts what “always” saves, the answers stay in view while the list scrolls, and hidden characters are spelled out.',
          crop: around(40),
          setup: async ({ page }) => {
            await sendMessage(page, 'Build and test the workspace');
            await page.getByTestId('chat-permission-gate').waitFor();
            await parkPointer(page);
          },
          wait: 800,
        },
        {
          id: 'permission-left-out',
          caption: '**What is left out** is said at the end of the list: a wider mode is never saved from a prompt.',
          crop: around(40),
          setup: async ({ page }) => {
            await page.getByTestId('chat-thread-gate-slot').evaluate((slot) => slot.scrollTo(0, slot.scrollHeight));
          },
        },
      ],
    },
    {
      board: 'Chat-ComposerFocus',
      launch: { recordingKey: 'delegate-gate', mockMaxDelayMs: 2_500 },
      before,
      seed: async (ctx) => {
        await seed(ctx);
        await turn(ctx.page, 'Have another agent check the migration');
      },
      states: [
        {
          id: 'permission-task',
          caption: '**A delegated task asks** (G5): the eyebrow names it, “always” names the rule it saves.',
          crop: around(40),
          setup: async ({ page }) => {
            await page.getByTestId('chat-permission-gate').waitFor();
            await parkPointer(page);
          },
          wait: 800,
        },
      ],
    },
    {
      board: 'Chat-ComposerFocus',
      launch: { recordingKey: 'ask-question-multi' },
      before,
      seed: async (ctx) => {
        await seed(ctx);
        await sendMessage(ctx.page, 'Ask me how to ship this');
      },
      states: [
        {
          id: 'question',
          caption: '**Question** (G4): the question is the title; its context sits under it.',
          crop: around(40),
          setup: async ({ page }) => {
            await page.getByTestId('chat-question-gate').waitFor();
            await page.getByTestId('chat-question-option-0-OAuth2').click();
            await parkPointer(page);
          },
          wait: 600,
        },
        {
          id: 'question-multi',
          caption: '**Second question**: select all that apply.',
          crop: around(40),
          setup: async ({ page }) => {
            await page.getByTestId('chat-question-next').click();
            await page.getByTestId('chat-question-option-1-Staging').click();
            await parkPointer(page);
          },
        },
      ],
    },
    {
      board: 'Chat-ComposerFocus',
      launch: { recordingKey: 'composer-plan' },
      before,
      seed: async (ctx) => {
        await seed(ctx);
        await daemonFetch(`/api/chats/${ctx.vars['chat']}/config`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planMode: true, permissionMode: 'acceptEdits' }),
        });
        await sendMessage(ctx.page, 'Plan the quota fix');
      },
      states: [
        {
          id: 'plan',
          caption: '**Plan** (G3): the mode segment starts on the composer’s own mode.',
          crop: around(40),
          setup: async ({ page }) => {
            await page.getByTestId('chat-plan-gate').waitFor({ timeout: 30_000 });
            await parkPointer(page);
          },
          wait: 800,
        },
      ],
    },
  ],
};

export default area;
